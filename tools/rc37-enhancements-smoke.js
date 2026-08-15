'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const js = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'js', 'rc37-enhancements.js'), 'utf8').replace(/\r\n?/g, '\n');
const config = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'js', 'config.js'), 'utf8').replace(/\r\n?/g, '\n');
const html = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');

function main() {
  assert(html.includes('js/rc37-enhancements.js'), 'RC3.7 enhancement layer must be loaded');
  assert(html.includes('css/rc37-enhancements.css'), 'RC3.7 enhancement styles must be loaded');
  assert(js.includes("'/api/diagnostics'"), 'diagnostics API must be exposed in TV UI');
  assert(js.includes("'/api/history'"), 'history API must be used');
  assert(js.includes("'/api/next?source_url='"), 'next episode API must be used');
  assert(js.includes("'/api/image?url='"), 'TMDB artwork must route through NAS cache');
  assert(js.includes("var PROGRESS_QUEUE='homecinema.progress.queue'"), 'offline progress queue must exist');
  assert(js.includes("var FAVORITES_KEY='homecinema.favorites'"), 'favorites persistence must exist');
  assert(js.includes('function markOffline(){'), 'offline state handling must exist');
  assert(js.includes('function flushProgressQueue(){'), 'queued progress must recover after reconnect');
  assert(js.includes('data-rc37-start-over'), 'start-over control must exist');
  assert(js.includes('data-rc37-view=') || js.includes("setAttribute('data-rc37-view'"), 'history/favorites custom navigation must exist');
  assert(js.includes('function applyTrackPreferences(){'), 'series track preferences must be restored');
  assert(js.includes('function cycleSubtitleSize(){'), 'subtitle size control must exist');
  assert(config.includes("STORAGE_KEY='homecinema.api.base'"), 'NAS endpoint must persist');
  assert(config.includes('MiniResponse.prototype.json'), 'Tizen 4 cached JSON response fallback must exist');

  console.log('PASS: offline cache, reconnect and progress queue are present');
  console.log('PASS: diagnostics, history, favorites, filters and next-episode UX are present');
  console.log('PASS: track preferences and subtitle sizing are present');
  console.log('HOME_CINEMA_RC37_ENHANCEMENTS_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
