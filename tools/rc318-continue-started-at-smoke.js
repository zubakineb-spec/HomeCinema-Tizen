'use strict';

const fs=require('fs');

const layer=fs.readFileSync('tv-app/js/rc318-continue-started-at.js','utf8');
const index=fs.readFileSync('tv-app/index.html','utf8');
const models=fs.readFileSync('native-qnap-d1/internal/app/models.go','utf8');
const ux=fs.readFileSync('native-qnap-d1/internal/app/ux_api.go','utf8');

function need(ok,msg){if(!ok){console.error('FAIL: '+msg);process.exit(1)}console.log('PASS: '+msg)}

need(index.indexOf('js/rc318-continue-started-at.js')>=0,'RC3.18 layer is loaded');
need(index.indexOf('js/rc318-continue-started-at.js')<index.indexOf('js/app.js'),'RC3.18 stamps progress before app playback saves');
need(layer.indexOf("path.indexOf('/api/progress?')===0")>=0,'playback start is captured from resume lookup');
need(layer.indexOf('startedAtBySource[source]=Date.now()')>=0,'each playback source gets a start timestamp');
need(layer.indexOf('body.started_at_ms=startedAtBySource[source]')>=0,'normal progress POST carries playback-start identity');
need(layer.indexOf('position_ms:0')<0,'RC3.18 never sends a zero-position start POST');
need(models.indexOf('StartedAtMS int64')>=0&&models.indexOf('started_at_ms,omitempty')>=0,'backend persists started_at_ms');
need(ux.indexOf('chooseShowContinueCandidate')>=0,'Continue has an explicit per-show candidate selector');
need(ux.indexOf('value := itemInt64(item, "started_at_ms")')>=0,'Continue prefers actual playback start time');
need(ux.indexOf('season > legacySeason')>=0,'legacy progress falls back to highest progressed episode');

console.log('HOME_CINEMA_RC318_CONTINUE_STARTED_AT_SMOKE=PASS');
