import request from 'supertest';
import express, { Express } from 'express';
import { createUserRouter } from '../../src/routes/users';
import { UserController } from '../../src/controllers/UserController';
import { configService } from '../../src/services/ConfigService';
import jwt from 'jsonwebtoken';
import Cookies from 'cookies';
import session from 'express-session';
import Cryptr from 'cryptr';
import * as otpauth from 'otpauth';

jest.mock('jsonwebtoken');
jest.mock('cookies');

const mockVerifyPassword = jest.fn();
const mockHashAndStorePassword = jest.fn();

jest.mock('../../src/services/ConfigService', () => ({
	configService: {
		config: {
			USER_NAME: 'testuser',
			USER_PASSWORD: 'testpass',
			SECRET: 'test-secret',
			SESSION_DURATION: 7,
		},
		verifyPassword: (...args: any[]) => mockVerifyPassword(...args),
		hashAndStorePassword: (...args: any[]) => mockHashAndStorePassword(...args),
	},
}));

const TOTP_SECRET = new otpauth.Secret().base32;
const currentTotpCode = () =>
	new otpauth.TOTP({ secret: otpauth.Secret.fromBase32(TOTP_SECRET) }).generate();

describe('User Routes', () => {
	let app: Express;
	let userController: UserController;
	let mockSettingsService: { getMainSettings: jest.Mock; consumeRecoveryCode: jest.Mock };

	beforeEach(() => {
		jest.clearAllMocks();
		mockVerifyPassword.mockReturnValue(false);
		mockHashAndStorePassword.mockReturnValue('$2a$10$mockhash');
		mockSettingsService = {
			getMainSettings: jest.fn().mockResolvedValue({ id: 1, settings: {} }),
			consumeRecoveryCode: jest.fn().mockResolvedValue(false),
		};
		userController = new UserController(mockSettingsService as any);

		app = express();
		app.use(session({ secret: 'test-session-secret', resave: false, saveUninitialized: false }));
		app.use(express.json());
		app.use('/api/user', createUserRouter(userController));
	});

	describe('POST /api/user/login', () => {
		it('should return 401 if username is missing', async () => {
			const response = await request(app).post('/api/user/login').send({ password: 'testpass' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ error: 'Username & Password Missing' });
		});

		it('should return 401 if password is missing', async () => {
			const response = await request(app).post('/api/user/login').send({ username: 'testuser' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ error: 'Username & Password Missing' });
		});

		it('should return 401 if username is incorrect', async () => {
			mockVerifyPassword.mockReturnValue(true);
			const response = await request(app)
				.post('/api/user/login')
				.send({ username: 'wronguser', password: 'testpass' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ success: false, error: 'Incorrect Username or Password' });
		});

		it('should return 401 if password is incorrect', async () => {
			mockVerifyPassword.mockReturnValue(false);
			const response = await request(app)
				.post('/api/user/login')
				.send({ username: 'testuser', password: 'wrongpass' });

			expect(response.status).toBe(401);
			expect(response.body).toEqual({ success: false, error: 'Incorrect Username or Password' });
		});

		it('should successfully login with correct credentials', async () => {
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');
			mockVerifyPassword.mockReturnValue(true);

			const response = await request(app)
				.post('/api/user/login')
				.send({ username: 'testuser', password: 'testpass' });

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, error: null });
			expect(jwt.sign).toHaveBeenCalledWith({ user: 'testuser' }, 'test-secret', {
				expiresIn: '7d',
			});
		});
	});

	describe('2FA login flow', () => {
		beforeEach(() => {
			(jwt.sign as jest.Mock).mockReturnValue('mock-token');
			mockVerifyPassword.mockReturnValue(true);
			mockSettingsService.getMainSettings.mockResolvedValue({
				id: 1,
				settings: {
					totp: {
						enabled: true,
						secret: new Cryptr('test-secret').encrypt(TOTP_SECRET),
						recoveryCodes: [],
					},
				},
			});
		});

		const tokenCookieSet = (res: request.Response) =>
			([] as string[]).concat(res.headers['set-cookie'] || []).some(c => c.startsWith('token='));

		it('should not issue the token cookie after the password step', async () => {
			const response = await request(app)
				.post('/api/user/login')
				.send({ username: 'testuser', password: 'testpass' });

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, totpRequired: true, error: null });
			expect(tokenCookieSet(response)).toBe(false);
		});

		it('should reject verify-otp without the password step', async () => {
			const response = await request(app)
				.post('/api/user/verify-otp')
				.send({ code: currentTotpCode() });

			expect(response.status).toBe(401);
			expect(tokenCookieSet(response)).toBe(false);
		});

		it('should issue the token cookie after password and a valid code', async () => {
			const agent = request.agent(app);
			await agent.post('/api/user/login').send({ username: 'testuser', password: 'testpass' });

			const response = await agent.post('/api/user/verify-otp').send({ code: currentTotpCode() });

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, error: null });
			expect(tokenCookieSet(response)).toBe(true);

			// The pending login is consumed and cannot be reused
			const reuse = await agent.post('/api/user/verify-otp').send({ code: currentTotpCode() });
			expect(reuse.status).toBe(401);
		});

		it('should require the password again after too many invalid codes', async () => {
			const agent = request.agent(app);
			await agent.post('/api/user/login').send({ username: 'testuser', password: 'testpass' });

			for (let i = 0; i < 5; i++) {
				const res = await agent.post('/api/user/verify-otp').send({ code: '000000' });
				expect(res.status).toBe(401);
			}

			const response = await agent.post('/api/user/verify-otp').send({ code: currentTotpCode() });
			expect(response.status).toBe(401);
			expect(response.body.error).toBe('Login session expired. Please log in again.');
		});
	});

	describe('GET /api/user/validate', () => {
		it('should return 401 if no token is provided', async () => {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue(null),
					}) as any
			);

			const response = await request(app).get('/api/user/validate');

			expect(response.status).toBe(401);
		});

		it('should return 200 if valid token is provided', async () => {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue('valid-token'),
					}) as any
			);
			(jwt.verify as jest.Mock).mockImplementation((token, secret, callback) => {
				callback(null, { user: 'testuser' });
			});

			const response = await request(app)
				.get('/api/user/validate')
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true });
		});
	});

	describe('POST /api/user/logout', () => {
		it('should return 401 if no token is provided', async () => {
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue(null),
					}) as any
			);

			const response = await request(app).post('/api/user/logout');

			expect(response.status).toBe(401);
		});

		it('should successfully logout when authenticated', async () => {
			const mockClearCookie = jest.fn();
			(Cookies as jest.MockedClass<typeof Cookies>).mockImplementation(
				() =>
					({
						get: jest.fn().mockReturnValue('valid-token'),
						set: mockClearCookie,
					}) as any
			);
			(jwt.verify as jest.Mock).mockImplementation((token, secret, callback) => {
				callback(null, { user: 'testuser' });
			});

			const response = await request(app)
				.post('/api/user/logout')
				.set('Cookie', ['token=valid-token']);

			expect(response.status).toBe(200);
			expect(response.body).toEqual({ success: true, message: 'Logged out successfully' });
		});
	});
});
