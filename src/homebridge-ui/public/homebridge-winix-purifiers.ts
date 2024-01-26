/* eslint-disable no-console */
const { homebridge } = window;
const $newTokenButton = document.getElementById('winix-new-token')!;
const $linkAccountHeader = document.getElementById('winix-link-account-header')!;

// Register click handler for the "Link Account" button
$newTokenButton.addEventListener('click', () => showLoginForm());

async function renderForm() {
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

// Init
renderForm();

async function showLoginForm() {
  // Hide the standard form
  homebridge.hideSchemaForm();

  $newTokenButton?.style.setProperty('display', 'none');
  $linkAccountHeader?.style.setProperty('display', 'block');

  const loginForm = homebridge.createForm(
    {
      schema: {
        type: 'object',
        properties: {
          email: {
            title: 'Email',
            type: 'string',
            'x-schema-form': {
              type: 'email',
            },
            required: true,
          },
          password: {
            title: 'Password',
            type: 'string',
            'x-schema-form': {
              type: 'password',
            },
            required: true,
          },
        },
      },
    },
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

function showConfigForm() {
  $newTokenButton?.style.setProperty('display', 'block');
  $linkAccountHeader?.style.setProperty('display', 'none');
  homebridge.showSchemaForm();
}

async function setExistingAuth(auth) {
  const [config, ...otherConfigs] = await homebridge.getPluginConfig();
  await homebridge.updatePluginConfig([
    { ...config, auth },
    ...otherConfigs,
  ]);
  await homebridge.savePluginConfig();
  homebridge.toast.success('Refresh Token Updated', 'Winix Login Successful');
}

async function hasExistingAuth(): Promise<boolean> {
  const [config] = await homebridge.getPluginConfig();
  return !!config?.auth?.refreshToken;
}

interface HomebridgeError {
  message: string;
  error: {
    status: number;
  };
}
