import type {
  API,
  Characteristic,
  DynamicPlatformPlugin,
  Logging,
  PlatformAccessory,
  PlatformConfig,
  Service,
} from 'homebridge';

import { planAccessories } from './accessoryMatching.js';
import { resolvePlatformConfig } from './config.js';
import { migrateLegacyConfig } from './migrate.js';
import { qBittorrentPlatformAccessory } from './platformAccessory.js';
import { qBittorrentClient } from './qbittorrentClient.js';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';
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
    const plan = planAccessories(servers, this.accessories, seed => this.api.hap.uuid.generate(seed));
    const pairs: { server: ResolvedServer; accessory: PlatformAccessory<AccessoryContext> }[] = [];
    const updated: PlatformAccessory<AccessoryContext>[] = [];

    for (const { server, accessory, contextChanged, adoptedBecause } of plan.matched) {
      if (adoptedBecause === 'renamed-url') {
        this.log.info(
          `${server.name} has moved to ${server.apiUrl}; keeping its existing accessory so its `
          + 'HomeKit room and automations are not lost.',
        );
      } else if (adoptedBecause === 'upgrade-from-v1') {
        this.log.info(
          `Adopting the existing "${accessory.displayName}" accessory for ${server.name} `
          + '(carried over from the previous version of this plugin).',
        );
      }

      accessory.context.serverKey = server.key;
      accessory.context.displayName = server.name;
      if (contextChanged) {
        updated.push(accessory);
      }
      pairs.push({ server, accessory });
    }

    const created: PlatformAccessory<AccessoryContext>[] = [];
    for (const { server, uuid } of plan.created) {
      const accessory = new this.api.platformAccessory<AccessoryContext>(server.name, uuid);
      accessory.context.serverKey = server.key;
      accessory.context.displayName = server.name;
      this.log.info(`Adding accessory for ${server.name} (${server.apiUrl}).`);
      created.push(accessory);
      pairs.push({ server, accessory });
    }

    if (plan.removed.length > 0) {
      for (const accessory of plan.removed) {
        this.log.info(`Removing accessory "${accessory.displayName}", which is no longer configured.`);
      }
      this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, plan.removed);
    }
    if (created.length > 0) {
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, created);
    }
    if (updated.length > 0) {
      this.api.updatePlatformAccessories(updated);
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
