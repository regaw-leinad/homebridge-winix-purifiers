import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { scrypt } from 'node:crypto';

export class DecryptionFailedError extends Error {
  constructor() {
    super('Decryption failed');
  }
}

export async function encrypt(value: string, password: string): Promise<string> {
  const iv = randomBytes(16);
  const salt = randomBytes(16);
  const key = await generateKey(password, salt);

  const cipher = createCipheriv('aes-256-cbc', key, iv);
  const encryptedData = Buffer.concat([
    cipher.update(value, 'utf8'),
    cipher.final(),
  ]);

  const encryptedMessage = Buffer.concat([salt, iv, encryptedData]);
  return encryptedMessage.toString('base64');
}

export async function decrypt(encryptedValue: string, password: string): Promise<string> {
  const encryptedBuffer = Buffer.from(encryptedValue, 'base64');

  const salt = encryptedBuffer.subarray(0, 16);
  const iv = encryptedBuffer.subarray(16, 32);
  const encryptedData = encryptedBuffer.subarray(32);

  const key = await generateKey(password, salt);

  let decryptedData: Buffer;
  try {
    const decipher = createDecipheriv('aes-256-cbc', key, iv);
    decryptedData = Buffer.concat([
      decipher.update(encryptedData),
      decipher.final(),
    ]);
  } catch (error) {
    throw new DecryptionFailedError();
  }

  return decryptedData.toString('utf8');
}

async function generateKey(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, (err, key) => {
      if (err) {
        reject(err);
      } else {
        resolve(key);
      }
    });
  });
}
