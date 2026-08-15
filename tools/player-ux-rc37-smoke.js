'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'js', 'rc32-player-navigation.js'), 'utf8').replace(/\r\n?/g, '\n');

function main() {
  assert(source.includes('var SCRUB_STEP=10000;'), 'base scrub step must remain 10 seconds');
  assert(source.includes('var SCRUB_STEP_MEDIUM=30000;'), 'medium hold scrub step must be 30 seconds');
  assert(source.includes('var SCRUB_STEP_FAST=60000;'), 'fast hold scrub step must be 60 seconds');
  assert(source.includes('if(scrubHoldCount>=11)return SCRUB_STEP_FAST;'), 'hold must accelerate to 60 seconds');
  assert(source.includes('if(scrubHoldCount>=5)return SCRUB_STEP_MEDIUM;'), 'hold must accelerate to 30 seconds');
  assert(source.includes("stepScrub(-1)"), 'left timeline scrub must use accelerated direction-aware stepping');
  assert(source.includes("stepScrub(1)"), 'right timeline scrub must use accelerated direction-aware stepping');
  assert(source.includes('consume(e);commitScrub(false);return false;'), 'keyup must still commit one seek');
  assert(source.includes('resetInactivePlayerNavigation'), 'player exit focus regression guard must remain');

  console.log('PASS: timeline hold accelerates 10 -> 30 -> 60 seconds');
  console.log('PASS: keyup still commits a single seek and player-exit guard remains');
  console.log('HOME_CINEMA_PLAYER_UX_RC37_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
