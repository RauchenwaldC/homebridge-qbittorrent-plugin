import type { API, Characteristic, DynamicPlatformPlugin, Logging, PlatformAccessory, PlatformConfig, Service } from 'homebridge';
import { qBittorrentPlatformAccessory } from './platformAccessory.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

export class qBittorrentPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  public readonly accessories: PlatformAccessory[] = []; // List to keep track of loaded accessories
  private sid: string | null = null; // Session ID for authentication

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service; // Access Homebridge services
    this.Characteristic = api.hap.Characteristic; // Access Homebridge characteristics

    this.log.debug('Finished initializing platform:', this.config.name);

    // Callback for when Homebridge finishes launching
    this.api.on('didFinishLaunching', () => {
      log.debug('Executed didFinishLaunching callback');
      this.discoverDevices(); // Discover devices on launch
    });
  }

  // Called when an accessory is loaded from cache
  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory); // Add accessory to the list
  }

  // Method to discover and register devices
  discoverDevices() {
    const uuid = this.api.hap.uuid.generate('AdvancedRateLimitsSwitch'); // Generate a unique UUID
    const existingAccessory = this.accessories.find(accessory => accessory.UUID === uuid); // Check for existing accessory

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      new qBittorrentPlatformAccessory(this, existingAccessory); // Restore existing accessory
    } else {
      this.log.info('Adding new accessory: Advanced Rate Limits Switch');
      const accessory = new this.api.platformAccessory('Advanced Rate Limits', uuid); // Create a new accessory
      new qBittorrentPlatformAccessory(this, accessory); // Initialize the new accessory
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]); // Register the new accessory with Homebridge
    }
  }

  // Method for authenticating with the qBittorrent API
  async authenticate(): Promise<boolean> {
    const { apiUrl, username, password } = this.config; // Extract config values
    const cleanedApiUrl = apiUrl.replace(/\/+$/, ''); // Clean up the API URL

    try {
      const { default: axios } = await import('axios'); // Dynamic import of axios
      const response = await axios.post(`${cleanedApiUrl}/api/v2/auth/login`, `username=${username}&password=${password}`, {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Referer': cleanedApiUrl,
        },
        withCredentials: true,
      });

      // Check if authentication was successful
      if (response.status === 200) {
        const cookies = response.headers['set-cookie'];
        if (cookies) {
          const sidCookie = cookies.find(cookie => cookie.startsWith('SID='));
          this.sid = sidCookie ? sidCookie.split(';')[0] : null; // Store the session ID
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
      return false; // Return false on error
    }
  }

  // Getter for the session ID
  getSid(): string | null {
    return this.sid;
  }

  // Method to toggle advanced rate limits
  async toggleAdvancedRateLimits(enable: boolean): Promise<void> {
    const authenticated = await this.authenticate(); // Authenticate before toggling
    if (!authenticated) {
      this.log.error('Failed to authenticate. Cannot toggle rate limits.');
      return; // Early return if authentication fails
    }

    const { apiUrl } = this.config; // Extract the API URL
    const cleanedApiUrl = apiUrl.replace(/\/+$/, ''); // Clean up the API URL

    try {
      const { default: axios } = await import('axios'); // Dynamic import of axios
      const toggleResponse = await axios.post(
        `${cleanedApiUrl}/api/v2/transfer/toggleSpeedLimitsMode`, 
        null,
        {
          headers: {
            'Referer': cleanedApiUrl,
            'Cookie': this.getSid() || '', // Include session ID in cookies
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
