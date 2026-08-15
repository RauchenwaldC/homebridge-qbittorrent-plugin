import {
  DEFAULT_REFRESH_INTERVAL,
  DEFAULT_REQUEST_TIMEOUT,
  MAX_REFRESH_INTERVAL,
  MAX_REQUEST_TIMEOUT,
  MIN_REFRESH_INTERVAL,
  MIN_REQUEST_TIMEOUT,
} from './settings.js';
import type {
  ResolvedPlatformConfig,
  ResolvedServer,
  qBittorrentPlatformConfig,
  qBittorrentServerConfig,
} from './types.js';

/** Returns a trimmed string, or '' for anything that is not a usable string. */
function asString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * Validates a qBittorrent Web UI URL and returns it without a trailing slash.
 *
 * Returns `null` when the value is missing or unusable, which is what stops the plugin
 * registering accessories for a half-configured server.
 */
export function normaliseApiUrl(value: unknown): string | null {
  const raw = asString(value);
  if (raw === '') {
    return null;
  }

  // Users routinely type `localhost:8080`; treat a missing scheme as http rather than failing.
  const candidate = /^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `http://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return null;
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return null;
  }
  if (url.hostname === '') {
    return null;
  }

  // Keep any base path (qBittorrent can be hosted behind a reverse proxy sub-path),
  // but drop query, fragment and the trailing slash.
  const path = url.pathname.replace(/\/+$/, '');
  return `${url.protocol}//${url.host}${path}`;
}

/** Clamps a numeric option, falling back to `fallback` when it is missing or not a number. */
function clampNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(asString(value));
  if (!Number.isFinite(parsed)) {
    return fallback;
  }
  return Math.min(Math.max(parsed, min), max);
}

/**
 * Resolves a setting that a server may override.
 *
 * Precedence is: this server's value, then the platform-wide value, then the built-in
 * default. An out-of-range value is clamped rather than rejected -- the settings GUI keeps
 * these within range, so anything else was hand-edited and clamping is friendlier than
 * ignoring it.
 */
function resolveOverride(
  serverValue: unknown, platformValue: number, min: number, max: number,
): number {
  const raw = typeof serverValue === 'number' ? serverValue : Number.parseFloat(asString(serverValue));
  if (!Number.isFinite(raw)) {
    return platformValue;
  }
  return Math.min(Math.max(raw, min), max) * 1000;
}

/**
 * Reads the platform config, migrates the deprecated single-server layout, validates every
 * server and reports what is wrong.
 *
 * This is deliberately total: it never throws, and a caller that gets back an empty
 * `servers` array must not register any accessories.
 */
export function resolvePlatformConfig(config: qBittorrentPlatformConfig): ResolvedPlatformConfig {
  const errors: string[] = [];
  const warnings: string[] = [];

  const rawServers: qBittorrentServerConfig[] = [];
  let usedLegacyLayout = false;

  if (Array.isArray(config.servers) && config.servers.length > 0) {
    rawServers.push(...config.servers.filter((entry): entry is qBittorrentServerConfig =>
      typeof entry === 'object' && entry !== null));

    // If both layouts are present the array wins, but say so rather than silently ignoring.
    if (asString(config.apiUrl) !== '') {
      warnings.push(
        'Both the "servers" list and the deprecated top-level "apiUrl" are set. '
        + 'The "servers" list is being used; you can safely remove the top-level '
        + '"apiUrl", "username" and "password" settings.',
      );
    }
  } else if (asString(config.apiUrl) !== '') {
    usedLegacyLayout = true;
    rawServers.push({
      name: asString(config.name) || 'qBittorrent',
      apiUrl: config.apiUrl,
      username: config.username,
      password: config.password,
    });
  } else if (Array.isArray(config.servers)) {
    errors.push('The "servers" list is empty. Add at least one qBittorrent server in the plugin settings.');
  } else {
    errors.push('No qBittorrent servers are configured. Add at least one server in the plugin settings.');
  }

  const refreshIntervalMs = clampNumber(
    config.refreshInterval, DEFAULT_REFRESH_INTERVAL, MIN_REFRESH_INTERVAL, MAX_REFRESH_INTERVAL,
  ) * 1000;
  const requestTimeoutMs = clampNumber(
    config.requestTimeout, DEFAULT_REQUEST_TIMEOUT, MIN_REQUEST_TIMEOUT, MAX_REQUEST_TIMEOUT,
  ) * 1000;

  const servers: ResolvedServer[] = [];
  const seenKeys = new Set<string>();

  rawServers.forEach((entry, index) => {
    // Give the user a label they can find in their config even when the entry is unnamed.
    const label = asString(entry.name) || `server ${index + 1}`;
    const apiUrl = normaliseApiUrl(entry.apiUrl);

    if (apiUrl === null) {
      errors.push(
        asString(entry.apiUrl) === ''
          ? `Ignoring ${label}: no Web UI URL is set. Set it to something like "http://localhost:8080".`
          : `Ignoring ${label}: "${asString(entry.apiUrl)}" is not a valid http(s) URL.`,
      );
      return;
    }

    const key = apiUrl.toLowerCase();
    if (seenKeys.has(key)) {
      warnings.push(`Ignoring ${label}: ${apiUrl} is already configured by an earlier entry.`);
      return;
    }
    seenKeys.add(key);

    const username = asString(entry.username);
    const password = asString(entry.password);
    if (username === '' && password !== '') {
      warnings.push(`${label}: a password is set but no username. Requests will be sent unauthenticated.`);
    }

    servers.push({
      name: asString(entry.name) || (rawServers.length === 1 ? 'qBittorrent' : `qBittorrent ${index + 1}`),
      apiUrl,
      username,
      password,
      key,
      refreshIntervalMs: resolveOverride(
        entry.refreshInterval, refreshIntervalMs, MIN_REFRESH_INTERVAL, MAX_REFRESH_INTERVAL,
      ),
      requestTimeoutMs: resolveOverride(
        entry.requestTimeout, requestTimeoutMs, MIN_REQUEST_TIMEOUT, MAX_REQUEST_TIMEOUT,
      ),
    });
  });

  // Two accessories with the same name are indistinguishable in the Home app.
  const nameCounts = new Map<string, number>();
  for (const server of servers) {
    const lower = server.name.toLowerCase();
    nameCounts.set(lower, (nameCounts.get(lower) ?? 0) + 1);
  }
  for (const [name, count] of nameCounts) {
    if (count > 1) {
      warnings.push(`${count} servers are named "${name}". Give each server a unique name so you can tell them apart in the Home app.`);
    }
  }

  return {
    servers,
    errors,
    warnings,
    refreshIntervalMs,
    requestTimeoutMs,
    usedLegacyLayout,
  };
}
