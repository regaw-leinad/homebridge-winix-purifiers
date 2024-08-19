export const PLATFORM_NAME = 'WinixPurifiers';
export const PLUGIN_NAME = 'homebridge-winix-purifiers';

// Use the `WINIX_ENCRYPTION_KEY` environment variable as the encryption key. If it is not set, use a default value.
// Yes, this is not secure unless you set the `WINIX_ENCRYPTION_KEY` environment variable.
export const ENCRYPTION_KEY = process.env.WINIX_ENCRYPTION_KEY || 'hwp-b87fbda6-44e6-4101-9f4e-38685d08cd9f';
