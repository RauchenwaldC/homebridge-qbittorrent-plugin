import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { qBittorrentPlatform } from './platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
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

    // Create a Switch service for Advanced Rate Limits
    this.service = this.accessory.getService(this.platform.Service.Switch) 
      || this.accessory.addService(this.platform.Service.Switch);

    this.service.setCharacteristic(this.platform.Characteristic.Name, 'Advanced Rate Limits');

    // Register handlers for the On/Off Characteristic
    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onSet(this.setRateLimits.bind(this)) // Bind to the `setRateLimits` method
      .onGet(this.getRateLimits.bind(this)); // Bind to the `getRateLimits` method
  }

  /**
   * Handle "SET" requests from HomeKit
   */
  async setRateLimits(value: CharacteristicValue) {
    // Implement the logic to toggle advanced rate limits in qBittorrent
    this.platform.log.debug('Set Advanced Rate Limits ->', value);
    // Example API call: await this.platform.api.setAdvancedRateLimits(value);
  }

  /**
   * Handle "GET" requests from HomeKit
   */
  async getRateLimits(): Promise<CharacteristicValue> {
    // Implement the logic to get the current state of advanced rate limits
    const currentValue = false; // Replace with actual value from qBittorrent
    this.platform.log.debug('Get Advanced Rate Limits ->', currentValue);
    return currentValue;
  }
}
