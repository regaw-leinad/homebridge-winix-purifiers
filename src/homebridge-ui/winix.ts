import { WinixDevice } from 'winix-api';
import { WinixPluginAuth } from '../config';
import { UnauthenticatedError, WinixHandler } from '../winix';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface Device {
  deviceId: string;
  deviceAlias: string;
  modelName: string;
}

export interface DiscoverResponse {
  devices: Device[];
}

export interface InitResponse {
  needsLogin: boolean;
}

export class WinixService {
  private readonly winix: WinixHandler;
  private hasValidAuth: boolean;

  constructor(storagePath: string) {
    this.winix = new WinixHandler(storagePath);
    this.hasValidAuth = false;
  }

  async init(auth?: WinixPluginAuth): Promise<InitResponse> {
    this.hasValidAuth = false;

    if (!auth) {
      return { needsLogin: true };
    }

    const refreshToken = await this.winix.getRefreshToken();

    if (!refreshToken) {
      return { needsLogin: true };
    }

    try {
      await this.winix.refresh(auth);
      this.hasValidAuth = true;
    } catch (e: unknown) {
      this.hasValidAuth = false;
      return { needsLogin: true };
    }

    return { needsLogin: false };
  }

  async login({ email, password }: LoginRequest): Promise<WinixPluginAuth> {
    const result = await this.winix.login(email, password);
    this.hasValidAuth = true;
    return result;
  }

  async discoverDevices(): Promise<DiscoverResponse> {
    if (!this.hasValidAuth) {
      throw new UnauthenticatedError();
    }

    let winixDevices: WinixDevice[];

    try {
      winixDevices = await this.winix.getDevices();
    } catch (e: unknown) {
      if (e instanceof UnauthenticatedError) {
        throw new UnauthenticatedError();
      }
      throw e;
    }

    const devices: Device[] = winixDevices.map(({ deviceAlias, deviceId, modelName }) => {
      return { deviceId, deviceAlias, modelName };
    });

    return { devices };
  }
}
