import { eq } from 'drizzle-orm';
import Cryptr from 'cryptr';
import { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { storages } from '../db/schema/storages';
import { configService } from '../services/ConfigService';
import { moveSecretSettings } from './storageSecrets';

/**
 * Moves plain-text secrets that older versions saved in `storages.settings`
 * into the encrypted `storages.credentials` column. Safe to run on every start.
 */
export async function migrateStorageSecrets(db: BetterSQLite3Database): Promise<void> {
	const rows = await db.select().from(storages).all();
	let cryptr: Cryptr | null = null;
	let migrated = 0;

	for (const row of rows) {
		if (row.id === 'local' || !row.type) continue;
		try {
			const oldSettings = (row.settings as Record<string, any>) || {};
			const moved = moveSecretSettings(row.type, oldSettings, {});
			if (Object.keys(moved.settings).length === Object.keys(oldSettings).length) continue;

			const credentials = { ...((row.credentials as Record<string, string>) || {}) };
			for (const [key, value] of Object.entries(moved.credentials)) {
				if (key in credentials) continue;
				cryptr = cryptr || new Cryptr(configService.config.SECRET as string);
				credentials[key] = cryptr.encrypt(String(value));
			}

			await db
				.update(storages)
				.set({ settings: moved.settings, credentials })
				.where(eq(storages.id, row.id))
				.run();
			migrated++;
		} catch (error: any) {
			console.error(
				`[migrateStorageSecrets] Failed to migrate storage ${row.id}:`,
				error?.message || error
			);
		}
	}

	if (migrated > 0) {
		console.log(`[migrateStorageSecrets] Moved secrets of ${migrated} storage(s) to credentials.`);
	}
}
