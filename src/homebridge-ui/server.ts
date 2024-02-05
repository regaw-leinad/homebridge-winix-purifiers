/* eslint-disable no-console */

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import { WinixAccount, WinixAuth, WinixAuthResponse, WinixDevice, WinixExistingAuth } from 'winix-api';

export interface LoginRequest {
  email: string;
  password: string;
}

export interface Device {
  deviceId: string;
  deviceAlias: string;
  modelName: string;
}

export interface DeviceResponse {
  devices: Device[];
}

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/login', this.login.bind(this));
    this.onRequest('/discover', this.discoverDevices.bind(this));
    this.ready();
  }

  async login({ email, password }: LoginRequest): Promise<WinixExistingAuth> {
    console.log(`Logging in with email '${email}' and password`);

    let auth: WinixAuthResponse;
    try {
      auth = await WinixAuth.login(email, password, 3);
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      console.error(message);
      throw new RequestError(message, { status: 400 });
    }

    return {
      username: email,
      refreshToken: auth.refreshToken,
      userId: auth.userId,
    };
  }

  async discoverDevices(auth: WinixExistingAuth): Promise<DeviceResponse> {
    let winixDevices: WinixDevice[];

    try {
      const account = await WinixAccount.fromExistingAuth(auth);
      winixDevices = await account.getDevices();
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      console.error(message);
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
