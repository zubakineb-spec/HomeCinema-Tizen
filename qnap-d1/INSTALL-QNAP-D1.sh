#!/bin/sh
set -eu

APP=HomeCinemaD1
VERSION=0.3.10
QPKG_CONF=/etc/config/qpkg.conf
BASE_DIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"

fail(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "[HomeCinemaD1] $*"; }

ARCH="$(uname -m 2>/dev/null || true)"
case "$ARCH" in
  armv7l|armv7*) ;;
  *) fail "Expected ARMv7 QNAP D1, got architecture: $ARCH" ;;
esac

QTS_VER="$(/sbin/getcfg System Version -f /etc/config/uLinux.conf 2>/dev/null || true)"
QTS_BUILD="$(/sbin/getcfg System 'Build Number' -f /etc/config/uLinux.conf 2>/dev/null || true)"
info "QTS ${QTS_VER:-unknown} build ${QTS_BUILD:-unknown}; arch=$ARCH"

[ -x "$BASE_DIR/homecinema-d1" ] || chmod +x "$BASE_DIR/homecinema-d1" 2>/dev/null || true
"$BASE_DIR/homecinema-d1" --version >/dev/null 2>&1 || fail "ARMv7 binary cannot execute on this NAS"

VOL="$(/sbin/getcfg SHARE_DEF defVolMP -f /etc/config/def_share.info 2>/dev/null || true)"
if [ -z "$VOL" ] || [ ! -d "$VOL" ]; then
  PUB="$(readlink -f /share/Public 2>/dev/null || true)"
  [ -n "$PUB" ] && VOL="$(dirname "$PUB")"
fi
[ -n "$VOL" ] && [ -d "$VOL" ] || fail "Cannot determine QNAP data volume"

MEDIA="$(/sbin/getcfg Multimedia path -f /etc/config/smb.conf 2>/dev/null || true)"
if [ -z "$MEDIA" ] || [ ! -d "$MEDIA" ]; then
  [ -d /share/Multimedia ] && MEDIA=/share/Multimedia
fi
if [ -z "$MEDIA" ] || [ ! -d "$MEDIA" ]; then
  MEDIA="$VOL/Multimedia"
  mkdir -p "$MEDIA"
fi

APPDIR="$VOL/.qpkg/$APP"
DATADIR="$VOL/.homecinema-d1"
mkdir -p "$APPDIR" "$APPDIR/www" "$DATADIR" "$DATADIR/hls"

if [ -x "$APPDIR/homecinema.sh" ]; then "$APPDIR/homecinema.sh" stop >/dev/null 2>&1 || true; fi
cp "$BASE_DIR/homecinema-d1" "$APPDIR/homecinema-d1"
chmod 755 "$APPDIR/homecinema-d1"
rm -rf "$APPDIR/www"
cp -R "$BASE_DIR/www" "$APPDIR/www"

CONF="$APPDIR/homecinema.conf"
if [ ! -f "$CONF" ]; then
cat > "$CONF" <<CONFEOF
export HC_LISTEN=":8096"
export HC_MEDIA_ROOT="$MEDIA"
export HC_MEDIA_BASE_URL="http://192.168.0.101:8096/media/"
export HC_DATA_DIR="$DATADIR"
export HC_WEB_ROOT="$APPDIR/www"
export HC_ENABLE_DTS_FALLBACK="false"
export HC_AUTO_LIBRARY="true"
export HC_AUTO_LIBRARY_INTERVAL_SECONDS="120"
export HC_DLNA_ENABLED="true"
export HC_DLNA_NAME="HOME CINEMA"
export HC_DLNA_ADVERTISE_IP="192.168.0.101"
export HC_DLNA_UUID="6a0a34d4-27dd-4e02-9e07-7ef386393010"
# Optional TMDB token:
# export TMDB_BEARER_TOKEN="..."
CONFEOF
else
  grep -q '^export HC_AUTO_LIBRARY=' "$CONF" || echo 'export HC_AUTO_LIBRARY="true"' >> "$CONF"
  grep -q '^export HC_AUTO_LIBRARY_INTERVAL_SECONDS=' "$CONF" || echo 'export HC_AUTO_LIBRARY_INTERVAL_SECONDS="120"' >> "$CONF"
  grep -q '^export HC_DLNA_ENABLED=' "$CONF" || echo 'export HC_DLNA_ENABLED="true"' >> "$CONF"
  grep -q '^export HC_DLNA_NAME=' "$CONF" || echo 'export HC_DLNA_NAME="HOME CINEMA"' >> "$CONF"
  grep -q '^export HC_DLNA_ADVERTISE_IP=' "$CONF" || echo 'export HC_DLNA_ADVERTISE_IP="192.168.0.101"' >> "$CONF"
  grep -q '^export HC_DLNA_UUID=' "$CONF" || echo 'export HC_DLNA_UUID="6a0a34d4-27dd-4e02-9e07-7ef386393010"' >> "$CONF"
