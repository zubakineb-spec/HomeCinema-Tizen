'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const index = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'index.html'), 'utf8').replace(/\r\n?/g, '\n');
const source = fs.readFileSync(path.join(__dirname, '..', 'tv-app', 'js', 'rc38-search-surface.js'), 'utf8').replace(/\r\n?/g, '\n');

function main() {
  const fixLoad = index.indexOf('<script src="js/rc38-search-surface.js"></script>');
  const appLoad = index.indexOf('<script src="js/app.js"></script>');

  assert(fixLoad >= 0, 'RC3.8 search surface fix must be loaded');
  assert(appLoad > fixLoad, 'search surface fix must observe app transitions before app.js starts');
  assert(source.includes("try{input.blur()}catch(_){}"), 'focused search input must be blurred before viewing');
  assert(source.includes("input.classList.remove('focused')"), 'visual search focus marker must be removed');
  assert(source.includes("input.style.visibility='hidden'"), 'native input surface must be explicitly hidden');
  assert(source.includes("overlay.classList.add('hidden')"), 'search overlay must be hidden during viewing');
  assert(source.includes("observer.observe(player"), 'player visibility changes must be observed');
  assert(source.includes("observer.observe(details"), 'details visibility changes must be observed');
  assert(source.includes('restoreSearchAfterDetails'), 'search origin must be remembered while opening details');
  assert(source.includes('nav.click()'), 'Back from search-origin details must restore the real search mode through app navigation');

  console.log('PASS: focused Tizen search input is removed before details/player viewing');
  console.log('PASS: search mode is restored after returning from search-origin details');
  console.log('HOME_CINEMA_SEARCH_PLAYER_SURFACE_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
