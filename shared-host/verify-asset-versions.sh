#!/usr/bin/env bash
set -euo pipefail

URL="${ASSET_VERSION_PUBLIC_URL:-https://tiles.radlobby.at/asset-versions.php}"
MAP_ORIGIN="${ASSET_VERSION_MAP_ORIGIN:-https://fahrrad.lima-city.de}"
EXPECTED_PREFIX="${ASSET_VERSION_EXPECTED_PREFIX:-/WienBuildings/LOD1/}"
VERSION_FILE="${ASSET_VERSION_EXPECTED_FILE:-wien-buildings/build/WienBuildings/ks-version.txt}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

[ -s "$VERSION_FILE" ] || {
	echo "Missing dataset version file: $VERSION_FILE" >&2
	exit 1
}

EXPECTED_VERSION="$(tr -d '\r\n' < "$VERSION_FILE")"
BODY="$WORK_DIR/asset-versions.json"
HEADERS="$WORK_DIR/headers.txt"
STATUS="$(
	curl \
		--silent \
		--show-error \
		--location \
		--fail-with-body \
		--retry 5 \
		--retry-delay 3 \
		--retry-all-errors \
		--connect-timeout 20 \
		--max-time 90 \
		--header "Origin: $MAP_ORIGIN" \
		--header 'Cache-Control: no-cache' \
		--dump-header "$HEADERS" \
		--output "$BODY" \
		--write-out '%{http_code}' \
		"$URL?verify=$(date +%s)"
)"

[ "$STATUS" = "200" ] || {
	echo "Expected HTTP 200 from $URL, got $STATUS" >&2
	exit 1
}

CORS="$(
	awk 'BEGIN { IGNORECASE=1 }
		/^Access-Control-Allow-Origin:/ {
			sub(/\r$/, "");
			sub(/^[^:]+:[[:space:]]*/, "");
			print
		}' "$HEADERS" | tail -n 1
)"
if [ "$CORS" != "*" ] && [ "$CORS" != "$MAP_ORIGIN" ]; then
	echo "Unexpected Access-Control-Allow-Origin: ${CORS:-missing}" >&2
	exit 1
fi

node - "$BODY" "$EXPECTED_PREFIX" "$EXPECTED_VERSION" <<'NODE'
const fs = require("fs");

const manifest = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const prefix = process.argv[3];
const expected = process.argv[4];

if (Number(manifest?.schema) !== 1) {
	throw new Error("Asset-version manifest schema is not 1.");
}
if (manifest?.truncated) {
	throw new Error("Asset-version manifest is truncated.");
}
if (String(manifest?.prefixes?.[prefix] || "") !== expected) {
	throw new Error(
		`Expected ${prefix}=${expected}, got ${manifest?.prefixes?.[prefix] || "missing"}`
	);
}
NODE

echo "Asset-version endpoint OK: $EXPECTED_PREFIX -> $EXPECTED_VERSION"
