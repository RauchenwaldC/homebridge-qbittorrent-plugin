import type { Logging } from 'homebridge';

/**
 * An error raised by the qBittorrent Web API, carrying the HTTP status so callers can tell
 * "your session expired" (403) from "your password is wrong" (401).
 */
export class qBittorrentApiError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'qBittorrentApiError';
  }
}

export interface qBittorrentClientOptions {
  baseUrl: string;
  username: string;
  password: string;
  timeoutMs: number;
  log: Logging;
  /** Prefix for log lines, so multi-server setups are readable. */
  label: string;
}

interface RequestOptions {
  method?: 'GET' | 'POST';
  body?: URLSearchParams;
  /** Set false on the login call itself, to stop it recursing. */
  allowReauth?: boolean;
}

/**
 * Picks the session cookie out of a login response.
 *
 * qBittorrent named it `SID` historically and `QBT_SID_<port>` since 5.x, so match on the
 * shape of the name rather than a literal.
 */
function extractSessionCookie(response: Response): string | null {
  const cookies = response.headers.getSetCookie();

  for (const raw of cookies) {
    const pair = raw.split(';', 1)[0];
    const separator = pair.indexOf('=');
    if (separator <= 0) {
      continue;
    }

    const name = pair.slice(0, separator).trim();
    const value = pair.slice(separator + 1).trim();
    if (value !== '' && /(^|_)SID(_|$)/i.test(name)) {
      return `${name}=${value}`;
    }
  }

  return null;
}

/**
 * A small client for the parts of the qBittorrent Web API this plugin needs.
 *
 * Deliberately built on the global `fetch` so the plugin ships with no runtime dependencies.
 *
 * Session handling notes, verified against qBittorrent 5.2.3 / Web API 2.15.1:
 *   - A successful login answers `204 No Content` (older builds answered `200` with the body
 *     `Ok.`), and sets a session cookie named `SID` on older builds but `QBT_SID_<port>` on
 *     current ones. Both are matched.
 *   - Bad credentials answer `401`, and a missing or expired session answers `403`.
 *   - The `Referer` header must either be absent or match the Web UI origin, otherwise
 *     qBittorrent's CSRF protection answers `401`.
 */
export class qBittorrentClient {
  private cookie: string | null = null;
  /** In-flight login, shared so concurrent requests never trigger two logins at once. */
  private loginInFlight: Promise<void> | null = null;
  /** Cached result of probing for the non-toggling setter; see setSpeedLimitsMode(). */
  private supportsDirectSet = true;

  constructor(private readonly options: qBittorrentClientOptions) {}

  private get log(): Logging {
    return this.options.log;
  }

  /** True when the user supplied credentials; some setups bypass auth by IP whitelist. */
  private get hasCredentials(): boolean {
    return this.options.username !== '' || this.options.password !== '';
  }

  /**
   * Logs in and stores the session cookie.
   *
   * Concurrent callers share one request: qBittorrent bans clients that fail to
   * authenticate too many times in a row, so a burst of logins is worth avoiding.
   */
  private async login(): Promise<void> {
    if (this.loginInFlight) {
      return this.loginInFlight;
    }

    this.loginInFlight = (async () => {
      const body = new URLSearchParams({
        username: this.options.username,
        password: this.options.password,
      });

      const response = await this.fetchRaw('/api/v2/auth/login', { method: 'POST', body });

      if (response.status === 401 || response.status === 403) {
        throw new qBittorrentApiError(
          'qBittorrent rejected the username or password.', response.status,
        );
      }
      if (!response.ok) {
        throw new qBittorrentApiError(
          `Unexpected response ${response.status} from the qBittorrent login endpoint.`, response.status,
        );
      }

      // Older builds answer 200 with a plain-text body of `Ok.` or `Fails.`.
      const text = (await response.text()).trim();
      if (text.toLowerCase().startsWith('fail')) {
        throw new qBittorrentApiError('qBittorrent rejected the username or password.', response.status);
      }

      const cookie = extractSessionCookie(response);
      if (cookie === null) {
        throw new qBittorrentApiError('qBittorrent did not return a session cookie after login.');
      }

      this.cookie = cookie;
      this.log.debug(`[${this.options.label}] Authenticated with qBittorrent.`);
    })().finally(() => {
      this.loginInFlight = null;
    });

    return this.loginInFlight;
  }

