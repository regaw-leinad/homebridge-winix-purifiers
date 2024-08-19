import path from 'node:path';
import { RefreshTokenExpiredError, WinixAccount, WinixAuth, WinixAuthResponse, WinixDevice } from 'winix-api';
import { WinixPluginAuth } from './config';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

const TOKEN_DIRECTORY_NAME = 'winix-purifiers';
const TOKEN_FILE_NAME = 'token.json';

export class NotConfiguredError extends Error {
  constructor() {
    super('Account not configured');
  }
}

export class UnauthenticatedError extends Error {
  constructor() {
    super('Account not authenticated');
  }
}

export class WinixHandler {
  private readonly refreshTokenPath: string;
  private auth?: WinixPluginAuth;
  private winix?: WinixAccount;

  constructor(storagePath: string) {
    this.refreshTokenPath = path.join(storagePath, TOKEN_DIRECTORY_NAME, TOKEN_FILE_NAME);
  }

  /**
   * Refresh the Winix account's auth. If the refresh token is expired or does not exist, the account will be logged in again. If the
   * account is not configured, a NotConfiguredError will be thrown.
   *
   * @param auth The existing auth credentials
   */
  async refresh(auth: WinixPluginAuth): Promise<void> {
    this.ensureConfigured(auth);

    const refreshToken = await this.getRefreshToken();

    if (!refreshToken) {
      await this.login(auth.username, auth.password);
      return;
    }

    let response: WinixAuthResponse | undefined;

    try {
      response = await WinixAuth.refresh(refreshToken, auth.userId);
    } catch (e: unknown) {
      if (!(e instanceof RefreshTokenExpiredError)) {
        const message = getErrorMessage(e);
        throw new Error(message);
      }
    }

    if (!response) {
      await this.login(auth.username, auth.password);
      return;
    }

    await this.setRefreshToken(response.refreshToken);
    this.auth = auth;
    this.winix = await WinixAccount.from(auth.username, response);
  }

  /**
   * Log in to the Winix account.
   *
   * @param email The email address
   * @param password The password
   */
  async login(email: string, password: string): Promise<WinixPluginAuth> {
    let response: WinixAuthResponse;

    try {
      response = await WinixAuth.login(email, password, 3);
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      throw new Error(message);
    }

    await this.setRefreshToken(response.refreshToken);
    this.winix = await WinixAccount.from(email, response);
    this.auth = { username: email, userId: response.userId, password: password };

    return this.auth;
  }

  async getRefreshToken(): Promise<string> {
    await this.ensureFileExists();
    return await readFile(this.refreshTokenPath, { encoding: 'utf8' }) ?? '';
  }

  async getDevices(): Promise<WinixDevice[]> {
    if (!this.winix || !this.auth) {
      throw new UnauthenticatedError();
    }

    let devices: WinixDevice[] | undefined;

    try {
      devices = await this.winix.getDevices();
    } catch (e: unknown) {
      if (!(e instanceof RefreshTokenExpiredError)) {
        throw e;
      }

      // if we get a refresh token expiry, we need to re-login and get devices again
      await this.login(this.auth.username, this.auth.password);
      return await this.winix.getDevices();
    }

    return devices;
  }

  private ensureConfigured(auth: WinixPluginAuth): void {
    if (!auth.username || !auth.userId || !auth.password) {
      throw new NotConfiguredError();
    }
  }

  private async setRefreshToken(token: string): Promise<void> {
    await this.ensureDirectoryExists();
    await writeFile(this.refreshTokenPath, token, { encoding: 'utf8' });
  }

  private async ensureFileExists(): Promise<void> {
    await this.ensureDirectoryExists();
    await writeFile(this.refreshTokenPath, '', { flag: 'a' });
  }

  private async ensureDirectoryExists(): Promise<void> {
    await mkdir(path.dirname(this.refreshTokenPath), { recursive: true });
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
