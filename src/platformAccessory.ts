import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { qBittorrentPlatform } from './platform.js';
import axios from 'axios';

export class qBittorrentPlatformAccessory {
  private service: Service;

  constructor(
    private readonly platform: qBittorrentPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set the accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // Check if the service already exists; if not, create a new one
    this.service = this.accessory.getService(this.platform.Service.Switch) 
      || this.accessory.addService(this.platform.Service.Switch, 'Advanced Rate Limits');

    // Set up event handlers for the service
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setAdvancedRateLimits.bind(this))
      .onGet(this.getAdvancedRateLimits.bind(this));
  }

  async setAdvancedRateLimits(value: CharacteristicValue) {
    const currentState = await this.getAdvancedRateLimits();
    const enable = value as boolean;

    if (currentState !== enable) {
      await this.platform.toggleAdvancedRateLimits(enable);
      this.platform.log.debug('Set Advanced Rate Limits ->', enable);
    } else {
      this.platform.log.debug('No toggle needed; state is already', enable);
    }
  }

  async getAdvancedRateLimits(): Promise<CharacteristicValue> {
    const { apiUrl } = this.platform.config;
    const cleanedApiUrl = apiUrl.replace(/\/+$/, '');

    try {
      await this.platform.authenticate();

      const speedLimitsResponse = await axios.get(`${cleanedApiUrl}/api/v2/transfer/speedLimitsMode`, {
        headers: {
          'Cookie': this.platform.getSid() || '',
          'Referer': cleanedApiUrl,
        },
      });

      const isAltSpeedLimitsEnabled = speedLimitsResponse.data === 1;
      this.platform.log.debug('Get Advanced Rate Limits ->', isAltSpeedLimitsEnabled);
      return isAltSpeedLimitsEnabled;
    } catch (error) {
      this.platform.log.error('Error fetching Advanced Rate Limits:', error);
      return false; // Default to false in case of error
    }
  }
}
