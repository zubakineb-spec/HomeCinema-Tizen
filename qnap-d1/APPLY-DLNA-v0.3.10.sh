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
BIN="$APPDIR/homecinema-d1"
SVC="$APPDIR/homecinema.sh"
CONF="$APPDIR/homecinema.conf"
NEWBIN="$BASE_DIR/homecinema-d1"
BACKUP="$APPDIR/dlna-update-backup-$STAMP"

[ -d "$APPDIR" ] || fail "Home Cinema install directory not found: $APPDIR"
[ -x "$SVC" ] || fail "Service script not found: $SVC"
[ -f "$CONF" ] || fail "Config not found: $CONF"
[ -f "$NEWBIN" ] || fail "Bundle binary not found: $NEWBIN"
chmod 755 "$NEWBIN" 2>/dev/null || true

NEWVER="$($NEWBIN --version 2>/dev/null || true)"
echo "$NEWVER" | grep '0.3.10' >/dev/null 2>&1 || fail "Expected v0.3.10 binary, got: $NEWVER"

mkdir -p "$BACKUP"
cp "$BIN" "$BACKUP/homecinema-d1"
cp "$CONF" "$BACKUP/homecinema.conf"

# Preserve all existing media/TMDb/catalog/progress settings; add only DLNA options.
grep -q '^export HC_DLNA_ENABLED=' "$CONF" || echo 'export HC_DLNA_ENABLED="true"' >> "$CONF"
grep -q '^export HC_DLNA_NAME=' "$CONF" || echo 'export HC_DLNA_NAME="HOME CINEMA"' >> "$CONF"
grep -q '^export HC_DLNA_ADVERTISE_IP=' "$CONF" || echo 'export HC_DLNA_ADVERTISE_IP="192.168.0.101"' >> "$CONF"
grep -q '^export HC_DLNA_UUID=' "$CONF" || echo 'export HC_DLNA_UUID="6a0a34d4-27dd-4e02-9e07-7ef386393010"' >> "$CONF"

"$SVC" stop >/dev/null 2>&1 || true
cp "$NEWBIN" "$BIN"
chmod 755 "$BIN"
"$SVC" start
sleep 3

"$SVC" status >/dev/null 2>&1 || fail "Home Cinema did not restart"
HEALTH="$(wget -qO- http://127.0.0.1:8096/api/health 2>/dev/null || true)"
echo "$HEALTH" | grep '"status":"ok"' >/dev/null 2>&1 || fail "Health is not ok"
echo "$HEALTH" | grep '"version":"0.3.10"' >/dev/null 2>&1 || fail "Runtime is not v0.3.10"
echo "$HEALTH" | grep '"dlna_enabled":true' >/dev/null 2>&1 || fail "DLNA is not enabled"

DEVICE="$(wget -qO- http://127.0.0.1:8096/dlna/device.xml 2>/dev/null || true)"
echo "$DEVICE" | grep '<friendlyName>HOME CINEMA</friendlyName>' >/dev/null 2>&1 || fail "DLNA device description is not HOME CINEMA"

STATUS="$(wget -qO- http://127.0.0.1:8096/api/dlna/status 2>/dev/null || true)"

info "HOME_CINEMA_DLNA_UPDATE=PASS"
info "Version=0.3.10"
info "Source=HOME CINEMA"
info "Backup=$BACKUP"
info "Health=$HEALTH"
info "DLNAStatus=$STATUS"
info "On Samsung: Sources -> HOME CINEMA"
