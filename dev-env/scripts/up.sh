#!/usr/bin/env bash
#
# Bring up the development environment: Homebridge plus two qBittorrent servers.
#
# Creates ./state on first run and seeds the two qBittorrent configs from ./seed, so the
# servers come up with known credentials instead of the random password qBittorrent
# generates on a fresh install.
#
# Usage:
#   ./scripts/up.sh            # stable Homebridge only
#   ./scripts/up.sh --beta     # also start the Homebridge beta container

set -euo pipefail

DEV_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DEV_ENV_DIR}"

WITH_BETA=0
for arg in "$@"; do
  case "$arg" in
    --beta) WITH_BETA=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo "==> Preparing ./state"
mkdir -p state/{homebridge,homebridge-beta,plugin-package,downloads-a,downloads-b}

# Seed Homebridge with a config that already points at both qBittorrent containers and has
# a fixed bridge identity, so re-creating the container does not orphan a HomeKit pairing.
for instance in homebridge homebridge-beta; do
  if [[ ! -f "state/${instance}/config.json" ]]; then
    cp seed/homebridge-config.json "state/${instance}/config.json"
    echo "    seeded ${instance}/config.json"
  fi
done
# The beta instance needs its own UI port and bridge identity to coexist with the stable one.
if [[ -f state/homebridge-beta/config.json ]]; then
  python3 - <<'PY'
import json, pathlib
path = pathlib.Path('state/homebridge-beta/config.json')
config = json.loads(path.read_text())
config['bridge']['name'] = 'Homebridge Dev Beta'
config['bridge']['username'] = '0E:11:22:33:44:66'
config['bridge']['port'] = 51827
for block in config['platforms']:
    if block.get('platform') == 'config':
        block['port'] = 8582
path.write_text(json.dumps(config, indent=4) + '\n')
PY
fi

for server in a b; do
  target="state/qbittorrent-${server}/qBittorrent"
  if [[ ! -f "${target}/qBittorrent.conf" ]]; then
    mkdir -p "${target}"
    cp "seed/qbittorrent-${server}.conf" "${target}/qBittorrent.conf"
    echo "    seeded qbittorrent-${server}"
  fi
done

echo "==> Starting containers"
if [[ "${WITH_BETA}" == "1" ]]; then
  docker compose --profile beta up -d
else
  docker compose up -d
fi

echo "==> Waiting for the Homebridge UI"
until curl -fsS -o /dev/null --max-time 3 http://localhost:8581/api/auth/settings; do sleep 3; done

# Create a known UI login on a fresh install, so scripts/verify.sh can drive the REST API
# without prompting. Harmless once a user already exists -- the call just fails.
curl -fsS -o /dev/null -X POST http://localhost:8581/api/setup-wizard/create-first-user \
  -H 'Content-Type: application/json' \
  -d '{"username":"dev","password":"devdevdev","name":"Dev","admin":true}' 2>/dev/null \
  && echo "    created UI login dev / devdevdev" \
  || echo "    UI login already set up"

cat <<'EOF'

==> Ready.

  Homebridge UI    http://localhost:8581   dev / devdevdev
  qBittorrent A    http://localhost:8080   admin / devpassword
  qBittorrent B    http://localhost:8081   qbadmin / devpassword2
                   (B also whitelists the compose subnet, so the plugin can
                    reach it with no credentials at all)

Next:
  ./scripts/deploy-plugin.sh   build and install the plugin
  ./scripts/verify.sh          check it actually works
EOF
