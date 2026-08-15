#!/usr/bin/env bash
#
# End-to-end acceptance checks against the running development environment.
#
# Unlike `npm test`, which exercises the plugin in isolation, this drives the real thing:
# a real Homebridge, two real qBittorrent servers, and the plugin installed from the
# tarball that would be published to npm. Run it before pushing.
#
# It rewrites dev-env/state/homebridge/config.json as it goes and restores the seed config
# at the end, so do not run it against an environment whose config you care about.
#
# Usage:
#   ./scripts/verify.sh              # run everything
#   ./scripts/verify.sh --quick      # skip the slower restart-based scenarios
#
# Environment:
#   HB_URL       Homebridge UI base URL   (default http://localhost:8581)
#   HB_USERNAME  Homebridge UI username   (default dev)
#   HB_PASSWORD  Homebridge UI password   (default devdevdev)

set -uo pipefail

DEV_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${DEV_ENV_DIR}"

HB_URL="${HB_URL:-http://localhost:8581}"
HB_USERNAME="${HB_USERNAME:-dev}"
HB_PASSWORD="${HB_PASSWORD:-devdevdev}"
CONFIG="state/homebridge/config.json"
LOG="state/homebridge/homebridge.log"
QUICK=0

for arg in "$@"; do
  case "$arg" in
    --quick) QUICK=1 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

PASSED=0
FAILED=0
declare -a FAILURES=()

green() { printf '\033[32m%s\033[0m' "$1"; }
red()   { printf '\033[31m%s\033[0m' "$1"; }
dim()   { printf '\033[2m%s\033[0m' "$1"; }

pass() { PASSED=$((PASSED + 1)); printf '  %s %s\n' "$(green 'PASS')" "$1"; }
fail() {
  FAILED=$((FAILED + 1))
  FAILURES+=("$1")
  printf '  %s %s\n' "$(red 'FAIL')" "$1"
  [[ $# -gt 1 ]] && printf '       %s\n' "$(dim "$2")"
  return 0
}

check() { # check <description> <expected> <actual>
  if [[ "$2" == "$3" ]]; then pass "$1"; else fail "$1" "expected '$2', got '$3'"; fi
}

section() { printf '\n%s\n' "$1"; }

# --- helpers ----------------------------------------------------------------------------

TOKEN=""
login() {
  TOKEN="$(curl -fsS -X POST "${HB_URL}/api/auth/login" \
    -H 'Content-Type: application/json' \
    -d "{\"username\":\"${HB_USERNAME}\",\"password\":\"${HB_PASSWORD}\"}" 2>/dev/null \
    | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))' 2>/dev/null)"

  if [[ -z "${TOKEN}" ]]; then
    echo "Could not log in to the Homebridge UI at ${HB_URL} as '${HB_USERNAME}'." >&2
    echo "Set HB_USERNAME and HB_PASSWORD, or delete ./state and re-run ./scripts/up.sh." >&2
    exit 1
  fi
}

api() { curl -fsS -H "Authorization: Bearer ${TOKEN}" "${HB_URL}$1" 2>/dev/null; }

# Reads a qBittorrent server's alternative speed limits mode ("0" or "1"), from inside the
# compose network so server B's subnet whitelist applies.
qb_mode() { # qb_mode a|b
  local host="qbittorrent-$1" user pass
  case "$1" in
    a) user=admin;   pass=devpassword  ;;
    b) user=qbadmin; pass=devpassword2 ;;
  esac
  docker exec hb-dev sh -c "
    C=\$(curl -s -i -X POST 'http://${host}:8080/api/v2/auth/login' \
          --data 'username=${user}&password=${pass}' \
        | grep -i '^set-cookie' | sed 's/set-cookie: //I' | cut -d';' -f1)
    curl -s -b \"\$C\" 'http://${host}:8080/api/v2/transfer/speedLimitsMode'" 2>/dev/null
}

