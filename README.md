# homebridge-winix-purifiers

[Homebridge](https://homebridge.io) plugin providing support for [Winix](https://www.winixamerica.com) air purifiers.

After buying some C545 purifiers, and seeing no support from the only other Winix plugin since September 2020, I decided
to dive in and create an updated homebridge plugin to support them. Right now it only officially supports the C545,
since that's all I own, but we can expand this to other Winix purifiers with support from other device owners!

## Features

The following features are supported on the air purifiers

* Switch `on` / `off`
* Switch between `auto` / `manual` modes
* Adjust airflow speed (`Sleep`, `Low`, `Medium`, `High`, `Turbo`)

The following features are optionally supported

* Show air quality
* Expose switch to turn Plasmawave `on` / `off`

## Device Support

Currently, this plugin supports the following Winix air purifiers

* C545

## Installation

It is highly recommended that you use the
main [Homebridge Config UI X](https://www.npmjs.com/package/homebridge-config-ui-x) to install and configure this
plugin.

### Manual Installation

1. Install this plugin using: `npm install -g homebridge-winix-purifiers`.
2. Update your configuration file. See below for a sample.

### Configuration

In your `config.json`, add and update the following under the `accessories` section

```json
{
  "accessories": [
    {
      "accessory": "WinixPurifier",
      "name": "Bedroom Air Purifier",
      "model": "C545",
      "deviceId": "ABCDEF012345_abcde01234",
      "exposeAirQuality": true,
      "exposePlasmawave": false
    }
  ]
}
```

### Properties

| Parameter          | Note                                                                            |
|--------------------|---------------------------------------------------------------------------------|
| `accessory`        | must always be set to `WinixPurifier`                                           |
| `name`             | a human-readable name for the air purifier                                      |
| `model`            | the model of the [supported air purifier](#Device-Support)                      |
| `deviceId`         | the unique identifier of the device (see below for details on how to find this) |
| `exposeAirQuality` | _(optional)_ whether to expose an air quality sensor                            |
| `exposePlasmawave` | _(optional)_ whether to expose Plasmawave control as a `Switch`                 |

## Device ids

In order to communicate with the Winix device APIs and control your air purifiers, you need your device ids.

Follow [these steps](https://www.winixamerica.com/2021/11/04/winix-smart-app/) to connect your purifiers with the Winix
app. These steps are necessary to connect your purifier to Winix and allow it to be controlled with this homebridge
plugin.

### [hfern/winix](https://github.com/hfern/winix)

[@hfern](https://github.com/hfern) has reverse-engineered the Winix android app and created
a [Python CLI](https://github.com/hfern/winix). This CLI allows you to, among other things, login and get the device
ids associated with your account. I have used this to successfully get my device ids. Follow the setup and auth steps
in the [README](https://github.com/hfern/winix/blob/master/README.md). You should then be able to find your device ids
in the file `~/.config/winix/config.json`
