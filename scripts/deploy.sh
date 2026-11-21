#!/usr/bin/env bash
# Baut die Webseite und veröffentlicht sie im Branch `deploy` (Webroot für Plesk/netcup).
# Danach in Plesk unter Git „Jetzt abrufen“ klicken (oder Webhook).
set -euo pipefail
cd "$(dirname "$0")/.."
[ -z "$(git status --porcelain)" ] || { echo "Bitte zuerst alle Änderungen committen."; exit 1; }
SRC=$(git rev-parse --short HEAD)
npm run build
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT
git clone -q --branch deploy --single-branch "$(git remote get-url origin)" "$TMP"
find "$TMP" -mindepth 1 -maxdepth 1 ! -name .git -exec rm -rf {} +
cp -r dist/. "$TMP"/
cp deploy/.htaccess deploy/DEPLOY.md "$TMP"/
cp node_modules/stockfish/Copying.txt "$TMP"/engine/COPYING-stockfish.txt
cd "$TMP"
git add -A
if git diff --cached --quiet; then echo "Keine Änderungen am Build."; exit 0; fi
git -c user.name="$(git -C "$OLDPWD" config user.name)" -c user.email="$(git -C "$OLDPWD" config user.email)" \
  commit -q -m "Build von main@$SRC für das Webroot"
git push -q origin deploy
echo "Veröffentlicht: Branch deploy (Build von main@$SRC). In Plesk „Jetzt abrufen“ klicken."
