'use strict';

const fs = require('fs');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const player = fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');

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

if(!player.includes('seekWatchdog=nativeSetTimeout(done,1800)'))fail('old-Tizen seek callback watchdog is missing');
if(!player.includes('if(scrubActive||seekInFlight){nativeSetTimeout(waitForSeekToSettle,350);return}')){
  fail('player chrome auto-hide is not postponed only for active scrub/seek');
}
if(player.includes('if(timelineFocused()||scrubActive||seekInFlight)return')){
  fail('idle timeline focus still suppresses player chrome auto-hide forever');
}

console.log('PASS: seek preview/fill are cleared before AVPlay seekTo');
console.log('PASS: missing AVPlay seek callbacks cannot leave seekInFlight stuck');
console.log('PASS: idle timeline focus no longer prevents the 7-second player chrome hide');
console.log('HOME_CINEMA_RC313_SEEK_SURFACE_SMOKE=PASS');
