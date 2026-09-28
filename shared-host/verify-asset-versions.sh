#!/usr/bin/env bash
set -euo pipefail

URL="${ASSET_VERSION_PUBLIC_URL:-https://tiles.radlobby.at/asset-versions.php}"
MAP_ORIGIN="${ASSET_VERSION_MAP_ORIGIN:-https://fahrrad.lima-city.de}"
EXPECTED_PREFIX="${ASSET_VERSION_EXPECTED_PREFIX:-/WienBuildings/LOD1/}"
VERSION_URL="${ASSET_VERSION_EXPECTED_VERSION_URL:-https://tiles.radlobby.at/WienBuildings/LOD1/ks-version.txt}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

VERIFY_TOKEN="$(date +%s)"
EXPECTED_VERSION="$(
	curl \
		--silent \
		--show-error \
		--location \
		--fail \
		--retry 3 \
		--retry-delay 2 \
		--connect-timeout 15 \
		--max-time 30 \
		"$VERSION_URL?verify=$VERIFY_TOKEN" \
		| tr -d '\r\n'
)"

[ -n "$EXPECTED_VERSION" ] || {
	echo "Empty live dataset version from $VERSION_URL" >&2
	exit 1
}

BODY="$WORK_DIR/asset-versions.json"
HEADERS="$WORK_DIR/headers.txt"
STATUS="$(
	curl \
		--silent \
		--show-error \
		--location \
		--connect-timeout 15 \
		--max-time 20 \
		--header "Origin: $MAP_ORIGIN" \
		--header 'Cache-Control: no-cache' \
		--dump-header "$HEADERS" \
		--output "$BODY" \
		--write-out '%{http_code}' \
		"$URL?verify=$VERIFY_TOKEN"
)"

if ! grep -q '[^[:space:]]' "$BODY"; then
	echo "Asset-version endpoint returned HTTP $STATUS without a JSON body." >&2
	echo "Response headers:" >&2
	cat "$HEADERS" >&2 || true
	exit 1
fi

if [ "$STATUS" != "200" ]; then
	echo "Asset-version endpoint returned HTTP $STATUS:" >&2
	cat "$BODY" >&2 || true
	echo >&2
	exit 1
fi

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

const raw = fs.readFileSync(process.argv[2], "utf8");
let manifest;
try {
	manifest = JSON.parse(raw);
} catch (error) {
	console.error("Invalid asset-version response:");
	console.error(raw.slice(0, 1000));
	throw error;
}
const prefix = process.argv[3];
const expected = process.argv[4];

if (Number(manifest?.schema) !== 1) {
	throw new Error("Asset-version manifest schema is not 1.");
}
if (manifest?.error) {
	throw new Error(
		`Asset-version endpoint reported ${manifest.error}: ${manifest.jsonError || manifest.phpErrorMessage || "no details"}`
	);
}
if (manifest?.truncated) {
	throw new Error(
		`Asset-version manifest is truncated at: ${(manifest?.truncatedPrefixes || []).join(", ") || "unknown"}`
	);
}
if (String(manifest?.prefixes?.[prefix] || "") !== expected) {
	throw new Error(
		`Expected ${prefix}=${expected}, got ${manifest?.prefixes?.[prefix] || "missing"}`
	);
}
NODE

echo "Asset-version endpoint OK: $EXPECTED_PREFIX -> $EXPECTED_VERSION"
