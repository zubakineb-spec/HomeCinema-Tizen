'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const css = [
  fs.readFileSync(path.join(root, 'tv-app', 'css', 'app.css'), 'utf8'),
  fs.readFileSync(path.join(root, 'tv-app', 'css', 'rc-release.css'), 'utf8')
].join('\n');
const js = [
  fs.readFileSync(path.join(root, 'tv-app', 'js', 'app.js'), 'utf8'),
  fs.readFileSync(path.join(root, 'tv-app', 'js', 'rc-release.js'), 'utf8')
].join('\n');
const html = fs.readFileSync(path.join(root, 'tv-app', 'index.html'), 'utf8');
const config = fs.readFileSync(path.join(root, 'tv-app', 'config.xml'), 'utf8');

const forbiddenCss = [
  [/display\s*:\s*grid/i, 'CSS Grid requires newer Chromium than Samsung 2018 M56'],
  [/grid-template-/i, 'CSS Grid template properties require newer Chromium'],
  [/(^|[;{\s])gap\s*:/i, 'flex/grid gap is not safe on Chromium 56'],
  [/aspect-ratio\s*:/i, 'aspect-ratio is not available on Chromium 56'],
  [/backdrop-filter\s*:/i, 'backdrop-filter is not available on Chromium 56']
];

forbiddenCss.forEach(function(rule) {
  assert(!rule[0].test(css), rule[1]);
});

const forbiddenJs = [
  [/\?\./, 'optional chaining is not available on Chromium 56'],
  [/\?\?/, 'nullish coalescing is not available on Chromium 56'],
  [/\.finally\s*\(/, 'Promise.finally is not available on Chromium 56'],
  [/\.flat\s*\(/, 'Array.flat is not available on Chromium 56'],
  [/\.flatMap\s*\(/, 'Array.flatMap is not available on Chromium 56'],
  [/Object\.fromEntries\s*\(/, 'Object.fromEntries is not available on Chromium 56'],
  [/\.replaceAll\s*\(/, 'String.replaceAll is not available on Chromium 56']
];

forbiddenJs.forEach(function(rule) {
  assert(!rule[0].test(js), rule[1]);
});

const webapis = html.indexOf('$WEBAPIS/webapis/webapis.js');
const shim = html.indexOf('js/browser-avplay-shim.js');
const rc = html.indexOf('js/rc-release.js');
const app = html.indexOf('js/app.js');
assert(webapis >= 0, 'Samsung webapis.js must be loaded');
assert(shim > webapis, 'browser shim must load after Samsung webapis.js');
assert(rc > shim, 'release RC layer must load after AVPlay shim');
assert(app > rc, 'application code must load after the RC capture layer');

assert(/required_version="2\.3"/.test(config), 'Tizen required_version must stay compatible with Tizen 4 target');
assert(/<tizen:profile name="tv-samsung"\s*\/>/.test(config), 'Samsung TV profile must remain declared');
assert(/width:1920px;height:1080px/.test(css), 'TV layout must retain the 1920x1080 application canvas');

console.log('PASS: no unsupported Chromium 56 CSS primitives');
console.log('PASS: no known post-M56 JavaScript syntax/APIs');
console.log('PASS: Samsung webapis/shim/RC/app load order');
console.log('PASS: Tizen manifest remains compatible with target TV');
console.log('PASS: 1920x1080 TV canvas retained');
console.log('HOME_CINEMA_TIZEN4_COMPAT=PASS');