  /** Issues a single HTTP request. No session handling — see `request()` for that. */
  private async fetchRaw(path: string, options: RequestOptions): Promise<Response> {
    const url = `${this.options.baseUrl}${path}`;
    const headers: Record<string, string> = {
      // qBittorrent validates Referer against its own origin when CSRF protection is on.
      Referer: this.options.baseUrl,
      Origin: this.options.baseUrl,
    };

    if (this.cookie !== null) {
      headers.Cookie = this.cookie;
    }
    if (options.body) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    try {
      return await fetch(url, {
        method: options.method ?? 'GET',
        headers,
        body: options.body,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
        throw new qBittorrentApiError(
          `Timed out after ${Math.round(this.options.timeoutMs / 1000)}s contacting ${this.options.baseUrl}.`,
        );
      }
      throw new qBittorrentApiError(
        `Could not reach ${this.options.baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /**
   * Issues a request, logging in first when needed and retrying once if the session expired.
   */
  private async request(path: string, options: RequestOptions = {}): Promise<Response> {
    const allowReauth = options.allowReauth ?? true;

    if (this.cookie === null && this.hasCredentials) {
      await this.login();
    }

    let response = await this.fetchRaw(path, options);

    // 403 means the session is missing or stale. Log in once and try again.
    if (response.status === 403 && allowReauth && this.hasCredentials) {
      this.log.debug(`[${this.options.label}] Session expired, re-authenticating.`);
      this.cookie = null;
      await this.login();
      response = await this.fetchRaw(path, options);
    }

    if (response.status === 403) {
      throw new qBittorrentApiError(
        this.hasCredentials
          ? 'qBittorrent refused the request even after re-authenticating.'
          : 'qBittorrent requires authentication. Set a username and password for this server '
            + 'in the plugin settings, or whitelist Homebridge in qBittorrent\'s Web UI settings.',
        403,
      );
    }

    return response;
  }

  /** Reads whether alternative ("advanced") speed limits are currently active. */
  async getSpeedLimitsMode(): Promise<boolean> {
    const response = await this.request('/api/v2/transfer/speedLimitsMode');
    if (!response.ok) {
      throw new qBittorrentApiError(
        `Unexpected response ${response.status} when reading the speed limits mode.`, response.status,
      );
    }

    // The endpoint answers with a bare `0` or `1` as text/plain.
    const text = (await response.text()).trim();
    if (text === '1') {
      return true;
    }
    if (text === '0') {
      return false;
    }
    throw new qBittorrentApiError(`Could not understand the speed limits mode "${text}".`);
  }

  /**
   * Turns alternative speed limits on or off.
   *
   * Prefers `setSpeedLimitsMode`, which is idempotent. Older servers only offer
   * `toggleSpeedLimitsMode`, so fall back to reading the current state and toggling only
   * when it actually differs.
   */
  async setSpeedLimitsMode(enabled: boolean): Promise<void> {
    if (this.supportsDirectSet) {
      const body = new URLSearchParams({ mode: enabled ? '1' : '0' });
      const response = await this.request('/api/v2/transfer/setSpeedLimitsMode', { method: 'POST', body });

      if (response.ok) {
        return;
      }

      // 404/405 means this build predates the direct setter; fall through to the toggle.
      if (response.status !== 404 && response.status !== 405) {
        throw new qBittorrentApiError(
          `Unexpected response ${response.status} when setting the speed limits mode.`, response.status,
        );
      }

      this.supportsDirectSet = false;
      this.log.debug(
        `[${this.options.label}] This qBittorrent build has no setSpeedLimitsMode endpoint; using toggle instead.`,
      );
    }

    if (await this.getSpeedLimitsMode() === enabled) {
      return;
    }

    const response = await this.request('/api/v2/transfer/toggleSpeedLimitsMode', { method: 'POST' });
    if (!response.ok) {
      throw new qBittorrentApiError(
        `Unexpected response ${response.status} when toggling the speed limits mode.`, response.status,
      );
    }
  }

  /** Reads the qBittorrent version, for the HomeKit accessory details. Never throws. */
  async getApplicationVersion(): Promise<string | null> {
    try {
      const response = await this.request('/api/v2/app/version');
      if (!response.ok) {
        return null;
      }
      const version = (await response.text()).trim();
      return version === '' ? null : version.replace(/^v/, '');
    } catch {
      return null;
    }
  }
}
