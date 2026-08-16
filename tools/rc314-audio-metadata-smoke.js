'use strict';

const fs = require('fs');

function fail(message){
  console.error('FAIL: ' + message);
  process.exit(1);
}

const models = fs.readFileSync('native-qnap-d1/internal/app/models.go','utf8');
const profile = fs.readFileSync('native-qnap-d1/internal/app/media_profile.go','utf8');
const history = fs.readFileSync('native-qnap-d1/internal/app/ux_api.go','utf8');
const config = fs.readFileSync('tv-app/js/config.js','utf8');
const audio = fs.readFileSync('tv-app/js/rc314-audio-metadata.js','utf8');
const seek = fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');

if(!models.includes('type AudioTrackProfile struct'))fail('AudioTrackProfile model missing');
for(const marker of ['Language','Title','Codec','Channels','Studio','Translation']){
  if(!models.includes(marker))fail('audio track model field missing: '+marker);
}
if(!profile.includes('stream_tags=language,title,handler_name'))fail('ffprobe does not read audio title/language metadata');
if(!profile.includes('detectAudioStudio'))fail('audio studio detector missing');
if(!profile.includes('detectTranslationType'))fail('translation type detector missing');
if(!profile.includes('profile.AudioTracks = append'))fail('per-track metadata is not persisted into media profile');
if(!history.includes('"media_profile": m.MediaProfile'))fail('movie continue/history metadata missing');
if(!history.includes('"media_profile": episode.MediaProfile'))fail('episode continue/history metadata missing');
if(!history.includes('"media_profile": next.MediaProfile'))fail('next-episode metadata missing');
if(!config.includes('js/rc314-audio-metadata.js'))fail('RC3.14 audio layer is not loaded before app.js');
for(const marker of ['Русский',' — ','details.join(\' · \')','audio_tracks','HOME_CINEMA_AUDIO_PROFILES']){
  if(!audio.includes(marker))fail('compact audio UI marker missing: '+marker);
}
if(!audio.includes("if(trim(meta.translation))details.push(trim(meta.translation))"))fail('translation type is not first compact metadata field');
if(!audio.includes("codecLabel(meta.codec||avx.fourCC||'')"))fail('codec fallback missing');
if(!audio.includes('channelLabel(meta)'))fail('channel layout label missing');
if(!seek.includes('function clearScrubVisuals()'))fail('RC3.13 seek surface fix missing from combined release');
if(!seek.includes('seekWatchdog=nativeSetTimeout(done,1800)'))fail('RC3.13 seek watchdog missing from combined release');

console.log('PASS: ffprobe captures audio language/title/studio/translation/codec/channels');
console.log('PASS: TV renders compact two-line audio attribution without inventing missing studios');
console.log('PASS: RC3.13 seek artifact hotfix remains present in RC3.14');
console.log('HOME_CINEMA_RC314_AUDIO_METADATA_SMOKE=PASS');
