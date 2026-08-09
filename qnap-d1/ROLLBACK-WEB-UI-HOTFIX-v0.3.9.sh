#!/bin/sh
set -eu

APP=HomeCinemaD1
QPKG_CONF=/etc/config/qpkg.conf
DEFAULT_APPDIR=/share/CACHEDEV1_DATA/.qpkg/HomeCinemaD1

fail(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "[HomeCinemaD1] $*"; }

APPDIR="$(/sbin/getcfg "$APP" Install_Path -f "$QPKG_CONF" 2>/dev/null || true)"
[ -n "$APPDIR" ] || APPDIR="$DEFAULT_APPDIR"
WEB="$APPDIR/www"
MARKER="$APPDIR/.webui-last-backup"

[ -f "$MARKER" ] || fail "No web UI backup marker found"
BACKUP="$(cat "$MARKER" 2>/dev/null || true)"
[ -n "$BACKUP" ] && [ -f "$BACKUP/index.html" ] || fail "Backup is not usable: $BACKUP"

cp "$BACKUP/index.html" "$WEB/index.html"
if [ -f "$BACKUP/css/web-controls.css" ]; then
  cp "$BACKUP/css/web-controls.css" "$WEB/css/web-controls.css"
else
  rm -f "$WEB/css/web-controls.css"
fi
if [ -f "$BACKUP/js/web-controls.js" ]; then
  cp "$BACKUP/js/web-controls.js" "$WEB/js/web-controls.js"
else
  rm -f "$WEB/js/web-controls.js"
fi
rm -f "$MARKER"

HEALTH="$(wget -qO- http://127.0.0.1:8096/api/health 2>/dev/null || true)"
echo "$HEALTH" | grep '"status":"ok"' >/dev/null 2>&1 || fail "Home Cinema health is not ok after rollback"

info "WEB_UI_ROLLBACK=PASS"
info "Restored=$BACKUP"
info "Browser: reload with Ctrl+F5 once."
