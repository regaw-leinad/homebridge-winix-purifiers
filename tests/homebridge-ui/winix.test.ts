import { beforeEach, describe, expect, it, vi } from 'vitest';
import { WinixService } from '../../src/homebridge-ui/winix';
import { UnauthenticatedError } from '../../src/winix';
import { WinixDevice } from 'winix-api';

vi.mock('../winix');
const mockAuth = { username: 'test@example.com', password: 'password', userId: '12345' };
const mockDevices = [{ deviceId: '1', deviceAlias: 'Purifier 1', modelName: 'Model A' } as WinixDevice];
const mockStoragePath = '/mock/storage';

describe('WinixService', () => {
  let service: WinixService;

  beforeEach(() => {
    service = new WinixService(mockStoragePath);
  });

  describe('init', () => {
    it('should return needsLogin true if no auth is provided', async () => {
      const response = await service.init();
      expect(response).toEqual({ needsLogin: true });
    });

    it('should return needsLogin true if refreshToken is not available', async () => {
      vi.spyOn(service['winix'], 'getRefreshToken').mockResolvedValue('');

      const result = await service.init(mockAuth);

      expect(result).toEqual({ needsLogin: true });
    });

    it('should return needsLogin false if refresh is successful', async () => {
      vi.spyOn(service['winix'], 'getRefreshToken').mockResolvedValue('valid-token');
      vi.spyOn(service['winix'], 'refresh').mockResolvedValue(undefined);

      const response = await service.init(mockAuth);
      expect(response).toEqual({ needsLogin: false });
    });

    it('should set hasValidAuth to false and return needsLogin true if refresh() throws an error', async () => {
      vi.spyOn(service['winix'], 'getRefreshToken').mockResolvedValue('valid-token');
      vi.spyOn(service['winix'], 'refresh').mockRejectedValue(new Error('Refresh failed'));

      const result = await service.init(mockAuth);

      expect(service['hasValidAuth']).toBe(false);
      expect(result).toEqual({ needsLogin: true });
    });
  });

  describe('login', () => {
    it('should login successfully and return auth details', async () => {
      vi.spyOn(service['winix'], 'login').mockResolvedValue(mockAuth);
      const result = await service.login({ email: 'test@example.com', password: 'password' });
      expect(result).toEqual(mockAuth);
    });
  });

  describe('discoverDevices', () => {
    it('should return devices if authenticated', async () => {
      service['hasValidAuth'] = true;
      vi.spyOn(service['winix'], 'getDevices').mockResolvedValue(mockDevices);

      const result = await service.discoverDevices();
      expect(result.devices).toEqual(mockDevices);
    });

    it('should throw UnauthenticatedError if not authenticated', async () => {
      await expect(service.discoverDevices()).rejects.toThrow(UnauthenticatedError);
    });

    it('should throw UnauthenticatedError if winix.getDevices throws UnauthenticatedError', async () => {
      // Set authentication state to valid
      service['hasValidAuth'] = true;
      // Mock the getDevices method to throw UnauthenticatedError
      vi.spyOn(service['winix'], 'getDevices').mockRejectedValue(new UnauthenticatedError());

      await expect(service.discoverDevices()).rejects.toThrow(UnauthenticatedError);
    });

    it('should rethrow any other error during device discovery', async () => {
      // Set authentication state to valid
      service['hasValidAuth'] = true;
      const genericError = new Error('Device discovery failed');
      // Mock the getDevices method to throw a generic error
      vi.spyOn(service['winix'], 'getDevices').mockRejectedValue(genericError);

      await expect(service.discoverDevices()).rejects.toThrow(genericError);
    });
  });
});
