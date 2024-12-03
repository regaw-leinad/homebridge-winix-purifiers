/* eslint-disable no-console */

import { encrypt } from '../src/encryption';

async function main() {
  if (process.argv.length < 4) {
    console.error();
    console.error('Usage: ');
    console.error('       npm run encrypt-password <winix-password> <your-encryption-key>');
    console.error();
    process.exit(1);
  }

  const password = process.argv[2];
  const key = process.argv[3];
  const encrypted = await encrypt(password, key);
  console.log(encrypted);
}

main();
