# homebridge-winix-purifiers

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/regaw-leinad/homebridge-winix-purifiers/build.yml)](https://github.com/regaw-leinad/homebridge-winix-purifiers/actions)
[![npm](https://img.shields.io/npm/dt/homebridge-winix-purifiers)](https://www.npmjs.com/package/homebridge-winix-purifiers)

[Homebridge](https://homebridge.io) plugin providing support for [Winix](https://www.winixamerica.com) air purifiers.

## Features

- **Dynamic Device Discovery**: Automatically discovers and configures Winix purifiers linked to your account.
- **Control**: Power on/off, switch between auto/manual modes, and adjust airflow speed.
- **Customization**: Optionally expose Air Quality, Ambient Light, Plasmawave, and Auto Mode switches to HomeKit.
- **Filter Management**: Exposes the remaining filter life and provides an alert when it's time to change the filter,
  configurable to trigger at a specified percentage of remaining filter life.
- **Efficiency**: Features Winix API response caching to minimize requests and avoid rate limiting.
- **Reliability**: Automatically refreshes device list on a configurable interval to ensure devices are always
  up-to-date.

## Device Support

This plugin officially supports the following Winix air purifiers:

* C545
* C909

## Configuration

Before starting the configuration process, while not required, it's advisable to set up an alternate Winix account
specifically for Homebridge use. This approach prevents the issue of being logged out from one service when logging into
the other, as Winix restricts users to one active session at a time.

### Alternate Winix Account Setup for Homebridge

1. **Create an Alternate Account**: If you're a Gmail user, simply append "+homebridge" to your current email (
   e.g., `yourEmail+homebridge@gmail.com`). This modified email still routes to your primary inbox.
2. **Device Sharing**: In your main Winix account within the app, go to `Device Settings` > `Device Sharing`, and add
   your alternate email. This shares control of your purifiers with the new account.
3. **Update Filter Replacement Cycle (Optional)**: The alternate account's default setting is a 9-month filter
   replacement cycle. It's important to adjust this to your preferred amount of months to ensure Homebridge displays an
   accurate timeline for filter life. Without this adjustment, Homebridge might indicate a filter change sooner/later
   than preferred.
    - In the app, for each purifier, select the "Filter use life" tile, tap the settings gear in the top right, and
      set `Replacement Cycle` to your desired number of months.
4. **Log Into Homebridge**: Use the new account's credentials for Homebridge. Your devices will now be stable in
   Homebridge, free from login conflicts with the Winix app.

### Homebridge Configuration UI

Easily configure the plugin through the [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x).
Simply provide your Winix account credentials for automatic device discovery and provisioning.

### Manual Configuration

While not recommended, if manual setup is required, add the following to the `platforms` section of your `config.json`:

```json
{
  "platforms": [
    {
      "exposeAirQuality": true,
      "exposeAmbientLight": true,
      "exposePlasmawave": false,
      "exposeAutoSwitch": false,
      "filterReplacementIndicatorPercentage": 10,
      "cacheIntervalSeconds": 300,
      "deviceRefreshIntervalMinutes": 60,
      "auth": {
        "username": "your-email@domain.com",
        "userId": "f470ce5f-6b8e-44b4-a6db-b7f4d4c6f851",
        "refreshToken": "<refresh token>"
      },
      "platform": "WinixPurifiers"
    }
  ]
}
```

#### Properties

| Name                                   | Default Value      | Note                                                                                                               |
|----------------------------------------|--------------------|--------------------------------------------------------------------------------------------------------------------|
| `exposeAirQuality`                     | `false`            | Whether to expose the air quality sensors to HomeKit.                                                              |
| `exposeAmbientLight`                   | `false`            | Whether to expose the ambient light sensors to HomeKit.                                                            |
| `exposePlasmawave`                     | `false`            | Whether to expose switches for Plasmawave on/off.                                                                  |
| `exposeAutoSwitch`                     | `false`            | Whether to expose switches for Auto mode on/off.                                                                   |
| `filterReplacementIndicatorPercentage` | `10`               | Percentage of filter life remaining to trigger a filter replacement alert.                                         |
| `cacheIntervalSeconds`                 | `60`               | Time, in seconds, for how long to reuse cached responses from Winix.                                               |
| `deviceRefreshIntervalMinutes`         | `60`               | Time, in minutes, for how often to poll Winix to refresh the device list.                                          |
| `auth.username`                        | `""`               | Your Winix account username (email). This field is meant to be read-only after being generated in the UI.          |
| `auth.userId`                          | `""`               | Your Winix user ID for the Cognito User Pool. This field is meant to be read-only after being generated in the UI. |
| `auth.refreshToken`                    | `""`               | The refresh token for your Winix account. This field is meant to be read-only after being generated in the UI.     |
| `platform`                             | `"WinixPurifiers"` | Must always be `"WinixPurifiers"` in order for the plugin to load this config.                                     |

## FAQ

### Missing “Auto/Manual” switch in Home app?

Please see [this issue](https://github.com/regaw-leinad/homebridge-winix-purifiers/issues/1) for more details.

### Early adopter and need to migrate from the old plugin architecture?

Unfortunately, there's no way to migrate from the old plugin architecture (v1.x.x) to the new one (v2.x.x). You'll need
to remove the old plugin configs in the `accessories` section of your `config.json` and configure this new plugin
following the steps in the [Configuration](#configuration) section above.

### Having issues moving your purifier to a room in the Home app with the same name?

Try moving the purifier to a room with a different name, then move it back to the desired room. For example, if you have
a room named “Bedroom” and a purifier named “Bedroom”, try moving the purifier to a room named "Living Room", then move
it to "Bedroom".

## Acknowledgments

- [@banzalik](https://github.com/banzalik) - wrote the
  first [Winix C545 Homebridge plugin](https://github.com/banzalik/homebridge-winix-c545)
- [@hfern](https://github.com/hfern) - wrote the
  [Python Driver and CLI for the Winix C545 Air Purifier](https://github.com/hfern/winix) in Python, which this plugin's
  authentication system is heavily based on