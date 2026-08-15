'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'tv-app', 'index.html'), 'utf8');
const app = fs.readFileSync(path.join(root, 'tv-app', 'js', 'app.js'), 'utf8');
const rc = fs.readFileSync(path.join(root, 'tv-app', 'js', 'rc-release.js'), 'utf8');
const selectionSync = fs.readFileSync(path.join(root, 'tv-app', 'js', 'rc3-selection-sync.js'), 'utf8');
const rc3 = fs.readFileSync(path.join(root, 'tv-app', 'js', 'rc3-fixes.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'tv-app', 'css', 'rc-release.css'), 'utf8');
const rc3css = fs.readFileSync(path.join(root, 'tv-app', 'css', 'rc3-fixes.css'), 'utf8');

assert(html.includes('data-view="about"'), 'About must be reachable from the top navigation');
assert(html.includes('id="aboutOverlay"'), 'About overlay must exist');
assert(html.includes('id="aboutBack"'), 'About overlay must have a remote-friendly Back action');
assert(html.includes('This product uses the TMDB API but is not endorsed or certified by TMDB.'), 'TMDB attribution notice must be present');
assert(/https:\/\/www\.themoviedb\.org\/assets\/.*\.svg/.test(html), 'About must use an official TMDB SVG asset URL');
assert(html.indexOf('js/rc-release.js') < html.indexOf('js/app.js'), 'RC capture handlers must load before app.js');
assert(html.indexOf('js/rc3-selection-sync.js') < html.indexOf('js/rc3-fixes.js'), 'hero selection sync must preempt older RC3 hero interception');
assert(html.indexOf('js/rc3-selection-sync.js') < html.indexOf('js/app.js'), 'hero selection sync must load before app.js');
assert(html.indexOf('js/rc3-fixes.js') < html.indexOf('js/app.js'), 'RC3 key/persistence hooks must load before app.js');
assert(html.includes('css/rc-release.css'), 'release styles must be loaded');
assert(html.includes('css/rc3-fixes.css'), 'RC3 layout styles must be loaded');
assert(html.includes('id="playerTimelineButton"'), 'player timeline must be remote-focusable');
assert(html.includes('data-player-timeline="1"'), 'player timeline must expose the seek focus contract');

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

assert(selectionSync.includes('heroSelection'), 'hero sync must keep an explicit selected type/id state');
assert(selectionSync.includes('selectionFromCard'), 'hero sync must derive selection from the focused media card');
assert(selectionSync.includes('data-card-type'), 'hero sync must retain media type together with ID');
assert(selectionSync.includes('data-id'), 'hero sync must retain the exact catalog ID');
assert(selectionSync.includes('stopImmediatePropagation'), 'hero sync must prevent stale app.js hero handlers from also running');
assert(selectionSync.includes('card.click()'), 'hero actions must route through the exact selected catalog card');

assert(rc3.includes('homecinema.playerPrefs.v1'), 'RC3 must persist player preferences');
assert(rc3.includes('setSilentSubtitle'), 'RC3 must restore subtitle preference through AVPlay');
assert(rc3.includes('rememberTrack'), 'RC3 must remember selected audio/text tracks');
assert(rc3.includes('pickFeatured'), 'RC3 must choose a deterministic featured hero instead of the first catalog movie');
assert(rc3.includes('episode-overview'), 'RC3 must render episode descriptions');
assert(rc3.includes('timelineSeek'), 'RC3 must seek when the progress track is focused');
assert(rc3.includes('stopImmediatePropagation'), 'RC3 timeline/hero capture must preempt conflicting app key handling');
assert(rc3css.includes('.hero{height:500px}'), 'RC3 hero must be reduced to keep shelves clear');
assert(rc3css.includes('.episode-overview'), 'RC3 episode description styles must exist');
assert(rc3css.includes('.progress.player-focusable.focused'), 'RC3 timeline focus must be visible');

console.log('PASS: Smart Remote dedicated Play/Pause keys');
console.log('PASS: details/search/series focus contracts');
console.log('PASS: About/Credits remote flow');
console.log('PASS: TMDB attribution notice and official logo URL');
console.log('PASS: RC3 hero selection is bound to exact media type/id');
console.log('PASS: RC3 featured hero and compact home layout');
console.log('PASS: RC3 episode descriptions');
console.log('PASS: RC3 player preference persistence and focused timeline seek');
console.log('HOME_CINEMA_RELEASE_CANDIDATE_SMOKE=PASS');
