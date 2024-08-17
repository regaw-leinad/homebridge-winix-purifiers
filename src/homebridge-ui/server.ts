import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
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

export interface NeedsLoginResponse {
  needsLogin: boolean;
}

class PluginUiServer extends HomebridgePluginUiServer {
  private winix: WinixHandler;

  constructor() {
    super();

    this.winix = new WinixHandler(this.homebridgeStoragePath!);

    this.onRequest('/needs-login', this.needsLogin.bind(this));
    this.onRequest('/login', this.login.bind(this));
    this.onRequest('/discover', this.discoverDevices.bind(this));
    this.ready();
  }

  async needsLogin(): Promise<NeedsLoginResponse> {
    const refreshToken = await this.winix.getRefreshToken();
    return { needsLogin: !refreshToken };
  }

  async login({ email, password }: LoginRequest): Promise<WinixPluginAuth> {
    try {
      return await this.winix.login(email, password);
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      throw new RequestError(message, { status: 400 });
    }
  }

  async discoverDevices(): Promise<DiscoverResponse> {
    let winixDevices: WinixDevice[];

    try {
      winixDevices = await this.winix.getDevices();
    } catch (e: unknown) {
      if (e instanceof UnauthenticatedError) {
        throw new RequestError('Not authenticated', { status: 401 });
      }

      const message = getErrorMessage(e);
      throw new RequestError(message, { status: 500 });
    }

    const devices: Device[] = winixDevices.map(({ deviceAlias, deviceId, modelName }) => {
      return { deviceId, deviceAlias, modelName };
    });

    return { devices };
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function startPluginUiServer() {
  return new PluginUiServer();
}

startPluginUiServer();
