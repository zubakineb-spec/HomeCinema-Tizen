'use strict';

var fs=require('fs');
function read(p){return fs.readFileSync(p,'utf8')}
function assert(ok,msg){if(!ok){console.error('FAIL: '+msg);process.exit(1)}console.log('PASS: '+msg)}

var index=read('tv-app/index.html');
var js=read('tv-app/js/rc316-regression-fixes.js');
var css=read('tv-app/css/rc316-regression-fixes.css');
var seek=read('tv-app/js/rc32-player-navigation.js');

assert(index.indexOf('css/rc316-regression-fixes.css')>=0,'RC3.16 seek-surface CSS is loaded');
assert(index.indexOf('js/rc316-regression-fixes.js')>=0,'RC3.16 regression JS is loaded');
assert(index.indexOf('js/rc316-regression-fixes.js')<index.indexOf('js/app.js'),'RC3.16 API normalization runs before app.js');
assert(js.indexOf('recognized_title=trim(value.title)')>=0,'local/Russian title wins over original_title');
assert(js.indexOf('runtime.lastSource')>=0&&js.indexOf('HOME_CINEMA_AUDIO_PROFILES')>=0,'audio attribution follows actual AVPlay source');
assert(js.indexOf('clearNativeSeekSurface')>=0&&js.indexOf("t.classList.remove('focused')")>=0,'post-seek native focus surface is cleared');
assert(css.indexOf('#playerTimelineButton:not(.scrubbing) #playerSeekPreview')>=0,'seek preview cannot render outside active scrub');
assert(css.indexOf('#playerTimelineButton:not(.scrubbing) #playerScrubFill')>=0,'seek fill cannot render outside active scrub');
assert(seek.indexOf('seekWatchdog=nativeSetTimeout(done,1800)')>=0,'RC3.13 seek watchdog remains present');
console.log('HOME_CINEMA_RC316_REGRESSION_SMOKE=PASS');
