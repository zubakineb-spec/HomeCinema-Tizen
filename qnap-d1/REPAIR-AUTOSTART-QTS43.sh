#!/bin/sh
set -eu

APP=HomeCinemaD1
QPKG_CONF=/etc/config/qpkg.conf
DEFAULT_APPDIR=/share/CACHEDEV1_DATA/.qpkg/HomeCinemaD1
STAMP="$(date +%Y%m%d%H%M%S)"

fail(){ echo "ERROR: $*" >&2; exit 1; }
info(){ echo "[HomeCinemaD1] $*"; }

[ -f "$QPKG_CONF" ] || fail "Missing $QPKG_CONF"

APPDIR="$(/sbin/getcfg "$APP" Install_Path -f "$QPKG_CONF" 2>/dev/null || true)"
[ -n "$APPDIR" ] || APPDIR="$DEFAULT_APPDIR"
SVC="$APPDIR/homecinema.sh"
CONF="$APPDIR/homecinema.conf"
BIN="$APPDIR/homecinema-d1"

[ -d "$APPDIR" ] || fail "HomeCinemaD1 install directory not found: $APPDIR"
[ -f "$CONF" ] || fail "Config not found: $CONF"
[ -x "$BIN" ] || fail "Binary not executable: $BIN"

cp "$QPKG_CONF" "$QPKG_CONF.homecinema-autostart.$STAMP.bak"
if [ -f "$SVC" ]; then cp "$SVC" "$SVC.pre-autostart-$STAMP.bak"; fi

cat > "$SVC" <<'SVCEOF'
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
  if running; then
    return 0
  fi

  # A reboot or hard stop may leave a stale PID file behind.
  rm -f "$PIDFILE"
  mkdir -p "$HC_DATA_DIR" "$HC_DATA_DIR/hls"

  # QTS can invoke QPKG startup while storage services are still settling.
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

  if running; then
    return 0
  fi

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
chmod 755 "$SVC"

# QTS/QPKG startup ordering uses RC_Number. The previous hand-written
# registration omitted it, so the entry was not reliable across NAS reboot.
/sbin/setcfg "$APP" Name "$APP" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Display_Name "Home Cinema D1" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Shell "$SVC" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Install_Path "$APPDIR" -f "$QPKG_CONF"
/sbin/setcfg "$APP" RC_Number "199" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Status "complete" -f "$QPKG_CONF"
/sbin/setcfg "$APP" Enable "TRUE" -f "$QPKG_CONF"

rm -f "$(/sbin/getcfg "$APP" Install_Path -f "$QPKG_CONF")/../.homecinema-dummy" 2>/dev/null || true
"$SVC" restart
sleep 3

"$SVC" status >/dev/null 2>&1 || fail "Service did not start after autostart repair"

HEALTH="$(wget -qO- http://127.0.0.1:8096/api/health 2>/dev/null || true)"
echo "$HEALTH" | grep '"status":"ok"' >/dev/null 2>&1 || fail "Local /api/health did not return status=ok"

info "AUTOSTART_REPAIR=PASS"
info "RC_Number=$(/sbin/getcfg "$APP" RC_Number -f "$QPKG_CONF")"
info "Enable=$(/sbin/getcfg "$APP" Enable -f "$QPKG_CONF")"
info "Shell=$(/sbin/getcfg "$APP" Shell -f "$QPKG_CONF")"
info "Health=$HEALTH"
info "Reboot acceptance: reboot NAS, then verify service status and local health."
