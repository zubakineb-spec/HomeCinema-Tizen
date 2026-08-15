'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'js', 'app.js'), 'utf8').replace(/\r\n?/g, '\n');

function extract(start, end) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error('LIFECYCLE_SMOKE_START_NOT_FOUND: ' + start);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error('LIFECYCLE_SMOKE_END_NOT_FOUND: ' + end);
  return source.slice(a, b);
}

const code = [
  extract('function avAvailable(){', 'function clearPlayerTimer(){'),
  extract('function resetLifecycleState(){', 'function createAvObject(){'),
  extract('function restorePausedTrackSwitch(', 'function beginPlayback('),
  extract('function seek(delta', 'function parseExtra(v){'),
  extract('function selectPlayerTrack(', 'function disableSubtitles(){')
].join('\n');

let suspendCalls = 0;
let restoreCalls = 0;
let hideMenuCalls = 0;
let pauseCalls = 0;
let playCalls = 0;
let selectTrackCalls = 0;
let refreshCalls = 0;
let openPanelCalls = 0;
let menuCalls = 0;
let forward = null;
let backward = null;
let timers = [];
let avState = 'PLAYING';

const documentState = {hidden: false};

const context = {
  console,
  document: documentState,
  state: {
    player: {token: 1, phase: 'playing', restorePausedAfterTrackSwitch: false},
    seekBusy: false,
    pendingStop: null,
    lifecycleSuspended: false,
    pendingVisibility: false,
    postStartPending: null
  },
  webapis: {
    avplay: {
      getState() { return avState; },
      suspend() { suspendCalls++; },
      restore() { restoreCalls++; avState = 'PLAYING'; },
      jumpForward(ms, ok, fail) { forward = {ms, ok, fail}; },
      jumpBackward(ms, ok, fail) { backward = {ms, ok, fail}; },
      play() { playCalls++; avState = 'PLAYING'; },
      pause() { pauseCalls++; avState = 'PAUSED'; },
      setSelectTrack() { selectTrackCalls++; }
    }
  },
  hidePlayerMenu() { hideMenuCalls++; },
  runPostStart() {},
  showPlayerMenu() { menuCalls++; },
  refreshPlayerTrackSummary() { refreshCalls++; },
  openPlayerPanel() { openPanelCalls++; },
  syncToggleButton() {},
  toast() {},
  setTimeout(fn) { timers.push(fn); return timers.length; },
  clearTimeout() {}
};

vm.createContext(context);
vm.runInContext(code, context, {filename: 'player-lifecycle-smoke-extracted.js'});

function resetCounters() {
  suspendCalls = 0;
  restoreCalls = 0;
  hideMenuCalls = 0;
  pauseCalls = 0;
  playCalls = 0;
  selectTrackCalls = 0;
  refreshCalls = 0;
  openPanelCalls = 0;
  menuCalls = 0;
  forward = null;
  backward = null;
  timers = [];
}

