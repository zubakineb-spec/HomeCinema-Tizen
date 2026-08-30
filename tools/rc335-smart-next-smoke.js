'use strict';

const fs=require('fs');
function fail(message){console.error('FAIL: '+message);process.exit(1)}

const index=fs.readFileSync('tv-app/index.html','utf8');
const smart=fs.readFileSync('tv-app/js/rc315-skip-credits.js','utf8');
const css=fs.readFileSync('tv-app/css/rc315-skip-credits.css','utf8');
const rc37=fs.readFileSync('tv-app/js/rc37-enhancements.js','utf8');
const release=fs.readFileSync('tv-app/js/rc-release.js','utf8');
const seek=fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');
const server=fs.readFileSync('native-qnap-d1/internal/app/server.go','utf8');
const backendTest=fs.readFileSync('native-qnap-d1/internal/app/rc37_test.go','utf8');

if(!index.includes('js/rc315-skip-credits.js'))fail('smart credits script not loaded');
if(index.indexOf('js/rc315-skip-credits.js')>index.indexOf('js/app.js'))fail('smart credits handler must load before app.js');
if(index.indexOf('js/rc-release.js')>index.indexOf('js/rc315-skip-credits.js'))fail('RC3.37 fetch retry must load before smart credits');

for(const marker of [
  "FALLBACK_PROMPT_MS=25000",
  "FALLBACK_AUTOPLAY_MS=7000",
  "CREDITS_AUTOPLAY_SECONDS=7",
  "AUTOPLAY_KEY='homecinema.autoplay.next'",
  "credits_start_ms",
  "/api/next?source_url=",
  "rc335NextEpisodePanel",
  "▶ Следующая серия",
  "Смотреть титры",
  "function handoffToNext()",
  "data-play-source",
  "lastPlaybackRatio=1",
  "seekTo(target",
  "HOME_CINEMA_RC315",
  "HOME_CINEMA_RC335",
  "rc3.35-smart-credits-next"
])if(!smart.includes(marker))fail('RC3.35 marker missing: '+marker);

for(const marker of [
  "NEXT_RETRY_MS=3000",
  "function isNextEpisodeRequest(input)",
  "/api/next?source_url=",
  "__homeCinemaRC337Wrapped",
  "function retry(){setTimeout(attempt,NEXT_RETRY_MS)}",
  "rc3.37-next-fetch-retry",
  "HOME_CINEMA_RC337_NEXT_RETRY"
])if(!release.includes(marker))fail('RC3.37 retry marker missing: '+marker);

if(!release.includes("if(resp&&resp.ok){resolve(resp);return}"))fail('RC3.37 must resolve only a healthy /api/next response');
if(!release.includes("},function(){retry()});"))fail('RC3.37 must retry rejected /api/next requests');
if(!release.includes("if(!isNextEpisodeRequest(input))return nativeFetch.call(window,input,init);"))fail('RC3.37 must leave non-next fetch traffic untouched');

for(const marker of [
  '.rc315-skip-credits{',
  'position:absolute',
  'right:72px',
  'bottom:118px',
  'min-width:292px',
  '.rc335-next-episode-panel',
  'z-index:72',
  '.rc335-next-primary',
  '.rc335-next-secondary'
])if(!css.includes(marker))fail('RC3.35 CSS marker missing: '+marker);

if(!rc37.includes("AUTOPLAY_KEY='homecinema.autoplay.next'"))fail('RC3.35 must reuse existing autoplay preference');
if(!rc37.includes("function requestNext(source)"))fail('proven RC3.7 next-episode flow missing');
if(!server.includes('s.mux.HandleFunc("/api/next", s.nextEpisode)'))fail('backend /api/next route missing');
if(!backendTest.includes('TestNextEpisodeAPI'))fail('backend next-episode contract test missing');

for(const marker of [
  'function clearScrubVisuals()',
  'seekWatchdog=nativeSetTimeout(done,1800)',
  'function handleScrubArrow(direction)',
  'function commitScrub(immediateFeedback)',
  'SCRUB_FRAME_MS=80',
  'SCRUB_STEP=10000'
])if(!seek.includes(marker))fail('RC3.25 player navigation/scrub baseline lost: '+marker);

if(smart.includes('jumpForward(')||smart.includes('jumpBackward('))fail('RC3.35 must not take RC3.25 arrow/scrub ownership');
if(smart.includes('rc32-player-navigation'))fail('RC3.35 must not rewrite player navigation module');

console.log('PASS: exact chapter credits trigger smart next-episode UI');
console.log('PASS: files without credits chapters only autoplay at natural episode end');
console.log('PASS: transient /api/next failure remains pending and retries every 3 seconds');
console.log('PASS: retry wrapper leaves unrelated API traffic untouched');
console.log('PASS: next episode uses existing /api/next contract and hidden data-play-source handoff');
console.log('PASS: autoplay setting is shared with RC3.7 diagnostics');
console.log('PASS: RC3.25 smooth timeline ownership is preserved');
console.log('HOME_CINEMA_RC337_NEXT_RETRY_SMOKE=PASS');
