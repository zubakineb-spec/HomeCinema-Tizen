param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"

$App  = Join-Path $RepoRoot "tv-app\js\app.js"
$Shim = Join-Path $RepoRoot "tv-app\js\browser-avplay-shim.js"

if (-not (Test-Path $App))  { throw "app.js not found: $App" }
if (-not (Test-Path $Shim)) { throw "browser-avplay-shim.js not found: $Shim" }

function Replace-Exact {
    param(
        [string]$Text,
        [string]$Old,
        [string]$New,
        [string]$Name
    )
    if (-not $Text.Contains($Old)) {
        throw "PATCH_ANCHOR_NOT_FOUND: $Name"
    }
    return $Text.Replace($Old, $New)
}

$appText = [IO.File]::ReadAllText($App)

$appText = Replace-Exact $appText @'
  playerTimer:null,
  saveTimer:null,
  searchTimer:null
'@ @'
  playerTimer:null,
  saveTimer:null,
  seekBusy:false,
  pendingStop:null,
  searchTimer:null
'@ "state seek/progress fields"

$appText = Replace-Exact $appText @'
function clearPlayerTimer(){if(state.playerTimer){clearTimeout(state.playerTimer);state.playerTimer=null}}
'@ @'
function clearPlayerTimer(){if(state.playerTimer){clearTimeout(state.playerTimer);state.playerTimer=null}}
function clearSaveTimer(){if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=null}}
'@ "clearSaveTimer"

$appText = Replace-Exact $appText @'
  clearPlayerTimer();closeAv();restorePlayerScreen();
'@ @'
  clearPlayerTimer();clearSaveTimer();state.seekBusy=false;state.pendingStop=null;closeAv();restorePlayerScreen();
'@ "failPlayback cleanup"

$appText = Replace-Exact $appText @'
  if(state.player){toast('Видео уже запускается');return}
  state.playerToken++;
'@ @'
  if(state.player){toast('Видео уже запускается');return}
  clearSaveTimer();state.seekBusy=false;state.pendingStop=null;
  state.playerToken++;
'@ "startPlayback cleanup"

$appText = Replace-Exact $appText @'
  state.player={token:token,url:url,title:title||'Видео',phase:'boot',subtitleOff:true};
'@ @'
  state.player={token:token,url:url,title:title||'Видео',phase:'boot',subtitleOff:true,lastPosition:0,lastDuration:0};
'@ "player progress snapshot"

