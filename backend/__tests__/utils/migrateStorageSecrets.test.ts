import Cryptr from 'cryptr';
import { migrateStorageSecrets } from '../../src/utils/migrateStorageSecrets';

jest.mock('cryptr');
jest.mock('../../src/services/ConfigService', () => ({
	configService: { config: { SECRET: 'test-secret' } },
}));

const makeDb = (rows: any[]) => {
	const run = jest.fn();
	const where = jest.fn(() => ({ run }));
	const set = jest.fn(() => ({ where }));
	const update = jest.fn(() => ({ set }));
	const all = jest.fn().mockResolvedValue(rows);
	const from = jest.fn(() => ({ all }));
	const select = jest.fn(() => ({ from }));
	return { db: { select, update } as any, select, update, set, where, run };
};

describe('migrateStorageSecrets', () => {
	let encrypt: jest.Mock;
	let logSpy: jest.SpyInstance;
	let errorSpy: jest.SpyInstance;

	beforeEach(() => {
		jest.clearAllMocks();
		encrypt = jest.fn((v: string) => `encrypted(${v})`);
		(Cryptr as unknown as jest.Mock).mockImplementation(() => ({ encrypt }));
		logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
		errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
	});

	afterEach(() => {
		logSpy.mockRestore();
		errorSpy.mockRestore();
	});

	it('moves plain webdav user and pass into encrypted credentials', async () => {
		const { db, set, where, run } = makeDb([
			{
				id: 'dav-1',
				type: 'webdav',
				settings: { vendor: 'nextcloud', user: 'bob', pass: 'hunter2' },
				credentials: { url: 'encrypted(https://dav)' },
			},
		]);

		await migrateStorageSecrets(db);

		expect(Cryptr).toHaveBeenCalledWith('test-secret');
		expect(set).toHaveBeenCalledWith({
			settings: { vendor: 'nextcloud' },
			credentials: {
				url: 'encrypted(https://dav)',
				user: 'encrypted(bob)',
				pass: 'encrypted(hunter2)',
			},
		});
		expect(where).toHaveBeenCalledTimes(1);
		expect(run).toHaveBeenCalledTimes(1);
	});

	it('keeps an existing credential key and does not re-encrypt it', async () => {
		const { db, set } = makeDb([
			{
				id: 'dav-1',
				type: 'webdav',
				settings: { vendor: 'other', pass: 'plain-pass', user: 'bob' },
				credentials: { pass: 'encrypted(old-pass)' },
			},
		]);

		await migrateStorageSecrets(db);

		expect(encrypt).not.toHaveBeenCalledWith('plain-pass');
		expect(encrypt).toHaveBeenCalledWith('bob');
		expect(set).toHaveBeenCalledWith({
			settings: { vendor: 'other' },
			credentials: { pass: 'encrypted(old-pass)', user: 'encrypted(bob)' },
		});
	});

	it('skips the local row and rows with a null or unknown type', async () => {
		const { db, update } = makeDb([
			{ id: 'local', type: 'local', settings: { pass: 'x' }, credentials: {} },
			{ id: 'no-type', type: null, settings: { pass: 'x' }, credentials: {} },
			{ id: 'unknown', type: 'not-a-provider', settings: { pass: 'x' }, credentials: {} },
		]);

		await migrateStorageSecrets(db);

		expect(update).not.toHaveBeenCalled();
		expect(Cryptr).not.toHaveBeenCalled();
	});

	it('does not update a row without secrets in settings', async () => {
		const { db, update } = makeDb([
			{
				id: 'dav-1',
				type: 'webdav',
				settings: { vendor: 'nextcloud' },
				credentials: { user: 'encrypted(bob)', pass: 'encrypted(p)' },
			},
			{ id: 'dav-2', type: 'webdav', settings: null, credentials: null },
		]);

		await migrateStorageSecrets(db);

		expect(update).not.toHaveBeenCalled();
		expect(logSpy).not.toHaveBeenCalled();
	});

	it('removes an empty secret from settings without adding a credential', async () => {
		const { db, set } = makeDb([
			{ id: 'dav-1', type: 'webdav', settings: { vendor: 'x', pass: '' }, credentials: {} },
		]);

		await migrateStorageSecrets(db);

		expect(set).toHaveBeenCalledWith({ settings: { vendor: 'x' }, credentials: {} });
		expect(encrypt).not.toHaveBeenCalled();
	});

	it('continues with the next row when an update throws', async () => {
		const { db, run } = makeDb([
			{ id: 'dav-1', type: 'webdav', settings: { pass: 'p1' }, credentials: {} },
			{ id: 'dav-2', type: 'webdav', settings: { pass: 'p2' }, credentials: {} },
		]);
		run.mockImplementationOnce(() => {
			throw new Error('db locked');
		});

		await expect(migrateStorageSecrets(db)).resolves.toBeUndefined();

		expect(run).toHaveBeenCalledTimes(2);
		expect(errorSpy).toHaveBeenCalledWith(
			'[migrateStorageSecrets] Failed to migrate storage dav-1:',
			'db locked'
		);
		expect(logSpy).toHaveBeenCalledWith(
			'[migrateStorageSecrets] Moved secrets of 1 storage(s) to credentials.'
		);
	});

	it('does not write secret values to the console', async () => {
		const { db, run } = makeDb([
			{
				id: 'dav-1',
				type: 'webdav',
				settings: { user: 'secret-user', pass: 'secret-pass' },
				credentials: {},
			},
			{
				id: 'dav-2',
				type: 'webdav',
				settings: { bearer_token: 'secret-token' },
				credentials: {},
			},
		]);
		run.mockImplementationOnce(() => {
			throw new Error('db locked');
		});

		await migrateStorageSecrets(db);

		const output = JSON.stringify([...logSpy.mock.calls, ...errorSpy.mock.calls]);
		['secret-user', 'secret-pass', 'secret-token'].forEach(secret => {
			expect(output).not.toContain(secret);
		});
	});
});