qb_set_mode() { # qb_set_mode a|b 0|1
  local host="qbittorrent-$1" user pass
  case "$1" in
    a) user=admin;   pass=devpassword  ;;
    b) user=qbadmin; pass=devpassword2 ;;
  esac
  docker exec hb-dev sh -c "
    C=\$(curl -s -i -X POST 'http://${host}:8080/api/v2/auth/login' \
          --data 'username=${user}&password=${pass}' \
        | grep -i '^set-cookie' | sed 's/set-cookie: //I' | cut -d';' -f1)
    curl -s -o /dev/null -b \"\$C\" -X POST \
      'http://${host}:8080/api/v2/transfer/setSpeedLimitsMode' --data 'mode=$2'" 2>/dev/null
}

switch_id() { # switch_id <serviceName>
  api /api/accessories | python3 -c "
import sys, json
name = sys.argv[1]
print(next((a['uniqueId'] for a in json.load(sys.stdin) if a.get('serviceName') == name), ''))
" "$1"
}

switch_value() { # switch_value <serviceName>
  api /api/accessories | python3 -c "
import sys, json
name = sys.argv[1]
print(next((a['values'].get('On') for a in json.load(sys.stdin) if a.get('serviceName') == name), 'missing'))
" "$1"
}

switch_names() {
  api /api/accessories | python3 -c "
import sys, json
print(','.join(sorted(a['serviceName'] for a in json.load(sys.stdin) if a.get('type') == 'Switch')))
"
}

set_switch() { # set_switch <uniqueId> <0|1>
  curl -fsS -o /dev/null -X PUT "${HB_URL}/api/accessories/$1" \
    -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
    -d "{\"characteristicType\":\"On\",\"value\":$2}" 2>/dev/null
}

write_platform_config() { # write_platform_config <json for the qBittorrent platform block>
  PLATFORM_JSON="$1" python3 - <<'PY'
import json, os, pathlib
path = pathlib.Path('state/homebridge/config.json')
config = json.loads(path.read_text())
config['platforms'] = [b for b in config['platforms'] if b.get('platform') == 'config']
block = json.loads(os.environ['PLATFORM_JSON'])
if block:
    config['platforms'].append(block)
path.write_text(json.dumps(config, indent=4) + '\n')
PY
}

log_mark() { wc -l < "${LOG}" 2>/dev/null || echo 0; }

# Simulates a fresh install by dropping the accessories Homebridge would restore from cache.
clear_accessory_cache() {
  docker compose stop homebridge >/dev/null 2>&1
  docker run --rm -v "${DEV_ENV_DIR}/state/homebridge:/hb" alpine \
    sh -c 'echo "[]" > /hb/accessories/cachedAccessories 2>/dev/null || true' >/dev/null 2>&1
  docker compose start homebridge >/dev/null 2>&1
}
log_since() { tail -n +"$(( $1 + 1 ))" "${LOG}" 2>/dev/null | sed 's/\x1b\[[0-9;]*m//g'; }

restart_homebridge() {
  docker compose restart homebridge >/dev/null 2>&1
  # Wait for Homebridge itself, not just the UI, to have finished starting.
  local deadline=$(( SECONDS + 120 ))
  until curl -fsS -o /dev/null --max-time 3 "${HB_URL}/api/auth/settings" 2>/dev/null; do
    (( SECONDS > deadline )) && { echo "Homebridge did not come back" >&2; return 1; }
    sleep 3
  done
  login
  until api /api/accessories >/dev/null 2>&1; do
    (( SECONDS > deadline )) && break
    sleep 3
  done
  sleep 8
}

TWO_SERVERS='{"name":"qBittorrent","platform":"qBittorrentHomebridgePlugin","refreshInterval":10,
  "servers":[
    {"name":"Seedbox A","apiUrl":"http://qbittorrent-a:8080","username":"admin","password":"devpassword"},
    {"name":"Seedbox B","apiUrl":"http://qbittorrent-b:8080"}]}'

