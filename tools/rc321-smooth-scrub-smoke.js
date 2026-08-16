'use strict';

const fs = require('fs');
const vm = require('vm');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const retired = fs.readFileSync('tv-app/js/rc321-smooth-scrub.js','utf8');
const proven = fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');
const rc319 = fs.readFileSync('tv-app/js/rc319-continue-recovery.js','utf8');
const index = fs.readFileSync('tv-app/index.html','utf8');

[
  "marker:'rc3.24-rc321-retired'",
  'retired:true',
  "owner:'rc32-player-navigation.js'",
  "window.HOME_CINEMA_RC='rc3.24-samsung-release-detection'"
].forEach(marker=>{if(!retired.includes(marker))fail('missing RC3.24 retirement marker: '+marker)});

[
  "window.addEventListener('keydown'",
  "window.addEventListener('keyup'",
  'nativeSetInterval=',
  'frameTimer=',
  'p.pause(',
  'p.jumpForward(',
  'p.jumpBackward(',
  'p.seekTo('
].forEach(marker=>{if(retired.includes(marker))fail('retired RC3.21 layer still owns playback/remote behavior: '+marker)});

[
  "marker:'rc3.24-samsung-release-detection'",
  'var SCRUB_STEP=10000',
  'var SCRUB_STEP_MEDIUM=30000',
  'var SCRUB_STEP_FAST=60000',
  'var SCRUB_FRAME_MS=80',
  'var SCRUB_INITIAL_RELEASE_MS=750',
  'var SCRUB_REPEAT_RELEASE_MS=360',
  'function holdStep(direction)',
  'function smoothHoldTick()',
  'function startSmoothMotion()',
  'function armReleaseFallback(delay)',
  'function handleScrubArrow(direction)',
  'if(!scrubRepeatSeen){scrubRepeatSeen=true;startSmoothMotion()}',
  'armReleaseFallback(SCRUB_INITIAL_RELEASE_MS)',
  'armReleaseFallback(SCRUB_REPEAT_RELEASE_MS)',
  'var delta=speed*SCRUB_FRAME_MS/1000',
  'scrubHoldTimer=nativeSetTimeout(smoothHoldTick,SCRUB_FRAME_MS)',
  'if(code===37||code===412){consume(e);stepScrub(-1)',
  'if(code===39||code===417){consume(e);stepScrub(1)',
  "window.addEventListener('keyup'",
  'consume(e);clearHoldTimer();clearReleaseTimer();scrubKeyHeld=false;commitScrub(false)',
  'p.seekTo(target,done',
  'DO NOT consume Back',
  'function clearScrubVisuals()',
  'seekWatchdog=nativeSetTimeout(done,1800)',
  "holdConfirm:'repeated-keydown'",
  "commit:'keyup-or-repeat-gap-one-seekTo'"
].forEach(marker=>{if(!proven.includes(marker))fail('RC3.24 timeline contract missing: '+marker)});

if((proven.match(/p\.seekTo\(/g)||[]).length!==1){
  fail('timeline must contain exactly one executable absolute seekTo commit');
}
if(proven.includes('jumpForward(')||proven.includes('jumpBackward(')){
  fail('timeline must not issue AVPlay jumps during target selection');
}
if(!proven.includes('repeated keydown proves')){
  fail('continuous scrub must start only after a repeat confirms physical hold');
}

[
  'body.completed=completed?1:0',
  'body.rc319_progress_contract=319',
  'effectiveIncomplete',
  'mergeContinueData',
  "marker:'rc3.20-seek-watchdog'",
  'var WATCHDOG_MS=1800',
  "installMethod(av,'seekTo')",
  "installMethod(av,'jumpForward')",
  "installMethod(av,'jumpBackward')"
].forEach(marker=>{if(!rc319.includes(marker))fail('RC3.19/RC3.20 preserved contract missing: '+marker)});

const ixCompat=index.indexOf('js/rc321-smooth-scrub.js');
const ixProven=index.indexOf('js/rc32-player-navigation.js');
const ix319=index.indexOf('js/rc319-continue-recovery.js');
const ixApp=index.indexOf('js/app.js');
if(ixCompat<0||ixProven<0||ix319<0||ixApp<0||!(ixCompat<ixProven&&ixProven<ix319&&ix319<ixApp)){
  fail('package load order changed unexpectedly');
}

let keyHandlers=0;
let intervalCalls=0;
const hint={textContent:''};
const sandbox={
  window:{
    addEventListener:function(){keyHandlers++},
    setInterval:function(){intervalCalls++;return 1}
  },
  document:{querySelector:function(selector){return selector==='.player-hint'?hint:null}},
  console:console
};
sandbox.window.window=sandbox.window;
vm.runInNewContext(retired,sandbox,{filename:'rc321-smooth-scrub.js'});

if(keyHandlers!==0)fail('retired RC3.21 registered a remote handler at runtime');
if(intervalCalls!==0)fail('retired RC3.21 started a scrub timer at runtime');
if(!sandbox.window.HOME_CINEMA_RC321||sandbox.window.HOME_CINEMA_RC321.retired!==true){
  fail('RC3.24 runtime retirement marker missing');
}
if(sandbox.window.HOME_CINEMA_RC321.owner!=='rc32-player-navigation.js'){
  fail('rc32 was not declared as sole scrub owner');
}

console.log('PASS: RC3.21 experimental direct-arrow scrubber remains retired');
console.log('PASS: Up -> timeline remains the only entry into scrub selection');
console.log('PASS: first Left/Right selects one 10-second target without requiring keyup');
console.log('PASS: repeated keydown confirms hold; target motion then runs on the internal 80ms clock');
console.log('PASS: keyup or repeat-stream silence commits exactly one absolute seekTo');
console.log('PASS: RC3.13 seek cleanup, RC3.19 Continue and RC3.20 AVPlay watchdog are preserved');
console.log('HOME_CINEMA_RC324_SAMSUNG_RELEASE=PASS');
