import {
	credentialsEqual,
	getSecretFieldKeys,
	moveSecretSettings,
	restoreCredentialTypes,
} from '../../src/utils/storageSecrets';
import { providers } from '../../src/utils/providers';

describe('getSecretFieldKeys', () => {
	it('returns the password and auth fields of a provider', () => {
		const keys = getSecretFieldKeys('sftp');
		const expected = providers.sftp.settings
			.filter(f => f.fieldType === 'password' || !!f.authFieldType)
			.map(f => f.value);

		expect(keys).toEqual(expected);
		expect(keys).toEqual(expect.arrayContaining(['host', 'user', 'pass', 'key_file_pass']));
	});

	it('includes the webdav auth fields and skips plain settings', () => {
		const keys = getSecretFieldKeys('webdav');

		expect(keys).toEqual(expect.arrayContaining(['url', 'user', 'pass', 'bearer_token']));
		expect(keys).not.toContain('vendor');
		expect(keys).not.toContain('bearer_token_command');
	});

	it('returns an empty list for an unknown type', () => {
		expect(getSecretFieldKeys('does-not-exist')).toEqual([]);
	});
});

describe('moveSecretSettings', () => {
	it('moves a secret key from settings to credentials', () => {
		const result = moveSecretSettings(
			'webdav',
			{ vendor: 'nextcloud', user: 'bob', pass: 'secret' },
			{ url: 'https://dav' }
		);

		expect(result.settings).toEqual({ vendor: 'nextcloud' });
		expect(result.credentials).toEqual({ url: 'https://dav', user: 'bob', pass: 'secret' });
	});

	it('keeps the credentials value when both objects have the key', () => {
		const result = moveSecretSettings(
			'webdav',
			{ pass: 'from-settings' },
			{ pass: 'from-credentials' }
		);

		expect(result.settings).toEqual({});
		expect(result.credentials).toEqual({ pass: 'from-credentials' });
	});

	it.each([[''], [null], [undefined]])(
		'removes an empty value (%p) from settings and does not add it to credentials',
		value => {
			const result = moveSecretSettings('webdav', { vendor: 'other', pass: value }, {});

			expect(result.settings).toEqual({ vendor: 'other' });
			expect('pass' in result.settings).toBe(false);
			expect('pass' in result.credentials).toBe(false);
		}
	);

	it('moves user for webdav', () => {
		const result = moveSecretSettings('webdav', { user: 'bob' }, {});

		expect(result.settings).toEqual({});
		expect(result.credentials).toEqual({ user: 'bob' });
	});

	it('moves a provider password field such as sftp key_file_pass', () => {
		const result = moveSecretSettings('sftp', { key_file_pass: 'kfp', idle_timeout: '1m0s' }, {});

		expect(result.settings).toEqual({ idle_timeout: '1m0s' });
		expect(result.credentials).toEqual({ key_file_pass: 'kfp' });
	});

	it('returns settings unchanged for an unknown type', () => {
		const settings = { pass: 'secret', foo: 'bar' };
		const credentials = { a: 'b' };
		const result = moveSecretSettings('does-not-exist', settings, credentials);

		expect(result.settings).toEqual(settings);
		expect(result.credentials).toEqual(credentials);
	});

	it('does not mutate the inputs', () => {
		const settings = { vendor: 'nextcloud', user: 'bob', pass: 'secret' };
		const credentials = { url: 'https://dav' };
		const settingsCopy = { ...settings };
		const credentialsCopy = { ...credentials };

		const result = moveSecretSettings('webdav', settings, credentials);

		expect(settings).toEqual(settingsCopy);
		expect(credentials).toEqual(credentialsCopy);
		expect(result.settings).not.toBe(settings);
		expect(result.credentials).not.toBe(credentials);
	});

	it('handles missing settings and credentials', () => {
		expect(moveSecretSettings('webdav')).toEqual({ settings: {}, credentials: {} });
	});
});

describe('restoreCredentialTypes', () => {
	it('converts bool and int fields back to their type', () => {
		const result = restoreCredentialTypes('ftp', {
			host: 'ftp.example.com',
			port: '21',
			tls: 'true',
			explicit_tls: 'false',
		});

		expect(result).toEqual({ host: 'ftp.example.com', port: 21, tls: true, explicit_tls: false });
	});

	it('keeps values that do not match the field type', () => {
		const result = restoreCredentialTypes('ftp', { port: 'abc', tls: 'yes' });

		expect(result).toEqual({ port: 'abc', tls: 'yes' });
	});

	it('keeps an empty int value as text', () => {
		expect(restoreCredentialTypes('sftp', { port: '' })).toEqual({ port: '' });
	});

	it('does not convert string fields that look like a bool or number', () => {
		const result = restoreCredentialTypes('webdav', { user: 'true', pass: '123' });

		expect(result).toEqual({ user: 'true', pass: '123' });
	});

	it('returns the values unchanged for an unknown type', () => {
		expect(restoreCredentialTypes('does-not-exist', { tls: 'true' })).toEqual({ tls: 'true' });
	});

	it('does not change the input object', () => {
		const input = { tls: 'true' };
		restoreCredentialTypes('ftp', input);

		expect(input).toEqual({ tls: 'true' });
	});
});

describe('credentialsEqual', () => {
	it('treats typed values as equal to their text form', () => {
		expect(credentialsEqual({ port: '22', tls: 'false' }, { port: 22, tls: false })).toBe(true);
	});

	it('ignores key order', () => {
		expect(credentialsEqual({ user: 'a', pass: 'b' }, { pass: 'b', user: 'a' })).toBe(true);
	});

	it('detects a changed value', () => {
		expect(credentialsEqual({ port: '22' }, { port: 2222 })).toBe(false);
	});

	it('detects an added or removed key', () => {
		expect(credentialsEqual({ user: 'a' }, { user: 'a', key_file_pass: 'x' })).toBe(false);
		expect(credentialsEqual({ user: 'a', key_file_pass: 'x' }, { user: 'a' })).toBe(false);
	});

	it('treats a missing key and an empty value as equal', () => {
		expect(credentialsEqual({ user: 'a' }, { user: 'a', key_file_pass: '' })).toBe(true);
	});
});