cleanup() {
  printf '\n%s\n' "$(dim 'Restoring the seed configuration...')"
  write_platform_config "${TWO_SERVERS}"
  docker compose start qbittorrent-b >/dev/null 2>&1
  docker compose restart homebridge >/dev/null 2>&1
}
trap cleanup EXIT

# --- checks -----------------------------------------------------------------------------

printf '%s\n' "Verifying homebridge-qbittorrent-plugin against ${HB_URL}"

login

section 'Plugin loads and registers one switch per configured server'
write_platform_config "${TWO_SERVERS}"
restart_homebridge

EXPECTED_VERSION="$(python3 -c 'import json;print(json.load(open("../package.json"))["version"])')"
INSTALLED="$(api /api/plugins | python3 -c "
import sys, json
print(next((p['installedVersion'] for p in json.load(sys.stdin)
            if p['name'] == 'homebridge-qbittorrent-plugin'), 'not installed'))" 2>/dev/null)"
check "the built version is the one installed (${EXPECTED_VERSION})" "${EXPECTED_VERSION}" "${INSTALLED}"
check 'two switches exist, named from the config' 'Seedbox A,Seedbox B' "$(switch_names)"

INFO="$(api /api/accessories | python3 -c "
import sys, json
a = next(x for x in json.load(sys.stdin) if x.get('serviceName') == 'Seedbox A')
i = a['accessoryInformation']
print(f\"{i.get('Manufacturer')}|{i.get('Serial Number')}|{i.get('Firmware Revision')}\")")"
check 'accessory details name the server and its live qBittorrent version' \
  'qBittorrent|http://qbittorrent-a:8080|5.2.3' "${INFO}"

section 'Toggling from HomeKit reaches qBittorrent'
for server in a b; do
  case "${server}" in a) NAME='Seedbox A' ;; b) NAME='Seedbox B' ;; esac
  ID="$(switch_id "${NAME}")"
  qb_set_mode "${server}" 0 >/dev/null; sleep 1

  set_switch "${ID}" 1; sleep 3
  check "${NAME}: switching on enables alternative speed limits" '1' "$(qb_mode "${server}")"

  set_switch "${ID}" 0; sleep 3
  check "${NAME}: switching off disables them" '0' "$(qb_mode "${server}")"
done
pass 'Seedbox B did all of that with no credentials (subnet whitelist)'

section 'A change made in qBittorrent reaches HomeKit'
qb_set_mode a 1 >/dev/null
sleep 15
check 'HomeKit picks up an external change on the next refresh' '1' "$(switch_value 'Seedbox A')"
qb_set_mode a 0 >/dev/null
sleep 15
check 'and picks up the change back' '0' "$(switch_value 'Seedbox A')"

section 'An unreachable server degrades gracefully'
MARK="$(log_mark)"
docker compose stop qbittorrent-b >/dev/null 2>&1
sleep 35   # three refresh intervals
ERRORS="$(log_since "${MARK}" | grep -c 'Seedbox B: could not')"
check 'one error is logged, not one per refresh' '1' "${ERRORS}"
CRASHES="$(log_since "${MARK}" | grep -ciE 'unhandled|UnhandledPromise')"
check 'no unhandled rejection' '0' "${CRASHES}"
check 'the other server keeps working' '0' "$(qb_mode a)"

MARK="$(log_mark)"
docker compose start qbittorrent-b >/dev/null 2>&1
sleep 40
RECOVERED="$(log_since "${MARK}" | grep -c 'Seedbox B: connection restored')"
check 'recovery is logged once the server returns' '1' "${RECOVERED}"

if [[ "${QUICK}" == '1' ]]; then
  section 'Skipping the restart-based scenarios (--quick)'
