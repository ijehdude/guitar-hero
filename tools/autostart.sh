#!/usr/bin/env bash
# Install / uninstall a macOS LaunchAgent that runs the FRETSTORM library host at
# login (and restarts it if it stops), so you never have to run `npm run host`.
#
#   npm run host:install      # start now + every login
#   npm run host:uninstall    # remove it
#
# Set a permanent URL first for pair-once-forever, e.g.:
#   PUBLIC_URL=https://your-machine.tailXXXX.ts.net npm run host:install
# (or put "publicUrl" in private_audio/.host.json)
set -euo pipefail

LABEL="com.fretstorm.host"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/fretstorm-host.log"
REPO="$(cd "$(dirname "$0")/.." && pwd)"
NODE="$(command -v node || true)"

case "${1:-}" in
  install)
    [ -n "$NODE" ] || { echo "node not found on PATH"; exit 1; }
    mkdir -p "$HOME/Library/LaunchAgents" "$HOME/Library/Logs"
    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${NODE}</string>
    <string>${REPO}/tools/library-host.mjs</string>
  </array>
  <key>WorkingDirectory</key><string>${REPO}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PUBLIC_URL</key><string>${PUBLIC_URL:-}</string>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${LOG}</string>
  <key>StandardErrorPath</key><string>${LOG}</string>
</dict>
</plist>
PLISTEOF
    launchctl unload "$PLIST" 2>/dev/null || true
    launchctl load "$PLIST"
    echo "✓ Installed $LABEL"
    echo "  host:   ${REPO}/tools/library-host.mjs"
    echo "  logs:   $LOG"
    if [ -n "${PUBLIC_URL:-}" ]; then echo "  PUBLIC_URL=${PUBLIC_URL} (permanent pairing link)";
    else echo "  (no PUBLIC_URL — set one for a permanent link; see README)"; fi
    echo "  pairing link/QR is in the log above ↑  (tail -f \"$LOG\")"
    ;;
  uninstall)
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ Removed $LABEL (the host will no longer auto-start)"
    ;;
  *)
    echo "usage: bash tools/autostart.sh [install|uninstall]"; exit 1 ;;
esac
