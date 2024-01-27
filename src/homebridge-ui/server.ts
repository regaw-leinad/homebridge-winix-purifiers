/* eslint-disable no-console */

import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import { WinixAuth, WinixAuthResponse, WinixExistingAuth } from 'winix-api';

interface LoginRequest {
  email: string;
  password: string;
}

class PluginUiServer extends HomebridgePluginUiServer {
  constructor() {
    super();
    this.onRequest('/login', this.login.bind(this));
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
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function startPluginUiServer() {
  return new PluginUiServer();
}

startPluginUiServer();
