import { providers } from './providers';

/**
 * Keys of a provider's secret and auth fields. These must be stored in the
 * encrypted `credentials` column, never in the plain `settings` column.
 */
export function getSecretFieldKeys(type: string): string[] {
	const fields = providers[type]?.settings || [];
	return fields.filter(f => f.fieldType === 'password' || !!f.authFieldType).map(f => f.value);
}

/**
 * Cryptr returns text, so decrypted `bool` and `int` values are converted
 * back to their field type for the UI.
 */
export function restoreCredentialTypes(
	type: string,
	credentials: Record<string, string>
): Record<string, string | number | boolean> {
	const fields = providers[type]?.settings || [];
	const result: Record<string, string | number | boolean> = { ...credentials };

	fields.forEach(f => {
		const value = credentials[f.value];
		if (typeof value !== 'string') return;
		if (f.fieldType === 'bool' && (value === 'true' || value === 'false')) {
			result[f.value] = value === 'true';
		} else if (f.fieldType === 'int' && value.trim() !== '' && !isNaN(Number(value))) {
			result[f.value] = Number(value);
		}
	});

	return result;
}

/**
 * Moves secret keys out of `settings` into `credentials`. A key that already
 * exists in `credentials` keeps its value. The input objects are not changed.
 */
export function moveSecretSettings(
	type: string,
	settings: Record<string, any> = {},
	credentials: Record<string, any> = {}
): { settings: Record<string, any>; credentials: Record<string, any> } {
	const newSettings = { ...settings };
	const newCredentials = { ...credentials };

	getSecretFieldKeys(type).forEach(key => {
		if (!(key in newSettings)) return;
		const value = newSettings[key];
		delete newSettings[key];
		if (value === undefined || value === null || value === '') return;
		if (!(key in newCredentials)) {
			newCredentials[key] = value;
		}
	});

	return { settings: newSettings, credentials: newCredentials };
}

/**
 * Compares credentials by their text value. Decrypted values are always text,
 * but the UI sends `bool` and `int` fields back as their own type.
 */
export function credentialsEqual(
	a: Record<string, unknown> = {},
	b: Record<string, unknown> = {}
): boolean {
	const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
	for (const key of keys) {
		if (String(a[key] ?? '') !== String(b[key] ?? '')) return false;
	}
	return true;
}
