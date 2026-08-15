import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { normaliseApiUrl, resolvePlatformConfig } from '../dist/config.js';
import type { qBittorrentPlatformConfig } from '../dist/types.js';

/** Builds a platform config with the two fields Homebridge always supplies. */
function config(extra: Partial<qBittorrentPlatformConfig>): qBittorrentPlatformConfig {
  return { platform: 'qBittorrentHomebridgePlugin', name: 'qBittorrent', ...extra };
}

describe('normaliseApiUrl', () => {
  it('strips trailing slashes', () => {
    assert.equal(normaliseApiUrl('http://localhost:8080///'), 'http://localhost:8080');
  });

  it('keeps a reverse-proxy sub-path', () => {
    assert.equal(normaliseApiUrl('https://example.com/qbit/'), 'https://example.com/qbit');
  });

  it('assumes http when no scheme is given', () => {
    assert.equal(normaliseApiUrl('localhost:8080'), 'http://localhost:8080');
  });

  it('drops query strings and fragments', () => {
    assert.equal(normaliseApiUrl('http://localhost:8080/?a=1#b'), 'http://localhost:8080');
  });

  it('rejects values that cannot identify a server', () => {
    for (const value of ['', '   ', null, undefined, 42, {}, 'ftp://localhost', 'http://']) {
      assert.equal(normaliseApiUrl(value), null, `expected ${JSON.stringify(value)} to be rejected`);
    }
  });
});

