/* eslint-disable no-console */
import { getSchemaDeviceOverrides, schemaLogin } from './schemas.ts';
import { Device, DiscoverResponse, NeedsLoginResponse } from '../../server.ts';
import { DeviceOverride, WinixPluginAuth } from '../../../config.ts';

const { homebridge } = window;
const $headerButtons = document.getElementById('header-winix-buttons')!;
const $btnNewToken = document.getElementById('btn-winix-new-token')!;
const $btnDeviceOverrides = document.getElementById('btn-winix-device-overrides')!;
const $headerLinkAccount = document.getElementById('header-winix-link-account')!;
const $headerDeviceOverrides = document.getElementById('header-winix-device-overrides')!;
const $txtAuthIssues = document.getElementById('txt-auth-issues')!;

// Register click handler for the "Link Account" button
$btnNewToken.addEventListener('click', () => showLoginForm());
$btnDeviceOverrides.addEventListener('click', () => showDeviceOverridesForm());

// Init
homebridge.showSpinner();
init();

async function init(): Promise<void> {
  const { needsLogin } = await homebridge.request('/needs-login') as NeedsLoginResponse;

  if (needsLogin) {
    await showLoginForm();
  } else {
    showConfigForm();
  }
}

async function showLoginForm(): Promise<void> {
  // Hide the standard form
  homebridge.hideSchemaForm();

  $headerButtons?.style.setProperty('display', 'none');
  $headerLinkAccount?.style.setProperty('display', 'block');

  const auth = await getExistingAuth();
  const existingAuth = auth.username;

  if (existingAuth) {
    // show the "having issues" text if there is existing auth
    $txtAuthIssues?.style.setProperty('display', 'block');
  }

  homebridge.hideSpinner();

  const loginForm = homebridge.createForm(
    schemaLogin,
    existingAuth ? { email: auth.username } : {},
    'Log In',
    existingAuth ? 'Back' : undefined,
  );

  loginForm.onSubmit(async ({ email, password }) => {
    homebridge.showSpinner();

    try {
      const auth = await homebridge.request('/login', { email, password });
      await setExistingAuth(auth);
      homebridge.toast.success('Linked with Winix account', 'Winix Purifiers');
      showConfigForm();
    } catch (e) {
      const error = e as HomebridgeError;
      console.error('error logging in', error.message);
      homebridge.toast.error('Login Failed: ' + error.message, 'Winix Purifiers');
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

  let resp: DiscoverResponse;

  try {
    resp = await homebridge.request('/discover');
  } catch (e) {
    const error = e as HomebridgeError;
    console.error('error discovering devices', error.message);
    homebridge.toast.error('Device Discovery Failed: ' + error.message, 'Winix Purifiers');
    homebridge.hideSpinner();
    return;
  }

  // Map of deviceId to DeviceOverrideData for discovered Winix devices
  const discoveredDevices = resp.devices
    // convert to minimal DeviceOverrideData
    .map((device: Device): DeviceOverrideData => {
      return {
        deviceId: device.deviceId,
        deviceAlias: device.deviceAlias,
        modelName: device.modelName,
      };
    })
    // convert to map for easy lookup
    .reduce((m: Map<string, DeviceOverrideData>, device: DeviceOverrideData) => {
      return m.set(device.deviceId, device);
    }, new Map<string, DeviceOverrideData>());

  const [config] = await homebridge.getPluginConfig();
  const existingOverrides = (config?.deviceOverrides ?? []) as DeviceOverride[];

  // merge in any existing overrides from the config
  existingOverrides.forEach((override) => {
    const existing = discoveredDevices.get(override.deviceId);
    if (existing) {
      discoveredDevices.set(override.deviceId, { ...existing, ...override });
    }
  });

  const overrides = Array.from(discoveredDevices.values());

  $headerButtons?.style.setProperty('display', 'none');
  $headerDeviceOverrides?.style.setProperty('display', 'block');
  homebridge.hideSchemaForm();
  homebridge.hideSpinner();

  const form = homebridge.createForm(
    getSchemaDeviceOverrides(overrides.length),
    { deviceOverrides: overrides },
    'Save All',
    'Back',
  );

  form.onSubmit(async ({ deviceOverrides }): Promise<void> => {
    deviceOverrides = cleanOverrides(deviceOverrides as DeviceOverrideData[]);

    const [config, ...otherConfigs] = await homebridge.getPluginConfig();
    await homebridge.updatePluginConfig([{ ...config, deviceOverrides }, ...otherConfigs]);
    await homebridge.savePluginConfig();
    homebridge.toast.success('Device configurations updated successfully', 'Winix Purifiers');
    showConfigForm();
  });

  form.onCancel(() => {
    homebridge.toast.warning('Device configurations not updated', 'Winix Purifiers');
    showConfigForm();
  });
}

/**
 * Convert a list of DeviceOverrideData to DeviceOverride, removing any empty overrides where no data was entered
 */
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
      if (!(key in otherProperties)) {
        return;
      }
      const value = otherProperties[key as keyof typeof otherProperties];
      if (value === undefined || value === '') {
        otherProperties[key as keyof typeof otherProperties] = undefined;
      }
    });
    return { deviceId, ...otherProperties };
  });
}

function showConfigForm(): void {
  $headerButtons?.style.setProperty('display', 'block');
  $headerLinkAccount?.style.setProperty('display', 'none');
  $txtAuthIssues?.style.setProperty('display', 'none');
  $headerDeviceOverrides?.style.setProperty('display', 'none');
  homebridge.showSchemaForm();
  homebridge.hideSpinner();
}

async function setExistingAuth(auth: WinixPluginAuth): Promise<void> {
  const [config, ...otherConfigs] = await homebridge.getPluginConfig();
  await homebridge.updatePluginConfig([{ ...config, auth }, ...otherConfigs]);
  await homebridge.savePluginConfig();
}

async function getExistingAuth(): Promise<WinixPluginAuth> {
  const [config] = await homebridge.getPluginConfig();
  return config && config.auth ? config.auth : {};
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
