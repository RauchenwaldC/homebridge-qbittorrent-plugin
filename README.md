# qBittorrent Homebridge Plugin

[![NPM Version](https://img.shields.io/npm/v/homebridge-qbittorrent-plugin)](https://www.npmjs.com/package/homebridge-qbittorrent-plugin)
[![NPM Downloads](https://img.shields.io/npm/dw/homebridge-qbittorrent-plugin)](https://www.npmjs.com/package/homebridge-qbittorrent-plugin)
[![Build and Lint](https://github.com/RauchenwaldC/homebridge-qbittorrent-plugin/actions/workflows/build.yml/badge.svg)](https://github.com/RauchenwaldC/homebridge-qbittorrent-plugin/actions/workflows/build.yml)

Control qBittorrent's **alternative speed limits** from Apple HomeKit.

The plugin adds one HomeKit switch per qBittorrent server. Turning the switch on puts that
server into its alternative (throttled) speed limits; turning it off returns it to the
normal limits. It is the same thing as the turtle icon in the qBittorrent Web UI.

Useful for automations like *"throttle downloads while we are watching TV"* or
*"full speed between 02:00 and 08:00"*.

## Features

- One switch per qBittorrent server — add as many servers as you like.
- Switches stay in sync with qBittorrent, so changes made in the Web UI show up in the
  Home app too.
- Works with servers that need a username and password, and with servers that skip
  authentication for whitelisted clients.
- No runtime dependencies.
- Runs on Homebridge 1.8 and Homebridge 2.

## Requirements

| | |
|---|---|
| Homebridge | 1.8 or later, including Homebridge 2 |
| Node.js | 22, 24 or 26 |
| qBittorrent | Any version with the Web UI enabled (tested against 5.2.3) |

Enable the Web UI on each server under **Tools → Options → Web UI**.

## Installation

1. Open the Homebridge UI.
2. Go to **Plugins** and search for **homebridge-qbittorrent-plugin**.
3. Click **Install**.
4. Open the plugin's settings and add your qBittorrent server(s).

Or from the command line:

```shell
npm install -g homebridge-qbittorrent-plugin
```

## Configuration

The plugin has a settings GUI in the Homebridge UI — use that unless you prefer editing
`config.json` by hand. Each server you add becomes its own switch:

```json
{
  "platforms": [
    {
      "platform": "qBittorrentHomebridgePlugin",
      "name": "qBittorrent",
      "servers": [
        {
          "name": "Living Room NAS",
          "apiUrl": "http://192.168.1.10:8080",
          "username": "admin",
          "password": "your-password"
        },
        {
          "name": "Seedbox",
          "apiUrl": "https://seedbox.example.com/qbit"
        }
      ]
    }
  ]
}
```

### Server options

| Field | Description | Required |
|---|---|---|
| `name` | The switch's name in the Home app. Give each server a different one. | Yes |
| `apiUrl` | Address of the qBittorrent Web UI, including the port. A reverse-proxy sub-path such as `https://example.com/qbit` works too. | Yes |
| `username` | Web UI username. Leave empty if the server does not require authentication. | No |
| `password` | Web UI password. Leave empty if the server does not require authentication. | No |
| `refreshInterval` | Overrides the default below, for this server only. | No |
| `requestTimeout` | Overrides the default below, for this server only. | No |

### Defaults for all servers

| Field | Description | Default |
|---|---|---|
| `name` | Name shown in the Homebridge log. | `qBittorrent` |
| `refreshInterval` | How often, in seconds, to re-read each server so changes made in qBittorrent reach the Home app. 5–3600. | `30` |
| `requestTimeout` | How long, in seconds, to wait for a server to respond. 1–60. | `10` |

Any server can override either of these under its own **Advanced** section — useful when one
qBittorrent is on the local network and another is across the internet:

```json
{
  "platform": "qBittorrentHomebridgePlugin",
  "name": "qBittorrent",
  "refreshInterval": 60,
  "servers": [
    { "name": "NAS", "apiUrl": "http://192.168.1.10:8080", "refreshInterval": 10 },
    { "name": "Seedbox", "apiUrl": "https://seedbox.example.com", "requestTimeout": 30 }
  ]
}
```

The NAS is polled every 10 seconds, the seedbox every 60, and the seedbox is given 30 seconds
to answer instead of 10.

### Servers without a password

If you have turned on *Bypass authentication for clients on localhost* or added Homebridge
to *Bypass authentication for clients in whitelisted IP subnets*, leave `username` and
`password` empty and the plugin will connect anonymously.

## Upgrading from version 1

Version 1 supported a single server, configured with `apiUrl`, `username` and `password` at
the top level of the platform block. Those settings are read and moved into the `servers`
list automatically the first time version 2 starts — there is nothing to do, and the switch
keeps its HomeKit room, scenes and automations.

Version 2 requires Node.js 22 or later. If you are still on Node 18 or 20, update Node
first; both are past end of life. See
[Updating Node.js](https://github.com/homebridge/homebridge/wiki/How-To-Update-Node.js).

## Troubleshooting

**The switch shows "No Response".**
The plugin cannot reach the server, or it is rejecting the credentials. Check the Homebridge
log — the plugin names the server and says what failed.

**"qBittorrent requires authentication".**
The server needs a username and password, and none are set for it in the plugin settings.

**"qBittorrent rejected the username or password".**
The credentials are wrong. Note that qBittorrent temporarily bans clients that fail to log
in too many times in a row; if you have been testing, you may need to wait or restart
qBittorrent.

**The switch is slow to reflect a change made in the Web UI.**
That is the polling interval. Lower `refreshInterval` if you want it faster.

## Contributing

```shell
npm install
npm run check     # lint, tests, type-check, build
```

There is a Docker-based development environment — Homebridge plus two qBittorrent
servers — under [`dev-env/`](dev-env/README.md):

```shell
cd dev-env
./scripts/up.sh              # start Homebridge + two qBittorrent servers
./scripts/deploy-plugin.sh   # build the plugin and install it into Homebridge
```

## License

Apache-2.0. See [LICENSE](LICENSE).

## Issues

Please report problems on the [issue tracker](https://github.com/RauchenwaldC/homebridge-qbittorrent-plugin/issues).
