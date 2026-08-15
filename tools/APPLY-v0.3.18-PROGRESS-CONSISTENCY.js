'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'tv-app', 'js', 'app.js');

function readLF(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}
function replaceRange(text, start, end, replacement, name) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error('PATCH_RANGE_START_NOT_FOUND: ' + name);
  const b = text.indexOf(end, a + start.length);
  if (b < 0) throw new Error('PATCH_RANGE_END_NOT_FOUND: ' + name);
  return text.slice(0, a) + replacement + text.slice(b);
}
function requireMarker(text, marker) {
  if (!text.includes(marker)) throw new Error('PATCH_ASSERTION_FAILED: ' + marker);
  console.log('PASS: ' + marker);
}

let app = readLF(appPath);

const saveProgress = `function saveProgress(pos,dur,completed,player){
  var pl=player||state.player;if(!pl)return Promise.resolve(false);
  return fetch(API_BASE+'/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({source_url:pl.url,position_ms:Math.round(pos||0),duration_ms:Math.round(dur||0),completed:!!completed})})
    .then(function(r){return !!(r&&r.ok)})
    .catch(function(){return false});
}
`;
app = replaceRange(app, 'function saveProgress(pos,dur,completed,player){', 'function formatPlayerTime(ms){', saveProgress, 'saveProgress');

const stopPlayer = `function stopPlayer(completed){
  if(!state.player)return;
  if(state.seekBusy){state.pendingStop={completed:!!completed};return}
  var pl=state.player,pos=0,dur=0;clearPlayerTimer();clearSaveTimer();state.pendingStop=null;
  try{var p=webapis.avplay;pos=p.getCurrentTime();dur=p.getDuration()}catch(_){}
  if(pos<=0&&Number(pl.lastPosition||0)>0)pos=Number(pl.lastPosition);
  if(dur<=0&&Number(pl.lastDuration||0)>0)dur=Number(pl.lastDuration);
  var completedNow=!!completed||(dur>0&&pos/dur>0.95);
  closeAv();restorePlayerScreen();
  state.player=null;state.tracksOpen=false;state.playerMenuOpen=false;state.playerPanel=null;state.mode=state.current?'details':'home';
  saveProgress(pos,dur,completedNow,pl).then(function(){return loadContinue()}).then(function(){rebuildFocus($('#detailPlay')||null)});
}
`;
app = replaceRange(app, 'function stopPlayer(completed){', 'function syncToggleButton(){', stopPlayer, 'stopPlayer');

[
  "return fetch(API_BASE+'/api/progress'",
  'var completedNow=!!completed||(dur>0&&pos/dur>0.95);',
  'if(pos<=0&&Number(pl.lastPosition||0)>0)',
  'saveProgress(pos,dur,completedNow,pl).then(function(){return loadContinue()})'
].forEach(function(marker){requireMarker(app, marker)});

const tmp = appPath + '.progress-consistency.tmp.js';
fs.writeFileSync(tmp, app, 'utf8');
try {
  cp.execFileSync(process.execPath, ['--check', tmp], {stdio: 'inherit'});
} catch (e) {
  try { fs.unlinkSync(tmp); } catch (_) {}
  throw e;
}
fs.renameSync(tmp, appPath);
console.log('HOME_CINEMA_PROGRESS_CONSISTENCY_PATCH=PASS');
