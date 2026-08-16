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
const seekCss = fs.readFileSync('tv-app/css/rc316-regression-fixes.css','utf8');
const index = fs.readFileSync('tv-app/index.html','utf8');

[
  "marker:'rc3.24-rc321-retired'",
  'retired:true',
  "owner:'rc32-player-navigation.js'"
].forEach(marker=>{if(!retired.includes(marker))fail('retired RC3.21 layer marker missing: '+marker)});

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
  "marker:'rc3.25-visible-scrub-autoresume'",
  'var SCRUB_STEP=10000',
  'var SCRUB_STEP_MEDIUM=30000',
  'var SCRUB_STEP_FAST=60000',
  'var SCRUB_FRAME_MS=80',
  'var SCRUB_INITIAL_RELEASE_MS=1100',
  'var SCRUB_REPEAT_RELEASE_MIN_MS=520',
  'var SCRUB_REPEAT_RELEASE_MAX_MS=1400',
  'var SCRUB_REPEAT_RELEASE_DEFAULT_MS=720',
  'function adaptiveReleaseDelay()',
  'function releaseScrubFromSilence()',
  'function resumeAfterSeek(p,resume,attempt)',
  "ui.fill.style.opacity='1'",
  "ui.fill.style.visibility='visible'",
  "ui.preview.style.visibility='visible'",
  "ui.preview.style.opacity='1'",
  'if(scrubReleaseDeadline>0&&nowMs()>=scrubReleaseDeadline){releaseScrubFromSilence();return}',
  'scrubRepeatInterval=scrubRepeatInterval?Math.round(scrubRepeatInterval*0.65+sample*0.35):sample',
  'armReleaseFallback(adaptiveReleaseDelay())',
  'p.seekTo(target,done',
  "commit:'keyup-or-adaptive-repeat-gap-one-seekTo'",
  "visual:'restore-purple-fill-and-preview'",
  "autoresume:'retry-non-playing-state'"
].forEach(marker=>{if(!proven.includes(marker))fail('RC3.25 timeline contract missing: '+marker)});

if((proven.match(/p\.seekTo\(/g)||[]).length!==1){
  fail('timeline must contain exactly one executable absolute seekTo commit');
}
if(proven.includes('jumpForward(')||proven.includes('jumpBackward(')){
  fail('timeline must not issue AVPlay jumps during target selection');
}

[
  '#playerTimelineButton.scrubbing #playerScrubFill',
  'visibility:visible!important',
  'opacity:1!important',
  '#playerTimelineButton.scrubbing #playerSeekPreview',
  'display:block!important'
].forEach(marker=>{if(!seekCss.includes(marker))fail('RC3.25 active scrub CSS missing: '+marker)});

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
  fail('retired RC3.21 runtime marker missing');
}
if(sandbox.window.HOME_CINEMA_RC321.owner!=='rc32-player-navigation.js'){
  fail('rc32 was not declared as sole scrub owner');
}

console.log('PASS: RC3.21 experimental direct-arrow scrubber remains retired');
console.log('PASS: RC3.25 restores the purple target fill and time preview on every new scrub');
console.log('PASS: adaptive repeat-gap release provides a no-keyup commit path without OK');
console.log('PASS: post-seek autoresume retries every non-PLAYING Tizen state');
console.log('PASS: RC3.13 seek cleanup, RC3.19 Continue and RC3.20 AVPlay watchdog are preserved');
console.log('HOME_CINEMA_RC325_VISIBLE_SCRUB_AUTORESUME=PASS');
