import { WinixExistingAuth } from 'winix-api';

export interface WinixPlatformConfig {
  auth?: WinixExistingAuth;
  exposeAirQuality?: boolean;
  exposeAmbientLight?: boolean;
  exposePlasmawave?: boolean;
  exposeAutoSwitch?: boolean;
  filterReplacementIndicatorPercentage?: number;
  cacheIntervalSeconds?: number;
  deviceRefreshIntervalMinutes?: number;
}
