#!/usr/bin/env bash
set -euo pipefail

if [ "$#" -ne 2 ]; then
	echo "Usage: $0 <local-file> <remote-file>" >&2
	exit 1
fi

: "${MAIN_FTP_HOST:?MAIN_FTP_HOST is required}"
: "${MAIN_FTP_USER:?MAIN_FTP_USER is required}"
: "${MAIN_FTP_PASSWORD:?MAIN_FTP_PASSWORD is required}"

LOCAL_FILE="$1"
REMOTE_FILE="$2"
REMOTE_FILE="${REMOTE_FILE#/}"

if [ ! -f "$LOCAL_FILE" ]; then
	echo "Local path is not a regular file: $LOCAL_FILE" >&2
	exit 1
fi

if [ -z "$REMOTE_FILE" ] || [ "$REMOTE_FILE" = "." ] || [ "$REMOTE_FILE" = ".." ]; then
	echo "Invalid remote file path: $REMOTE_FILE" >&2
	exit 1
fi

curl \
	--fail \
	--silent \
	--show-error \
	--ftp-ssl-reqd \
	--ftp-pasv \
	--ftp-create-dirs \
	--connect-timeout 30 \
	--retry 5 \
	--retry-delay 10 \
	--retry-max-time 300 \
	--retry-all-errors \
	--insecure \
	--user "${MAIN_FTP_USER}:${MAIN_FTP_PASSWORD}" \
	--upload-file "$LOCAL_FILE" \
	"ftp://${MAIN_FTP_HOST}/${REMOTE_FILE}"
