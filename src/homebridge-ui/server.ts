import { HomebridgePluginUiServer, RequestError } from '@homebridge/plugin-ui-utils';
import { DiscoverResponse, InitResponse, LoginRequest, WinixService } from './winix';
import { UnauthenticatedError } from '../winix';
import { ENCRYPTION_KEY } from '../settings';
import { WinixPluginAuth } from '../config';

export class PluginUiServer extends HomebridgePluginUiServer {
  private readonly service: WinixService;

  constructor() {
    super();
    this.service = new WinixService(this.homebridgeStoragePath!, ENCRYPTION_KEY);

    this.onRequest('/init', this.init.bind(this));
    this.onRequest('/login', this.login.bind(this));
    this.onRequest('/discover', this.discoverDevices.bind(this));
    this.ready();
  }

  async init(auth?: WinixPluginAuth): Promise<InitResponse> {
    try {
      return await this.service.init(auth);
    } catch (e: unknown) {
      return { needsLogin: true };
    }
  }

  async login(request: LoginRequest): Promise<WinixPluginAuth> {
    try {
      return await this.service.login(request);
    } catch (e: unknown) {
      const message = getErrorMessage(e);
      throw new RequestError(message, { status: 400 });
    }
  }

  async discoverDevices(): Promise<DiscoverResponse> {
    try {
      return await this.service.discoverDevices();
    } catch (e: unknown) {
      if (e instanceof UnauthenticatedError) {
        throw new RequestError('Not authenticated', { status: 401 });
      }

      const message = getErrorMessage(e);
      throw new RequestError(message, { status: 500 });
    }
  }
}

function getErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

function startPluginUiServer() {
  return new PluginUiServer();
}

startPluginUiServer();
