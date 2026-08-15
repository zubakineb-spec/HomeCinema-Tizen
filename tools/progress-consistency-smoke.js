'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.resolve(__dirname, '..');
const appPath = path.join(root, 'tv-app', 'js', 'app.js');
const source = fs.readFileSync(appPath, 'utf8').replace(/\r\n?/g, '\n');

function extract(start, end) {
  const a = source.indexOf(start);
  if (a < 0) throw new Error('SMOKE_START_NOT_FOUND: ' + start);
  const b = source.indexOf(end, a + start.length);
  if (b < 0) throw new Error('SMOKE_END_NOT_FOUND: ' + end);
  return source.slice(a, b);
}

const productionFunctions = [
  extract('function saveProgress(pos,dur,completed,player){', 'function formatPlayerTime(ms){'),
  extract('function stopPlayer(completed){', 'function syncToggleButton(){')
].join('\n');

let requests = [];
let resolvePost = null;
let continueCalls = 0;
let rebuildCalls = 0;
let closeCalls = 0;
let restoreCalls = 0;
let avCurrent = 0;
let avDuration = 0;

function deferredPost(url, opts) {
  requests.push({url: url, opts: opts});
  return new Promise(function(resolve) { resolvePost = resolve; });
}

const context = {
  console: console,
  Promise: Promise,
  JSON: JSON,
  Math: Math,
  Number: Number,
  String: String,
  API_BASE: '',
  state: {
    player: null,
    seekBusy: false,
    pendingStop: null,
    current: null,
    tracksOpen: false,
    playerMenuOpen: false,
    playerPanel: null,
    mode: 'player'
  },
  fetch: deferredPost,
  clearPlayerTimer: function() {},
  clearSaveTimer: function() {},
  closeAv: function() { closeCalls++; },
  restorePlayerScreen: function() { restoreCalls++; },
  loadContinue: function() { continueCalls++; return Promise.resolve(); },
  rebuildFocus: function() { rebuildCalls++; },
  $: function() { return null; },
  webapis: {
    avplay: {
      getCurrentTime: function() { return avCurrent; },
      getDuration: function() { return avDuration; }
    }
  }
};

vm.createContext(context);
vm.runInContext(productionFunctions, context, {filename: 'progress-consistency-extracted.js'});

async function flushAsyncChain() {
  await Promise.resolve();
  await Promise.resolve();
  await new Promise(function(resolve) { setImmediate(resolve); });
}

function reset() {
  requests = [];
  resolvePost = null;
  continueCalls = 0;
  rebuildCalls = 0;
  closeCalls = 0;
  restoreCalls = 0;
  context.state.seekBusy = false;
  context.state.pendingStop = null;
  context.state.current = null;
  context.state.mode = 'player';
}

async function main() {
  // AVPlay can report 0 during shutdown on older Tizen. stopPlayer must use the
  // latest observed progress snapshot and still mark >95% playback completed.
  reset();
  avCurrent = 0;
  avDuration = 0;
  context.state.player = {
    token: 31,
    url: 'media://almost-finished',
    phase: 'playing',
    lastPosition: 96000,
    lastDuration: 100000
  };

  context.stopPlayer(false);

  assert.strictEqual(requests.length, 1, 'stop must persist progress exactly once');
  const almostDone = JSON.parse(requests[0].opts.body);
  assert.strictEqual(almostDone.position_ms, 96000, 'stop must fall back to last observed position');
  assert.strictEqual(almostDone.duration_ms, 100000, 'stop must fall back to last observed duration');
  assert.strictEqual(almostDone.completed, true, '96% playback must remain completed on manual stop');
  assert.strictEqual(context.state.player, null, 'player state should close immediately');
  assert.strictEqual(continueCalls, 0, 'continue shelf must wait for progress POST');
  assert.strictEqual(rebuildCalls, 0, 'focus rebuild must wait for progress POST');

  resolvePost({ok: true});
  await flushAsyncChain();

  assert.strictEqual(continueCalls, 1, 'continue shelf must refresh after progress POST resolves');
  assert.strictEqual(rebuildCalls, 1, 'focus must rebuild after continue shelf refresh');

  // A normal mid-playback stop must not be promoted to completed.
  reset();
  avCurrent = 50000;
  avDuration = 100000;
  context.state.player = {
    token: 32,
    url: 'media://half-watched',
    phase: 'playing',
    lastPosition: 50000,
    lastDuration: 100000
  };

  context.stopPlayer(false);
  const halfDone = JSON.parse(requests[0].opts.body);
  assert.strictEqual(halfDone.completed, false, '50% playback must stay resumable');
  resolvePost({ok: true});
  await flushAsyncChain();

  assert.strictEqual(closeCalls, 1, 'AVPlay must close once per stop');
  assert.strictEqual(restoreCalls, 1, 'player screen must restore once per stop');

  console.log('PASS: 96% stop persists completed=true');
  console.log('PASS: AVPlay zero-time shutdown uses last progress snapshot');
  console.log('PASS: continue shelf refresh waits for progress POST');
  console.log('PASS: mid-playback stop remains resumable');
  console.log('HOME_CINEMA_PROGRESS_CONSISTENCY_SMOKE=PASS');
}

main().catch(function(err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
