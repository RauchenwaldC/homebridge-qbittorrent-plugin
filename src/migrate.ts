import { readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import type { Logging } from 'homebridge';

import { PLATFORM_NAME } from './settings.js';

/** Turns an unknown thrown value into something worth putting in a log line. */
function describe(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Rewrites a v1.x single-server platform block into the v2 `servers` list, in place.
 *
 * The plugin reads the old layout at runtime regardless, so this is not needed to keep an
 * upgraded install working. It exists so the Homebridge UI shows the user their server in
 * the settings form: without it the form renders an empty list, which looks like the
 * configuration has been lost, and saving from that state really would lose it.
 *
 * Best effort. Any failure is logged and ignored, leaving the runtime migration to cope.
 */
export async function migrateLegacyConfig(configPath: string, log: Logging): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(configPath, 'utf8');
  } catch (error) {
    log.debug(`Could not read ${configPath} to migrate the old settings: ${describe(error)}`);
    return false;
  }

  let config: { platforms?: unknown };
  try {
    config = JSON.parse(raw);
  } catch (error) {
    log.debug(`Could not parse ${configPath} to migrate the old settings: ${describe(error)}`);
    return false;
  }

  if (!Array.isArray(config.platforms)) {
    return false;
  }

  let changed = false;

  for (const block of config.platforms) {
    if (typeof block !== 'object' || block === null) {
      continue;
    }

    const platform = block as Record<string, unknown>;
    if (platform.platform !== PLATFORM_NAME) {
      continue;
    }
    // Only touch a block that still uses the old layout and has no new one.
    if (Array.isArray(platform.servers) || typeof platform.apiUrl !== 'string' || platform.apiUrl.trim() === '') {
      continue;
    }

    const server: Record<string, string> = {
      name: typeof platform.name === 'string' && platform.name.trim() !== ''
        ? platform.name.trim()
        : 'qBittorrent',
      apiUrl: platform.apiUrl.trim(),
    };
    if (typeof platform.username === 'string' && platform.username.trim() !== '') {
      server.username = platform.username.trim();
    }
    if (typeof platform.password === 'string' && platform.password.trim() !== '') {
      server.password = platform.password.trim();
    }

    platform.servers = [server];
    delete platform.apiUrl;
    delete platform.username;
    delete platform.password;
    changed = true;
  }

  if (!changed) {
    return false;
  }

  try {
    // Write beside the target and rename, so an interrupted write cannot truncate the
    // user's config.json.
    const temporary = join(dirname(configPath), `.${PLATFORM_NAME}.config.tmp`);
    await writeFile(temporary, `${JSON.stringify(config, null, 4)}\n`, 'utf8');
    await rename(temporary, configPath);
  } catch (error) {
    log.warn(
      'Could not move your old single-server settings into the new "servers" list '
      + `(${describe(error)}). The plugin still works, but the plugin settings page will `
      + 'show an empty server list until you add the server there yourself.',
    );
    return false;
  }

  log.info('Moved your qBittorrent server into the new "servers" list in config.json.');
  return true;
}
