import {
	ResticExitCode,
	classifyResticExitCode,
	isResticBackupWarning,
	isRetryableResticError,
	isNonRetryableResticError,
	isMetadataOnlyRestoreFailure,
} from '../../../src/utils/restic/exitCodes';

describe('isMetadataOnlyRestoreFailure', () => {
	const timestampError =
		'{"message_type":"error","error":{"message":"failed to restore timestamp of \\"C:\\\\\\\\R\\\\\\\\C\\\\\\\\Users\\": Access is denied."},"during":"restore","item":"\\\\C\\\\Users"}';
	const fileError =
		'{"message_type":"error","error":{"message":"open C:\\\\R\\\\disk.vhdx: There is not enough space on the disk."},"during":"restore","item":"\\\\disk.vhdx"}';
	const exitError = '{"message_type":"exit_error","code":1,"message":"Fatal: There were 1 errors"}';

	it('returns true when every error is a metadata error', () => {
		expect(isMetadataOnlyRestoreFailure(1, `${timestampError}\n${exitError}`)).toBe(true);
	});

	it('returns true for the multi-line Windows metadata error', () => {
		const windowsError =
			'{"message_type":"error","error":{"message":"error restoring creation time for: C:\\\\R\\\\C\\\\Users : Access is denied.\\nerror restoring file attributes for: C:\\\\R\\\\C\\\\Users : Access is denied."},"during":"restore","item":"\\\\C\\\\Users"}';
		expect(isMetadataOnlyRestoreFailure(1, `${windowsError}\n${exitError}`)).toBe(true);
	});

	it('returns false when one line of a multi-line error is not metadata', () => {
		const mixedError =
			'{"message_type":"error","error":{"message":"error restoring creation time for: C:\\\\R\\\\C\\\\Users : Access is denied.\\nopen C:\\\\R\\\\disk.vhdx: Access is denied."},"during":"restore","item":"\\\\C\\\\Users"}';
		expect(isMetadataOnlyRestoreFailure(1, `${mixedError}\n${exitError}`)).toBe(false);
	});

	it('returns false when a file error is also reported', () => {
		expect(isMetadataOnlyRestoreFailure(1, `${timestampError}\n${fileError}\n${exitError}`)).toBe(false);
	});

	it('returns false for non-JSON output', () => {
		expect(isMetadataOnlyRestoreFailure(1, `${timestampError}\nFatal: repository is locked`)).toBe(false);
	});

	it('returns false for other exit codes or no errors', () => {
		expect(isMetadataOnlyRestoreFailure(3, `${timestampError}\n${exitError}`)).toBe(false);
		expect(isMetadataOnlyRestoreFailure(undefined, timestampError)).toBe(false);
		expect(isMetadataOnlyRestoreFailure(1, exitError)).toBe(false);
		expect(isMetadataOnlyRestoreFailure(1, '')).toBe(false);
	});
});

describe('classifyResticExitCode', () => {
	it('classifies exit code 0 as success (not retryable, not a warning)', () => {
		const result = classifyResticExitCode(0);
		expect(result.category).toBe('success');
		expect(result.retryable).toBe(false);
		expect(result.isWarning).toBe(false);
	});

	it('classifies exit code 3 as a success-with-warning that must NOT be retried', () => {
		const result = classifyResticExitCode(ResticExitCode.IncompleteBackup);
		expect(result.category).toBe('warning');
		expect(result.retryable).toBe(false);
		expect(result.isWarning).toBe(true);
	});

	it('classifies exit code 11 (lock failed) as retryable', () => {
		const result = classifyResticExitCode(ResticExitCode.RepositoryLockFailed);
		expect(result.category).toBe('retryable');
		expect(result.retryable).toBe(true);
	});

	it('classifies exit code 12 (wrong password) as fatal / not retryable', () => {
		const result = classifyResticExitCode(ResticExitCode.WrongPassword);
		expect(result.category).toBe('fatal');
		expect(result.retryable).toBe(false);
	});

	it('classifies exit code 10 (repo does not exist) as fatal / not retryable', () => {
		const result = classifyResticExitCode(ResticExitCode.RepositoryDoesNotExist);
		expect(result.category).toBe('fatal');
		expect(result.retryable).toBe(false);
	});

	it('classifies generic error (1) and runtime error (2) as retryable', () => {
		expect(classifyResticExitCode(1).retryable).toBe(true);
		expect(classifyResticExitCode(2).retryable).toBe(true);
	});

	it('classifies interruption (130) as cancelled / not retryable', () => {
		const result = classifyResticExitCode(ResticExitCode.Interrupted);
		expect(result.category).toBe('cancelled');
		expect(result.retryable).toBe(false);
	});

	it('treats unknown or undefined codes as retryable by default', () => {
		expect(classifyResticExitCode(undefined).retryable).toBe(true);
		expect(classifyResticExitCode(999).retryable).toBe(true);
	});
});

describe('isResticBackupWarning', () => {
	it('returns true only for exit code 3', () => {
		expect(isResticBackupWarning(3)).toBe(true);
		expect(isResticBackupWarning(0)).toBe(false);
		expect(isResticBackupWarning(11)).toBe(false);
		expect(isResticBackupWarning(undefined)).toBe(false);
	});
});

describe('isRetryableResticError', () => {
	it('returns true for transient failures (1, 2, 11)', () => {
		expect(isRetryableResticError(1)).toBe(true);
		expect(isRetryableResticError(2)).toBe(true);
		expect(isRetryableResticError(11)).toBe(true);
	});

	it('returns false for permanent failures and warnings (3, 10, 12, 130)', () => {
		expect(isRetryableResticError(3)).toBe(false);
		expect(isRetryableResticError(10)).toBe(false);
		expect(isRetryableResticError(12)).toBe(false);
		expect(isRetryableResticError(130)).toBe(false);
	});
});

describe('isNonRetryableResticError', () => {
	it('is true only for genuine permanent failures', () => {
		expect(isNonRetryableResticError(12)).toBe(true);
		expect(isNonRetryableResticError(10)).toBe(true);
		expect(isNonRetryableResticError(130)).toBe(true);
	});

	it('is false for success, warning, retryable and unknown codes', () => {
		expect(isNonRetryableResticError(0)).toBe(false);
		expect(isNonRetryableResticError(3)).toBe(false); // warning is not a failure
		expect(isNonRetryableResticError(11)).toBe(false);
		expect(isNonRetryableResticError(1)).toBe(false);
		expect(isNonRetryableResticError(undefined)).toBe(false);
	});
});
