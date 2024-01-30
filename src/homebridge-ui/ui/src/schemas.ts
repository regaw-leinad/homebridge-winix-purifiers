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
              description: 'The ID of the device provided in the Winix app',
              required: true,
            },
            deviceAlias: {
              type: 'string',
              title: 'Device Alias',
              description: 'The alias of the device provided in the Winix app',
              required: true,
            },
            modelName: {
              type: 'string',
              title: 'Model Name',
              description: 'The model name of the device',
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
              required: false,
            },
            nameAmbientLightSensor: {
              type: 'string',
              title: 'Ambient Light Sensor Name',
              description: 'The display name of the ambient light sensor',
              required: false,
            },
            namePlasmawaveSwitch: {
              type: 'string',
              title: 'Plasmawave Switch Name',
              description: 'The display name of the Plasmawave switch',
              required: false,
            },
            nameAutoSwitch: {
              type: 'string',
              title: 'Auto Switch Name',
              description: 'The display name of the Auto switch',
              required: false,
            },
          },
        },
      },
    },
    layout: [
      {
        type: 'tabarray',
        key: 'deviceOverrides',
        maxItems: deviceCount,
        items: {
          type: 'section',
          title: 'Device Information',
          description: 'Update device information for each device',
          legend: '{{value.deviceAlias}} ({{value.modelName}})',
          removable: false,
          items: [
            {
              key: 'deviceOverrides[].serialNumber',
              type: 'text',
              title: 'Serial Number',
              description: 'The serial number of the device',
              placeholder: 'WNXAI00000000',
            },
            {
              key: 'deviceOverrides[].nameDevice',
              type: 'text',
              title: 'Device Name',
              description: 'The display name of the device',
            },
            {
              key: 'deviceOverrides[].nameAirQualitySensor',
              type: 'text',
              title: 'Air Quality Sensor Name',
              description: 'The display name of the air quality sensor',
            },
            {
              key: 'deviceOverrides[].nameAmbientLightSensor',
              type: 'text',
              title: 'Ambient Light Sensor Name',
              description: 'The display name of the ambient light sensor',
            },
            {
              key: 'deviceOverrides[].namePlasmawaveSwitch',
              type: 'text',
              title: 'Plasmawave Switch Name',
              description: 'The display name of the Plasmawave switch',
            },
            {
              key: 'deviceOverrides[].nameAutoSwitch',
              type: 'text',
              title: 'Auto Switch Name',
              description: 'The display name of the Auto switch',
            },
          ],
        },
      },
    ],
  };
};
