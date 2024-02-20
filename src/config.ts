import { WinixExistingAuth } from 'winix-api';

export interface DeviceOverride {
  deviceId: string;
  serialNumber?: string;
  nameDevice?: string;
  nameAirQuality?: string;
  nameAmbientLight?: string;
  namePlasmawave?: string;
  nameAutoSwitch?: string;
}

export interface WinixPlatformConfig {
  auth?: WinixExistingAuth;
  exposeAirQuality?: boolean;
  exposeAmbientLight?: boolean;
  exposePlasmawave?: boolean;
  exposeAutoSwitch?: boolean;
  exposeSleepSwitch?: boolean;
  filterReplacementIndicatorPercentage?: number;
  cacheIntervalSeconds?: number;
  deviceRefreshIntervalMinutes?: number;
  deviceOverrides?: DeviceOverride[];
}
