#!/usr/bin/env bash
#
# Build the plugin and install it into the running Homebridge container(s).
#
# `npm pack` is used deliberately: the container then runs exactly the file set that would
# be published to npm, so a mistake in "files" shows up here rather than after a release.
#
# The tarball is written to ./plugin-package (mounted read-only into the containers at
# /plugin-package) and declared in the container's /homebridge/package.json as a `file:`
# dependency. That is the only arrangement that survives the image's startup npm install,
# which prunes anything it does not consider a declared dependency.
#
# Do NOT bind-mount the plugin working copy into /var/lib/homebridge/node_modules. The
# image's startup does `rm -rf node_modules`, which deletes the CONTENTS of the mounted
# host directory -- i.e. your working copy.
#
# Usage:
#   ./scripts/deploy-plugin.sh              # build + deploy to the stable container
#   ./scripts/deploy-plugin.sh --beta       # ...to the Homebridge beta container as well
#   ./scripts/deploy-plugin.sh --no-restart # deploy without restarting Homebridge

set -euo pipefail

DEV_ENV_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLUGIN_DIR="$(cd "${DEV_ENV_DIR}/.." && pwd)"
PLUGIN_NAME="homebridge-qbittorrent-plugin"
PACKAGE_DIR="${DEV_ENV_DIR}/state/plugin-package"

RESTART=1
TARGETS=("homebridge")

for arg in "$@"; do
  case "$arg" in
    --beta)       TARGETS+=("homebridge-beta") ;;
    --no-restart) RESTART=0 ;;
    *) echo "unknown option: $arg" >&2; exit 2 ;;
  esac
done

echo "==> Building ${PLUGIN_NAME}"
cd "${PLUGIN_DIR}"
npm run build

echo "==> Packing"
mkdir -p "${PACKAGE_DIR}"
rm -f "${PACKAGE_DIR}"/*.tgz
TARBALL="$(cd "${PACKAGE_DIR}" && npm pack "${PLUGIN_DIR}" --silent)"
# A stable filename keeps the dependency spec in package.json constant across rebuilds.
mv "${PACKAGE_DIR}/${TARBALL}" "${PACKAGE_DIR}/${PLUGIN_NAME}.tgz"
echo "    ${PACKAGE_DIR}/${PLUGIN_NAME}.tgz"

for target in "${TARGETS[@]}"; do
  case "$target" in
    homebridge)      VOLUME_DIR="${DEV_ENV_DIR}/state/homebridge" ;;
    homebridge-beta) VOLUME_DIR="${DEV_ENV_DIR}/state/homebridge-beta" ;;
  esac

  echo "==> Declaring the plugin in ${target}'s package.json"
  PKG="${VOLUME_DIR}/package.json" python3 - "${PLUGIN_NAME}" <<'PY'
import json, os, pathlib, sys

name = sys.argv[1]
path = pathlib.Path(os.environ['PKG'])
package = json.loads(path.read_text()) if path.exists() else {}
package.setdefault('dependencies', {})[name] = f'file:/plugin-package/{name}.tgz'
path.write_text(json.dumps(package, indent=2) + '\n')
print(f'    dependencies.{name} = {package["dependencies"][name]}')
PY

  # Force npm to re-extract: with a stable tarball path it will otherwise keep the copy
  # that is already in node_modules.
  rm -rf "${VOLUME_DIR}/node_modules/${PLUGIN_NAME}"
done

if [[ "${RESTART}" == "1" ]]; then
  cd "${DEV_ENV_DIR}"
  for target in "${TARGETS[@]}"; do
    echo "==> Restarting ${target}"
    docker compose restart "${target}" >/dev/null
  done
fi

echo "==> Done. Homebridge UI: http://localhost:8581"
