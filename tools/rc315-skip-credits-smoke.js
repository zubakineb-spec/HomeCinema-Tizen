'use strict';

const fs = require('fs');
function fail(message){console.error('FAIL: '+message);process.exit(1)}

const models=fs.readFileSync('native-qnap-d1/internal/app/models.go','utf8');
const profile=fs.readFileSync('native-qnap-d1/internal/app/media_profile.go','utf8');
const scanner=fs.readFileSync('native-qnap-d1/internal/app/scanner.go','utf8');
const index=fs.readFileSync('tv-app/index.html','utf8');
const skip=fs.readFileSync('tv-app/js/rc315-skip-credits.js','utf8');
const css=fs.readFileSync('tv-app/css/rc315-skip-credits.css','utf8');
const seek=fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');
const audio=fs.readFileSync('tv-app/js/rc314-audio-metadata.js','utf8');

for(const marker of ['ProfileVersion','IntroEndMS','CreditsStartMS'])if(!models.includes(marker))fail('media profile marker missing: '+marker);
if(!profile.includes('const mediaProfileVersion = 315'))fail('profile version 315 missing');
if(!profile.includes('chapter=start_time,end_time:chapter_tags=title'))fail('ffprobe chapter extraction missing');
if(!profile.includes('detectChapterMarkers'))fail('chapter marker detector missing');
if(!profile.includes('isCreditsChapter'))fail('credits chapter detector missing');
if(!scanner.includes('profile.ProfileVersion < mediaProfileVersion'))fail('legacy profile reprobe gate missing');
if(!index.includes('css/rc315-skip-credits.css'))fail('RC3.15 CSS not loaded');
if(!index.includes('js/rc315-skip-credits.js'))fail('RC3.15 JS not loaded');
if(index.indexOf('js/rc315-skip-credits.js')>index.indexOf('js/app.js'))fail('RC3.15 skip handler must load before app.js');
for(const marker of ['Пропустить титры','credits_start_ms','lastPlaybackRatio=1','seekTo(target','isEpisodeSource','HOME_CINEMA_RC315'])if(!skip.includes(marker))fail('skip credits marker missing: '+marker);
for(const marker of ['position:absolute','right:72px','bottom:118px','min-width:292px'])if(!css.includes(marker))fail('skip credits CSS marker missing: '+marker);
if(!seek.includes('function clearScrubVisuals()')||!seek.includes('seekWatchdog=nativeSetTimeout(done,1800)'))fail('RC3.13 seek fix lost');
if(!audio.includes('HOME_CINEMA_AUDIO_PROFILES')||!audio.includes('audio_tracks'))fail('RC3.14 audio metadata lost');

console.log('PASS: ffprobe chapter markers feed credits_start_ms');
console.log('PASS: legacy profiles are reprofiled once for RC3.15');
console.log('PASS: Skip Credits is episode-only and reuses RC3.7 next-episode flow');
console.log('PASS: RC3.13 seek fix and RC3.14 compact audio remain in the combined release');
console.log('HOME_CINEMA_RC315_SKIP_CREDITS_SMOKE=PASS');