else
  section 'An unconfigured plugin registers nothing (homebridge/plugins#764)'
  # As on a fresh install: no cached accessories to restore.
  clear_accessory_cache
  write_platform_config '{"name":"qBittorrent Platform","platform":"qBittorrentHomebridgePlugin"}'
  MARK="$(log_mark)"
  restart_homebridge
  OUT="$(log_since "${MARK}")"
  check 'no switch is registered' '' "$(switch_names)"
  if grep -q 'is not configured, so no accessories will be added' <<<"${OUT}"; then
    pass 'the log says what to do about it'
  else
    fail 'the log says what to do about it' 'expected the "not configured" error'
  fi
  if grep -qiE "cannot read propert|TypeError|unhandled" <<<"${OUT}"; then
    fail 'no exception is thrown' "$(grep -iE 'cannot read propert|TypeError|unhandled' <<<"${OUT}" | head -1)"
  else
    pass 'no exception is thrown'
  fi

  section 'A blank URL is treated as unconfigured, not as a crash'
  clear_accessory_cache
  write_platform_config '{"name":"qBittorrent","platform":"qBittorrentHomebridgePlugin","servers":[{"name":"Empty","apiUrl":""}]}'
  MARK="$(log_mark)"
  restart_homebridge
  OUT="$(log_since "${MARK}")"
  check 'no switch is registered' '' "$(switch_names)"
  if grep -q 'no Web UI URL is set' <<<"${OUT}"; then
    pass 'the log names the offending server'
  else
    fail 'the log names the offending server' 'expected the "no Web UI URL" error'
  fi

  section 'A version 1 configuration is migrated automatically'
  write_platform_config '{"name":"My Seedbox","platform":"qBittorrentHomebridgePlugin","apiUrl":"http://qbittorrent-a:8080","username":"admin","password":"devpassword"}'
  MARK="$(log_mark)"
  restart_homebridge
  MIGRATED="$(python3 -c "
import json
block = next(b for b in json.load(open('${CONFIG}'))['platforms']
             if b.get('platform') == 'qBittorrentHomebridgePlugin')
servers = block.get('servers', [])
print(f\"{len(servers)}|{servers[0]['apiUrl'] if servers else ''}|{'apiUrl' in block}\")")"
  check 'config.json now uses the servers list' '1|http://qbittorrent-a:8080|False' "${MIGRATED}"
  check 'and the switch is named from the old block' 'My Seedbox' "$(switch_names)"

  section 'Removing a server removes its switch'
  write_platform_config "${TWO_SERVERS}"
  restart_homebridge
  check 'both switches are back' 'Seedbox A,Seedbox B' "$(switch_names)"
  write_platform_config '{"name":"qBittorrent","platform":"qBittorrentHomebridgePlugin","servers":[{"name":"Seedbox A","apiUrl":"http://qbittorrent-a:8080","username":"admin","password":"devpassword"}]}'
  MARK="$(log_mark)"
  restart_homebridge
  check 'only the remaining server has a switch' 'Seedbox A' "$(switch_names)"
  if grep -q 'Removing accessory "Seedbox B"' <<<"$(log_since "${MARK}")"; then
    pass 'the removed accessory is unregistered, not orphaned'
  else
    fail 'the removed accessory is unregistered, not orphaned' 'expected a "Removing accessory" line'
  fi
fi

section 'No warnings from the plugin'
WARNINGS="$(grep -c 'This plugin generated a warning' "${LOG}" 2>/dev/null)"
WARNINGS="${WARNINGS:-0}"
check 'HAP logged no characteristic warnings' '0' "${WARNINGS}"

# --- summary ----------------------------------------------------------------------------

printf '\n%s\n' "$(printf '%.0s─' {1..60})"
if [[ "${FAILED}" == '0' ]]; then
  printf '%s  %d checks passed\n' "$(green 'ALL GOOD')" "${PASSED}"
  exit 0
fi

printf '%s  %d passed, %d failed\n' "$(red 'FAILURES')" "${PASSED}" "${FAILED}"
for failure in "${FAILURES[@]}"; do printf '  - %s\n' "${failure}"; done
exit 1
