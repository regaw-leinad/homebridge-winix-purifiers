import { describe, expect, it } from 'vitest';
import { decrypt, DecryptionFailedError, encrypt } from '../src/encryption';

describe('Encryption/Decryption', () => {
  const validPassword = 'validPassword123';
  const invalidPassword = 'invalidPassword';
  const testMessage = 'This is a secret message';

  it('should successfully encrypt and decrypt a message with a valid password', async () => {
    const encryptedMessage = await encrypt(testMessage, validPassword);
    expect(encryptedMessage).toBeDefined();
    expect(typeof encryptedMessage).toBe('string');

    const decryptedMessage = await decrypt(encryptedMessage, validPassword);
    expect(decryptedMessage).toBe(testMessage);
  });

  it('should throw DecryptionFailedError when decrypting with an incorrect password', async () => {
    const encryptedMessage = await encrypt(testMessage, validPassword);

    try {
      await decrypt(encryptedMessage, invalidPassword);
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(DecryptionFailedError);
    }
  });

  it('should return different encrypted values for the same message and password', async () => {
    const encryptedMessage1 = await encrypt(testMessage, validPassword);
    const encryptedMessage2 = await encrypt(testMessage, validPassword);

    // Even though the message and password are the same, the salt and IV are random
    expect(encryptedMessage1).not.toBe(encryptedMessage2);
  });

  it('should throw an error when trying to decrypt invalid data', async () => {
    const invalidEncryptedMessage = 'invalidMessage';

    try {
      await decrypt(invalidEncryptedMessage, validPassword);
    } catch (error) {
      expect(error).toBeInstanceOf(DecryptionFailedError);
    }
  });
});