function main() {
  resetCounters();
  context.state.player = {token: 1, phase: 'playing', restorePausedAfterTrackSwitch: false};
  context.state.seekBusy = false;
  context.state.lifecycleSuspended = false;
  context.state.pendingVisibility = false;
  context.state.postStartPending = null;
  documentState.hidden = true;
  avState = 'PLAYING';

  context.handlePlayerVisibility();
  assert.strictEqual(suspendCalls, 1, 'hidden player must suspend exactly once');
  assert.strictEqual(context.state.lifecycleSuspended, true, 'suspend state must be recorded');
  assert.strictEqual(hideMenuCalls, 1, 'player chrome must hide while suspended');
  context.handlePlayerVisibility();
  assert.strictEqual(suspendCalls, 1, 'duplicate hidden events must not double-suspend');

  documentState.hidden = false;
  context.handlePlayerVisibility();
  assert.strictEqual(restoreCalls, 1, 'visible player must restore after successful suspend');
  assert.strictEqual(context.state.lifecycleSuspended, false, 'restore must clear suspended state');

  resetCounters();
  context.state.player = {token: 2, phase: 'playing', restorePausedAfterTrackSwitch: false};
  context.state.seekBusy = false;
  context.state.pendingStop = null;
  context.state.lifecycleSuspended = false;
  context.state.pendingVisibility = false;
  documentState.hidden = false;
  avState = 'PLAYING';

  context.seek(10000, function() {});
  assert(forward, 'forward seek must be issued');
  assert.strictEqual(context.state.seekBusy, true, 'seek must lock lifecycle AVPlay calls');
  documentState.hidden = true;
  context.handlePlayerVisibility();
  assert.strictEqual(suspendCalls, 0, 'suspend must wait for seek callback');
  assert.strictEqual(context.state.pendingVisibility, true, 'visibility transition must be deferred while seeking');
  forward.ok();
  assert.strictEqual(context.state.seekBusy, false, 'seek callback must release lock');
  assert.strictEqual(suspendCalls, 1, 'deferred suspend must run after seek callback');
  assert.strictEqual(context.state.lifecycleSuspended, true, 'deferred suspend must update lifecycle state');

  resetCounters();
  context.state.player = {token: 10, phase: 'playing', subtitleOff: true, restorePausedAfterTrackSwitch: false};
  context.state.seekBusy = false;
  context.state.lifecycleSuspended = false;
  avState = 'PAUSED';
  context.selectPlayerTrack('AUDIO', 2, null);
  assert.strictEqual(playCalls, 1, 'audio track switch from PAUSED must temporarily resume playback');
  assert.strictEqual(selectTrackCalls, 1, 'audio track must be selected once');
  assert.strictEqual(context.state.player.restorePausedAfterTrackSwitch, true, 'temporary resume must remember paused intent');
  assert.strictEqual(timers.length, 2, 'track switch schedules pause restore and panel refresh');

  context.state.player = {token: 11, phase: 'playing', subtitleOff: true, restorePausedAfterTrackSwitch: false};
  timers.forEach(function(fn) { fn(); });
  assert.strictEqual(pauseCalls, 0, 'stale track-switch timer must not pause a newer playback session');
  assert.strictEqual(refreshCalls, 0, 'stale track-switch timer must not refresh a newer session');
  assert.strictEqual(openPanelCalls, 0, 'stale track-switch timer must not reopen controls for a newer session');

  // Critical Tizen 4 edge: AUDIO switch starts from PAUSED, temporarily calls play(),
  // then the TV sends the app to background before the 120 ms re-pause timer fires.
  // Restore must honor the original PAUSED intent rather than continue playback.
  resetCounters();
  context.state.player = {token: 20, phase: 'playing', subtitleOff: true, restorePausedAfterTrackSwitch: false};
  context.state.seekBusy = false;
  context.state.lifecycleSuspended = false;
  context.state.pendingVisibility = false;
  context.state.postStartPending = null;
  documentState.hidden = false;
  avState = 'PAUSED';
  context.selectPlayerTrack('AUDIO', 4, null);
  assert.strictEqual(avState, 'PLAYING', 'audio switch temporarily resumes a paused player');
  assert.strictEqual(context.state.player.restorePausedAfterTrackSwitch, true, 'paused intent must be retained before backgrounding');

  documentState.hidden = true;
  context.handlePlayerVisibility();
  assert.strictEqual(context.state.lifecycleSuspended, true, 'temporary playing state must still suspend in background');
  const pendingTimers = timers.slice();
  pendingTimers.forEach(function(fn) { fn(); });
  assert.strictEqual(pauseCalls, 0, 're-pause timer must defer while lifecycle is suspended');
  assert.strictEqual(context.state.player.restorePausedAfterTrackSwitch, true, 'paused intent must survive suspended timers');

  documentState.hidden = false;
  context.handlePlayerVisibility();
  assert.strictEqual(restoreCalls, 1, 'backgrounded track switch must restore AVPlay once');
  assert.strictEqual(pauseCalls, 1, 'restore must return temporary AUDIO-switch playback to PAUSED');
  assert.strictEqual(avState, 'PAUSED', 'player must remain paused after lifecycle restore');
  assert.strictEqual(context.state.player.restorePausedAfterTrackSwitch, false, 'paused intent flag must clear after restoration');

  resetCounters();
  context.state.player = {token: 12, phase: 'playing', subtitleOff: true, restorePausedAfterTrackSwitch: false};
  context.state.seekBusy = false;
  context.state.lifecycleSuspended = true;
  avState = 'PLAYING';
  context.selectPlayerTrack('AUDIO', 3, null);
  assert.strictEqual(selectTrackCalls, 0, 'track changes must be blocked while lifecycle is suspended');

  assert(source.includes("if(document.hidden){handlePlayerVisibility();state.postStartPending={token:token,url:url};return}"), 'prepareAsync completion must suspend/defer post-start work when hidden');
  assert(source.includes('if(!state.player||state.player.token!==token)return;\n  var finished=false;'), 'restoreProgress must reject stale playback tokens before locking seek state');
  assert(source.includes('restorePausedTrackSwitch(p);'), 'lifecycle restore must enforce saved PAUSED intent');

  console.log('PASS: suspend/restore lifecycle state');
  console.log('PASS: lifecycle transition deferred across seek');
  console.log('PASS: stale audio-track timers isolated by player token');
  console.log('PASS: paused AUDIO switch survives background/restore');
  console.log('PASS: track changes blocked while suspended');
  console.log('PASS: hidden prepare completion defers post-start AVPlay work');
  console.log('HOME_CINEMA_LIFECYCLE_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
