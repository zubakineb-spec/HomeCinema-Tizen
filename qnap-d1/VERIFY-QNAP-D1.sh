#!/bin/sh
set +e
printf '=== Home Cinema D1 preflight ===\n'
printf 'Model: '; /sbin/getcfg System 'Model' -f /etc/config/uLinux.conf 2>/dev/null || true
printf 'QTS: '; /sbin/getcfg System Version -f /etc/config/uLinux.conf 2>/dev/null || true
printf 'Build: '; /sbin/getcfg System 'Build Number' -f /etc/config/uLinux.conf 2>/dev/null || true
printf 'Arch: '; uname -m
printf 'Kernel: '; uname -r
printf 'CPU cores: '; grep -c '^processor' /proc/cpuinfo 2>/dev/null
printf 'Memory: '; grep MemTotal /proc/meminfo 2>/dev/null
printf 'Default volume: '; /sbin/getcfg SHARE_DEF defVolMP -f /etc/config/def_share.info 2>/dev/null || true
printf 'Multimedia share: '; /sbin/getcfg Multimedia path -f /etc/config/smb.conf 2>/dev/null || true
printf 'ffprobe: '; command -v ffprobe || echo not-found
printf 'ffmpeg: '; command -v ffmpeg || echo not-found
printf 'Port 8096: '; netstat -lnt 2>/dev/null | grep ':8096 ' || echo free-or-not-detected
printf 'Binary: '; ./homecinema-d1 --version 2>&1
