import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';

import { qBittorrentPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

import axios from 'axios';

/**
 * HomebridgePlatform
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
export class qBittorrentPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: PlatformAccessory[] = [];
  private sid: string | null = null; // Store SID for authenticated requests

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

    // When this event is fired it means Homebridge has restored all cached accessories from disk.
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices();
    });
  }

  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  discoverDevices() {
    const uuid = this.api.hap.uuid.generate('AdvancedRateLimitsSwitch');
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new qBittorrentPlatformAccessory(this, existingAccessory);
    } else {
      this.log.info('Adding new accessory: Advanced Rate Limits Switch');
      const accessory = new this.api.platformAccessory('Advanced Rate Limits', uuid);
      new qBittorrentPlatformAccessory(this, accessory);
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }

  async authenticate(): Promise<void> {
    const { apiUrl, username, password } = this.config;
    const cleanedApiUrl = apiUrl.replace(/\/+$/, '');

    try {
      const response = await axios.post(`${cleanedApiUrl}/api/v2/auth/login`, `username=${username}&password=${password}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': cleanedApiUrl,
        },
        withCredentials: true,
      });

      if (response.status === 200) {
        const cookies = response.headers['set-cookie'];
        if (cookies) {
          const sidCookie = cookies.find(cookie => cookie.startsWith('SID='));
          this.sid = sidCookie ? sidCookie.split(';')[0] : null; // Safely set sid
          this.log.debug(`Authenticated successfully. SID: ${this.sid}`);
        } else {
          this.log.error('No cookies returned from login response');
        }
      } else {
        this.log.error('Authentication failed:', response.status);
      }
    } catch (error) {
      this.log.error('Error during authentication:', error);
    }
  }

  getSid(): string | null {
    return this.sid; // Method to access the SID
  }

  async toggleAdvancedRateLimits(enable: boolean): Promise<void> {
    await this.authenticate(); // Ensure we are authenticated before making requests
    const { apiUrl } = this.config;
    const cleanedApiUrl = apiUrl.replace(/\/+$/, '');

    try {
      // Use GET request to toggle the state of alternative speed limits
      const toggleResponse = await axios.get(`${cleanedApiUrl}/api/v2/transfer/toggleSpeedLimitsMode`, {
        headers: {
          'Referer': cleanedApiUrl,
          'Cookie': this.getSid() || '', // Use the getter method to access sid
        },
      });

      if (toggleResponse.status === 200) {
        this.log.info(`Advanced Rate Limits ${enable ? 'enabled' : 'disabled'}`);
      } else {
        this.log.error('Failed to toggle Advanced Rate Limits:', toggleResponse.status);
      }
    } catch (error) {
      this.log.error('Error toggling Advanced Rate Limits:', error);
    }
  }
}
