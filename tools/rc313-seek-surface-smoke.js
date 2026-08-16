'use strict';

const fs = require('fs');
const vm = require('vm');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const player = fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');
const recovery = fs.readFileSync('tv-app/js/rc319-continue-recovery.js','utf8');

if(!player.includes('function clearScrubVisuals()'))fail('central scrub visual reset is missing');
if(!player.includes("ui.timeline.classList.remove('scrubbing')"))fail('scrubbing class is not cleared');
if(!player.includes("ui.fill.style.width='0%'"))fail('temporary seek fill is not cleared');
if(!player.includes("ui.preview.style.display='none'"))fail('seek preview is not hidden');
if(!player.includes("ui.preview.textContent=''"))fail('seek preview text is not cleared');

const commit = player.indexOf('function commitScrub(');
const immediateClear = player.indexOf('clearScrubVisuals();', commit);
const seekCall = player.indexOf('p.seekTo(target', commit);
if(commit < 0 || immediateClear < 0 || seekCall < 0 || immediateClear > seekCall){
  fail('temporary scrub surface must clear before AVPlay seekTo');
}

if(!player.includes('seekWatchdog=nativeSetTimeout(done,1800)'))fail('old-Tizen scrub seek callback watchdog is missing');
if(!player.includes('if(scrubActive||seekInFlight){nativeSetTimeout(waitForSeekToSettle,350);return}')){
  fail('player chrome auto-hide is not postponed only for active scrub/seek');
}
if(player.includes('if(timelineFocused()||scrubActive||seekInFlight)return')){
  fail('idle timeline focus still suppresses player chrome auto-hide forever');
}

/* RC3.20 protects app.js restoreProgress() and direct jumpForward/jumpBackward too.
 * A missed Samsung AVPlay callback must not leave state.seekBusy stuck forever. */
if(!recovery.includes("marker:'rc3.20-seek-watchdog'"))fail('RC3.20 seek watchdog marker is missing');
if(!recovery.includes('var WATCHDOG_MS=1800'))fail('RC3.20 watchdog duration is missing');
if(!recovery.includes("installMethod(av,'seekTo')"))fail('seekTo is not guarded');
if(!recovery.includes("installMethod(av,'jumpForward')"))fail('jumpForward is not guarded');
if(!recovery.includes("installMethod(av,'jumpBackward')"))fail('jumpBackward is not guarded');
if(!recovery.includes('__homeCinemaRC320SeekWatchdog'))fail('idempotent AVPlay wrapping marker is missing');

const timers=[];
let nativeSeekCalls=0;
let successCalls=0;
const avplay={
  seekTo:function(){nativeSeekCalls++},
  jumpForward:function(){},
  jumpBackward:function(){}
};
const context={
  console:console,
  Promise:Promise,
  JSON:JSON,
  Date:Date,
  Math:Math,
  Number:Number,
  String:String,
  Object:Object,
  Array:Array,
  isFinite:isFinite,
  document:{querySelector:function(){return null}},
  window:{
    webapis:{avplay:avplay},
    fetch:function(){return Promise.reject(new Error('unused'))},
    localStorage:{setItem:function(){}},
    Response:function(){},
    addEventListener:function(){},
    setTimeout:function(fn,delay){timers.push({fn:fn,delay:delay});return timers.length},
    clearTimeout:function(){}
  }
};
vm.runInNewContext(recovery,context,{filename:'rc319-continue-recovery.js'});
if(!avplay.seekTo.__homeCinemaRC320SeekWatchdog)fail('seekTo was not wrapped at runtime');
avplay.seekTo(12345,function(){successCalls++},function(){});
if(nativeSeekCalls!==1)fail('wrapped seekTo did not call native AVPlay exactly once');
const watchdog=timers.filter(function(x){return x.delay===1800}).pop();
if(!watchdog)fail('runtime seek watchdog timer was not armed');
watchdog.fn();
if(successCalls!==1)fail('watchdog did not release a missing AVPlay success callback');

console.log('PASS: seek preview/fill are cleared before AVPlay seekTo');
console.log('PASS: scrub seek callback watchdog remains active');
console.log('PASS: RC3.20 releases missed resume/direct AVPlay seek callbacks');
console.log('PASS: idle timeline focus no longer prevents the 7-second player chrome hide');
console.log('HOME_CINEMA_RC320_SEEK_RELIABILITY_SMOKE=PASS');
