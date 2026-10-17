import { Restore } from '../../db/schema/restores';

type RestoreCompleteHook = (restore: Restore) => unknown;

const completeHooks: RestoreCompleteHook[] = [];

export function registerRestoreCompleteHook(fn: RestoreCompleteHook): void {
	completeHooks.push(fn);
}

/** Fire-and-forget: a hook failure never changes the restore result. */
export function runRestoreCompleteHooks(restore: Restore): void {
	for (const hook of completeHooks) {
		Promise.resolve()
			.then(() => hook(restore))
			.catch((error: any) =>
				console.error(`[restore] Completion hook failed for ${restore.id}:`, error?.message || error)
			);
	}
}
