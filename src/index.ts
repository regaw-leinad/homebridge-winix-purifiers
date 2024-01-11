import { API } from 'homebridge';
import { WinixPurifierPlatform } from './platform';

export = (api: API) => {
  api.registerPlatform('homebridge-winix-purifiers', 'WinixPurifiers', WinixPurifierPlatform);
};