$appText = Replace-Exact $appText @'
function updateProgress(pos,dur){
  var pct=dur?Math.max(0,Math.min(100,pos/dur*100)):0;
  $('#playerProgress').style.width=pct+'%';
  $('#playerCurrentTime').textContent=formatPlayerTime(pos);
  $('#playerDurationTime').textContent=formatPlayerTime(dur);
  if(!state.saveTimer){state.saveTimer=setTimeout(function(){state.saveTimer=null;if(state.player)saveProgress(pos,dur,pct>95,state.player)},5000)}
}
'@ @'
function updateProgress(pos,dur){
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
'@ "latest progress autosave"

$appText = Replace-Exact $appText @'
function stopPlayer(completed){
  if(!state.player)return;
  var pl=state.player,pos=0,dur=0;clearPlayerTimer();
'@ @'
function stopPlayer(completed){
  if(!state.player)return;
  if(state.seekBusy){state.pendingStop={completed:!!completed};return}
  var pl=state.player,pos=0,dur=0;clearPlayerTimer();clearSaveTimer();state.pendingStop=null;
'@ "stop during seek"

$appText = Replace-Exact $appText @'
function playerToggle(){
  if(!state.player||state.player.phase!=='playing')return;
'@ @'
function playerToggle(){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy)return;
'@ "pause during seek"

$appText = Replace-Exact $appText @'
function seek(delta){
  if(!state.player||state.player.phase!=='playing')return;
  try{if(delta>0)webapis.avplay.jumpForward(delta);else webapis.avplay.jumpBackward(Math.abs(delta))}catch(_){}
}
'@ @'
function seek(delta,onDone){
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
'@ "serialized AVPlay seek"

$appText = Replace-Exact $appText @'
function openPlayerPanel(kind){
  if(!state.player||state.player.phase!=='playing')return;
'@ @'
function openPlayerPanel(kind){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy)return;
'@ "settings during seek"

$appText = Replace-Exact $appText @'
function selectPlayerTrack(type,index,button){
  if(!state.player||state.player.phase!=='playing'||!avAvailable())return;
'@ @'
function selectPlayerTrack(type,index,button){
  if(!state.player||state.player.phase!=='playing'||state.seekBusy||!avAvailable())return;
'@ "track switch during seek"

$appText = Replace-Exact $appText @'
    if(action==='toggle')playerToggle();else if(action==='rewind'){seek(-10000);showPlayerMenu('[data-player-action=\"rewind\"]')}else if(action==='forward'){seek(10000);showPlayerMenu('[data-player-action=\"forward\"]')}
'@ @'
    if(action==='toggle')playerToggle();else if(action==='rewind'){seek(-10000,function(){showPlayerMenu('[data-player-action=\"rewind\"]')})}else if(action==='forward'){seek(10000,function(){showPlayerMenu('[data-player-action=\"forward\"]')})}
'@ "click seek callback"

$appText = Replace-Exact $appText @'
function registerKeys(){
  try{
    if(typeof tizen==='undefined'||!tizen.tvinputdevice)return;
    var keys=['MediaPlayPause','MediaPlay','MediaPause','MediaFastForward','MediaRewind','MediaStop'];
    if(tizen.tvinputdevice.registerKeyBatch)tizen.tvinputdevice.registerKeyBatch(keys);
    else keys.forEach(function(k){try{tizen.tvinputdevice.registerKey(k)}catch(_){}});
  }catch(e){console.warn(e)}
}
'@ @'
function registerKeys(){
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
'@ "safe media key registration"

$appText = Replace-Exact $appText @'
    if(code===37||code===412){consume(e);seek(-10000);showPlayerMenu('[data-player-action=\"rewind\"]');return false}
    if(code===39||code===417){consume(e);seek(10000);showPlayerMenu('[data-player-action=\"forward\"]');return false}
'@ @'
    if(code===37||code===412){consume(e);seek(-10000,function(){showPlayerMenu('[data-player-action=\"rewind\"]')});return false}
    if(code===39||code===417){consume(e);seek(10000,function(){showPlayerMenu('[data-player-action=\"forward\"]')});return false}
'@ "remote seek callback"

[IO.File]::WriteAllText($App, $appText, (New-Object Text.UTF8Encoding($false)))

$shimText = [IO.File]::ReadAllText($Shim)
$shimText = Replace-Exact $shimText @'
if(window.webapis&&window.webapis.avplay)return;
'@ @'
if(window.webapis&&window.webapis.avplay)return;
if(typeof window.tizen!=='undefined')return;
'@ "never shim native Tizen"

$shimText = Replace-Exact $shimText @'
  jumpForward:function(ms){var v=ensureVideo();v.currentTime=Math.min(isFinite(v.duration)?v.duration:Infinity,v.currentTime+Math.max(0,Number(ms||0))/1000)},
  jumpBackward:function(ms){var v=ensureVideo();v.currentTime=Math.max(0,v.currentTime-Math.max(0,Number(ms||0))/1000)},
'@ @'
  jumpForward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.min(isFinite(v.duration)?v.duration:Infinity,v.currentTime+Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},
  jumpBackward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.max(0,v.currentTime-Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},
'@ "browser seek callbacks"

[IO.File]::WriteAllText($Shim, $shimText, (New-Object Text.UTF8Encoding($false)))

Write-Host "=== NODE CHECK ==="
$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $Node) { throw "node.exe not found" }
& $Node.Source --check $App
if ($LASTEXITCODE -ne 0) { throw "APP_JS_CHECK_FAILED" }
& $Node.Source --check $Shim
if ($LASTEXITCODE -ne 0) { throw "SHIM_JS_CHECK_FAILED" }

Write-Host "=== PATCH ASSERTIONS ==="
$checks = @(
    'clearSaveTimer',
    'state.seekBusy=true',
    'state.pendingStop={completed:!!completed}',
    'getSupportedKeys()',
    "if(typeof window.tizen!=='undefined')return;"
)
$all = [IO.File]::ReadAllText($App) + "`n" + [IO.File]::ReadAllText($Shim)
foreach ($c in $checks) {
    if (-not $all.Contains($c)) { throw "PATCH_ASSERTION_FAILED: $c" }
    Write-Host "PASS: $c"
}

Write-Host "TIZEN4_HARDENING_PATCH=PASS"
