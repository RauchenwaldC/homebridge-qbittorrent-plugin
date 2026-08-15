import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { migrateLegacyConfig } from '../dist/migrate.js';

function silentLog() {
  const lines: string[] = [];
  const record = (...args: unknown[]) => {
    lines.push(args.join(' '));
  };
  return Object.assign(record, {
    lines,
    info: record, warn: record, error: record, debug: record, log: record,
    success: record, prefix: 'test',
  });
}

/** Writes a config.json into a scratch directory and returns its path. */
async function writeConfig(config: unknown): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'hb-qbit-'));
  const path = join(directory, 'config.json');
  await writeFile(path, JSON.stringify(config, null, 4), 'utf8');
  return path;
}

async function readConfig(path: string): Promise<Record<string, never>> {
  return JSON.parse(await readFile(path, 'utf8'));
}

const platform = 'qBittorrentHomebridgePlugin';

describe('migrateLegacyConfig', () => {
  it('moves a v1 single-server block into the servers list', async () => {
    const path = await writeConfig({
      bridge: { name: 'Homebridge' },
      platforms: [
        { name: 'Config', platform: 'config' },
        { name: 'My Seedbox', platform, apiUrl: 'http://nas:8080/', username: 'admin', password: 'pw' },
      ],
    });

    assert.equal(await migrateLegacyConfig(path, silentLog() as never), true);

    const config = await readConfig(path);
    const block = (config as never as { platforms: Record<string, unknown>[] }).platforms[1];
    assert.deepEqual(block.servers, [
      { name: 'My Seedbox', apiUrl: 'http://nas:8080/', username: 'admin', password: 'pw' },
    ]);
    assert.equal('apiUrl' in block, false);
    assert.equal('username' in block, false);
    assert.equal('password' in block, false);
    // The rest of the file must be left exactly as it was.
    assert.deepEqual((config as never as { bridge: unknown }).bridge, { name: 'Homebridge' });
    assert.equal((config as never as { platforms: Record<string, unknown>[] }).platforms[0].platform, 'config');
  });

  it('omits credentials that were never set', async () => {
    const path = await writeConfig({
      platforms: [{ name: 'Open', platform, apiUrl: 'http://open:8080', username: '', password: '' }],
    });

    await migrateLegacyConfig(path, silentLog() as never);

    const config = await readConfig(path);
    assert.deepEqual((config as never as { platforms: Record<string, unknown>[] }).platforms[0].servers, [
      { name: 'Open', apiUrl: 'http://open:8080' },
    ]);
  });

  it('does nothing when the config is already migrated', async () => {
    const path = await writeConfig({
      platforms: [{ name: 'qBittorrent', platform, servers: [{ name: 'A', apiUrl: 'http://a:8080' }] }],
    });
    const before = await readFile(path, 'utf8');

    assert.equal(await migrateLegacyConfig(path, silentLog() as never), false);
    assert.equal(await readFile(path, 'utf8'), before);
  });

  it('leaves other plugins alone', async () => {
    const path = await writeConfig({
      platforms: [{ name: 'Other', platform: 'SomeOtherPlugin', apiUrl: 'http://other:8080' }],
    });
    const before = await readFile(path, 'utf8');

    assert.equal(await migrateLegacyConfig(path, silentLog() as never), false);
    assert.equal(await readFile(path, 'utf8'), before);
  });

  it('does not throw when the config is missing or unreadable', async () => {
    assert.equal(await migrateLegacyConfig('/nowhere/config.json', silentLog() as never), false);

    const directory = await mkdtemp(join(tmpdir(), 'hb-qbit-'));
    const broken = join(directory, 'config.json');
    await writeFile(broken, '{ not json', 'utf8');
    assert.equal(await migrateLegacyConfig(broken, silentLog() as never), false);
  });
});
