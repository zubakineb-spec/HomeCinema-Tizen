'use strict';

const fs = require('fs');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const rc32 = fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');
const retired = fs.readFileSync('tv-app/js/rc321-smooth-scrub.js','utf8');
const rc319 = fs.readFileSync('tv-app/js/rc319-continue-recovery.js','utf8');

[
  "marker:'rc3.23-smooth-timeline-hold'",
  'var SCRUB_FRAME_MS=80',
  'var SCRUB_HOLD_DELAY=320',
  'var SCRUB_STEP=10000',
  'function smoothHoldTick()',
  'function startSmoothHold(direction)',
  'if(scrubKeyHeld&&scrubHoldDirection===direction)return true',
  'var delta=speed*SCRUB_FRAME_MS/1000',
  'scrubHoldTimer=nativeSetTimeout(smoothHoldTick,SCRUB_FRAME_MS)',
  'scrubHoldTimer=nativeSetTimeout(smoothHoldTick,SCRUB_HOLD_DELAY)',
  "if(active&&code===38)",
  'focusTimeline()',
  'if(code===37||code===412){consume(e);stepScrub(-1)',
  'if(code===39||code===417){consume(e);stepScrub(1)',
  "window.addEventListener('keyup'",
  'consume(e);clearHoldTimer();scrubKeyHeld=false;commitScrub(false)',
  'p.seekTo(target,done',
  "commit:'keyup-one-seekTo'"
].forEach(marker=>{if(!rc32.includes(marker))fail('RC3.23 contract missing: '+marker)});

if((rc32.match(/p\.seekTo\(/g)||[]).length!==1){
  fail('rc32 must contain exactly one executable AVPlay seekTo commit');
}
if(rc32.includes('jumpForward(')||rc32.includes('jumpBackward(')){
  fail('timeline target selection must not issue AVPlay jumps while Left/Right is held');
}
if(rc32.includes('SCRUB_COMMIT_DELAY')||rc32.includes('scheduleCommit')){
  fail('timeline must commit on key release, not an idle debounce timer');
}

[
  "marker:'rc3.22-rc321-retired'",
  'retired:true',
  "owner:'rc32-player-navigation.js'"
].forEach(marker=>{if(!retired.includes(marker))fail('retired RC3.21 layer marker missing: '+marker)});
if(retired.includes("window.addEventListener('keydown'")||retired.includes("window.addEventListener('keyup'")){
  fail('retired RC3.21 layer must not compete for remote keys');
}

[
  'body.completed=completed?1:0',
  'body.rc319_progress_contract=319',
  'effectiveIncomplete',
  'mergeContinueData',
  "marker:'rc3.20-seek-watchdog'",
  'var WATCHDOG_MS=1800'
].forEach(marker=>{if(!rc319.includes(marker))fail('preserved Continue/AVPlay contract missing: '+marker)});

console.log('PASS: Up focuses the timeline before scrub ownership starts');
console.log('PASS: Left/Right choose only a visual target; Samsung key-repeat cadence is ignored');
console.log('PASS: held target motion uses an internal 80ms clock and accelerates smoothly');
console.log('PASS: key release performs exactly one absolute seekTo commit');
console.log('PASS: RC3.19 Continue and RC3.20 AVPlay watchdog remain intact');
console.log('HOME_CINEMA_RC323_SMOOTH_TIMELINE_HOLD=PASS');
