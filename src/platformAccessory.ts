import type { CharacteristicValue, PlatformAccessory, Service } from 'homebridge';

import type { qBittorrentPlatform } from './platform.js';
import { qBittorrentApiError, type qBittorrentClient } from './qbittorrentClient.js';
import type { AccessoryContext, ResolvedServer } from './types.js';

/**
 * A single HomeKit switch that mirrors one qBittorrent server's alternative
 * ("advanced") speed limits.
 */
export class qBittorrentPlatformAccessory {
  private readonly service: Service;

  /** Last value read from qBittorrent; `null` until the first successful read. */
  private currentState: boolean | null = null;
  /** Set when the last attempt failed, so repeated failures are not logged repeatedly. */
  private lastErrorMessage: string | null = null;

  constructor(
    private readonly platform: qBittorrentPlatform,
    private readonly accessory: PlatformAccessory<AccessoryContext>,
    private readonly server: ResolvedServer,
    private readonly client: qBittorrentClient,
  ) {
    this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.Characteristic.Manufacturer, 'qBittorrent')
      .setCharacteristic(this.platform.Characteristic.Model, 'Alternative Speed Limits')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, this.server.apiUrl);

    this.service = this.accessory.getService(this.platform.Service.Switch)
      ?? this.accessory.addService(this.platform.Service.Switch);

    // Keep the switch name in step with the config, in both HomeKit and the Homebridge UI.
    this.service.setCharacteristic(this.platform.Characteristic.Name, this.server.name);
    this.service.setCharacteristic(this.platform.Characteristic.ConfiguredName, this.server.name);

    this.service.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.handleGet.bind(this))
      .onSet(this.handleSet.bind(this));

    void this.reportServerVersion();
  }

  private get log() {
    return this.platform.log;
  }

  /**
   * Answers HomeKit from the last polled value.
   *
   * Returning immediately keeps Homebridge from warning about a slow characteristic. If
   * nothing has been read yet, throw so the Home app shows "No Response" rather than
   * inventing a state the server may not be in.
   */
  private handleGet(): CharacteristicValue {
    if (this.currentState === null) {
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
    return this.currentState;
  }

  private async handleSet(value: CharacteristicValue): Promise<void> {
    const target = value as boolean;

    try {
      await this.client.setSpeedLimitsMode(target);
      this.currentState = target;
      this.clearError();
      this.log.info(`${this.server.name}: alternative speed limits ${target ? 'enabled' : 'disabled'}.`);
    } catch (error) {
      this.reportError('set the alternative speed limits', error);
      throw new this.platform.api.hap.HapStatusError(
        this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
      );
    }
  }

  /**
   * Re-reads the state from qBittorrent and pushes it to HomeKit.
   *
   * Called on a timer by the platform. Never rejects: a polling failure must not become an
   * unhandled rejection.
   */
  async refresh(): Promise<void> {
    try {
      const state = await this.client.getSpeedLimitsMode();
      this.clearError();

      if (state !== this.currentState) {
        this.currentState = state;
        this.service.updateCharacteristic(this.platform.Characteristic.On, state);
        this.log.debug(`${this.server.name}: alternative speed limits are ${state ? 'on' : 'off'}.`);
      }
    } catch (error) {
      this.reportError('read the alternative speed limits', error);
      this.currentState = null;
      this.service.updateCharacteristic(
        this.platform.Characteristic.On,
        new this.platform.api.hap.HapStatusError(
          this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE,
        ),
      );
    }
  }

  /** Shows the qBittorrent version in the accessory details. Best effort only. */
  private async reportServerVersion(): Promise<void> {
    const version = await this.client.getApplicationVersion();
    if (version === null) {
      return;
    }

    this.accessory.getService(this.platform.Service.AccessoryInformation)
      ?.setCharacteristic(this.platform.Characteristic.FirmwareRevision, version);
    this.log.debug(`${this.server.name}: qBittorrent ${version}.`);
  }

  /**
   * Logs a failure once, then stays quiet until something changes, so an unreachable
   * server does not fill the log at the polling interval.
   */
  private reportError(action: string, error: unknown): void {
    const detail = error instanceof qBittorrentApiError || error instanceof Error
      ? error.message
      : String(error);
    const message = `${this.server.name}: could not ${action}. ${detail}`;

    if (message !== this.lastErrorMessage) {
      this.lastErrorMessage = message;
      this.log.error(message);
    } else {
      this.log.debug(message);
    }
  }

  private clearError(): void {
    if (this.lastErrorMessage !== null) {
      this.log.info(`${this.server.name}: connection restored.`);
      this.lastErrorMessage = null;
    }
  }
}
