#!/usr/bin/env bash
# Generates a local certificate authority + a server certificate for every name/IP of this machine.
# Browsers only give microphone access to HTTPS pages (or localhost), hence this step.
# Everything stays in app/certs/. No sudo: each device that opens the app imports rootCA once.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
export CAROOT="$APP/certs"
mkdir -p "$CAROOT"
MKCERT="$APP/vendor/mkcert"
if [ ! -x "$MKCERT" ]; then
  echo "Téléchargement de mkcert…"
  curl -fsSL -o "$MKCERT" "https://dl.filippo.io/mkcert/latest?for=linux/amd64"
  chmod +x "$MKCERT"
fi
# Every non-loopback IPv4 of the host + its names. Re-run this script if the IP changes.
mapfile -t IPS < <(hostname -I | tr ' ' '\n' | grep -E '^[0-9]+\.' || true)
NAMES=(localhost 127.0.0.1 "$(hostname)" "$(hostname).local" "${IPS[@]}")
echo "Certificat pour : ${NAMES[*]}"
"$MKCERT" -cert-file "$CAROOT/server.pem" -key-file "$CAROOT/server-key.pem" "${NAMES[@]}"
chmod 600 "$CAROOT/server-key.pem" "$CAROOT/rootCA-key.pem"
echo
echo "OK. Autorité locale à importer sur chaque appareil : $CAROOT/rootCA.pem"
echo "(téléchargeable depuis l'app : https://<ip>:8443/ca.crt)"
