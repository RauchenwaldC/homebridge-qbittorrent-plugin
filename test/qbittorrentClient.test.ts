import assert from 'node:assert/strict';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { after, describe, it } from 'node:test';

import { qBittorrentApiError, qBittorrentClient } from '../dist/qbittorrentClient.js';

/** A log that satisfies the bits of Homebridge's Logging that the client uses. */
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

interface FakeOptions {
  /** Session cookie name. qBittorrent 5.x uses QBT_SID_<port>; older builds used SID. */
  cookieName?: string;
  /** Status the login endpoint answers with on success: 204 (5.x) or 200 (older). */
  loginStatus?: 204 | 200;
  /** When false, /transfer/setSpeedLimitsMode answers 404 as older builds do. */
  supportsDirectSet?: boolean;
  /** Require a session cookie; when false the server behaves like an IP-whitelisted host. */
  requireAuth?: boolean;
  password?: string;
}

interface FakeServer {
  url: string;
  close: () => Promise<void>;
  mode: () => boolean;
  /** Number of times /auth/login was called, to prove sessions are reused. */
  logins: () => number;
  /** Force the next request to be treated as an expired session. */
  expireSession: () => void;
}

/** A stand-in for qBittorrent's Web API, matching the behaviour of a real 5.2.3 server. */
async function startFakeQbittorrent(options: FakeOptions = {}): Promise<FakeServer> {
  const {
    cookieName = 'QBT_SID_8080',
    loginStatus = 204,
    supportsDirectSet = true,
    requireAuth = true,
    password = 'secret',
  } = options;

  let speedLimitsMode = false;
  let loginCount = 0;
  let validSid: string | null = null;
  let forceExpiry = false;

  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    const body = await new Promise<string>(resolve => {
      let data = '';
      req.on('data', chunk => {
        data += chunk;
      });
      req.on('end', () => resolve(data));
    });

    // qBittorrent answers 401 when the Referer does not match its own origin.
    const referer = req.headers.referer;
    if (referer !== undefined && !referer.startsWith('http://127.0.0.1:')) {
      res.writeHead(401).end('Bad referer');
      return;
    }

    if (url.pathname === '/api/v2/auth/login') {
      loginCount += 1;
      const params = new URLSearchParams(body);
      if (params.get('password') !== password) {
        res.writeHead(401).end('Fails.');
        return;
      }
      validSid = `sid-${loginCount}`;
      forceExpiry = false;
      res.setHeader('set-cookie', `${cookieName}=${validSid}; HttpOnly; path=/`);
      res.writeHead(loginStatus).end(loginStatus === 200 ? 'Ok.' : undefined);
      return;
    }

    if (requireAuth) {
      const cookie = req.headers.cookie ?? '';
      const presented = cookie.split(';').map(part => part.trim())
        .find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);

      if (forceExpiry || validSid === null || presented !== validSid) {
        res.writeHead(403).end('Forbidden');
        return;
      }
    }

    switch (url.pathname) {
    case '/api/v2/app/version':
      res.writeHead(200, { 'content-type': 'text/plain' }).end('v5.2.3');
      return;

    case '/api/v2/transfer/speedLimitsMode':
      res.writeHead(200, { 'content-type': 'text/plain' }).end(speedLimitsMode ? '1' : '0');
      return;

    case '/api/v2/transfer/setSpeedLimitsMode':
      if (!supportsDirectSet) {
        res.writeHead(404).end('Not Found');
        return;
      }
      speedLimitsMode = new URLSearchParams(body).get('mode') === '1';
      res.writeHead(200).end();
      return;

    case '/api/v2/transfer/toggleSpeedLimitsMode':
      speedLimitsMode = !speedLimitsMode;
      res.writeHead(200).end();
      return;

    default:
      res.writeHead(404).end('Not Found');
    }
  };

  const server: Server = createServer((req, res) => {
    void handler(req, res).catch(() => res.writeHead(500).end());
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') {
    throw new Error('failed to bind the fake qBittorrent server');
  }

  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>(resolve => server.close(() => resolve())),
    mode: () => speedLimitsMode,
    logins: () => loginCount,
    expireSession: () => {
      forceExpiry = true;
    },
  };
}

const openServers: FakeServer[] = [];

async function fake(options?: FakeOptions): Promise<FakeServer> {
  const server = await startFakeQbittorrent(options);
  openServers.push(server);
  return server;
}

function clientFor(server: FakeServer, overrides: { username?: string; password?: string } = {}) {
  return new qBittorrentClient({
    baseUrl: server.url,
    username: overrides.username ?? 'admin',
    password: overrides.password ?? 'secret',
    timeoutMs: 5_000,
    log: silentLog() as never,
    label: 'test',
  });
}

