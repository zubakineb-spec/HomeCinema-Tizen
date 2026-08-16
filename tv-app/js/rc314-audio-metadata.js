(function(){
'use strict';

var profiles={};
var currentSource='';
var nativeFetch=window.fetch;
var decorateTimer=null;

function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function trim(v){return String(v||'').replace(/^\s+|\s+$/g,'')}
function decode(v){try{return decodeURIComponent(String(v||'').replace(/\+/g,' '))}catch(_){return String(v||'')}}
function querySource(url){var m=String(url||'').match(/[?&]source_url=([^&#]+)/);return m?decode(m[1]):''}
function sourceKey(value){
  var v=trim(value);if(!v)return '';
  if(v.indexOf('/api/playback/smart')>=0){var inner=querySource(v);if(inner)return inner}
  return v;
}
function indexPayload(value,depth){
  if(depth>7||value===null||typeof value!=='object')return;
  if(Array.isArray(value)){for(var i=0;i<value.length;i++)indexPayload(value[i],depth+1);return}
  if(value.source_url&&value.media_profile){profiles[sourceKey(value.source_url)]=value.media_profile}
  var keys=Object.keys(value);
  for(var k=0;k<keys.length;k++)indexPayload(value[keys[k]],depth+1);
}
function shouldInspect(url){return /\/api\/(catalog|continue|history|next|movies\/|shows\/)/.test(String(url||''))}
function scheduleDecorate(){clearTimeout(decorateTimer);decorateTimer=setTimeout(decorateAudioMenu,30)}

if(typeof nativeFetch==='function'){
  window.fetch=function(input,init){
    var url=(typeof input==='string')?input:(input&&input.url)||'';
    var progressSource='';
    if(String(url).indexOf('/api/progress?')>=0)progressSource=querySource(url);
    if(progressSource){currentSource=sourceKey(progressSource);scheduleDecorate()}
    var response=nativeFetch.apply(window,arguments);
    if(!response||typeof response.then!=='function')return response;
    return response.then(function(r){
      try{
        if(shouldInspect(url)&&r&&typeof r.clone==='function'){
          r.clone().json().then(function(data){indexPayload(data,0);scheduleDecorate()}).catch(function(){});
        }
      }catch(_){}
      return r;
    });
  };
}

function codecLabel(value){
  var v=String(value||'').toLowerCase().replace(/[^a-z0-9]/g,'');
  if(v==='ac3')return 'AC3';
  if(v==='eac3'||v==='ec3'||v==='ddp')return 'E-AC3';
  if(v==='aac')return 'AAC';
  if(v==='dts'||v==='dca')return 'DTS';
  if(v==='truehd')return 'TrueHD';
  if(v==='flac')return 'FLAC';
  if(v==='mp3')return 'MP3';
  if(v==='opus')return 'Opus';
  return trim(value).toUpperCase();
}
function channelLabel(meta){
  var layout=String((meta&&meta.layout)||'').toLowerCase();
  if(layout.indexOf('7.1')>=0)return '7.1';
  if(layout.indexOf('5.1')>=0)return '5.1';
  if(layout==='stereo')return '2.0';
  if(layout==='mono')return '1.0';
  var n=Number(meta&&meta.channels||0);
  if(n===8)return '7.1';if(n===6)return '5.1';if(n===2)return '2.0';if(n===1)return '1.0';
  return n>0?String(n)+' ch':'';
}
function genericTrackTitle(value){
  var v=trim(value).toLowerCase().replace(/[._-]+/g,' ');
  return !v||v==='audio'||v==='аудио'||v==='rus'||v==='russian'||v==='русский'||v==='eng'||v==='english'||v==='английский'||/^track\s*\d+$/.test(v)||/^audio\s*\d+$/.test(v);
}
function attribution(meta){
  if(!meta)return '';
  if(trim(meta.studio))return trim(meta.studio);
  var title=trim(meta.title);
  if(genericTrackTitle(title))return '';
  if(title.length>30)title=title.substr(0,29)+'…';
  return title;
}
function avAudioTracks(){
  try{
    if(typeof webapis==='undefined'||!webapis.avplay)return [];
    return (webapis.avplay.getTotalTrackInfo()||[]).filter(function(x){return x.type==='AUDIO'});
  }catch(_){return []}
}
function avExtra(track){
  if(!track)return {};
  var x=track.extra_info;
  if(x&&typeof x==='object')return x;
  try{return JSON.parse(x||'{}')}catch(_){return {}}
}
function decorateAudioMenu(){
  var list=document.getElementById('playerSettingsList');
  var title=document.getElementById('playerSettingsTitle');
  if(!list||!title||trim(title.textContent)!=='Аудио')return;
  var profile=profiles[sourceKey(currentSource)]||null;
  var metadata=profile&&profile.audio_tracks||[];
  var options=Array.prototype.slice.call(list.querySelectorAll('.player-setting-option[data-track="AUDIO"]'));
  var avTracks=avAudioTracks();
  for(var i=0;i<options.length;i++){
    var option=options[i],main=option.querySelector('.setting-main'),sub=option.querySelector('.setting-meta');
    if(!main||!sub)continue;
    var meta=metadata[i]||{},avx=avExtra(avTracks[i]);
    var base=main.getAttribute('data-rc314-base');
    if(!base){base=trim(main.textContent);main.setAttribute('data-rc314-base',base)}
    var who=attribution(meta);
    main.textContent=base+(who?' — '+who:'');
    var details=[];
    if(trim(meta.translation))details.push(trim(meta.translation));
    var codec=codecLabel(meta.codec||avx.fourCC||'');if(codec)details.push(codec);
    var channels=channelLabel(meta);if(!channels&&avx.channels)channels=Number(avx.channels)===6?'5.1':(Number(avx.channels)===8?'7.1':(Number(avx.channels)===2?'2.0':String(avx.channels)+' ch'));
    if(channels)details.push(channels);
    if(details.length)sub.textContent=details.join(' · ');
  }
}

document.addEventListener('click',function(e){
  var play=closest(e.target,'[data-play-source]');
  if(play){currentSource=sourceKey(play.getAttribute('data-play-source'));scheduleDecorate()}
},true);

document.addEventListener('DOMContentLoaded',function(){
  var root=document.getElementById('playerSettingsList')||document.body;
  if(typeof MutationObserver!=='undefined'){
    new MutationObserver(function(){scheduleDecorate()}).observe(root,{childList:true,subtree:true});
  }
},false);

window.HOME_CINEMA_AUDIO_PROFILES=profiles;
window.HOME_CINEMA_AUDIO_DECORATE=decorateAudioMenu;
})();
