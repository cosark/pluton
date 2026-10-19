import 'express-session';

declare module 'express-session' {
	interface SessionData {
		totpSecret?: string;
		pendingTotpUser?: string;
		totpAttempts?: number;
	}
}
