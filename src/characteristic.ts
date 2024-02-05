import {
  Characteristic,
  CharacteristicGetHandler,
  CharacteristicSetHandler,
  CharacteristicValue,
  HAPStatus,
  Service,
  WithUUID,
} from 'homebridge';
import { WinixPurifierPlatform } from './platform';
import { DeviceLogger } from './logger';
import { assertError } from './errors';

export type CharacteristicType = WithUUID<{ new(): Characteristic }>;

/**
 * Manager to provide a consistent way to get and set characteristics
 */
export class CharacteristicManager {

  constructor(
    private readonly platform: WinixPurifierPlatform,
    private readonly log: DeviceLogger,
  ) {
  }

  get(service: Service, characteristic: CharacteristicType): CharacteristicWrapper {
    const c: Characteristic = service.getCharacteristic(characteristic);
    return new CharacteristicWrapper(this.platform, this.log, c);
  }

  set(service: Service, name: CharacteristicType, value: CharacteristicValue): Service {
    service.setCharacteristic(name, value);
    return service;
  }
}

/**
 * Wrapper for a Characteristic to handle errors and logging
 */
export class CharacteristicWrapper {

  constructor(
    private readonly platform: WinixPurifierPlatform,
    private readonly log: DeviceLogger,
    private readonly characteristic: Characteristic,
  ) {
  }

  onGet(handler: CharacteristicGetHandler): CharacteristicWrapper {
    this.characteristic.onGet(this.wrapGet(handler));
    return this;
  }

  onSet(handler: CharacteristicSetHandler): CharacteristicWrapper {
    this.characteristic.onSet(this.wrapSet(handler));
    return this;
  }

  /**
   * Wrap a get handler to handle errors and logging
   */
  private wrapGet(fn: CharacteristicGetHandler): CharacteristicGetHandler {
    return async (context: unknown) => {
      return this.wrap(async () => await fn(context));
    };
  }

  /**
   * Wrap a set handler to handle errors and logging
   */
  private wrapSet(fn: CharacteristicSetHandler): CharacteristicSetHandler {
    return async (value: CharacteristicValue, context: unknown) => {
      return this.wrap(async () => await fn(value, context));
    };
  }

  /**
   * Wrap an async function to handle errors and logging
   */
  private async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      assertError(e);
      this.log.error('error calling Winix API:', e.message);
      throw new this.platform.HapStatusError(HAPStatus.SERVICE_COMMUNICATION_FAILURE);
    }
  }
}
