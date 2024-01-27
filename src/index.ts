import { PLATFORM_NAME, PLUGIN_NAME } from './settings';
import { WinixPurifierPlatform } from './platform';
import { API } from 'homebridge';

export default (api: API) => {
  api.registerPlatform(PLUGIN_NAME, PLATFORM_NAME, WinixPurifierPlatform);
};
