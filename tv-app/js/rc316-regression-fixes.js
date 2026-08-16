(function(){
'use strict';

var nativeFetch=window.fetch;
var lastScrubbing=false;
var cleanupTimer=null;

function $(selector,root){return (root||document).querySelector(selector)}
function trim(v){return String(v||'').replace(/^\s+|\s+$/g,'')}
function sourceKey(value){
  var v=trim(value);if(!v)return '';
  if(v.indexOf('/api/playback/smart')>=0){
    var m=v.match(/[?&]source_url=([^&#]+)/);
    if(m){try{return decodeURIComponent(m[1].replace(/\+/g,' '))}catch(_){return m[1]}}
  }
  return v;
}
function shouldNormalize(url){return /\/api\/(catalog|search|continue|history|next|movies\/|shows\/)/.test(String(url||''))}
function normalizeTitles(value,depth){
  if(depth>8||value===null||typeof value!=='object')return value;
  if(Array.isArray(value)){for(var i=0;i<value.length;i++)normalizeTitles(value[i],depth+1);return value}
  if(value.title&&!trim(value.recognized_title))value.recognized_title=trim(value.title);
  var keys=Object.keys(value);for(var k=0;k<keys.length;k++)normalizeTitles(value[keys[k]],depth+1);
  return value;
}

/* RC3.16: app.js historically prefers recognized_title before original_title.
 * Normalize API payloads so a local/Russian display title never loses to the
 * English TMDB original title. */
if(typeof nativeFetch==='function'){
  window.fetch=function(input,init){
    var url=(typeof input==='string')?input:(input&&input.url)||'';
    var p=nativeFetch.apply(window,arguments);
    if(!p||typeof p.then!=='function'||!shouldNormalize(url))return p;
    return p.then(function(r){
      try{
        if(r&&typeof r.json==='function'){
          var nativeJson=r.json.bind(r);
          r.json=function(){return nativeJson().then(function(data){return normalizeTitles(data,0)})};
        }
      }catch(_){}
      return r;
    });
  };
}

function codecLabel(v){
  v=trim(v).toLowerCase().replace(/[^a-z0-9]/g,'');
  if(v==='ac3')return 'AC3';if(v==='eac3'||v==='ec3'||v==='ddp')return 'E-AC3';
  if(v==='aac')return 'AAC';if(v==='dts'||v==='dca')return 'DTS';if(v==='truehd')return 'TrueHD';
  if(v==='flac')return 'FLAC';if(v==='mp3')return 'MP3';if(v==='opus')return 'Opus';return trim(v).toUpperCase();
}
function channelLabel(meta){
  var layout=trim(meta&&meta.layout).toLowerCase();
  if(layout.indexOf('7.1')>=0)return '7.1';if(layout.indexOf('5.1')>=0)return '5.1';
  if(layout==='stereo')return '2.0';if(layout==='mono')return '1.0';
  var n=Number(meta&&meta.channels||0);if(n===8)return '7.1';if(n===6)return '5.1';if(n===2)return '2.0';if(n===1)return '1.0';
  return n>0?String(n)+' ch':'';
}
function genericTitle(v){
  v=trim(v).toLowerCase().replace(/[._-]+/g,' ');
  return !v||v==='audio'||v==='аудио'||v==='rus'||v==='russian'||v==='русский'||v==='eng'||v==='english'||v==='английский'||/^track\s*\d+$/.test(v)||/^audio\s*\d+$/.test(v);
}
function decorateAudio(){
  var list=$('#playerSettingsList'),title=$('#playerSettingsTitle');
  if(!list||!title||trim(title.textContent)!=='Аудио')return;
  var runtime=window.HOME_CINEMA_RC37_RUNTIME||{};
  var source=sourceKey(runtime.lastSource||'');
  var profiles=window.HOME_CINEMA_AUDIO_PROFILES||{};
  var profile=profiles[source]||null,metadata=profile&&profile.audio_tracks||[];
  if(!metadata.length)return;
  var options=Array.prototype.slice.call(list.querySelectorAll('.player-setting-option[data-track="AUDIO"]'));
  for(var i=0;i<options.length;i++){
    var option=options[i],main=$('.setting-main',option),sub=$('.setting-meta',option),meta=metadata[i]||{};
    if(!main||!sub)continue;
    var base=main.getAttribute('data-rc316-base')||main.getAttribute('data-rc314-base')||trim(main.textContent).split(' — ')[0];
    main.setAttribute('data-rc316-base',base);
    var who=trim(meta.studio);if(!who&&!genericTitle(meta.title))who=trim(meta.title);
    main.textContent=base+(who?' — '+who:'');
    var details=[];if(trim(meta.translation))details.push(trim(meta.translation));
    var codec=codecLabel(meta.codec);if(codec)details.push(codec);
    var channels=channelLabel(meta);if(channels)details.push(channels);
    if(details.length)sub.textContent=details.join(' · ');
  }
}

function clearNativeSeekSurface(){
  var t=$('#playerTimelineButton');if(!t)return;
  var fill=$('#playerScrubFill',t),preview=$('#playerSeekPreview',t);
  t.classList.remove('scrubbing');
  if(fill){fill.style.width='0%';fill.style.opacity='0'}
  if(preview){preview.style.display='none';preview.style.visibility='hidden';preview.style.opacity='0';preview.textContent='';preview.style.left='0%'}
  t.classList.remove('focused');
  try{if(document.activeElement===t&&t.blur)t.blur()}catch(_){}
  try{if(document.body&&document.body.focus)document.body.focus()}catch(_){}
}
function watchSeekSurface(){
  var t=$('#playerTimelineButton');if(!t)return;
  lastScrubbing=t.classList.contains('scrubbing');
  if(typeof MutationObserver!=='undefined'){
    new MutationObserver(function(){
      var now=t.classList.contains('scrubbing');
      if(lastScrubbing&&!now){
        clearTimeout(cleanupTimer);
        cleanupTimer=setTimeout(clearNativeSeekSurface,60);
        setTimeout(clearNativeSeekSurface,450);
      }
      lastScrubbing=now;
    }).observe(t,{attributes:true,attributeFilter:['class']});
  }
}

function tick(){decorateAudio()}
document.addEventListener('DOMContentLoaded',function(){watchSeekSurface();setInterval(tick,250)},false);
if(document.readyState!=='loading'){watchSeekSurface();setInterval(tick,250)}
window.HOME_CINEMA_RC316={normalizeTitles:normalizeTitles,decorateAudio:decorateAudio,clearNativeSeekSurface:clearNativeSeekSurface};
})();
