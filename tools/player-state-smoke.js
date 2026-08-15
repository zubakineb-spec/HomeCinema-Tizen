'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'tv-app', 'js', 'app.js');
const shimPath = path.join(root, 'tv-app', 'js', 'browser-avplay-shim.js');
const source = fs.readFileSync(appPath, 'utf8').replace(/\r\n?/g, '\n');
const shim = fs.readFileSync(shimPath, 'utf8').replace(/\r\n?/g, '\n');

function extract(start, end) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error('SMOKE_START_NOT_FOUND: ' + start);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error('SMOKE_END_NOT_FOUND: ' + end);
  return source.slice(a, b);
}

const playerFunctions = [
  extract('function restoreProgress(', 'function saveProgress('),
  extract('function updateProgress(pos,dur){', 'function stopPlayer(completed){'),
  extract('function playerToggle(){', 'function seek(delta'),
  extract('function seek(delta', 'function parseExtra(v){'),
  extract('function registerKeys(){', 'function key(e){')
].join('\n');

const nodes = Object.create(null);
function node(selector) {
  if (!nodes[selector]) nodes[selector] = {style: {}, textContent: ''};
  return nodes[selector];
}

let timers = [];
let saves = [];
let menuCalls = 0;
let toggleSyncCalls = 0;
let stopCalls = [];
let avState = 'PLAYING';
let forwardCalls = [];
let backwardCalls = [];
let apiResult = {position_ms: 0, completed: 0};
let batchKeys = null;

const context = {
  console,
  Promise,
  Math,
  Number,
  String,
  Object,
  Array,
  JSON,
  state: {
    player: {token: 1, url: 'media://one', phase: 'playing', lastPosition: 0, lastDuration: 0},
    saveTimer: null,
    seekBusy: false,
    pendingStop: null
  },
  $: node,
  setTimeout(fn) { timers.push(fn); return timers.length; },
  clearTimeout() {},
  saveProgress(pos, dur, completed, player) { saves.push({pos, dur, completed, player}); },
  syncToggleButton() { toggleSyncCalls++; },
  showPlayerMenu() { menuCalls++; },
  stopPlayer(completed) { stopCalls.push(!!completed); },
  api() { return Promise.resolve(apiResult); },
  webapis: {
    avplay: {
      getState() { return avState; },
      pause() { avState = 'PAUSED'; },
      play() { avState = 'PLAYING'; },
      jumpForward(ms, ok, fail) { forwardCalls.push({ms, ok, fail}); },
      jumpBackward(ms, ok, fail) { backwardCalls.push({ms, ok, fail}); }
    }
  },
  tizen: {
    tvinputdevice: {
      getSupportedKeys() {
        return [
          {name: 'MediaPlayPause', code: 10252},
          {name: 'MediaStop', code: 413},
          {name: 'VolumeUp', code: 447}
        ];
      },
      registerKeyBatch(keys, ok) {
        batchKeys = Array.prototype.slice.call(keys);
        if (ok) ok();
      },
      registerKey() {}
    }
  }
};

vm.createContext(context);
vm.runInContext(playerFunctions, context, {filename: 'player-smoke-extracted.js'});

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
}

