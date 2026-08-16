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
  "marker:'rc3.22-rc321-retired'",
  'retired:true',
  "owner:'rc32-player-navigation.js'",
  "window.HOME_CINEMA_RC='rc3.22-restore-proven-scrub'"
].forEach(marker=>{if(!retired.includes(marker))fail('missing RC3.22 retirement marker: '+marker)});

/* Check executable ownership markers, not words that can legitimately appear
 * in comments describing the retired historical implementation. */
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
  'var SCRUB_STEP=10000',
  'var SCRUB_STEP_MEDIUM=30000',
  'var SCRUB_STEP_FAST=60000',
  'function holdStep(direction)',
  'if(scrubHoldCount>=11)return SCRUB_STEP_FAST',
  'if(scrubHoldCount>=5)return SCRUB_STEP_MEDIUM',
  'if(code===37||code===412){consume(e);stepScrub(-1)',
  'if(code===39||code===417){consume(e);stepScrub(1)',
  "window.addEventListener('keyup'",
  'p.seekTo(target,done',
  'DO NOT consume Back',
  'function clearScrubVisuals()',
  'seekWatchdog=nativeSetTimeout(done,1800)'
].forEach(marker=>{if(!proven.includes(marker))fail('proven rc32 scrub contract missing: '+marker)});

if(proven.includes('jumpForward(delta')||proven.includes('jumpBackward(Math.abs(delta)')){
  fail('proven timeline owner must commit one absolute seekTo rather than direct per-key jumps');
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
  fail('RC3.22 runtime retirement marker missing');
}
if(sandbox.window.HOME_CINEMA_RC321.owner!=='rc32-player-navigation.js'){
  fail('rc32 was not declared as sole scrub owner');
}
if(hint.textContent.indexOf('↑ — шкала времени')!==0){
  fail('historical timeline interaction hint was not restored');
}

console.log('PASS: RC3.21 experimental direct-arrow scrubber is retired');
console.log('PASS: rc32-player-navigation.js is again the sole timeline scrub owner');
console.log('PASS: proven 10 -> 30 -> 60 second hold acceleration and one seekTo commit are preserved');
console.log('PASS: RC3.13 seek-surface watchdog/cleanup is preserved');
console.log('PASS: RC3.19 Continue recovery and RC3.20 AVPlay callback watchdog are preserved');
console.log('HOME_CINEMA_RC322_RESTORE_PROVEN_SCRUB=PASS');
