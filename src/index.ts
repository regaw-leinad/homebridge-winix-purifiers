import { API } from 'homebridge';
import { WinixPurifierAccessory } from './accessory';

export = (api: API) => {
  api.registerAccessory('homebridge-winix-purifiers', 'WinixPurifier', WinixPurifierAccessory);
};
