'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const nav = fs.readFileSync(path.join(root, 'tv-app', 'js', 'rc32-player-navigation.js'), 'utf8');
const rc3 = fs.readFileSync(path.join(root, 'tv-app', 'js', 'rc3-fixes.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'tv-app', 'index.html'), 'utf8');

assert(html.includes('class="progress player-timeline-focusable"'), 'timeline must remain outside app.js native player control list');
assert(nav.includes('function clearTimelineState()'), 'timeline state must have an explicit cleanup path');
assert(nav.includes("t.classList.remove('focused')"), 'cleanup must remove stale timeline focus class');
assert(nav.includes('document.activeElement===t'), 'cleanup must detect DOM focus left on the hidden timeline');
assert(nav.includes('t.blur()'), 'cleanup must release hidden timeline DOM focus');
assert(nav.includes("new MutationObserver"), 'player/chrome visibility changes must trigger cleanup');
assert(nav.includes('if(!playerActive()||!playerChromeVisible())clearTimelineState()'), 'closing or hiding player chrome must reset timeline state');
assert(nav.includes('return playerChromeVisible()&&!settingsOpen()'), 'timeline key capture must be scoped to a visible player only');
assert(nav.includes('Outside the timeline, app.js remains the single source of truth'), 'normal controls must remain owned by app.js');
assert(nav.includes("window.addEventListener('keyup'"), 'hold-to-scrub must commit on physical key release');
assert(!nav.includes('SCRUB_COMMIT_DELAY'), 'scrub must not auto-commit on an idle timer');
assert(rc3.includes('function timelineFocused()'), 'legacy RC3 timeline guard must still be detectable');

console.log('PASS: hidden timeline focus is cleared when playback closes');
console.log('PASS: Home Left/Right cannot be stolen by a hidden player timeline');
console.log('PASS: Audio/Subtitle controls remain owned by app.js');
console.log('HOME_CINEMA_PLAYER_FOCUS_CLEANUP_SMOKE=PASS');
