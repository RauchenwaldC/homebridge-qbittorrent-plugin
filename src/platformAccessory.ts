import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';
import type { qBittorrentPlatform } from './platform.js';

export class qBittorrentPlatformAccessory {
  private service: Service; // Service instance for this accessory

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
      .onSet(this.setAdvancedRateLimits.bind(this)) // Bind the set function
      .onGet(this.getAdvancedRateLimits.bind(this)); // Bind the get function
  }

  // Method to set the advanced rate limits
  async setAdvancedRateLimits(value: CharacteristicValue) {
    try {
      const currentState = await this.getAdvancedRateLimits(); // Get the current state
      const enable = value as boolean;

      if (currentState !== enable) { // Only toggle if the state is different
        await this.platform.toggleAdvancedRateLimits(enable);
        this.platform.log.debug('Set Advanced Rate Limits ->', enable);
      } else {
        this.platform.log.debug('No toggle needed; state is already', enable);
      }
    } catch (error) {
      this.platform.log.error('Error setting Advanced Rate Limits:', error);
    }
  }

  // Method to get the current state of advanced rate limits
  async getAdvancedRateLimits(): Promise<CharacteristicValue> {
    const { apiUrl } = this.platform.config; // Extract the API URL
    const cleanedApiUrl = apiUrl.replace(/\/+$/, ''); // Clean up the API URL

    try {
      const authenticated = await this.platform.authenticate(); // Authenticate before getting the state
      if (!authenticated) {
        this.platform.log.error('Failed to authenticate. Returning default rate limit state.');
        return false; // Early return with default state
      }

      const { default: axios } = await import('axios'); // Dynamic import of axios
      const speedLimitsResponse = await axios.get(`${cleanedApiUrl}/api/v2/transfer/speedLimitsMode`, {
        headers: {
          'Cookie': this.platform.getSid() || '', // Include session ID in cookies
          'Referer': cleanedApiUrl,
        },
      });

      const isAltSpeedLimitsEnabled = speedLimitsResponse.data === 1; // Determine if alternative speed limits are enabled
      this.platform.log.debug('Get Advanced Rate Limits ->', isAltSpeedLimitsEnabled);
      return isAltSpeedLimitsEnabled; // Return the current state
    } catch (error) {
      this.platform.log.error('Error fetching Advanced Rate Limits:', error);
      return false; // Default to false in case of error
    }
  }
}
