'use strict';

const fs = require('fs');
const path = require('path');
const cp = require('child_process');

const repo = path.resolve(__dirname, '..');
const appPath = path.join(repo, 'tv-app', 'js', 'app.js');
const shimPath = path.join(repo, 'tv-app', 'js', 'browser-avplay-shim.js');

function readLF(file) {
  return fs.readFileSync(file, 'utf8').replace(/\r\n?/g, '\n');
}
function replaceOnce(text, oldText, newText, name) {
  const first = text.indexOf(oldText);
  if (first < 0) throw new Error('PATCH_ANCHOR_NOT_FOUND: ' + name);
  if (text.indexOf(oldText, first + oldText.length) >= 0) throw new Error('PATCH_ANCHOR_NOT_UNIQUE: ' + name);
  return text.slice(0, first) + newText + text.slice(first + oldText.length);
}
function replaceRange(text, start, end, replacement, name) {
  const a = text.indexOf(start);
  if (a < 0) throw new Error('PATCH_RANGE_START_NOT_FOUND: ' + name);
  const b = text.indexOf(end, a + start.length);
  if (b < 0) throw new Error('PATCH_RANGE_END_NOT_FOUND: ' + name);
  return text.slice(0, a) + replacement + text.slice(b);
}
function assertContains(text, needle) {
  if (!text.includes(needle)) throw new Error('PATCH_ASSERTION_FAILED: ' + needle);
  console.log('PASS: ' + needle);
}

let app = readLF(appPath);
let shim = readLF(shimPath);

const oldStartup = "      setTimeout(function(){selectCompatibleAudio();restoreProgress(url,p,token);refreshPlayerTrackSummary();showPlayerMenu('#playerToggleButton');},420);";
const newStartup = `      setTimeout(function(){
        selectCompatibleAudio();
        restoreProgress(url,p,token,function(){
          if(!state.player||state.player.token!==token)return;
          refreshPlayerTrackSummary();
          showPlayerMenu('#playerToggleButton');
        });
      },420);`;
if (!app.includes("restoreProgress(url,p,token,function(){")) {
  app = replaceOnce(app, oldStartup, newStartup, 'startup restore sequencing');
}

const newRestore = `function restoreProgress(url,p,token,onDone){
  var finished=false;
  state.seekBusy=true;
  function finish(error){
    if(finished)return;
    finished=true;state.seekBusy=false;
    if(error)console.warn('Restore progress seek failed',error);
    var pending=state.pendingStop;state.pendingStop=null;
    if(pending){stopPlayer(pending.completed);return}
    if(onDone)try{onDone()}catch(_){}
  }
  api('/api/progress?source_url='+encodeURIComponent(url)).then(function(x){
    if(!state.player||state.player.token!==token){finish();return}
    if(x.position_ms>15000&&x.completed!==1){
      try{p.seekTo(x.position_ms,function(){finish()},function(e){finish(e)});return}
      catch(e){finish(e);return}
    }
    finish();
  }).catch(function(e){finish(e)});
}
`;
app = replaceRange(app, 'function restoreProgress(', 'function saveProgress(', newRestore, 'restoreProgress');

shim = shim.replace(
  '  seekTo:function(ms){ensureVideo().currentTime=Math.max(0,Number(ms||0)/1000)},',
  '  seekTo:function(ms,onSuccess,onError){try{ensureVideo().currentTime=Math.max(0,Number(ms||0)/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},'
);

const combined = app + '\n' + shim;
[
  'restoreProgress(url,p,token,function(){',
  'function restoreProgress(url,p,token,onDone){',
  'state.seekBusy=true;',
  'p.seekTo(x.position_ms,function(){finish()},function(e){finish(e)})',
  'var pending=state.pendingStop;state.pendingStop=null;',
  'seekTo:function(ms,onSuccess,onError)'
].forEach(x => assertContains(combined, x));

const tmpApp = appPath + '.restore.tmp.js';
const tmpShim = shimPath + '.restore.tmp.js';
fs.writeFileSync(tmpApp, app, 'utf8');
fs.writeFileSync(tmpShim, shim, 'utf8');
try {
  cp.execFileSync(process.execPath, ['--check', tmpApp], {stdio: 'inherit'});
  cp.execFileSync(process.execPath, ['--check', tmpShim], {stdio: 'inherit'});
} catch (e) {
  try { fs.unlinkSync(tmpApp); } catch (_) {}
  try { fs.unlinkSync(tmpShim); } catch (_) {}
  throw e;
}
fs.renameSync(tmpApp, appPath);
fs.renameSync(tmpShim, shimPath);
console.log('ASYNC_RESTORE_SEEK_FIX=PASS');
