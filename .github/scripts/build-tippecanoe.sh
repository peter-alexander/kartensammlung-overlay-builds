#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "$SCRIPT_DIR/../.." && pwd)"
INSTALL_DIR="$REPO_ROOT/.local/bin"
BUILD_DIR="${RUNNER_TEMP:-/tmp}/tippecanoe-src"

mkdir -p "$INSTALL_DIR"
rm -rf "$BUILD_DIR"

git clone --depth=1 https://github.com/felt/tippecanoe.git "$BUILD_DIR" >&2
make -C "$BUILD_DIR" -j"$(nproc)" >&2
cp "$BUILD_DIR/tippecanoe" "$INSTALL_DIR/tippecanoe"
cp "$BUILD_DIR/tile-join" "$INSTALL_DIR/tile-join"
chmod +x "$INSTALL_DIR/tippecanoe" "$INSTALL_DIR/tile-join"

echo "$INSTALL_DIR/tippecanoe"