fi

cat > "$APPDIR/homecinema.sh" <<'SVCEOF'
#!/bin/sh
set -u
APPDIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
. "$APPDIR/homecinema.conf"
PIDFILE="$HC_DATA_DIR/homecinema.pid"
LOGFILE="$HC_DATA_DIR/homecinema.log"

running(){
  [ -f "$PIDFILE" ] || return 1
  PID="$(cat "$PIDFILE" 2>/dev/null || true)"
  [ -n "$PID" ] || return 1
  kill -0 "$PID" 2>/dev/null
}

start_service(){
  if running; then return 0; fi
  rm -f "$PIDFILE"
  mkdir -p "$HC_DATA_DIR" "$HC_DATA_DIR/hls"
  N=0
  while [ ! -d "$HC_MEDIA_ROOT" ] && [ "$N" -lt 30 ]; do
    sleep 2
    N=$((N + 1))
  done
  cd "$APPDIR" || return 1
  echo "$(date '+%Y-%m-%d %H:%M:%S') qts-start requested" >> "$LOGFILE"
  ( trap '' HUP; exec "$APPDIR/homecinema-d1" >>"$LOGFILE" 2>&1 </dev/null ) &
  echo $! > "$PIDFILE"
  sleep 2
  if running; then return 0; fi
  rm -f "$PIDFILE"
  echo "$(date '+%Y-%m-%d %H:%M:%S') qts-start failed" >> "$LOGFILE"
  return 1
}

stop_service(){
  if [ -f "$PIDFILE" ]; then
    PID="$(cat "$PIDFILE" 2>/dev/null || true)"
    if [ -n "$PID" ]; then
      kill "$PID" 2>/dev/null || true
      sleep 1
      kill -9 "$PID" 2>/dev/null || true
    fi
    rm -f "$PIDFILE"
  fi
}

case "${1:-start}" in
  start) start_service ;;
  stop) stop_service ;;
  restart) stop_service; start_service ;;
  status)
    if running; then echo running; exit 0; fi
    echo stopped; exit 1
    ;;
  *) echo "Usage: $0 {start|stop|restart|status}" >&2; exit 2 ;;
esac
SVCEOF
chmod 755 "$APPDIR/homecinema.sh"

if [ -f "$QPKG_CONF" ]; then cp "$QPKG_CONF" "$QPKG_CONF.homecinema.$(date +%Y%m%d%H%M%S).bak"; fi
/sbin/setcfg "$APP" Name "$APP" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Display_Name "Home Cinema D1" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Version "$VERSION" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Author "HomeCinema-Tizen" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Shell "$APPDIR/homecinema.sh" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Install_Path "$APPDIR" -f "$QPKG_CONF"
/sbin/setcfg "$APP" RC_Number "199" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Status "complete" -f "$QPKG_CONF"
/sbin/setcfg "$APP" WebUI "/" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Web_Port "8096" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Enable "TRUE" -f "$QPKG_CONF"

"$APPDIR/homecinema.sh" start
sleep 2
if "$APPDIR/homecinema.sh" status >/dev/null 2>&1; then
  HEALTH="$(wget -qO- http://127.0.0.1:8096/api/health 2>/dev/null || true)"
  echo "$HEALTH" | grep '"status":"ok"' >/dev/null 2>&1 || fail "Service started but /api/health is not ok"
  echo "$HEALTH" | grep '"dlna_enabled":true' >/dev/null 2>&1 || fail "DLNA is not enabled"
  info "Installed and started: http://192.168.0.101:8096/"
  info "DLNA source: HOME CINEMA"
  info "DLNA device: http://192.168.0.101:8096/dlna/device.xml"
  info "Media root preserved/configured in: $CONF"
  info "Log: $DATADIR/homecinema.log"
else
  fail "Service did not start. Check $DATADIR/homecinema.log"
fi
