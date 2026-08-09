(function(){
'use strict';

function $(s,root){return (root||document).querySelector(s)}
function browserMode(){return !(typeof webapis!=='undefined'&&webapis.avplay)}
function toast(msg){var t=$('#toast');if(!t)return;t.textContent=msg;t.classList.remove('hidden');setTimeout(function(){t.classList.add('hidden')},2400)}
function originalSource(video){return (video&&video.getAttribute('data-original-source'))||video.currentSrc||video.src||''}
function offsetMS(video){return Math.max(0,Number(video&&video.getAttribute('data-start-offset-ms')||0)||0)}
function absoluteMS(video){return offsetMS(video)+Math.max(0,Math.round((video.currentTime||0)*1000))}
function api(path){return fetch(path).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})}

var sidecar=null;
var selectedTrack=null;
var restartTimer=null;
var switching=false;

function hideUnsupportedAVPlayObject(){
  if(!browserMode())return;
  var av=$('#avplay');
  if(av){av.style.display='none';av.setAttribute('aria-hidden','true')}
}

function destroySidecar(unmute){
  if(restartTimer){clearTimeout(restartTimer);restartTimer=null}
  if(sidecar){
    try{sidecar.pause()}catch(_){}
    try{sidecar.removeAttribute('src');sidecar.load()}catch(_){}
    if(sidecar.parentNode)sidecar.parentNode.removeChild(sidecar);
    sidecar=null;
  }
  selectedTrack=null;
  switching=false;
  var v=$('#htmlVideo');
  if(v&&unmute)v.muted=false;
}

function labelTrack(t,i){
  var bits=[];
  if(t.language)bits.push(String(t.language).toUpperCase());
  if(t.title)bits.push(t.title);
  if(t.codec)bits.push(String(t.codec).toUpperCase());
  return bits.join(' • ')||('Дорожка '+(i+1));
}

function openPanel(tracks){
  var old=$('#webSidecarAudioPanel');if(old&&old.parentNode)old.parentNode.removeChild(old);
  var panel=document.createElement('div');
  panel.id='webSidecarAudioPanel';
  panel.className='web-audio-panel';
  var html='<div class="web-audio-title">Аудиодорожки</div>';
  html+='<button type="button" data-original-audio="1">Основная дорожка файла</button>';
  tracks.forEach(function(t,i){html+='<button type="button" data-sidecar-track="'+i+'">'+labelTrack(t,i)+'</button>'});
  html+='<button type="button" data-close="1">Закрыть</button>';
  panel.innerHTML=html;
  $('#player').appendChild(panel);
  panel.addEventListener('click',function(e){
    var b=e.target.closest?e.target.closest('button'):null;if(!b)return;
    if(b.getAttribute('data-close')){panel.parentNode.removeChild(panel);return}
    if(b.getAttribute('data-original-audio')){destroySidecar(true);panel.parentNode.removeChild(panel);toast('Основная аудиодорожка');return}
    var i=Number(b.getAttribute('data-sidecar-track'));
    if(isFinite(i)&&tracks[i])startSidecar(tracks[i],panel);
  });
}

function startSidecar(track,panel){
  var video=$('#htmlVideo');if(!video)return;
  var source=originalSource(video);if(!source){toast('Источник видео не определён');return}
  var wasPlaying=!video.paused;
  var start=absoluteMS(video);
  switching=true;
  if(wasPlaying){try{video.pause()}catch(_){}}
  if(sidecar){try{sidecar.pause();sidecar.removeAttribute('src');sidecar.load()}catch(_){};if(sidecar.parentNode)sidecar.parentNode.removeChild(sidecar)}
  selectedTrack=track;
  sidecar=document.createElement('audio');
  sidecar.id='webAltAudio';
  sidecar.preload='auto';
  sidecar.setAttribute('data-source',source);
  sidecar.setAttribute('data-stream-index',String(track.stream_index));
  sidecar.setAttribute('data-start-ms',String(start));
  sidecar.style.display='none';
  sidecar.src='/api/playback/audio?source_url='+encodeURIComponent(source)+'&stream_index='+encodeURIComponent(track.stream_index)+'&start_ms='+encodeURIComponent(start);
  document.body.appendChild(sidecar);

  var failed=false;
  function fail(){
    if(failed)return;failed=true;
    destroySidecar(true);
    if(wasPlaying){try{video.play()}catch(_){}}
    toast('Выбранную аудиодорожку браузер воспроизвести не смог');
  }
  sidecar.addEventListener('error',fail,{once:true});

  if(wasPlaying){
    var p;
    try{p=sidecar.play()}catch(_){fail();return}
    if(p&&p.then){
      p.then(function(){video.muted=true;switching=false;try{video.play()}catch(_){};toast('Аудиодорожка: '+labelTrack(track,0))}).catch(fail);
    }else{
      video.muted=true;switching=false;try{video.play()}catch(_){};toast('Аудиодорожка: '+labelTrack(track,0));
    }
  }else{
    video.muted=true;switching=false;toast('Аудиодорожка выбрана');
  }
  if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);
}

function restartAtCurrentPosition(){
  if(!selectedTrack||switching)return;
  if(restartTimer)clearTimeout(restartTimer);
  restartTimer=setTimeout(function(){
    restartTimer=null;
    var t=selectedTrack;
    startSidecar(t,null);
  },180);
}

function loadTracks(){
  var video=$('#htmlVideo');if(!video)return;
  var source=originalSource(video);if(!source){toast('Источник видео не определён');return}
  api('/api/playback/tracks?source_url='+encodeURIComponent(source)).then(function(x){
    var tracks=(x&&x.audio)||[];
    if(!tracks.length){toast('Аудиодорожки не обнаружены');return}
    openPanel(tracks);
  }).catch(function(){toast('Не удалось получить аудиодорожки')});
}

function wireVideo(){
  if(!browserMode())return;
  var video=$('#htmlVideo');if(!video||video.getAttribute('data-sidecar-wired')==='1')return;
  video.setAttribute('data-sidecar-wired','1');
  video.addEventListener('pause',function(){if(sidecar&&!switching){try{sidecar.pause()}catch(_){}}});
  video.addEventListener('play',function(){if(sidecar&&!switching&&sidecar.paused){var p;try{p=sidecar.play()}catch(_){return}if(p&&p.catch)p.catch(function(){})}});
  video.addEventListener('seeked',function(){if(sidecar&&selectedTrack)restartAtCurrentPosition()});
  video.addEventListener('ended',function(){destroySidecar(true)});
  video.addEventListener('emptied',function(){if(!video.src)destroySidecar(true)});
}

function interceptControls(e){
  if(!browserMode())return;
  var b=e.target&&e.target.closest?e.target.closest('[data-web-action]'):null;if(!b)return;
  var action=b.getAttribute('data-web-action');
  if(action==='audio'){
    e.preventDefault();
    e.stopImmediatePropagation();
    loadTracks();
    return;
  }
  if(action==='back')destroySidecar(true);
}

function init(){
  if(!browserMode())return;
  hideUnsupportedAVPlayObject();
  wireVideo();
  document.addEventListener('click',interceptControls,true);
  var obs=new MutationObserver(function(){hideUnsupportedAVPlayObject();wireVideo()});
  obs.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});
}

if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',init);else init();
})();
