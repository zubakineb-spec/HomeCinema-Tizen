param(
    [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot ".."))
)

$ErrorActionPreference = "Stop"

$App  = Join-Path $RepoRoot "tv-app\js\app.js"
$Shim = Join-Path $RepoRoot "tv-app\js\browser-avplay-shim.js"

if (-not (Test-Path $App))  { throw "app.js not found: $App" }
if (-not (Test-Path $Shim)) { throw "browser-avplay-shim.js not found: $Shim" }

function Normalize-LF([string]$Text) {
    return $Text.Replace("`r`n", "`n").Replace("`r", "`n")
}

function Replace-Once {
    param([string]$Text,[string]$Old,[string]$New,[string]$Name)
    $first = $Text.IndexOf($Old, [StringComparison]::Ordinal)
    if ($first -lt 0) { throw "PATCH_ANCHOR_NOT_FOUND: $Name" }
    $second = $Text.IndexOf($Old, $first + $Old.Length, [StringComparison]::Ordinal)
    if ($second -ge 0) { throw "PATCH_ANCHOR_NOT_UNIQUE: $Name" }
    return $Text.Substring(0,$first) + $New + $Text.Substring($first + $Old.Length)
}

function Replace-Range {
    param([string]$Text,[string]$Start,[string]$End,[string]$NewBlock,[string]$Name)
    $a = $Text.IndexOf($Start, [StringComparison]::Ordinal)
    if ($a -lt 0) { throw "PATCH_RANGE_START_NOT_FOUND: $Name" }
    $b = $Text.IndexOf($End, $a + $Start.Length, [StringComparison]::Ordinal)
    if ($b -lt 0) { throw "PATCH_RANGE_END_NOT_FOUND: $Name" }
    return $Text.Substring(0,$a) + $NewBlock + $Text.Substring($b)
}

$app = Normalize-LF ([IO.File]::ReadAllText($App))
$shim = Normalize-LF ([IO.File]::ReadAllText($Shim))

# State fields.
if (-not $app.Contains("  seekBusy:false,")) {
    $app = Replace-Once $app "  saveTimer:null,`n" "  saveTimer:null,`n  seekBusy:false,`n  pendingStop:null,`n" "state fields"
}

