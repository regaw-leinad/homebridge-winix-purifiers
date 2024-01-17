import { API } from 'homebridge';
import { WinixPurifierPlatform } from './platform';

export default (api: API) => {
  api.registerPlatform('homebridge-winix-purifiers', 'WinixPurifiers', WinixPurifierPlatform);
};
