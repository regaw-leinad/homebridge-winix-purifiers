import { API } from 'homebridge';
import { WinixPurifierPlatform } from './platform';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings';

export default (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, WinixPurifierPlatform);
};
