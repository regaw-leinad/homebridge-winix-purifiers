# homebridge-winix-purifiers

[![verified-by-homebridge](https://badgen.net/badge/homebridge/verified/purple)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![GitHub Workflow Status](https://img.shields.io/github/actions/workflow/status/regaw-leinad/homebridge-winix-purifiers/build.yml)](https://github.com/regaw-leinad/homebridge-winix-purifiers/actions)
[![npm](https://img.shields.io/npm/dt/homebridge-winix-purifiers)](https://www.npmjs.com/package/homebridge-winix-purifiers)

[Homebridge](https://homebridge.io) plugin providing support for [Winix](https://www.winixamerica.com) air purifiers.

I bought some Winix C545 purifiers and wanted to control them from the Home app (like everything else haha). I found
another Homebridge plugin, but it did not work out of the box (11 open issues at the time). Since that plugin's last
update was in September 2020 (over 2 years ago at the time of writing), I decided to dive in and create my own plugin to
support it. Right now it only officially supports the C545, since that's all I own, but we can expand this to other
Winix purifiers with support from other device owners!

## Features

The following features are supported on the air purifiers:

* Switch `on` / `off`
* Switch between `auto` / `manual` modes
* Adjust airflow speed
    * `Sleep` mapped to `0%`
    * `Low` mapped to `25%`
    * `Medium` mapped to `50%`
    * `High` mapped to `75%`
    * `Turbo` mapped to `100%`

The following features are optionally supported:

* Expose air quality
* Expose ambient light
* Expose switch to turn Plasmawave `on` / `off`

### Winix API Response Caching

By default, all individual responses from the Winix API are cached for `60` seconds. This helps prevent rate limiting
and reduces the number of requests made to the Winix API. The value can be configured with the `cacheIntervalSeconds`
property (see [Properties](#properties) below).

I personally have `cacheIntervalSeconds` set to `600` seconds (10 minutes) since I don't need to know the air quality
every minute - this significantly reduces the number of requests made to the Winix API.

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
      "serialNumber": "WNXAI40001234",
      "exposeAirQuality": true,
      "exposeAmbientLight": false,
      "exposePlasmawave": false,
      "cacheIntervalSeconds": 60
    }
  ]
}
```

### Properties

| Name                   | Default Value | Note                                                                            |
|------------------------|---------------|---------------------------------------------------------------------------------|
| `accessory`            | Required      | must always be set to `WinixPurifier`                                           |
| `name`                 | Required      | a human-readable name for the air purifier                                      |
| `model`                | Required      | the model of the [supported air purifier](#Device-Support)                      |
| `deviceId`             | Required      | the unique identifier of the device (see below for details on how to find this) |
| `serialNumber`         | null          | the serial number of the device                                                 |
| `exposeAirQuality`     | `false`       | whether to expose an air quality sensor                                         |
| `exposeAmbientLight`   | `false`       | whether to expose an ambient light sensor                                       |
| `exposePlasmawave`     | `false`       | whether to expose Plasmawave control as a `Switch`                              |
| `cacheIntervalSeconds` | `60`          | the amount of seconds to cache the responses from the Winix API                 |

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
