/* eslint-disable no-console */
import { getSchemaDeviceOverrides, schemaLogin } from './schemas.ts';
import { Device, DeviceResponse } from '../../server.ts';
import { DeviceOverride } from '../../../config.ts';
import { WinixExistingAuth } from 'winix-api';

const { homebridge } = window;
const $headerButtons = document.getElementById('header-winix-buttons')!;
const $btnNewToken = document.getElementById('btn-winix-new-token')!;
const $btnDeviceOverrides = document.getElementById('btn-winix-device-overrides')!;
const $headerLinkAccount = document.getElementById('header-winix-link-account')!;
const $headerDeviceOverrides = document.getElementById('header-winix-device-overrides')!;

// Register click handler for the "Link Account" button
$btnNewToken.addEventListener('click', () => showLoginForm());
$btnDeviceOverrides.addEventListener('click', () => showDeviceOverridesForm());

// Init
homebridge.showSpinner();
init();

async function init(): Promise<void> {
  // Hide initial loading spinner
  homebridge.hideSpinner();

  const [config] = await homebridge.getPluginConfig();
  const hasToken = config?.auth?.refreshToken;

  if (hasToken) {
    showConfigForm();
  } else {
    await showLoginForm();
  }
}

async function showLoginForm(): Promise<void> {
  // Hide the standard form
  homebridge.hideSchemaForm();

  $headerButtons?.style.setProperty('display', 'none');
  $headerLinkAccount?.style.setProperty('display', 'block');

  const loginForm = homebridge.createForm(
    schemaLogin,
    {},
    'Log In',
    await hasExistingAuth() ? 'Back' : undefined,
  );

  loginForm.onSubmit(async ({ email, password }) => {
    homebridge.showSpinner();

    try {
      const auth = await homebridge.request('/login', { email, password });
      await setExistingAuth(auth);
      showConfigForm();
    } catch (e) {
      const error = e as HomebridgeError;
      console.error('error logging in', error.message);
      homebridge.toast.error(error.message, 'Winix Login Failed');
    } finally {
      homebridge.hideSpinner();
    }
  });

  // We know already that there is existing auth since the 'Back' button is shown,
  // so we can just go back to the config form
  loginForm.onCancel(() => showConfigForm());
}

async function showDeviceOverridesForm(): Promise<void> {
  homebridge.showSpinner();

  // we know we have existing auth since we're showing this form
  const auth = await getExistingAuth();
  let resp: DeviceResponse;

  try {
    resp = await homebridge.request('/discover', auth);
  } catch (e) {
    const error = e as HomebridgeError;
    console.error('error discovering devices', error.message);
    homebridge.toast.error(error.message, 'Device Discovery Failed');
    homebridge.hideSpinner();
    return;
  }

  homebridge.hideSpinner();
  $headerDeviceOverrides?.style.setProperty('display', 'block');

  const data = resp.devices.map((device: Device): DeviceOverrideData => {
    return {
      deviceId: device.deviceId,
      deviceAlias: device.deviceAlias,
      modelName: device.modelName,
    };
  });

  // TODO: Fill in rest of data from existing overrides in config

  // const [config] = await homebridge.getPluginConfig();
  // const deviceOverrides = (config?.deviceOverrides ?? []) as DeviceOverride[];
  //
  // if (deviceOverrides.length === 0) {
  //   homebridge.toast.warning('No device overrides found', 'Winix Device Overrides');
  //   return;
  // }

  $headerButtons?.style.setProperty('display', 'none');

  const form = homebridge.createForm(
    getSchemaDeviceOverrides(data.length),
    { deviceOverrides: data },
    'Save All',
    'Cancel',
  );

  form.onSubmit(async ({ deviceOverrides }) => {
    deviceOverrides = deviceOverrides as DeviceOverrideData[];
    console.log('deviceOverrides', deviceOverrides);
    const overrides = cleanOverrides(deviceOverrides);
    console.log('cleaned deviceOverrides', overrides);

    // const [config, ...otherConfigs] = await homebridge.getPluginConfig();
    // await homebridge.updatePluginConfig([{ ...config, deviceOverrides }, ...otherConfigs]);
    // await homebridge.savePluginConfig();
    homebridge.toast.success('Device Overrides Updated', 'Winix Device Overrides');
    showConfigForm();
  });

  form.onCancel(() => {
    homebridge.toast.warning('Device Overrides Not Updated', 'Winix Device Overrides');
    showConfigForm();
  });
}

function cleanOverrides(overrides: DeviceOverrideData[]): DeviceOverride[] {
  return overrides.filter((o) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deviceId, deviceAlias, modelName, ...otherProperties } = o;
    return Object.values(otherProperties).some(value => value !== undefined && value !== '');
  }).map((o) => {
    // set all empty strings to undefined, so they don't persist
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { deviceId, deviceAlias, modelName, ...otherProperties } = o;
    Object.keys(otherProperties).forEach((key: string) => {
      if (key in otherProperties && otherProperties[key as keyof typeof otherProperties] === '') {
        otherProperties[key as keyof typeof otherProperties] = undefined;
      }
    });
    return { deviceId, ...otherProperties };
  });
}

function showConfigForm(): void {
  $headerButtons?.style.setProperty('display', 'block');
  $headerLinkAccount?.style.setProperty('display', 'none');
  $headerDeviceOverrides?.style.setProperty('display', 'none');
  homebridge.showSchemaForm();
}

async function setExistingAuth(auth: WinixExistingAuth): Promise<void> {
  const [config, ...otherConfigs] = await homebridge.getPluginConfig();
  await homebridge.updatePluginConfig([{ ...config, auth }, ...otherConfigs]);
  await homebridge.savePluginConfig();
  homebridge.toast.success('Linked with Winix account', 'Winix Login Successful');
}

async function hasExistingAuth(): Promise<boolean> {
  const [config] = await homebridge.getPluginConfig();
  return !!config?.auth?.refreshToken;
}

/**
 * Assumes that you do have existing auth
 */
async function getExistingAuth(): Promise<WinixExistingAuth> {
  const [config] = await homebridge.getPluginConfig();
  return config.auth!;
}

interface HomebridgeError {
  message: string;
  error: {
    status: number;
  };
}

interface DeviceOverrideData extends DeviceOverride {
  deviceAlias: string;
  modelName: string;
}
