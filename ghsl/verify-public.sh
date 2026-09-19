#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${GHSL_PUBLIC_BASE_URL:-https://tiles.radlobby.at/GHSL}"
WORK_DIR="$(mktemp -d)"
trap 'rm -rf "$WORK_DIR"' EXIT

log() {
	printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*"
}

die() {
	log "FEHLER: $*"
	exit 1
}

require_command() {
	command -v "$1" >/dev/null 2>&1 || die "Benötigtes Programm fehlt: $1"
}

fetch_release() {
	local output="$WORK_DIR/release.json"

	log "Prüfe release.json"
	curl \
		--fail \
		--silent \
		--show-error \
		--location \
		--connect-timeout 20 \
		--max-time 60 \
		--output "$output" \
		"$BASE_URL/release.json"

	python3 - "$output" <<'PY'
import json
import pathlib
import sys

path = pathlib.Path(sys.argv[1])
data = json.loads(path.read_text(encoding="utf-8"))
files = data.get("files")
if not isinstance(files, list):
	raise SystemExit("release.json: files fehlt oder ist keine Liste")

expected = {
	"age/ghs-age-100m.tif": 694067422,
	"smod/ghs-smod-1975.tif": 12911587,
	"smod/ghs-smod-1980.tif": 13270885,
	"smod/ghs-smod-1985.tif": 13620540,
	"smod/ghs-smod-1990.tif": 13935406,
	"smod/ghs-smod-1995.tif": 14112056,
	"smod/ghs-smod-2000.tif": 14240344,
	"smod/ghs-smod-2005.tif": 14432669,
	"smod/ghs-smod-2010.tif": 14618936,
	"smod/ghs-smod-2015.tif": 14809416,
	"smod/ghs-smod-2020.tif": 15027956,
	"smod/ghs-smod-2025.tif": 15175684,
	"smod/ghs-smod-2030.tif": 15323519,
}

actual = {
	item.get("path"): item.get("bytes")
	for item in files
	if isinstance(item, dict)
}

if actual != expected:
	missing = sorted(set(expected) - set(actual))
	extra = sorted(set(actual) - set(expected))
	wrong = {
		key: (expected[key], actual.get(key))
		for key in sorted(set(expected) & set(actual))
		if actual.get(key) != expected[key]
	}
	raise SystemExit(
		f"release.json stimmt nicht mit dem validierten Produktionsbuild überein: "
		f"missing={missing}, extra={extra}, wrong={wrong}"
	)

print(f"release.json OK: {len(actual)} Dateien")
PY
}

check_range_cog() {
	local relative="$1"
	local expected_size="$2"
	local headers="$WORK_DIR/headers.txt"
	local body="$WORK_DIR/range.bin"
	local url="$BASE_URL/$relative"
	local status
	local content_range
	local cors

	rm -f "$headers" "$body"
	log "Prüfe COG Range/CORS: $relative"

	status="$(
		curl \
			--silent \
			--show-error \
			--location \
			--connect-timeout 20 \
			--max-time 60 \
			--max-filesize 64 \
			--header 'Origin: https://www.radlobby.at' \
			--header 'Range: bytes=0-15' \
			--dump-header "$headers" \
			--output "$body" \
			--write-out '%{http_code}' \
			"$url"
	)"

	[ "$status" = "206" ] || die "$relative: erwartet HTTP 206, erhalten $status"
	[ "$(wc -c < "$body")" -eq 16 ] || die "$relative: Range-Antwort hat nicht 16 Byte"

	content_range="$(
		awk 'BEGIN { IGNORECASE=1 } /^Content-Range:/ { sub(/\r$/, ""); print $0 }' "$headers" \
			| tail -n 1
	)"
	printf '%s\n' "$content_range" \
		| grep -Eiq "^Content-Range:[[:space:]]*bytes[[:space:]]+0-15/${expected_size}$" \
		|| die "$relative: ungültiges Content-Range: ${content_range:-<fehlt>}"

	cors="$(
		awk 'BEGIN { IGNORECASE=1 } /^Access-Control-Allow-Origin:/ { sub(/\r$/, ""); print $0 }' "$headers" \
			| tail -n 1
	)"
	[ -n "$cors" ] || die "$relative: Access-Control-Allow-Origin fehlt"

	python3 - "$body" <<'PY'
import pathlib
import sys

data = pathlib.Path(sys.argv[1]).read_bytes()
signatures = (
	b"II*\x00",
	b"MM\x00*",
	b"II+\x00",
	b"MM\x00+",
)
if not any(data.startswith(signature) for signature in signatures):
	raise SystemExit(f"Kein TIFF-/BigTIFF-Header: {data[:8]!r}")
print("TIFF-/BigTIFF-Magic OK")
PY

	log "$relative: HTTP 206, Content-Range und CORS OK"
}

main() {
	require_command curl
	require_command python3

	fetch_release
	check_range_cog "smod/ghs-smod-1975.tif" "12911587"
	check_range_cog "smod/ghs-smod-2020.tif" "15027956"
	check_range_cog "smod/ghs-smod-2030.tif" "15323519"
	check_range_cog "age/ghs-age-100m.tif" "694067422"

	log "Öffentliche GHSL-Dateien vollständig geprüft."
}

main "$@"
