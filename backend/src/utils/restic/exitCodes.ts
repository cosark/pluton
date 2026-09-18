/**
 * Classification of restic process exit codes so the backup pipeline can decide
 * whether to retry, fail immediately, or treat the result as success-with-warning.
 */

export enum ResticExitCode {
	Success = 0,
	GenericError = 1,
	GoRuntimeError = 2,
	/** backup could not read some source files/dirs (snapshot still created). */
	IncompleteBackup = 3,
	RepositoryDoesNotExist = 10,
	RepositoryLockFailed = 11,
	WrongPassword = 12,
	/** Interrupted via SIGINT/SIGTERM. */
	Interrupted = 130,
}

export type ResticExitCategory = 'success' | 'warning' | 'retryable' | 'fatal' | 'cancelled';

export interface ResticExitClassification {
	code?: number;
	category: ResticExitCategory;
	retryable: boolean;
	isWarning: boolean;
	description: string;
}

interface ResticExitCodeMeta {
	name: string;
	category: ResticExitCategory;
	retryable: boolean;
	isWarning: boolean;
	description: string;
}

// Codes 1 and 2 are treated as retryable because they most commonly stem from
// transient conditions (network, storage, memory pressure).
export const RESTIC_EXIT_CODES: Record<number, ResticExitCodeMeta> = {
	[ResticExitCode.Success]: {
		name: 'SUCCESS',
		category: 'success',
		retryable: false,
		isWarning: false,
		description: 'Command was successful.',
	},
	[ResticExitCode.GenericError]: {
		name: 'GENERIC_ERROR',
		category: 'retryable',
		retryable: true,
		isWarning: false,
		description: 'Command failed with a generic error (often a transient network/storage issue).',
	},
	[ResticExitCode.GoRuntimeError]: {
		name: 'GO_RUNTIME_ERROR',
		category: 'retryable',
		retryable: true,
		isWarning: false,
		description: 'Go runtime error (e.g. out of memory); usually transient.',
	},
	[ResticExitCode.IncompleteBackup]: {
		name: 'INCOMPLETE_BACKUP',
		category: 'warning',
		retryable: false,
		isWarning: true,
		description:
			'Backup completed but some source files or directories could not be read. A snapshot was still created.',
	},
	[ResticExitCode.RepositoryDoesNotExist]: {
		name: 'REPOSITORY_DOES_NOT_EXIST',
		category: 'fatal',
		retryable: false,
		isWarning: false,
		description:
			'The repository does not exist. This is a configuration issue that a retry cannot fix.',
	},
	[ResticExitCode.RepositoryLockFailed]: {
		name: 'REPOSITORY_LOCK_FAILED',
		category: 'retryable',
		retryable: true,
		isWarning: false,
		description:
			'Failed to lock the repository (usually a stale or concurrent lock); retrying may succeed.',
	},
	[ResticExitCode.WrongPassword]: {
		name: 'WRONG_PASSWORD',
		category: 'fatal',
		retryable: false,
		isWarning: false,
		description: 'Wrong password - the repository cannot be decrypted. A retry cannot fix this.',
	},
	[ResticExitCode.Interrupted]: {
		name: 'INTERRUPTED',
		category: 'cancelled',
		retryable: false,
		isWarning: false,
		description: 'Restic was interrupted (SIGINT/SIGTERM).',
	},
};

// Unknown/undefined codes default to retryable (transient failure).
export function classifyResticExitCode(code?: number): ResticExitClassification {
	if (code === undefined || code === null) {
		return {
			code,
			category: 'retryable',
			retryable: true,
			isWarning: false,
			description: 'Unknown error (no restic exit code available).',
		};
	}

	const meta = RESTIC_EXIT_CODES[code];
	if (!meta) {
		return {
			code,
			category: 'retryable',
			retryable: true,
			isWarning: false,
			description: `Unrecognized restic exit code ${code}.`,
		};
	}

	return {
		code,
		category: meta.category,
		retryable: meta.retryable,
		isWarning: meta.isWarning,
		description: meta.description,
	};
}

export function isResticBackupWarning(code?: number): boolean {
	return code === ResticExitCode.IncompleteBackup;
}

const RESTORE_METADATA_ERROR_PATTERNS = [
	/^failed to restore timestamp of /,
	/^error restoring creation time for: /,
	/^error restoring file attributes for: /,
	/^error restoring security descriptor for: /,
	/^(lchown|chmod) .*: (operation not permitted|permission denied)$/i,
];

// True when restic restore exited with code 1 and every reported error only failed to apply file metadata.
export function isMetadataOnlyRestoreFailure(code: number | undefined, stderr: string): boolean {
	if (code !== ResticExitCode.GenericError) return false;
	const messages = stderr
		.split(/\r?\n/)
		.filter(line => line.trim())
		.map(line => {
			try {
				return JSON.parse(line);
			} catch {
				return null;
			}
		});
	if (messages.some(m => m?.message_type !== 'error' && m?.message_type !== 'exit_error')) {
		return false;
	}
	const errorLines = messages
		.filter(m => m.message_type === 'error')
		.flatMap(m => String(m.error?.message || '').split(/\r?\n/))
		.filter(line => line.trim());
	return (
		errorLines.length > 0 &&
		errorLines.every(line => RESTORE_METADATA_ERROR_PATTERNS.some(p => p.test(line)))
	);
}

export function isRetryableResticError(code?: number): boolean {
	return classifyResticExitCode(code).retryable;
}

export function isNonRetryableResticError(code?: number): boolean {
	if (code === undefined || code === null) return false;
	const classification = classifyResticExitCode(code);
	return (
		(classification.category === 'fatal' || classification.category === 'cancelled') &&
		!classification.retryable
	);
}
