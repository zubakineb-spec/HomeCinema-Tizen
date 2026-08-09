#!/bin/sh
set -eu

APP=HomeCinemaD1
QPKG_CONF=/etc/config/qpkg.conf
DEFAULT_APPDIR=/share/CACHEDEV1_DATA/.qpkg/HomeCinemaD1
BASE_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
STAMP="$(date +%Y%m%d%H%M%S)"

fail(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "[HomeCinemaD1] $*"; }

APPDIR="$(/sbin/getcfg "$APP" Install_Path -f "$QPKG_CONF" 2>/dev/null || true)"
[ -n "$APPDIR" ] || APPDIR="$DEFAULT_APPDIR"
WEB="$APPDIR/www"
SRC="$BASE_DIR/www"
BACKUP="$APPDIR/webui-backup-$STAMP"
MARKER="$APPDIR/.webui-last-backup"

[ -d "$WEB" ] || fail "Installed web root not found: $WEB"
[ -f "$SRC/index.html" ] || fail "Bundle web root missing: $SRC/index.html"
[ -f "$SRC/css/web-controls.css" ] || fail "Bundle web-controls.css missing"
[ -f "$SRC/js/web-controls.js" ] || fail "Bundle web-controls.js missing"

mkdir -p "$BACKUP/css" "$BACKUP/js"
cp "$WEB/index.html" "$BACKUP/index.html"
[ -f "$WEB/css/web-controls.css" ] && cp "$WEB/css/web-controls.css" "$BACKUP/css/web-controls.css" || true
[ -f "$WEB/js/web-controls.js" ] && cp "$WEB/js/web-controls.js" "$BACKUP/js/web-controls.js" || true
printf '%s\n' "$BACKUP" > "$MARKER"

cp "$SRC/index.html" "$WEB/index.html"
mkdir -p "$WEB/css" "$WEB/js"
cp "$SRC/css/web-controls.css" "$WEB/css/web-controls.css"
cp "$SRC/js/web-controls.js" "$WEB/js/web-controls.js"
chmod 644 "$WEB/index.html" "$WEB/css/web-controls.css" "$WEB/js/web-controls.js"

# Static files are served directly; no binary replacement and no catalog/progress changes.
grep 'web-controls.css?v=0.3.9-r2' "$WEB/index.html" >/dev/null 2>&1 || fail "index.html CSS reference missing"
grep 'web-controls.js?v=0.3.9-r2' "$WEB/index.html" >/dev/null 2>&1 || fail "index.html JS reference missing"

HEALTH="$(wget -qO- http://127.0.0.1:8096/api/health 2>/dev/null || true)"
echo "$HEALTH" | grep '"status":"ok"' >/dev/null 2>&1 || fail "Home Cinema health is not ok after web UI hotfix"

info "WEB_UI_HOTFIX=PASS"
info "Backup=$BACKUP"
info "Health=$HEALTH"
info "Browser: reload http://192.168.0.101:8096/ with Ctrl+F5 once."
