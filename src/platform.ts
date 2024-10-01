import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { qBittorrentPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import axios from 'axios';

export class qBittorrentPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = [];
  private sid: string | null = null;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    this.log.debug('Finished initializing platform:', this.config.name);

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
    
      // Update the context or configuration of the existing accessory if needed
      new qBittorrentPlatformAccessory(this, existingAccessory);
    
    // Optionally update the accessory in Homebridge if changes were made
    // this.api.updatePlatformAccessories([existingAccessory]);
    } else {
      this.log.info('Adding new accessory: Advanced Rate Limits Switch');
    
      const accessory = new this.api.platformAccessory('Advanced Rate Limits', uuid);
      new qBittorrentPlatformAccessory(this, accessory);
    
      // Register the new accessory
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
    }
  }


  async authenticate(): Promise<boolean> {
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
          this.sid = sidCookie ? sidCookie.split(';')[0] : null;
          this.log.debug(`Authenticated successfully. SID: ${this.sid}`);
          return true; // Indicate successful authentication
        } else {
          this.log.error('No cookies returned from login response');
          return false; // Fail early if no SID
        }
      } else {
        this.log.error('Authentication failed:', response.status);
        return false;
      }
    } catch (error) {
      this.log.error('Error during authentication:', error);
      return false;
    }
  }

  getSid(): string | null {
    return this.sid;
  }

  async toggleAdvancedRateLimits(enable: boolean): Promise<void> {
    const authenticated = await this.authenticate();
    if (!authenticated) {
      this.log.error('Failed to authenticate. Cannot toggle rate limits.');
      return; // Early return if authentication fails
    }

    const { apiUrl } = this.config;
    const cleanedApiUrl = apiUrl.replace(/\/+$/, '');

    try {
      const toggleResponse = await axios.post(
        `${cleanedApiUrl}/api/v2/transfer/toggleSpeedLimitsMode`, 
        null,
        {
          headers: {
            'Referer': cleanedApiUrl,
            'Cookie': this.getSid() || '',
          },
        },
      );

      this.log.debug(`Toggle Response: ${JSON.stringify(toggleResponse.data)}`);

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
