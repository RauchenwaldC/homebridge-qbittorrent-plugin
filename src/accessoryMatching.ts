import { LEGACY_ACCESSORY_UUID_SEED, PLUGIN_NAME } from './settings.js';
import type { AccessoryContext, ResolvedServer } from './types.js';

/** The parts of a Homebridge PlatformAccessory this module needs. */
export interface AccessoryLike {
  UUID: string;
  displayName: string;
  context: AccessoryContext;
}

export interface MatchedAccessory<T> {
  server: ResolvedServer;
  accessory: T;
  /** True when the stored context no longer describes the configured server. */
  contextChanged: boolean;
  /** Set when the accessory was matched by something other than its server key. */
  adoptedBecause?: 'renamed-url' | 'upgrade-from-v1';
}

export interface AccessoryPlan<T> {
  matched: MatchedAccessory<T>[];
  /** Servers with no existing accessory, and the UUID to create one under. */
  created: { server: ResolvedServer; uuid: string }[];
  /** Cached accessories that no longer correspond to any configured server. */
  removed: T[];
}

/** The UUID seed for a server. Derived from the URL, which is a server's natural identity. */
export function uuidSeedFor(server: ResolvedServer): string {
  return `${PLUGIN_NAME}:${server.key}`;
}

/**
 * Works out which cached accessory belongs to which configured server, which servers need a
 * new accessory, and which accessories are now orphaned.
 *
 * Pure, so the interesting cases can be tested without a Homebridge instance.
 *
 * Accessories are matched in order of how confident the match is:
 *
 *   1. Same server key. The normal case: the URL is unchanged, so this is definitely the
 *      same server, whatever it has been renamed to.
 *   2. Same display name. The server's URL changed — its host got a new address, or it moved
 *      behind a reverse proxy. Re-using the accessory keeps the user's HomeKit room, scenes
 *      and automations instead of silently replacing the switch with an identical-looking
 *      one that has lost them all.
 *   3. The single accessory v1.x registered, which has no key stored at all.
 *
 * Changing a server's name *and* its URL at once therefore reads as a different server, and
 * gets a new accessory. That is the right answer: nothing links it to the old one.
 */
export function planAccessories<T extends AccessoryLike>(
  servers: ResolvedServer[],
  cached: T[],
  generateUuid: (seed: string) => string,
): AccessoryPlan<T> {
  const unclaimed = new Set(cached);
  const matched: MatchedAccessory<T>[] = [];
  let pending = [...servers];

  const claim = (
    server: ResolvedServer,
    accessory: T,
    adoptedBecause?: MatchedAccessory<T>['adoptedBecause'],
  ) => {
    unclaimed.delete(accessory);
    matched.push({
      server,
      accessory,
      contextChanged: accessory.context.serverKey !== server.key
        || accessory.context.displayName !== server.name,
      adoptedBecause,
    });
  };

  // 1. Same server key.
  pending = pending.filter(server => {
    const hit = [...unclaimed].find(accessory => accessory.context.serverKey === server.key);
    if (!hit) {
      return true;
    }
    claim(server, hit);
    return false;
  });

  // 2. Same name, different URL. Only consider accessories this plugin version created,
  //    which is what having a serverKey means.
  pending = pending.filter(server => {
    const hit = [...unclaimed].find(accessory =>
      accessory.context.serverKey !== undefined
      && accessory.context.displayName === server.name);
    if (!hit) {
      return true;
    }
    claim(server, hit, 'renamed-url');
    return false;
  });

  // 3. The v1.x accessory, which stored nothing in its context.
  const legacyUuid = generateUuid(LEGACY_ACCESSORY_UUID_SEED);
  if (pending.length > 0) {
    const legacy = [...unclaimed].find(accessory =>
      accessory.UUID === legacyUuid && accessory.context.serverKey === undefined);
    if (legacy) {
      claim(pending.shift()!, legacy, 'upgrade-from-v1');
    }
  }

  return {
    matched,
    created: pending.map(server => ({ server, uuid: generateUuid(uuidSeedFor(server)) })),
    removed: [...unclaimed],
  };
}
