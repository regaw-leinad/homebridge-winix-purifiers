import { RefreshTokenExpiredError, WinixAccount, WinixAuth, WinixAuthResponse, WinixDevice } from 'winix-api';
import { NotConfiguredError, UnauthenticatedError, WinixHandler } from '../src/winix';
import { afterEach, beforeEach, describe, expect, it, Mock, vi } from 'vitest';
import { readFile } from 'node:fs/promises';

vi.mock('node:fs/promises');
vi.mock('winix-api');

describe('WinixHandler', () => {
  const mockAuth = {
    username: 'test@example.com',
    password: 'password',
    userId: '12345',
  };

  const mockToken = 'mock-refresh-token';
  const storagePath = '/mock/storage';

  let handler: WinixHandler;

  beforeEach(() => {
    handler = new WinixHandler(storagePath);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('refresh', () => {
    it('should throw NotConfiguredError if account is not configured', async () => {
      await expect(handler.refresh({ username: '', userId: '', password: '' })).rejects.toThrow(NotConfiguredError);
    });

    it('should log in if refresh token does not exist', async () => {
      vi.spyOn(handler as never, 'getRefreshToken').mockResolvedValue(null);
      vi.spyOn(handler, 'login').mockResolvedValue(mockAuth);

      await handler.refresh(mockAuth);

      expect(handler.login).toHaveBeenCalledWith(mockAuth.username, mockAuth.password);
    });

    it('should call WinixAuth.refresh and update token if refresh token exists', async () => {
      const mockResponse = {
        refreshToken: mockToken,
        userId: mockAuth.userId,
      } as WinixAuthResponse;

      vi.spyOn(handler as never, 'getRefreshToken').mockResolvedValue(mockToken);
      vi.spyOn(WinixAuth, 'refresh').mockResolvedValue(mockResponse);
      vi.spyOn(handler as never, 'setRefreshToken').mockResolvedValue(undefined);
      vi.spyOn(WinixAccount, 'from').mockResolvedValue({} as WinixAccount);

      await handler.refresh(mockAuth);

      expect(WinixAuth.refresh).toHaveBeenCalledWith(mockToken, mockAuth.userId);
      expect(handler['setRefreshToken']).toHaveBeenCalledWith(mockToken);
      expect(WinixAccount.from).toHaveBeenCalledWith(mockAuth.username, mockResponse);
    });

    it('should log in again if refresh token is expired', async () => {
      vi.spyOn(handler as never, 'getRefreshToken').mockResolvedValue(mockToken);
      vi.spyOn(WinixAuth, 'refresh').mockRejectedValue(new RefreshTokenExpiredError());
      vi.spyOn(handler, 'login').mockResolvedValue(mockAuth);

      await handler.refresh(mockAuth);

      expect(handler.login).toHaveBeenCalledWith(mockAuth.username, mockAuth.password);
    });

    it('should handle unexpected errors during refresh', async () => {
      vi.spyOn(handler as never, 'getRefreshToken').mockResolvedValue(mockToken);
      vi.spyOn(WinixAuth, 'refresh').mockRejectedValue(new Error('Unexpected error'));

      await expect(handler.refresh(mockAuth)).rejects.toThrow('Unexpected error');
    });
  });

  describe('login', () => {
    it('should log in and set refresh token', async () => {
      const mockResponse = {
        refreshToken: mockToken,
        userId: mockAuth.userId,
      } as WinixAuthResponse;

      vi.spyOn(WinixAuth, 'login').mockResolvedValue(mockResponse);
      vi.spyOn(handler as never, 'setRefreshToken').mockResolvedValue(undefined);
      vi.spyOn(WinixAccount, 'from').mockResolvedValue({} as WinixAccount);

      const result = await handler.login(mockAuth.username, mockAuth.password);

      expect(WinixAuth.login).toHaveBeenCalledWith(mockAuth.username, mockAuth.password, 3);
      expect(handler['setRefreshToken']).toHaveBeenCalledWith(mockToken);
      expect(result).toEqual({
        username: mockAuth.username,
        userId: mockAuth.userId,
        password: mockAuth.password,
      });
    });

    it('should throw an error if login fails', async () => {
      vi.spyOn(WinixAuth, 'login').mockRejectedValue(new Error('Login failed'));
      await expect(handler.login(mockAuth.username, mockAuth.password)).rejects.toThrow('Login failed');
    });
  });

  describe('getRefreshToken', () => {
    it('should read and return the refresh token from file', async () => {
      (readFile as Mock).mockResolvedValue(mockToken);

      const token = await handler.getRefreshToken();

      expect(readFile).toHaveBeenCalledWith(handler['refreshTokenPath'], { encoding: 'utf8' });
      expect(token).toBe(mockToken);
    });

    it('should return empty string if the token does not exist', async () => {
      (readFile as Mock).mockResolvedValue(null);

      const token = await handler.getRefreshToken();

      expect(token).toBe('');
    });

    it('should throw an error if there is an unexpected issue reading the token', async () => {
      (readFile as Mock).mockRejectedValue(new Error('Unexpected error'));
      await expect(handler.getRefreshToken()).rejects.toThrow('Unexpected error');
    });
  });

  describe('getDevices', () => {
    it('should throw UnauthenticatedError if winix is not authenticated', async () => {
      await expect(handler.getDevices()).rejects.toThrow(UnauthenticatedError);
    });

    it('should return devices if winix is authenticated', async () => {
      const mockDevices = [{} as WinixDevice];

      handler['winix'] = {
        getDevices: vi.fn().mockResolvedValue(mockDevices),
      } as unknown as WinixAccount;

      const devices = await handler.getDevices();

      expect(devices).toEqual(mockDevices);
    });

    it('should throw an error if fetching devices fails', async () => {
      handler['winix'] = {
        getDevices: vi.fn().mockRejectedValue(new Error('Failed to fetch devices')),
      } as unknown as WinixAccount;

      await expect(handler.getDevices()).rejects.toThrow('Failed to fetch devices');
    });
  });
});
