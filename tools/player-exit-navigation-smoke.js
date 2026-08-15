'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'tv-app', 'js', 'rc32-player-navigation.js'),
  'utf8'
).replace(/\r\n?/g, '\n');

function main() {
  const resetStart = source.indexOf('function resetInactivePlayerNavigation(){');
  const keydownStart = source.indexOf("window.addEventListener('keydown',function(e){");
  const resetCall = source.indexOf('if(resetInactivePlayerNavigation())return;', keydownStart);
  const chromeGuard = source.indexOf('if(!playerChromeVisible()||settingsOpen())return;', keydownStart);

  assert(resetStart >= 0, 'inactive-player navigation reset must exist');
  assert(keydownStart >= 0, 'RC3.2 keydown handler must exist');
  assert(resetCall > keydownStart, 'keydown must reset stale player focus');
  assert(chromeGuard > resetCall, 'stale focus reset must run before player chrome guard');
  assert(source.includes("if(playerActive())return false;"), 'reset must be disabled while player is active');
  assert(source.includes("t.classList.remove('focused')"), 'timeline focused marker must be cleared after player exit');
  assert(source.includes("clearPlayerFocus();"), 'all player focused markers must be cleared after player exit');
  assert(source.includes("if(active&&closest(active,'#player')&&active.blur)active.blur();"), 'hidden player DOM focus must be released');
  assert(source.includes('lastControl=null;'), 'stale player control reference must be released');

  console.log('PASS: stale timeline focus is cleared before legacy remote handlers');
  console.log('PASS: first Left/Right after player exit remains available to app navigation');
  console.log('HOME_CINEMA_PLAYER_EXIT_NAVIGATION_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
