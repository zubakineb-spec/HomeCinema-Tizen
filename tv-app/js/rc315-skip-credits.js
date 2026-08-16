(function(){
'use strict';

var dismissedSource='';
var lastSource='';
var pollTimer=null;

function $(selector,root){return (root||document).querySelector(selector)}
function trim(v){return String(v||'').replace(/^\s+|\s+$/g,'')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function runtime(){return window.HOME_CINEMA_RC37_RUNTIME||null}
function profiles(){return window.HOME_CINEMA_AUDIO_PROFILES||{}}
function playerVisible(){var p=$('#player');return !!p&&!p.classList.contains('hidden')}
function currentSource(){var r=runtime();return trim(r&&r.lastSource||'')}
function currentProfile(){var source=currentSource();return source?(profiles()[source]||null):null}
function isEpisodeSource(source){
  var r=runtime();if(!r||!source)return false;
  var meta=r.sourceMeta&&r.sourceMeta[source];
  if(meta&&meta.kind==='episode')return true;
  var hist=r.historyBySource&&r.historyBySource[source];
  return !!(hist&&hist.media_type==='episode');
}
function creditsStart(profile){return Number(profile&&profile.credits_start_ms||0)}
function button(){return $('#rc315SkipCredits')}
function hideButton(){var b=button();if(b)b.classList.add('hidden')}
function ensureUI(){
  var player=$('#player');if(!player||button())return;
  var b=document.createElement('button');
  b.id='rc315SkipCredits';
  b.className='rc315-skip-credits hidden';
  b.type='button';
  b.textContent='Пропустить титры';
  b.setAttribute('aria-label','Пропустить титры');
  player.appendChild(b);
  b.addEventListener('click',function(e){consume(e);skipCredits()});
}
function showButton(){
  var b=button();if(!b)return;
  if(b.classList.contains('hidden')){
    b.classList.remove('hidden');
    try{b.focus()}catch(_){}
  }
}
function avState(){try{return webapis.avplay.getState()}catch(_){return ''}}
function playbackTimes(){
  try{return {position:Number(webapis.avplay.getCurrentTime()||0),duration:Number(webapis.avplay.getDuration()||0)}}catch(_){return {position:0,duration:0}}
}
function skipCredits(){
  var source=currentSource(),r=runtime();
  if(!source||!r||typeof webapis==='undefined'||!webapis.avplay)return;
  var times=playbackTimes();
  if(times.duration<=1500)return;
  dismissedSource=source;
  hideButton();
  // RC3.7 already owns the next-episode overlay. Mark this playback complete,
  // then let the proven AVPlay onstreamcompleted -> stopPlayer -> requestNext flow run.
  r.lastPlaybackRatio=1;
  var target=Math.max(0,times.duration-500);
  try{
    webapis.avplay.seekTo(target,function(){r.lastPlaybackRatio=1},function(){r.lastPlaybackRatio=1});
  }catch(_){
    r.lastPlaybackRatio=1;
  }
}
function poll(){
  ensureUI();
  var source=currentSource();
  if(source!==lastSource){lastSource=source;dismissedSource='';hideButton()}
  if(!source||dismissedSource===source||!playerVisible()||!isEpisodeSource(source)){hideButton();return}
  if(typeof webapis==='undefined'||!webapis.avplay){hideButton();return}
  var state=avState();if(state!=='PLAYING'&&state!=='PAUSED'){hideButton();return}
  var profile=currentProfile(),marker=creditsStart(profile);if(marker<=0){hideButton();return}
  var times=playbackTimes();
  if(times.duration<=0||marker>=times.duration-1000){hideButton();return}
  if(times.position>=Math.max(0,marker-750)&&times.position<times.duration-700)showButton();else hideButton();
}

window.addEventListener('keydown',function(e){
  var b=button();if(!b||b.classList.contains('hidden'))return;
  var code=Number(e.keyCode||e.which||0);
  if(code===13){consume(e);skipCredits();return false}
  if(code===10009||code===27){consume(e);dismissedSource=currentSource();hideButton();return false}
},true);

document.addEventListener('DOMContentLoaded',function(){ensureUI()},false);
ensureUI();
pollTimer=window.setInterval(poll,250);
window.HOME_CINEMA_RC315={poll:poll,skipCredits:skipCredits,creditsStart:creditsStart};
})();