# Save timer lifecycle.
if (-not $app.Contains("function clearSaveTimer()")) {
    $app = Replace-Once $app `
        "function clearPlayerTimer(){if(state.playerTimer){clearTimeout(state.playerTimer);state.playerTimer=null}}`n" `
        "function clearPlayerTimer(){if(state.playerTimer){clearTimeout(state.playerTimer);state.playerTimer=null}}`nfunction clearSaveTimer(){if(state.saveTimer){clearTimeout(state.saveTimer);state.saveTimer=null}}`n" `
        "clearSaveTimer"
}

$app = $app.Replace(
    "  clearPlayerTimer();closeAv();restorePlayerScreen();",
    "  clearPlayerTimer();clearSaveTimer();state.seekBusy=false;state.pendingStop=null;closeAv();restorePlayerScreen();"
)

if (-not $app.Contains("clearSaveTimer();state.seekBusy=false;state.pendingStop=null;`n  state.playerToken++;")) {
    $app = Replace-Once $app `
        "  if(state.player){toast('Видео уже запускается');return}`n" `
        "  if(state.player){toast('Видео уже запускается');return}`n  clearSaveTimer();state.seekBusy=false;state.pendingStop=null;`n" `
        "startPlayback cleanup"
}

$app = $app.Replace(
    "  state.player={token:token,url:url,title:title||'Видео',phase:'boot',subtitleOff:true};",
    "  state.player={token:token,url:url,title:title||'Видео',phase:'boot',subtitleOff:true,lastPosition:0,lastDuration:0};"
)

# Always save the latest position observed by AVPlay, not the values captured when the timer was created.
$newUpdate = @'
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
'@
$newUpdate = (Normalize-LF $newUpdate) + "`n"
$app = Replace-Range $app "function updateProgress(pos,dur){" "function stopPlayer(completed){" $newUpdate "updateProgress"

$newStop = @'
function stopPlayer(completed){
  if(!state.player)return;
  if(state.seekBusy){state.pendingStop={completed:!!completed};return}
  var pl=state.player,pos=0,dur=0;clearPlayerTimer();clearSaveTimer();state.pendingStop=null;
  try{var p=webapis.avplay;pos=p.getCurrentTime();dur=p.getDuration()}catch(_){}
  closeAv();saveProgress(pos,dur,completed,pl);restorePlayerScreen();
  state.player=null;state.tracksOpen=false;state.playerMenuOpen=false;state.playerPanel=null;state.mode=state.current?'details':'home';
  loadContinue().then(function(){rebuildFocus($('#detailPlay')||null)});
}
'@
$newStop = (Normalize-LF $newStop) + "`n"
$app = Replace-Range $app "function stopPlayer(completed){" "function syncToggleButton(){" $newStop "stopPlayer"

$app = $app.Replace(
    "  if(!state.player||state.player.phase!=='playing')return;`n  try{var p=webapis.avplay,st=p.getState();",
    "  if(!state.player||state.player.phase!=='playing'||state.seekBusy)return;`n  try{var p=webapis.avplay,st=p.getState();"
)

# Samsung AVPlay jumpForward/jumpBackward are asynchronous. Do not call other AVPlay methods until callback.
$newSeek = @'
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
'@
$newSeek = (Normalize-LF $newSeek) + "`n"
$app = Replace-Range $app "function seek(delta" "function parseExtra(v){" $newSeek "seek"

$app = $app.Replace(
    "function openPlayerPanel(kind){`n  if(!state.player||state.player.phase!=='playing')return;",
    "function openPlayerPanel(kind){`n  if(!state.player||state.player.phase!=='playing'||state.seekBusy)return;"
)
$app = $app.Replace(
    "function selectPlayerTrack(type,index,button){`n  if(!state.player||state.player.phase!=='playing'||!avAvailable())return;",
    "function selectPlayerTrack(type,index,button){`n  if(!state.player||state.player.phase!=='playing'||state.seekBusy||!avAvailable())return;"
)

$app = $app.Replace(
    "if(action==='toggle')playerToggle();else if(action==='rewind'){seek(-10000);showPlayerMenu('[data-player-action=\"rewind\"]')}else if(action==='forward'){seek(10000);showPlayerMenu('[data-player-action=\"forward\"]')}",
    "if(action==='toggle')playerToggle();else if(action==='rewind'){seek(-10000,function(){showPlayerMenu('[data-player-action=\"rewind\"]')})}else if(action==='forward'){seek(10000,function(){showPlayerMenu('[data-player-action=\"forward\"]')})}"
)

$newRegister = @'
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
'@
$newRegister = (Normalize-LF $newRegister) + "`n"
$app = Replace-Range $app "function registerKeys(){" "function key(e){" $newRegister "registerKeys"

$app = $app.Replace(
    "if(code===37||code===412){consume(e);seek(-10000);showPlayerMenu('[data-player-action=\"rewind\"]');return false}",
    "if(code===37||code===412){consume(e);seek(-10000,function(){showPlayerMenu('[data-player-action=\"rewind\"]')});return false}"
)
$app = $app.Replace(
    "if(code===39||code===417){consume(e);seek(10000);showPlayerMenu('[data-player-action=\"forward\"]');return false}",
    "if(code===39||code===417){consume(e);seek(10000,function(){showPlayerMenu('[data-player-action=\"forward\"]')});return false}"
)

# Browser shim must never replace native Tizen APIs, and must emulate asynchronous seek callbacks.
if (-not $shim.Contains("if(typeof window.tizen!=='undefined')return;")) {
    $shim = Replace-Once $shim "if(window.webapis&&window.webapis.avplay)return;`n" "if(window.webapis&&window.webapis.avplay)return;`nif(typeof window.tizen!=='undefined')return;`n" "native Tizen shim guard"
}
$shim = $shim.Replace(
    "  jumpForward:function(ms){var v=ensureVideo();v.currentTime=Math.min(isFinite(v.duration)?v.duration:Infinity,v.currentTime+Math.max(0,Number(ms||0))/1000)},",
    "  jumpForward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.min(isFinite(v.duration)?v.duration:Infinity,v.currentTime+Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},"
)
$shim = $shim.Replace(
    "  jumpBackward:function(ms){var v=ensureVideo();v.currentTime=Math.max(0,v.currentTime-Math.max(0,Number(ms||0))/1000)},",
    "  jumpBackward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.max(0,v.currentTime-Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},"
)

# Fail closed if any intended semantic marker is missing.
$checks = @(
    'function clearSaveTimer()',
    'state.seekBusy=true',
    'state.pendingStop={completed:!!completed}',
    'getSupportedKeys()',
    "if(typeof window.tizen!=='undefined')return;",
    'jumpForward:function(ms,onSuccess,onError)',
    'jumpBackward:function(ms,onSuccess,onError)'
)
$all = $app + "`n" + $shim
foreach ($c in $checks) {
    if (-not $all.Contains($c)) { throw "PATCH_ASSERTION_FAILED: $c" }
    Write-Host "PASS: $c"
}

# Write LF/UTF-8 without BOM so the patch itself never creates an EOL-only diff.
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText($App,  $app,  $utf8)
[IO.File]::WriteAllText($Shim, $shim, $utf8)

Write-Host "=== NODE CHECK ==="
$Node = Get-Command node.exe -ErrorAction SilentlyContinue
if (-not $Node) { throw "node.exe not found" }
& $Node.Source --check $App
if ($LASTEXITCODE -ne 0) { throw "APP_JS_CHECK_FAILED" }
& $Node.Source --check $Shim
if ($LASTEXITCODE -ne 0) { throw "SHIM_JS_CHECK_FAILED" }

Write-Host "TIZEN4_HARDENING_V3=PASS"
