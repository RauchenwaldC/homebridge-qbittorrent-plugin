import type { PlatformConfig } from 'homebridge';

/**
 * A single qBittorrent server as the user writes it in config.json.
 */
export interface qBittorrentServerConfig {
  name?: string;
  apiUrl?: string;
  username?: string;
  password?: string;
}

/**
 * The platform block as it appears in config.json.
 *
 * `apiUrl`, `username` and `password` at the top level are the v1.x single-server layout.
 * They are still honoured and are migrated into `servers` at runtime.
 */
export interface qBittorrentPlatformConfig extends PlatformConfig {
  servers?: qBittorrentServerConfig[];
  refreshInterval?: number;
  requestTimeout?: number;

  /** @deprecated v1.x single-server layout — use `servers` instead. */
  apiUrl?: string;
  /** @deprecated v1.x single-server layout — use `servers` instead. */
  username?: string;
  /** @deprecated v1.x single-server layout — use `servers` instead. */
  password?: string;
}

/**
 * A server that has passed validation, with everything the plugin needs to talk to it.
 */
export interface ResolvedServer {
  /** Display name, used for the HomeKit accessory and in the log. */
  name: string;
  /** Normalised base URL, without a trailing slash. */
  apiUrl: string;
  username: string;
  password: string;
  /**
   * Stable identity for this server, derived from its URL. Used to generate the accessory
   * UUID and to re-attach cached accessories across restarts and config re-orders.
   */
  key: string;
}

/**
 * The outcome of reading and validating the platform config.
 */
export interface ResolvedPlatformConfig {
  servers: ResolvedServer[];
  /** Fatal problems: these prevent a server from being used. */
  errors: string[];
  /** Non-fatal problems: the plugin carries on, but the user should know. */
  warnings: string[];
  refreshIntervalMs: number;
  requestTimeoutMs: number;
  /** True when the deprecated top-level single-server layout was found. */
  usedLegacyLayout: boolean;
}

/**
 * What the plugin stores on each accessory so it survives a Homebridge restart.
 */
export interface AccessoryContext {
  /** `ResolvedServer.key` of the server this accessory belongs to. */
  serverKey?: string;
  /** Last known display name, so renames in config are picked up. */
  displayName?: string;
}
