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
function assertContains(text, needle, name) {
  if (!text.includes(needle)) throw new Error('PATCH_ASSERTION_FAILED: ' + name);
  console.log('PASS: ' + name);
}

let app = readLF(appPath);
let shim = readLF(shimPath);

// Work from the exact v0.3.18 baseline. If an intended change is already present,
// leave it in place so the patcher is safe to re-run.
if (!app.includes('  seekBusy:false,')) {
  app = replaceOnce(
    app,
    '  saveTimer:null,\n',
    '  saveTimer:null,\n  seekBusy:false,\n  pendingStop:null,\n',
    'state fields'
  );
}

if (!app.includes('function clearSaveTimer()')) {
  app = replaceOnce(
    app,
    'function clearPlayerTimer(){if(state.playerTimer){clearTimeout(state.playerTimer);state.playerTimer=null}}\n',
    'function clearPlayerTimer(){if(state.playerTimer){clearTimeout(state.playerTimer);state.playerTimer=null}}\n' +
      'function clearSaveTimer(){if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=null}}\n',
    'clearSaveTimer'
  );
}

app = app.replace(
  '  clearPlayerTimer();closeAv();restorePlayerScreen();',
  '  clearPlayerTimer();clearSaveTimer();state.seekBusy=false;state.pendingStop=null;closeAv();restorePlayerScreen();'
);

if (!app.includes('clearSaveTimer();state.seekBusy=false;state.pendingStop=null;\n  state.playerToken++;')) {
  app = replaceOnce(
    app,
    "  if(state.player){toast('Видео уже запускается');return}\n",
    "  if(state.player){toast('Видео уже запускается');return}\n  clearSaveTimer();state.seekBusy=false;state.pendingStop=null;\n",
    'startPlayback cleanup'
  );
}

app = app.replace(
  "  state.player={token:token,url:url,title:title||'Видео',phase:'boot',subtitleOff:true};",
  "  state.player={token:token,url:url,title:title||'Видео',phase:'boot',subtitleOff:true,lastPosition:0,lastDuration:0};"
);

const updateProgress = `function updateProgress(pos,dur){
  var pct=dur?Math.max(0,Math.min(100,pos/dur*100)):0;
  $('#playerProgress').style.width=pct+'%';
  $('#playerCurrentTime').textContent=formatPlayerTime(pos);
  $('#playerDurationTime').textContent=formatPlayerTime(dur);
  if(state.player){state.player.lastPosition=Number(pos||0);state.player.lastDuration=Number(dur||0)}
  if(!state.saveTimer&&state.player){
    var token=state.player.token;
    state.saveTimer=setTimeout(function(){
      state.saveTimer=null;
      var pl=state.player;
      if(!pl||pl.token!==token)return;
      var p=Number(pl.lastPosition||0),d=Number(pl.lastDuration||0);
      saveProgress(p,d,d>0&&(p/d)>0.95,pl);
    },5000);
  }
}
`;
app = replaceRange(app, 'function updateProgress(pos,dur){', 'function stopPlayer(completed){', updateProgress, 'updateProgress');

const stopPlayer = `function stopPlayer(completed){
  if(!state.player)return;
  if(state.seekBusy){state.pendingStop={completed:!!completed};return}
  var pl=state.player,pos=0,dur=0;clearPlayerTimer();clearSaveTimer();state.pendingStop=null;
  try{var p=webapis.avplay;pos=p.getCurrentTime();dur=p.getDuration()}catch(_){}
  closeAv();saveProgress(pos,dur,completed,pl);restorePlayerScreen();
  state.player=null;state.tracksOpen=false;state.playerMenuOpen=false;state.playerPanel=null;state.mode=state.current?'details':'home';
  loadContinue().then(function(){rebuildFocus($('#detailPlay')||null)});
}
`;
app = replaceRange(app, 'function stopPlayer(completed){', 'function syncToggleButton(){', stopPlayer, 'stopPlayer');

app = app.replace(
  "function playerToggle(){\n  if(!state.player||state.player.phase!=='playing')return;",
  "function playerToggle(){\n  if(!state.player||state.player.phase!=='playing'||state.seekBusy)return;"
);

const seek = `function seek(delta,onDone){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy)return;
  state.seekBusy=true;
  var finished=false;
  function finish(ok,error){
    if(finished)return;
    finished=true;state.seekBusy=false;
    if(error)console.warn('AVPlay seek failed',error);
    var pending=state.pendingStop;state.pendingStop=null;
    if(pending){stopPlayer(pending.completed);return}
    if(onDone)try{onDone(ok)}catch(_){}
  }
  try{
    var success=function(){finish(true,null)};
    var failure=function(e){finish(false,e)};
    if(delta>0)webapis.avplay.jumpForward(delta,success,failure);
    else webapis.avplay.jumpBackward(Math.abs(delta),success,failure);
  }catch(e){finish(false,e)}
}
`;
app = replaceRange(app, 'function seek(delta', 'function parseExtra(v){', seek, 'seek');

