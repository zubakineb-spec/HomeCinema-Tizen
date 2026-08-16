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
  assert(source.includes('var SCRUB_INITIAL_RELEASE_MS=750;'), 'initial keydown must have a no-keyup release fallback');
  assert(source.includes('var SCRUB_REPEAT_RELEASE_MS=360;'), 'held repeat stream must have a quiet-gap release fallback');
  assert(source.includes('if(scrubHoldCount>=11)return SCRUB_STEP_FAST;'), 'hold must accelerate to 60 seconds/sec');
  assert(source.includes('if(scrubHoldCount>=5)return SCRUB_STEP_MEDIUM;'), 'hold must accelerate to 30 seconds/sec');
  assert(source.includes('var delta=speed*SCRUB_FRAME_MS/1000;'), 'smooth target movement must scale speed by frame duration');
  assert(source.includes('if(!scrubRepeatSeen){scrubRepeatSeen=true;startSmoothMotion()}'), 'continuous motion must begin only after Samsung repeat confirms hold');
  assert(source.includes('armReleaseFallback(SCRUB_INITIAL_RELEASE_MS);'), 'short tap fallback must be armed');
  assert(source.includes('armReleaseFallback(SCRUB_REPEAT_RELEASE_MS);'), 'repeat-gap fallback must refresh while held');
  assert(source.includes("stepScrub(-1)"), 'left timeline scrub must use direction-aware smooth selection');
  assert(source.includes("stepScrub(1)"), 'right timeline scrub must use direction-aware smooth selection');
  assert(source.includes('consume(e);clearHoldTimer();clearReleaseTimer();scrubKeyHeld=false;commitScrub(false);return false;'), 'keyup must remain an immediate release path');
  assert((source.match(/p\.seekTo\(/g)||[]).length===1, 'timeline must have exactly one absolute seekTo commit');
  assert(!source.includes('jumpForward(')&&!source.includes('jumpBackward('), 'target selection must never jump AVPlay repeatedly');
  assert(source.includes('resetInactivePlayerNavigation'), 'player exit focus regression guard must remain');

  console.log('PASS: Up/focused timeline retains 10-second short-tap selection');
  console.log('PASS: Samsung repeat confirms hold; held Left/Right then moves the target on the internal 80ms clock');
  console.log('PASS: release no longer depends on DOM keyup; repeat-stream silence also commits');
  console.log('PASS: every scrub still has exactly one absolute seekTo');
  console.log('HOME_CINEMA_PLAYER_UX_RC37_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
