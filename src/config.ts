import { WinixExistingAuth } from 'winix-api';

export interface WinixPluginAuth extends WinixExistingAuth {
  // Addition of password field for ability to regenerate refresh token
  password: string;
}

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
  auth?: WinixPluginAuth;
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
