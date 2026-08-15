# Development environment

A Docker Compose stack for working on this plugin: Homebridge, plus two qBittorrent
servers to point it at.

```
homebridge        Homebridge (current release) + Homebridge UI   http://localhost:8581
homebridge-beta   Homebridge beta channel + UI  (--profile beta) http://localhost:8582
qbittorrent-a     qBittorrent, needs credentials                 http://localhost:8080
qbittorrent-b     qBittorrent, whitelists the compose subnet     http://localhost:8081
```

The two qBittorrent servers exist so both authentication paths are exercised: **A** requires
a username and password, **B** lets whitelisted clients in without any, and having two of
them is what lets you test multiple switches.

Credentials are seeded from `./seed`, so they are known up front rather than being the
random password qBittorrent prints on a fresh install:

| Server | URL | Username | Password |
|---|---|---|---|
| A | http://localhost:8080 | `admin` | `devpassword` |
| B | http://localhost:8081 | `qbadmin` | `devpassword2` |

These are throwaway credentials for a container that is not reachable from outside this
machine. Do not reuse them anywhere.

## Usage

```shell
./scripts/up.sh                  # start everything (creates ./state on first run)
./scripts/deploy-plugin.sh       # build the plugin and install it into Homebridge
docker compose logs -f homebridge
docker compose down              # stop
```

Iterate by editing `../src`, then running `./scripts/deploy-plugin.sh` again.

To check the plugin against the Homebridge beta as well:

```shell
./scripts/up.sh --beta
./scripts/deploy-plugin.sh --beta
```

Everything the containers generate lives in `./state`, which is gitignored. Delete it to
start from scratch.

## How the plugin gets into the container

`deploy-plugin.sh` runs `npm pack` and installs the resulting tarball, so the container
runs exactly the file set that would be published to npm — a mistake in `files` shows up
here rather than after a release.

Two things about the `homebridge/homebridge` image make the obvious approaches wrong, both
learned the hard way:

- **Never bind-mount your working copy into `/var/lib/homebridge/node_modules`.** The
  image's startup runs `rm -rf node_modules` and `npm install`. It cannot remove the mount
  point itself, but it happily deletes *the contents of the mounted host directory* — i.e.
  your working copy — and npm then fails with `EBUSY` so Homebridge never installs.
- **That startup `npm install` also prunes.** Anything in `node_modules` that is not a
  declared dependency of `/homebridge/package.json` is removed on every container start.
  So the tarball is declared as a `file:` dependency pointing at `/plugin-package`, which
  is mounted read-only and well away from `node_modules`.

## Notes

- **Do not set `ENABLE_AVAHI=0`.** `/etc/nsswitch.conf` in this image reads
  `hosts: files mdns4_minimal [NOTFOUND=return] dns`. With `avahi-daemon` stopped,
  `mdns4_minimal` returns NOTFOUND, `[NOTFOUND=return]` halts the lookup before `dns` is
  tried, and *all* name resolution in the container fails — including npm.
- **`docker compose restart` does not apply changes to `docker-compose.yml`.** Use
  `docker compose up -d --force-recreate <service>` after editing it.
- **mDNS does not escape Docker Desktop on macOS**, so these bridges are not discoverable
  by a real iPhone. This environment is for exercising the plugin, the config schema and
  the Homebridge UI — not for pairing with HomeKit. Everything except pairing can be
  driven from the Homebridge UI at http://localhost:8581, including reading and writing
  the switches (the containers run with `-I`).
