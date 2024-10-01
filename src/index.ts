import type { API } from 'homebridge';

// Import the main platform class and platform name from settings
import { qBittorrentPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/**
 * This method registers the platform with Homebridge.
 * @param api - The Homebridge API instance.
 */
export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, qBittorrentPlatform);
};
