/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = 'qBittorrentHomebridgePlugin';

/**
 * This must match the name of your plugin as defined in the package.json
 */
export const PLUGIN_NAME = 'homebridge-qbittorrent-plugin';

/**
 * The UUID seed used by v1.x of this plugin, which supported exactly one qBittorrent
 * server and registered a single hard-coded accessory.
 *
 * When upgrading, the cached accessory generated from this seed is adopted by the first
 * configured server so that existing users keep their HomeKit room assignments,
 * automations and scenes. See `qBittorrentPlatform.discoverDevices()`.
 */
export const LEGACY_ACCESSORY_UUID_SEED = 'AdvancedRateLimitsSwitch';

/** How often, in seconds, the plugin polls each server for its current speed limits mode. */
export const DEFAULT_REFRESH_INTERVAL = 30;
export const MIN_REFRESH_INTERVAL = 5;
export const MAX_REFRESH_INTERVAL = 3600;

/** How long, in seconds, to wait for a single qBittorrent Web API request. */
export const DEFAULT_REQUEST_TIMEOUT = 10;
export const MIN_REQUEST_TIMEOUT = 1;
export const MAX_REQUEST_TIMEOUT = 60;
