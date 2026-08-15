import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { resolvePlatformConfig } from './config.js';
import { migrateLegacyConfig } from './migrate.js';
import { qBittorrentPlatformAccessory } from './platformAccessory.js';
import { qBittorrentClient } from './qbittorrentClient.js';
import { LEGACY_ACCESSORY_UUID_SEED, PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
import type { AccessoryContext, ResolvedServer, qBittorrentPlatformConfig } from './types.js';

export class qBittorrentPlatform implements DynamicPlatformPlugin {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  /** Accessories restored from the Homebridge cache, before they are matched to config. */
  public readonly accessories: PlatformAccessory<AccessoryContext>[] = [];

  private readonly handlers: qBittorrentPlatformAccessory[] = [];
  private refreshTimer?: NodeJS.Timeout;

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    public readonly api: API,
  ) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;

    const resolved = resolvePlatformConfig(this.config as qBittorrentPlatformConfig);

    for (const warning of resolved.warnings) {
      this.log.warn(warning);
    }
    for (const error of resolved.errors) {
      this.log.error(error);
    }

    // Nothing usable is configured, so register nothing at all. Homebridge keeps any
    // previously cached accessories, but no handlers are attached and no requests are made.
    // This is what keeps a fresh install quiet until the user has actually set it up.
    if (resolved.servers.length === 0) {
      this.log.error(
        'qBittorrent plugin is not configured, so no accessories will be added. '
        + 'Open the plugin settings in the Homebridge UI and add at least one qBittorrent server.',
      );
      return;
    }

    if (resolved.usedLegacyLayout) {
      // This run already uses the migrated values; rewriting config.json is only so the
      // settings page shows the server in its list rather than an empty one.
      void migrateLegacyConfig(this.api.user.configPath(), this.log);
    }

    this.log.debug(
      `Configured ${resolved.servers.length} qBittorrent server(s); `
      + `refresh every ${resolved.refreshIntervalMs / 1000}s, `
      + `request timeout ${resolved.requestTimeoutMs / 1000}s.`,
    );

    this.api.on('didFinishLaunching', () => {
      this.discoverDevices(resolved.servers, resolved.requestTimeoutMs);
      this.startPolling(resolved.refreshIntervalMs);
    });

    this.api.on('shutdown', () => {
      if (this.refreshTimer) {
        clearInterval(this.refreshTimer);
      }
    });
  }

  /** Called by Homebridge once per cached accessory, before `didFinishLaunching`. */
  configureAccessory(accessory: PlatformAccessory<AccessoryContext>): void {
    this.log.debug('Loading accessory from cache:', accessory.displayName);
    this.accessories.push(accessory);
  }

  /**
   * Matches configured servers to accessories, creating and removing them as needed.
   *
   * Accessories are keyed on `ResolvedServer.key` stored in the accessory context, so
   * re-ordering or renaming servers in config.json does not orphan them.
   */
  private discoverDevices(servers: ResolvedServer[], requestTimeoutMs: number): void {
    const unclaimed = new Set(this.accessories);
    const pairs: { server: ResolvedServer; accessory: PlatformAccessory<AccessoryContext> }[] = [];
    const pending: ResolvedServer[] = [];

    // Pass 1 — re-attach accessories that already know which server they belong to.
    for (const server of servers) {
      const existing = [...unclaimed].find(accessory => accessory.context.serverKey === server.key);
      if (existing) {
        unclaimed.delete(existing);
        pairs.push({ server, accessory: existing });
      } else {
        pending.push(server);
      }
    }

    // Pass 2 — one-time migration from v1.x, which registered a single accessory under a
    // fixed UUID and stored nothing in its context. Adopt it for the first server still
    // waiting, so upgrading users keep their HomeKit rooms, scenes and automations.
    const legacyUuid = this.api.hap.uuid.generate(LEGACY_ACCESSORY_UUID_SEED);
    const legacyAccessory = [...unclaimed].find(
      accessory => accessory.UUID === legacyUuid && accessory.context.serverKey === undefined,
    );
    if (legacyAccessory && pending.length > 0) {
      const server = pending.shift()!;
      unclaimed.delete(legacyAccessory);
      pairs.push({ server, accessory: legacyAccessory });
      this.log.info(
        `Adopting the existing "${legacyAccessory.displayName}" accessory for ${server.name} `
        + '(carried over from the previous version of this plugin).',
      );
    }

    // Pass 3 — anything still unmatched is genuinely new.
    const created: PlatformAccessory<AccessoryContext>[] = [];
    for (const server of pending) {
      const uuid = this.api.hap.uuid.generate(`${PLUGIN_NAME}:${server.key}`);
      const accessory = new this.api.platformAccessory<AccessoryContext>(server.name, uuid);
      this.log.info(`Adding accessory for ${server.name} (${server.apiUrl}).`);
      created.push(accessory);
      pairs.push({ server, accessory });
    }

    // Pass 4 — cached accessories with no matching server were removed from the config.
    if (unclaimed.size > 0) {
      for (const accessory of unclaimed) {
        this.log.info(`Removing accessory "${accessory.displayName}", which is no longer configured.`);
      }
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [...unclaimed]);
    }

    // Persist identity and pick up renames before anything is registered or updated.
    const renamed: PlatformAccessory<AccessoryContext>[] = [];
    for (const { server, accessory } of pairs) {
      const changed = accessory.context.serverKey !== server.key
        || accessory.context.displayName !== server.name;

      accessory.context.serverKey = server.key;
      accessory.context.displayName = server.name;

      if (changed && !created.includes(accessory)) {
        renamed.push(accessory);
      }
    }

    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created);
    }
    if (renamed.length > 0) {
      this.api.updatePlatformAccessories(renamed);
    }

    for (const { server, accessory } of pairs) {
      const client = new qBittorrentClient({
        baseUrl: server.apiUrl,
        username: server.username,
        password: server.password,
        timeoutMs: requestTimeoutMs,
        log: this.log,
        label: server.name,
      });
      this.handlers.push(new qBittorrentPlatformAccessory(this, accessory, server, client));
    }
  }

  /**
   * Polls every server so HomeKit reflects changes made in qBittorrent's own Web UI.
   *
   * Polling is what keeps the `onGet` handler fast: it answers from the last known value
   * rather than making HomeKit wait for a network round trip.
   */
  private startPolling(refreshIntervalMs: number): void {
    const refreshAll = () => {
      for (const handler of this.handlers) {
        void handler.refresh();
      }
    };

    refreshAll();
    this.refreshTimer = setInterval(refreshAll, refreshIntervalMs);
    // Do not hold the event loop open just for the poll.
    this.refreshTimer.unref?.();
  }
}
