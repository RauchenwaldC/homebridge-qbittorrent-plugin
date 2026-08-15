import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { planAccessories, uuidSeedFor } from '../dist/accessoryMatching.js';
import type { AccessoryLike } from '../dist/accessoryMatching.js';
import { resolvePlatformConfig } from '../dist/config.js';
import { LEGACY_ACCESSORY_UUID_SEED } from '../dist/settings.js';
import type { ResolvedServer } from '../dist/types.js';

/** Stands in for hap.uuid.generate: any injective function will do. */
const uuid = (seed: string) => `uuid(${seed})`;

/** Builds resolved servers the way the platform does, so keys are realistic. */
function servers(...entries: { name: string; apiUrl: string }[]): ResolvedServer[] {
  return resolvePlatformConfig({
    platform: 'qBittorrentHomebridgePlugin',
    name: 'qBittorrent',
    servers: entries,
  }).servers;
}

function cached(displayName: string, context: AccessoryLike['context'], UUID?: string): AccessoryLike {
  return { displayName, context, UUID: UUID ?? `uuid(homebridge-qbittorrent-plugin:${context.serverKey})` };
}

const legacyAccessory = (): AccessoryLike => ({
  UUID: uuid(LEGACY_ACCESSORY_UUID_SEED),
  displayName: 'Advanced Rate Limits',
  context: {},
});

