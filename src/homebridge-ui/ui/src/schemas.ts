import { PluginFormSchema } from '@homebridge/plugin-ui-utils/dist/ui.interface';

export const schemaLogin: PluginFormSchema = {
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
};

export const getSchemaDeviceOverrides = (deviceCount: number): PluginFormSchema => {
  return {
    schema: {
      deviceOverrides: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            deviceId: {
              type: 'string',
              title: 'Device ID',
              required: true,
            },
            deviceAlias: {
              type: 'string',
              title: 'Device Alias',
              required: true,
            },
            modelName: {
              type: 'string',
              title: 'Model Name',
              required: true,
            },
            serialNumber: {
              type: 'string',
              title: 'Serial Number',
              description: 'The serial number of the device',
              placeholder: 'WNXAI00000000',
              required: false,
            },
            nameDevice: {
              type: 'string',
              title: 'Device Name',
              description: 'The display name of the device',
              required: false,
            },
            nameAirQualitySensor: {
              type: 'string',
              title: 'Air Quality Sensor Name',
              description: 'The display name of the air quality sensor',
              placeholder: 'Air Quality',
              required: false,
            },
            nameAmbientLightSensor: {
              type: 'string',
              title: 'Ambient Light Sensor Name',
              description: 'The display name of the ambient light sensor',
              placeholder: 'Ambient Light',
              required: false,
            },
            namePlasmawaveSwitch: {
              type: 'string',
              title: 'Plasmawave Switch Name',
              description: 'The display name of the Plasmawave switch',
              placeholder: 'Plasmawave',
              required: false,
            },
            nameAutoSwitch: {
              type: 'string',
              title: 'Auto Switch Name',
              description: 'The display name of the Auto switch',
              placeholder: 'Auto Mode',
              required: false,
            },
            nameSleepSwitch: {
              type: 'string',
              title: 'Sleep Switch Name',
              description: 'The display name of the Sleep switch',
              placeholder: 'Sleep',
              required: false,
            },
          },
        },
      },
    },
    form: [
      {
        type: 'tabarray',
        key: 'deviceOverrides',
        legend: '{{value.deviceAlias}} ({{value.modelName}})',
        maxItems: deviceCount,
        removable: false,
        items: [
          'deviceOverrides[].serialNumber',
          'deviceOverrides[].nameDevice',
          'deviceOverrides[].nameAirQualitySensor',
          'deviceOverrides[].nameAmbientLightSensor',
          'deviceOverrides[].namePlasmawaveSwitch',
          'deviceOverrides[].nameAutoSwitch',
          'deviceOverrides[].nameSleepSwitch',
        ],
      },
    ],
  };
};