app = app.replace(
  "function openPlayerPanel(kind){\n  if(!state.player||state.player.phase!=='playing')return;",
  "function openPlayerPanel(kind){\n  if(!state.player||state.player.phase!=='playing'||state.seekBusy)return;"
);
app = app.replace(
  "function selectPlayerTrack(type,index,button){\n  if(!state.player||state.player.phase!=='playing'||!avAvailable())return;",
  "function selectPlayerTrack(type,index,button){\n  if(!state.player||state.player.phase!=='playing'||state.seekBusy||!avAvailable())return;"
);

const clickSeekOld = "if(action==='toggle')playerToggle();else if(action==='rewind'){seek(-10000);showPlayerMenu('[data-player-action=\\\"rewind\\\"]')}else if(action==='forward'){seek(10000);showPlayerMenu('[data-player-action=\\\"forward\\\"]')}";
const clickSeekNew = "if(action==='toggle')playerToggle();else if(action==='rewind'){seek(-10000,function(){showPlayerMenu('[data-player-action=\\\"rewind\\\"]')})}else if(action==='forward'){seek(10000,function(){showPlayerMenu('[data-player-action=\\\"forward\\\"]')})}";
if (app.includes(clickSeekOld)) app = replaceOnce(app, clickSeekOld, clickSeekNew, 'click seek callbacks');

const registerKeys = `function registerKeys(){
  try{
    if(typeof tizen==='undefined'||!tizen.tvinputdevice)return;
    var manager=tizen.tvinputdevice;
    var wanted=['MediaPlayPause','MediaPlay','MediaPause','MediaFastForward','MediaRewind','MediaStop'];
    var supported=null;
    try{
      supported={};
      (manager.getSupportedKeys()||[]).forEach(function(k){if(k&&k.name)supported[k.name]=true});
    }catch(_){supported=null}
    var keys=supported?wanted.filter(function(k){return !!supported[k]}):wanted.slice();
    function registerIndividually(){keys.forEach(function(k){try{manager.registerKey(k)}catch(e){console.warn('Key registration failed',k,e)}})}
    if(!keys.length)return;
    if(manager.registerKeyBatch){
      try{manager.registerKeyBatch(keys,function(){},function(e){console.warn('Batch key registration failed',e);registerIndividually()})}
      catch(e){console.warn('Batch key registration exception',e);registerIndividually()}
    }else registerIndividually();
  }catch(e){console.warn(e)}
}
`;
app = replaceRange(app, 'function registerKeys(){', 'function key(e){', registerKeys, 'registerKeys');

const remoteRewindOld = "if(code===37||code===412){consume(e);seek(-10000);showPlayerMenu('[data-player-action=\\\"rewind\\\"]');return false}";
const remoteRewindNew = "if(code===37||code===412){consume(e);seek(-10000,function(){showPlayerMenu('[data-player-action=\\\"rewind\\\"]')});return false}";
if (app.includes(remoteRewindOld)) app = replaceOnce(app, remoteRewindOld, remoteRewindNew, 'remote rewind callback');

const remoteForwardOld = "if(code===39||code===417){consume(e);seek(10000);showPlayerMenu('[data-player-action=\\\"forward\\\"]');return false}";
const remoteForwardNew = "if(code===39||code===417){consume(e);seek(10000,function(){showPlayerMenu('[data-player-action=\\\"forward\\\"]')});return false}";
if (app.includes(remoteForwardOld)) app = replaceOnce(app, remoteForwardOld, remoteForwardNew, 'remote forward callback');

if (!shim.includes("if(typeof window.tizen!=='undefined')return;")) {
  shim = replaceOnce(
    shim,
    'if(window.webapis&&window.webapis.avplay)return;\n',
    "if(window.webapis&&window.webapis.avplay)return;\nif(typeof window.tizen!=='undefined')return;\n",
    'native Tizen shim guard'
  );
}

shim = shim.replace(
  '  jumpForward:function(ms){var v=ensureVideo();v.currentTime=Math.min(isFinite(v.duration)?v.duration:Infinity,v.currentTime+Math.max(0,Number(ms||0))/1000)},',
  '  jumpForward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.min(isFinite(v.duration)?v.duration:Infinity,v.currentTime+Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},'
);
shim = shim.replace(
  '  jumpBackward:function(ms){var v=ensureVideo();v.currentTime=Math.max(0,v.currentTime-Math.max(0,Number(ms||0))/1000)},',
  '  jumpBackward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.max(0,v.currentTime-Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},'
);

const combined = app + '\n' + shim;
[
  'function clearSaveTimer()',
  'state.seekBusy=true',
  'state.pendingStop={completed:!!completed}',
  'getSupportedKeys()',
  "if(typeof window.tizen!=='undefined')return;",
  'jumpForward:function(ms,onSuccess,onError)',
  'jumpBackward:function(ms,onSuccess,onError)'
].forEach(x => assertContains(combined, x, x));

// Validate generated JavaScript before replacing either source file.
const tmpApp = appPath + '.hardening.tmp';
const tmpShim = shimPath + '.hardening.tmp';
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
console.log('TIZEN4_HARDENING_V4=PASS');
