# Changelog

## 2.0.0

### Added

- **Support for multiple qBittorrent servers** ([#1](https://github.com/RauchenwaldC/homebridge-qbittorrent-plugin/issues/1)).
  Configure as many servers as you like; each one gets its own HomeKit switch, named in the
  plugin settings.
- Switches now stay in sync with qBittorrent. Toggling alternative speed limits in the Web
  UI is reflected in the Home app on the next refresh, rather than only when HomeKit asks.
- `refreshInterval` and `requestTimeout` settings.
- The accessory now reports the qBittorrent version as its firmware revision.

### Fixed

- **The plugin could not authenticate against qBittorrent 5.x at all.** A successful login
  there answers `204` rather than `200`, and the session cookie is named `QBT_SID_<port>`
  rather than `SID`; the plugin checked for both of the old values. Both forms are now
  accepted.
- The plugin no longer logs in on every single read and write. Sessions are reused and only
  renewed when the server says they have expired, which also stops a polling plugin from
  tripping qBittorrent's failed-login ban.
- The `Referer` and `Origin` headers are no longer sent. qBittorrent validates them against
  the host it actually saw, so behind a reverse proxy they turned a working setup into an
  authentication failure.
- Turning a switch on or off now uses qBittorrent's non-toggling endpoint where available,
  so a switch can no longer end up inverted relative to the server.
- A server that is unreachable or misconfigured now shows as "No Response" in the Home app
  instead of silently reporting "off", and logs one error rather than one per refresh.
- Renaming a server, changing its address, or re-ordering the list no longer replaces its
  switch with a new one — which would have lost its HomeKit room, scenes and automations.
- No more `Configured Name` warning in the Homebridge log on every start.

### Changed

- **Requires Node.js 22, 24 or 26.** Node 18 and 20 are past end of life and Homebridge 2
  does not support them. This is why the release is a major version.
- Declares support for Homebridge 2 (`^1.8.0 || ^2.0.0`); the plugin runs on both 1.8 and 2
  ([#2](https://github.com/RauchenwaldC/homebridge-qbittorrent-plugin/issues/2)).
- **The plugin no longer registers any accessory until it is configured.** Previously an
  unconfigured install added a switch that threw when HomeKit read it.
- Removed the `axios` dependency in favour of the built-in `fetch`. The plugin now has no
  runtime dependencies at all.
- Added a test suite, run with `node --test`.

### Upgrading

Nothing to do. The version 1 settings (`apiUrl`, `username` and `password` at the top level
of the platform block) are read and moved into the new `servers` list automatically on first
start, and your existing switch keeps its HomeKit room, scenes and automations.

Make sure you are on Node.js 22 or later first.

## 1.1.2 and earlier

See the [releases page](https://github.com/RauchenwaldC/homebridge-qbittorrent-plugin/releases).