describe('resolvePlatformConfig', () => {
  it('reports an error and yields no servers when nothing is configured', () => {
    // This is the case the Homebridge reviewer hit: a platform block with only
    // `name` and `platform`. Nothing may be registered.
    const result = resolvePlatformConfig(config({}));

    assert.deepEqual(result.servers, []);
    assert.equal(result.errors.length, 1);
  });

  it('yields no servers when the only entry has a blank URL', () => {
    // The config schema marks the URL required, but the UI still lets it be saved empty.
    const result = resolvePlatformConfig(config({ servers: [{ name: 'Mine', apiUrl: '   ' }] }));

    assert.deepEqual(result.servers, []);
    assert.match(result.errors.join('\n'), /no Web UI URL/i);
  });

  it('keeps the valid servers and reports only the broken one', () => {
    const result = resolvePlatformConfig(config({
      servers: [
        { name: 'Good', apiUrl: 'http://good:8080' },
        { name: 'Broken', apiUrl: 'not a url' },
      ],
    }));

    assert.deepEqual(result.servers.map(s => s.name), ['Good']);
    assert.equal(result.errors.length, 1);
    assert.match(result.errors[0], /Broken/);
  });

  it('migrates the deprecated single-server layout', () => {
    const result = resolvePlatformConfig(config({
      apiUrl: 'http://localhost:8080/',
      username: 'admin',
      password: 'secret',
    }));

    assert.equal(result.usedLegacyLayout, true);
    assert.equal(result.servers.length, 1);
    assert.deepEqual(
      { ...result.servers[0] },
      {
        name: 'qBittorrent',
        apiUrl: 'http://localhost:8080',
        username: 'admin',
        password: 'secret',
        key: 'http://localhost:8080',
        refreshIntervalMs: 30_000,
        requestTimeoutMs: 10_000,
      },
    );
  });

  it('prefers the servers list over the deprecated layout, and says so', () => {
    const result = resolvePlatformConfig(config({
      apiUrl: 'http://legacy:8080',
      servers: [{ name: 'New', apiUrl: 'http://new:8080' }],
    }));

    assert.equal(result.usedLegacyLayout, false);
    assert.deepEqual(result.servers.map(s => s.apiUrl), ['http://new:8080']);
    assert.match(result.warnings.join('\n'), /deprecated top-level "apiUrl"/);
  });

  it('gives each server a stable key that ignores URL formatting', () => {
    const result = resolvePlatformConfig(config({
      servers: [{ name: 'A', apiUrl: 'HTTP://Example.com:8080/' }],
    }));

    assert.equal(result.servers[0].key, 'http://example.com:8080');
  });

  it('drops duplicate servers rather than creating two switches for one host', () => {
    const result = resolvePlatformConfig(config({
      servers: [
        { name: 'A', apiUrl: 'http://host:8080' },
        { name: 'B', apiUrl: 'http://host:8080/' },
      ],
    }));

    assert.deepEqual(result.servers.map(s => s.name), ['A']);
    assert.match(result.warnings.join('\n'), /already configured/);
  });

  it('warns when two servers share a name', () => {
    const result = resolvePlatformConfig(config({
      servers: [
        { name: 'qBittorrent', apiUrl: 'http://a:8080' },
        { name: 'qBittorrent', apiUrl: 'http://b:8080' },
      ],
    }));

    assert.equal(result.servers.length, 2);
    assert.match(result.warnings.join('\n'), /unique name/);
  });

  it('treats missing credentials as anonymous access', () => {
    const result = resolvePlatformConfig(config({
      servers: [{ name: 'Open', apiUrl: 'http://open:8080' }],
    }));

    assert.equal(result.servers[0].username, '');
    assert.equal(result.servers[0].password, '');
    assert.deepEqual(result.errors, []);
  });

  it('clamps the refresh interval and request timeout into their supported range', () => {
    const tooSmall = resolvePlatformConfig(config({
      servers: [{ name: 'A', apiUrl: 'http://a:8080' }],
      refreshInterval: 0,
      requestTimeout: 0,
    }));
    assert.equal(tooSmall.refreshIntervalMs, 5_000);
    assert.equal(tooSmall.requestTimeoutMs, 1_000);

    const tooBig = resolvePlatformConfig(config({
      servers: [{ name: 'A', apiUrl: 'http://a:8080' }],
      refreshInterval: 99_999,
      requestTimeout: 99_999,
    }));
    assert.equal(tooBig.refreshIntervalMs, 3_600_000);
    assert.equal(tooBig.requestTimeoutMs, 60_000);
  });

  it('falls back to the defaults when the intervals are absent or nonsense', () => {
    const result = resolvePlatformConfig(config({
      servers: [{ name: 'A', apiUrl: 'http://a:8080' }],
      refreshInterval: 'soon' as unknown as number,
    }));

    assert.equal(result.refreshIntervalMs, 30_000);
    assert.equal(result.requestTimeoutMs, 10_000);
  });

  it('lets a server override the refresh interval and request timeout', () => {
    const result = resolvePlatformConfig(config({
      refreshInterval: 60,
      requestTimeout: 20,
      servers: [
        // A NAS on the same LAN can be polled hard; a remote seedbox needs longer to answer.
        { name: 'LAN', apiUrl: 'http://lan:8080', refreshInterval: 10, requestTimeout: 5 },
        { name: 'Remote', apiUrl: 'http://remote:8080' },
      ],
    }));

    assert.deepEqual(
      result.servers.map(s => [s.name, s.refreshIntervalMs, s.requestTimeoutMs]),
      [['LAN', 10_000, 5_000], ['Remote', 60_000, 20_000]],
    );
  });

  it('falls back to the platform setting for a server that does not override it', () => {
    const result = resolvePlatformConfig(config({
      refreshInterval: 45,
      servers: [{ name: 'A', apiUrl: 'http://a:8080', requestTimeout: 3 }],
    }));

    assert.equal(result.servers[0].refreshIntervalMs, 45_000);
    assert.equal(result.servers[0].requestTimeoutMs, 3_000);
  });

  it('falls back to the built-in defaults when neither level sets anything', () => {
    const result = resolvePlatformConfig(config({
      servers: [{ name: 'A', apiUrl: 'http://a:8080' }],
    }));

    assert.equal(result.servers[0].refreshIntervalMs, 30_000);
    assert.equal(result.servers[0].requestTimeoutMs, 10_000);
  });

  it('clamps a hand-edited per-server override rather than ignoring it', () => {
    const result = resolvePlatformConfig(config({
      servers: [
        { name: 'Fast', apiUrl: 'http://a:8080', refreshInterval: 0, requestTimeout: 0 },
        { name: 'Slow', apiUrl: 'http://b:8080', refreshInterval: 99_999, requestTimeout: 99_999 },
      ],
    }));

    assert.deepEqual(
      result.servers.map(s => [s.refreshIntervalMs, s.requestTimeoutMs]),
      [[5_000, 1_000], [3_600_000, 60_000]],
    );
  });

  it('ignores a per-server override that is not a number', () => {
    const result = resolvePlatformConfig(config({
      refreshInterval: 90,
      servers: [{ name: 'A', apiUrl: 'http://a:8080', refreshInterval: 'often' as unknown as number }],
    }));

    assert.equal(result.servers[0].refreshIntervalMs, 90_000);
  });

  it('survives a servers list containing junk', () => {
    const result = resolvePlatformConfig(config({
      servers: [null, 'nope', { name: 'A', apiUrl: 'http://a:8080' }] as never,
    }));

    assert.deepEqual(result.servers.map(s => s.name), ['A']);
  });
});
