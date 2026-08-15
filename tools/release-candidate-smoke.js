'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tv-app', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'tv-app', 'js', 'app.js'), 'utf8');
const rc = fs.readFileSync(path.join(root, 'tv-app', 'js', 'rc-release.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'tv-app', 'css', 'rc-release.css'), 'utf8');

assert(html.includes('data-view="about"'), 'About must be reachable from the top navigation');
assert(html.includes('id="aboutOverlay"'), 'About overlay must exist');
assert(html.includes('id="aboutBack"'), 'About overlay must have a remote-friendly Back action');
assert(html.includes('This product uses the TMDB API but is not endorsed or certified by TMDB.'), 'TMDB attribution notice must be present');
assert(/https:\/\/www\.themoviedb\.org\/assets\/.*\.svg/.test(html), 'About must use an official TMDB SVG asset URL');
assert(html.indexOf('js/rc-release.js') < html.indexOf('js/app.js'), 'RC capture handlers must load before app.js');
assert(html.includes('css/rc-release.css'), 'release styles must be loaded');

assert(rc.includes('code!==415&&code!==19'), 'dedicated MediaPlay and MediaPause keys must be handled');
assert(rc.includes("code===415&&state==='PAUSED'"), 'MediaPlay must resume only from PAUSED');
assert(rc.includes("code===19&&state==='PLAYING'"), 'MediaPause must pause only from PLAYING');
assert(rc.includes('code===10009||code===27||code===13'), 'About must close with Back/Escape/OK');
assert(rc.includes('stopImmediatePropagation'), 'About/media RC capture must prevent duplicate app handling');

assert(app.includes("if(state.mode==='details'){consume(e);closeDetails();return false}"), 'Back must close details');
assert(app.includes("if(state.mode==='search'){consume(e);closeSearch(true)"), 'Back must close search and restore home focus');
assert(app.includes("return ['detail-actions','seasons','episodes','extras'];"), 'series details rows must stay in remote focus order');
assert(app.includes("return ['search-input','search-results'];"), 'search input/results must stay in remote focus order');
assert(app.includes("if(code===37||code===412)"), 'left/MediaRewind must seek backward');
assert(app.includes("if(code===39||code===417)"), 'right/MediaFastForward must seek forward');
assert(css.includes('.about-overlay'), 'About overlay styles must exist');
assert(css.includes('.tmdb-logo'), 'TMDB logo must have explicit TV-safe sizing');

console.log('PASS: Smart Remote dedicated Play/Pause keys');
console.log('PASS: details/search/series focus contracts');
console.log('PASS: About/Credits remote flow');
console.log('PASS: TMDB attribution notice and official logo URL');
console.log('HOME_CINEMA_RELEASE_CANDIDATE_SMOKE=PASS');
