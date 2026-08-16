'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'js', 'rc32-player-navigation.js'), 'utf8').replace(/\r\n?/g, '\n');

function main() {
  assert(source.includes('var SCRUB_STEP=10000;'), 'short timeline tap must remain 10 seconds');
  assert(source.includes('var SCRUB_STEP_MEDIUM=30000;'), 'medium hold speed must remain 30 seconds/sec');
  assert(source.includes('var SCRUB_STEP_FAST=60000;'), 'fast hold speed must remain 60 seconds/sec');
  assert(source.includes('var SCRUB_FRAME_MS=80;'), 'smooth timeline target must use its own 80ms visual clock');
  assert(source.includes('var SCRUB_HOLD_DELAY=320;'), 'hold acceleration must start only after a short-tap window');
  assert(source.includes('if(scrubHoldCount>=11)return SCRUB_STEP_FAST;'), 'hold must accelerate to 60 seconds/sec');
  assert(source.includes('if(scrubHoldCount>=5)return SCRUB_STEP_MEDIUM;'), 'hold must accelerate to 30 seconds/sec');
  assert(source.includes('var delta=speed*SCRUB_FRAME_MS/1000;'), 'smooth target movement must scale speed by frame duration');
  assert(source.includes('if(scrubKeyHeld&&scrubHoldDirection===direction)return true;'), 'Samsung repeated keydown events must not create extra timeline jumps');
  assert(source.includes("stepScrub(-1)"), 'left timeline scrub must use direction-aware smooth selection');
  assert(source.includes("stepScrub(1)"), 'right timeline scrub must use direction-aware smooth selection');
  assert(source.includes('consume(e);clearHoldTimer();scrubKeyHeld=false;commitScrub(false);return false;'), 'keyup must stop smooth target movement and commit one seek');
  assert((source.match(/p\.seekTo\(/g)||[]).length===1, 'timeline must have exactly one absolute seekTo commit');
  assert(!source.includes('jumpForward(')&&!source.includes('jumpBackward('), 'target selection must never jump AVPlay repeatedly');
  assert(source.includes('resetInactivePlayerNavigation'), 'player exit focus regression guard must remain');

  console.log('PASS: Up/focused timeline retains 10-second short tap selection');
  console.log('PASS: held Left/Right moves the visual target smoothly on an internal 80ms clock');
  console.log('PASS: hold acceleration progresses 10 -> 30 -> 60 seconds/sec without Samsung key-repeat jumps');
  console.log('PASS: keyup stops the target clock and commits exactly one seekTo');
  console.log('HOME_CINEMA_PLAYER_UX_RC37_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
