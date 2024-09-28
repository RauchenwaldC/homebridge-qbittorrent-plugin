import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { qBittorrentPlatform } from './platform.js';
import axios from 'axios';

export class qBittorrentPlatformAccessory {
  private service: Service;

  constructor(
    private readonly platform: qBittorrentPlatform,
    private readonly accessory: PlatformAccessory,
  ) {
    // Set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Default-Manufacturer')
      .setCharacteristic(this.platform.Characteristic.Model, 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, 'Default-Serial');

    // Create a new switch service for Advanced Rate Limits
    this.service = this.accessory.addService(this.platform.Service.Switch, 'Advanced Rate Limits');

    // Register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setAdvancedRateLimits.bind(this)) // SET - bind to the `setAdvancedRateLimits` method
      .onGet(this.getAdvancedRateLimits.bind(this)); // GET - bind to the `getAdvancedRateLimits` method
  }

  async setAdvancedRateLimits(value: CharacteristicValue) {
    const enable = value as boolean; // Get the boolean value from the switch
    await this.platform.toggleAdvancedRateLimits(enable); // Pass the boolean value to the method
    this.platform.log.debug('Set Advanced Rate Limits ->', enable);
  }

  async getAdvancedRateLimits(): Promise<CharacteristicValue> {
    const { apiUrl } = this.platform.config;
    const cleanedApiUrl = apiUrl.replace(/\/+$/, '');

    try {
      await this.platform.authenticate(); // Ensure we are authenticated

      const speedLimitsResponse = await axios.get(`${cleanedApiUrl}/api/v2/transfer/speedLimitsMode`, {
        headers: {
          'Cookie': this.platform.getSid() || '', // Use the getter method to access sid
          'Referer': cleanedApiUrl,
        },
      });

      const isAltSpeedLimitsEnabled = speedLimitsResponse.data === 1;
      this.platform.log.debug('Get Advanced Rate Limits ->', isAltSpeedLimitsEnabled);
      return isAltSpeedLimitsEnabled; // Return true if enabled, false if not
    } catch (error) {
      this.platform.log.error('Error fetching Advanced Rate Limits:', error);
      return false; // Default to false in case of error
    }
  }
}
