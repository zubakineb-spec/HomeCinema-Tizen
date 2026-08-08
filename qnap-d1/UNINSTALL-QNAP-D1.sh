#!/bin/sh
set -eu
APP=HomeCinemaD1
QPKG_CONF=/etc/config/qpkg.conf
APPDIR="$(/sbin/getcfg "$APP" Install_Path -f "$QPKG_CONF" 2>/dev/null || true)"
if [ -n "$APPDIR" ] && [ -x "$APPDIR/homecinema.sh" ]; then "$APPDIR/homecinema.sh" stop || true; fi
if command -v /sbin/rmcfg >/dev/null 2>&1; then /sbin/rmcfg "$APP" -f "$QPKG_CONF" || true; fi
[ -n "$APPDIR" ] && rm -rf "$APPDIR"
echo "Home Cinema D1 removed. Persistent catalog/progress data was intentionally kept on the data volume."