async function main() {
  // 1. Autosave must persist the latest observed position, not the value captured
  // when the five-second timer was created.
  timers = [];
  saves = [];
  context.state.player = {token: 7, url: 'media://progress', phase: 'playing', lastPosition: 0, lastDuration: 0};
  context.state.saveTimer = null;
  context.updateProgress(1000, 100000);
  context.updateProgress(7000, 100000);
  assert.strictEqual(timers.length, 1, 'only one autosave timer should be pending');
  timers[0]();
  assert.strictEqual(saves.length, 1, 'autosave should write once');
  assert.strictEqual(saves[0].pos, 7000, 'autosave must use latest position');
  assert.strictEqual(saves[0].dur, 100000, 'autosave must use latest duration');
  assert.strictEqual(saves[0].completed, false, '7% must not be marked completed');

  // 2. Pause/resume must toggle the AVPlay state and refresh the chrome.
  avState = 'PLAYING';
  menuCalls = 0;
  toggleSyncCalls = 0;
  context.state.player = {token: 8, url: 'media://toggle', phase: 'playing'};
  context.state.seekBusy = false;
  context.playerToggle();
  assert.strictEqual(avState, 'PAUSED', 'first toggle should pause');
  context.playerToggle();
  assert.strictEqual(avState, 'PLAYING', 'second toggle should resume');
  assert.strictEqual(toggleSyncCalls, 2, 'toggle UI must be refreshed twice');
  assert.strictEqual(menuCalls, 2, 'player menu must remain visible after toggle');

  // 3. jumpForward/jumpBackward must be serialized until the Samsung callback.
  forwardCalls = [];
  backwardCalls = [];
  stopCalls = [];
  context.state.player = {token: 9, url: 'media://seek', phase: 'playing'};
  context.state.seekBusy = false;
  context.state.pendingStop = null;
  let seekDone = false;
  context.seek(10000, function(ok) { seekDone = ok; });
  assert.strictEqual(context.state.seekBusy, true, 'seek must lock AVPlay API usage');
  assert.strictEqual(forwardCalls.length, 1, 'forward seek should be issued once');
  context.seek(10000, function() {});
  assert.strictEqual(forwardCalls.length, 1, 'second seek while busy must be ignored');
  forwardCalls[0].ok();
  assert.strictEqual(context.state.seekBusy, false, 'seek callback must release lock');
  assert.strictEqual(seekDone, true, 'seek completion callback must run');

  context.seek(-10000, function() {});
  assert.strictEqual(backwardCalls.length, 1, 'backward seek should be issued once');
  context.state.pendingStop = {completed: true};
  backwardCalls[0].ok();
  assert.deepStrictEqual(stopCalls, [true], 'stop requested during seek must run after callback');

  // 4. Restoring progress must not report completion until seekTo callback fires.
  apiResult = {position_ms: 32000, completed: 0};
  context.state.player = {token: 22, url: 'media://resume', phase: 'playing'};
  context.state.seekBusy = false;
  let restoreResult = null;
  let restoreSeek = null;
  const restorePlayer = {
    seekTo(ms, ok, fail) { restoreSeek = {ms, ok, fail}; }
  };
  context.restoreProgress('media://resume', restorePlayer, 22, function(ok) { restoreResult = ok; });
  await flushPromises();
  assert(restoreSeek, 'restore should call seekTo for positions over 15 seconds');
  assert.strictEqual(restoreSeek.ms, 32000, 'restore should seek to saved position');
  assert.strictEqual(context.state.seekBusy, true, 'restore seek must lock AVPlay API usage');
  assert.strictEqual(restoreResult, null, 'restore callback must wait for seekTo callback');
  restoreSeek.ok();
  assert.strictEqual(context.state.seekBusy, false, 'restore seek callback must release lock');
  assert.strictEqual(restoreResult, true, 'restore completion must propagate success');

  // 5. Media key batch must contain only keys actually supported by the TV.
  batchKeys = null;
  context.registerKeys();
  assert.deepStrictEqual(batchKeys, ['MediaPlayPause', 'MediaStop'], 'unsupported media keys must be filtered out');

  // 6. Browser shim must never replace native Tizen APIs and must emulate the
  // asynchronous seek callbacks used by the production player state machine.
  assert(shim.includes("if(typeof window.tizen!=='undefined')return;"), 'browser shim must exit on native Tizen');
  assert(shim.includes('seekTo:function(ms,onSuccess,onError)'), 'browser shim seekTo must expose callbacks');
  assert(shim.includes('jumpForward:function(ms,onSuccess,onError)'), 'browser shim jumpForward must expose callbacks');
  assert(shim.includes('jumpBackward:function(ms,onSuccess,onError)'), 'browser shim jumpBackward must expose callbacks');

  console.log('PASS: latest-position autosave');
  console.log('PASS: pause/resume state transition');
  console.log('PASS: serialized forward/backward seek');
  console.log('PASS: async restore progress seek');
  console.log('PASS: supported media-key filtering');
  console.log('PASS: browser AVPlay shim contract');
  console.log('HOME_CINEMA_PLAYER_SMOKE=PASS');
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