after(async () => {
  await Promise.all(openServers.map(server => server.close()));
});

describe('qBittorrentClient', () => {
  it('authenticates against qBittorrent 5.x, which answers 204 with a QBT_SID_<port> cookie', async () => {
    const server = await fake();
    const client = clientFor(server);

    assert.equal(await client.getSpeedLimitsMode(), false);
    assert.equal(server.logins(), 1);
  });

  it('authenticates against older builds, which answer 200 with an SID cookie', async () => {
    const server = await fake({ cookieName: 'SID', loginStatus: 200 });
    const client = clientFor(server);

    assert.equal(await client.getSpeedLimitsMode(), false);
  });

  it('reuses the session instead of logging in for every request', async () => {
    const server = await fake();
    const client = clientFor(server);

    await client.getSpeedLimitsMode();
    await client.getSpeedLimitsMode();
    await client.getSpeedLimitsMode();

    assert.equal(server.logins(), 1);
  });

  it('logs in only once when several requests start at the same time', async () => {
    const server = await fake();
    const client = clientFor(server);

    await Promise.all([
      client.getSpeedLimitsMode(),
      client.getSpeedLimitsMode(),
      client.getSpeedLimitsMode(),
    ]);

    assert.equal(server.logins(), 1);
  });

  it('re-authenticates transparently when the session expires', async () => {
    const server = await fake();
    const client = clientFor(server);

    await client.getSpeedLimitsMode();
    server.expireSession();

    assert.equal(await client.getSpeedLimitsMode(), false);
    assert.equal(server.logins(), 2);
  });

  it('reports a bad password rather than retrying forever', async () => {
    const server = await fake();
    const client = clientFor(server, { password: 'wrong' });

    await assert.rejects(
      () => client.getSpeedLimitsMode(),
      (error: unknown) => error instanceof qBittorrentApiError && /username or password/i.test(error.message),
    );
  });

  it('works without credentials when the server does not require them', async () => {
    const server = await fake({ requireAuth: false });
    const client = clientFor(server, { username: '', password: '' });

    assert.equal(await client.getSpeedLimitsMode(), false);
    assert.equal(server.logins(), 0);
  });

  it('explains what to do when credentials are missing but required', async () => {
    const server = await fake();
    const client = clientFor(server, { username: '', password: '' });

    await assert.rejects(
      () => client.getSpeedLimitsMode(),
      (error: unknown) => error instanceof qBittorrentApiError
        && error.status === 403
        && /username and password/i.test(error.message),
    );
  });

  it('sets the mode directly when the server supports it', async () => {
    const server = await fake();
    const client = clientFor(server);

    await client.setSpeedLimitsMode(true);
    assert.equal(server.mode(), true);

    await client.setSpeedLimitsMode(false);
    assert.equal(server.mode(), false);
  });

  it('is idempotent: setting the mode it is already in does not flip it', async () => {
    const server = await fake();
    const client = clientFor(server);

    await client.setSpeedLimitsMode(true);
    await client.setSpeedLimitsMode(true);

    assert.equal(server.mode(), true);
  });

  it('falls back to toggling on builds without setSpeedLimitsMode', async () => {
    const server = await fake({ supportsDirectSet: false });
    const client = clientFor(server);

    await client.setSpeedLimitsMode(true);
    assert.equal(server.mode(), true);

    // The fallback must not flip a server that is already in the wanted state.
    await client.setSpeedLimitsMode(true);
    assert.equal(server.mode(), true);

    await client.setSpeedLimitsMode(false);
    assert.equal(server.mode(), false);
  });

  it('reads the qBittorrent version for the accessory details', async () => {
    const server = await fake();
    const client = clientFor(server);

    assert.equal(await client.getApplicationVersion(), '5.2.3');
  });

  it('reports an unreachable server instead of throwing something opaque', async () => {
    const client = new qBittorrentClient({
      // Port 1 is reserved and refuses connections.
      baseUrl: 'http://127.0.0.1:1',
      username: '',
      password: '',
      timeoutMs: 2_000,
      log: silentLog() as never,
      label: 'test',
    });

    await assert.rejects(
      () => client.getSpeedLimitsMode(),
      (error: unknown) => error instanceof qBittorrentApiError && /Could not reach/.test(error.message),
    );
  });

  it('never leaves getApplicationVersion rejecting, since it is best effort', async () => {
    const client = new qBittorrentClient({
      baseUrl: 'http://127.0.0.1:1',
      username: '',
      password: '',
      timeoutMs: 2_000,
      log: silentLog() as never,
      label: 'test',
    });

    assert.equal(await client.getApplicationVersion(), null);
  });
});
