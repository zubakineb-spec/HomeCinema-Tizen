'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

function read(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8').replace(/\r\n?/g, '\n');
}

function main() {
  const html = read('tv-app/index.html');
  const css = read('tv-app/css/rc39-cinematic-ui.css');
  const js = read('tv-app/js/rc39-cinematic-ui.js');

  assert(html.includes('css/rc39-cinematic-ui.css'), 'cinematic stylesheet must be loaded');
  assert(html.includes('js/rc39-cinematic-ui.js'), 'cinematic JS layer must be loaded');
  assert(css.includes('height:720px'), 'hero must use the large cinematic canvas');
  assert(css.includes('width:420px'), 'media cards must use wide 16:9 geometry');
  assert(css.includes('height:236px'), 'wide cards must preserve the 16:9 target height');
  assert(css.includes('.cin-card-rating'), 'cards must expose the green rating badge');
  assert(css.includes('box-shadow:0 0 0 5px #fff'), 'focused cards must have a white selection frame');
  assert(js.includes("item.backdrop_url||item.poster_url"), 'catalog cards must prefer landscape backdrops');
  assert(js.includes("window.HOME_CINEMA_RC='rc3.9-cinematic-ui'"), 'diagnostics must identify RC3.9 UI');
  assert(js.includes('Сериалы на основе вашей медиатеки'), 'home shelf naming must use the cinematic recommendation copy');
  assert(js.includes('MutationObserver'), 'dynamic catalog/hero changes must stay decorated');

  console.log('PASS: full-bleed cinematic hero layer is loaded');
  console.log('PASS: catalog uses 420x236 landscape cards with white focus frame');
  console.log('PASS: ratings and landscape backdrops are decorated dynamically');
  console.log('HOME_CINEMA_CINEMATIC_UI_SMOKE=PASS');
}

try {
  main();
} catch (err) {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
}
