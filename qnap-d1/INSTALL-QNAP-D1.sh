#!/bin/sh
set -eu

APP=HomeCinemaD1
VERSION=0.3.3
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
# Optional TMDB token:
# export TMDB_BEARER_TOKEN="..."
CONFEOF
fi

cat > "$APPDIR/homecinema.sh" <<'SVCEOF'
#!/bin/sh
set -u
APPDIR="$(cd "$(dirname "$0")" 2>/dev/null && pwd)"
. "$APPDIR/homecinema.conf"
PIDFILE="$HC_DATA_DIR/homecinema.pid"
LOGFILE="$HC_DATA_DIR/homecinema.log"
case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then exit 0; fi
    mkdir -p "$HC_DATA_DIR" "$HC_DATA_DIR/hls"
    cd "$APPDIR" || exit 1
    ( trap '' HUP; exec "$APPDIR/homecinema-d1" >>"$LOGFILE" 2>&1 </dev/null ) &
    echo $! > "$PIDFILE"
    ;;
  stop)
    if [ -f "$PIDFILE" ]; then
      PID="$(cat "$PIDFILE" 2>/dev/null || true)"
      [ -n "$PID" ] && kill "$PID" 2>/dev/null || true
      sleep 1
      [ -n "$PID" ] && kill -9 "$PID" 2>/dev/null || true
      rm -f "$PIDFILE"
    fi
    ;;
  restart) "$0" stop; "$0" start ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE" 2>/dev/null)" 2>/dev/null; then echo running; exit 0; fi
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
/sbin/setcfg "$APP" WebUI "/" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Web_Port "8096" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Enable "TRUE" -f "$QPKG_CONF"

"$APPDIR/homecinema.sh" start
sleep 2
if "$APPDIR/homecinema.sh" status >/dev/null 2>&1; then
  info "Installed and started: http://192.168.0.101:8096/"
  info "Media root: $MEDIA"
  info "Config: $CONF"
  info "Log: $DATADIR/homecinema.log"
else
  fail "Service did not start. Check $DATADIR/homecinema.log"
fi