describe('planAccessories', () => {
  it('creates an accessory for every server on a fresh install', () => {
    const configured = servers({ name: 'A', apiUrl: 'http://a:8080' }, { name: 'B', apiUrl: 'http://b:8080' });
    const plan = planAccessories(configured, [], uuid);

    assert.deepEqual(plan.matched, []);
    assert.deepEqual(plan.removed, []);
    assert.deepEqual(plan.created.map(c => c.server.name), ['A', 'B']);
    // Distinct servers must not collide on one UUID.
    assert.notEqual(plan.created[0].uuid, plan.created[1].uuid);
  });

  it('re-attaches accessories by server key across a restart', () => {
    const configured = servers({ name: 'A', apiUrl: 'http://a:8080' });
    const existing = cached('A', { serverKey: 'http://a:8080', displayName: 'A' });
    const plan = planAccessories(configured, [existing], uuid);

    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].accessory, existing);
    assert.equal(plan.matched[0].contextChanged, false);
    assert.deepEqual(plan.created, []);
    assert.deepEqual(plan.removed, []);
  });

  it('keeps the accessory when a server is renamed but its URL is unchanged', () => {
    const configured = servers({ name: 'New Name', apiUrl: 'http://a:8080' });
    const existing = cached('Old Name', { serverKey: 'http://a:8080', displayName: 'Old Name' });
    const plan = planAccessories(configured, [existing], uuid);

    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].accessory, existing);
    assert.equal(plan.matched[0].contextChanged, true);
    assert.deepEqual(plan.created, []);
  });

  it('keeps the accessory when a server moves to a new URL but keeps its name', () => {
    // The realistic case: the NAS picked up a different address.
    const configured = servers({ name: 'NAS', apiUrl: 'http://192.168.1.50:8080' });
    const existing = cached('NAS', { serverKey: 'http://192.168.1.10:8080', displayName: 'NAS' });
    const plan = planAccessories(configured, [existing], uuid);

    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].accessory, existing);
    assert.equal(plan.matched[0].adoptedBecause, 'renamed-url');
    assert.deepEqual(plan.created, []);
    assert.deepEqual(plan.removed, []);
  });

  it('treats a server whose name and URL both changed as a different server', () => {
    const configured = servers({ name: 'Totally Different', apiUrl: 'http://elsewhere:8080' });
    const existing = cached('NAS', { serverKey: 'http://nas:8080', displayName: 'NAS' });
    const plan = planAccessories(configured, [existing], uuid);

    assert.deepEqual(plan.matched, []);
    assert.equal(plan.created.length, 1);
    assert.deepEqual(plan.removed, [existing]);
  });

  it('prefers a key match over a name match', () => {
    // Two servers swapped names. Each must keep the accessory for its own URL.
    const configured = servers({ name: 'B', apiUrl: 'http://a:8080' }, { name: 'A', apiUrl: 'http://b:8080' });
    const first = cached('A', { serverKey: 'http://a:8080', displayName: 'A' });
    const second = cached('B', { serverKey: 'http://b:8080', displayName: 'B' });
    const plan = planAccessories(configured, [first, second], uuid);

    assert.equal(plan.matched.length, 2);
    assert.equal(plan.matched.find(m => m.server.apiUrl === 'http://a:8080')?.accessory, first);
    assert.equal(plan.matched.find(m => m.server.apiUrl === 'http://b:8080')?.accessory, second);
    assert.deepEqual(plan.created, []);
    assert.deepEqual(plan.removed, []);
  });

  it('is unaffected by the order servers appear in the config', () => {
    const forwards = servers({ name: 'A', apiUrl: 'http://a:8080' }, { name: 'B', apiUrl: 'http://b:8080' });
    const backwards = servers({ name: 'B', apiUrl: 'http://b:8080' }, { name: 'A', apiUrl: 'http://a:8080' });
    const store = [
      cached('A', { serverKey: 'http://a:8080', displayName: 'A' }),
      cached('B', { serverKey: 'http://b:8080', displayName: 'B' }),
    ];

    for (const configured of [forwards, backwards]) {
      const plan = planAccessories(configured, store, uuid);
      assert.deepEqual(plan.created, []);
      assert.deepEqual(plan.removed, []);
      assert.equal(plan.matched.every(m => m.contextChanged === false), true);
    }
  });

  it('adopts the v1 accessory for the first server on upgrade', () => {
    const configured = servers({ name: 'My Seedbox', apiUrl: 'http://nas:8080' });
    const legacy = legacyAccessory();
    const plan = planAccessories(configured, [legacy], uuid);

    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].accessory, legacy);
    assert.equal(plan.matched[0].adoptedBecause, 'upgrade-from-v1');
    assert.deepEqual(plan.created, []);
    assert.deepEqual(plan.removed, []);
  });

  it('adopts the v1 accessory only once, and only for the first server', () => {
    const configured = servers({ name: 'First', apiUrl: 'http://a:8080' }, { name: 'Second', apiUrl: 'http://b:8080' });
    const legacy = legacyAccessory();
    const plan = planAccessories(configured, [legacy], uuid);

    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].server.name, 'First');
    assert.deepEqual(plan.created.map(c => c.server.name), ['Second']);
  });

  it('does not re-adopt the v1 accessory once it has been claimed', () => {
    // Second start after the upgrade: the accessory now carries a server key.
    const configured = servers({ name: 'My Seedbox', apiUrl: 'http://nas:8080' });
    const adopted: AccessoryLike = {
      UUID: uuid(LEGACY_ACCESSORY_UUID_SEED),
      displayName: 'My Seedbox',
      context: { serverKey: 'http://nas:8080', displayName: 'My Seedbox' },
    };
    const plan = planAccessories(configured, [adopted], uuid);

    assert.equal(plan.matched.length, 1);
    assert.equal(plan.matched[0].adoptedBecause, undefined);
    assert.deepEqual(plan.created, []);
  });

  it('removes accessories for servers dropped from the config', () => {
    const configured = servers({ name: 'A', apiUrl: 'http://a:8080' });
    const keep = cached('A', { serverKey: 'http://a:8080', displayName: 'A' });
    const drop = cached('B', { serverKey: 'http://b:8080', displayName: 'B' });
    const plan = planAccessories(configured, [keep, drop], uuid);

    assert.deepEqual(plan.matched.map(m => m.accessory), [keep]);
    assert.deepEqual(plan.removed, [drop]);
    assert.deepEqual(plan.created, []);
  });

  it('removes every accessory when all servers are dropped', () => {
    const store = [
      cached('A', { serverKey: 'http://a:8080', displayName: 'A' }),
      cached('B', { serverKey: 'http://b:8080', displayName: 'B' }),
    ];
    const plan = planAccessories([], store, uuid);

    assert.deepEqual(plan.matched, []);
    assert.deepEqual(plan.created, []);
    assert.deepEqual(plan.removed, store);
  });

  it('derives the same UUID seed for a URL however the user typed it', () => {
    const [typed] = servers({ name: 'A', apiUrl: 'HTTP://Example.com:8080/' });
    const [canonical] = servers({ name: 'A', apiUrl: 'http://example.com:8080' });

    assert.equal(uuidSeedFor(typed), uuidSeedFor(canonical));
  });
});
