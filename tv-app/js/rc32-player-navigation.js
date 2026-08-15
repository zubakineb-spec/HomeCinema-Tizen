(function(){
'use strict';

var lastControl=null;
var scrubActive=false;
var scrubTarget=0;
var scrubDuration=0;
var scrubOrigin=0;
var scrubWasPlaying=false;
var seekInFlight=false;
var seekToken=0;
var pendingAfterSeek=null;
var SCRUB_STEP=10000;
/* SCRUB_COMMIT_DELAY is intentionally disabled in RC3.4: scrubbing commits only on OK or Down. */

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function visible(el){return !!el&&!closest(el,'.hidden')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function timeline(){return $('#playerTimelineButton')}
function playerActive(){var p=$('#player');return !!p&&!p.classList.contains('hidden')}
function playerChromeVisible(){var c=$('#playerChrome');return playerActive()&&!!c&&!c.classList.contains('hidden')}
function settingsOpen(){var s=$('#playerSettings');return !!s&&!s.classList.contains('hidden')}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function formatTime(ms){
  var sec=Math.max(0,Math.floor(Number(ms||0)/1000));
  var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;
  function z(n){return n<10?'0'+n:String(n)}
  return h>0?(h+':'+z(m)+':'+z(s)):(z(m)+':'+z(s));
}
function av(){return (typeof webapis!=='undefined'&&webapis.avplay)?webapis.avplay:null}
function playbackReady(){
  var p=av();if(!p)return false;
  try{var st=p.getState();return st==='PLAYING'||st==='PAUSED'}catch(_){return false}
}
function setHint(text){var hint=$('.player-hint');if(hint)hint.textContent=text}
function ensureScrubUi(){
  var t=timeline();if(!t)return null;
  var fill=$('#playerScrubFill',t),preview=$('#playerSeekPreview',t);
  if(!fill){fill=document.createElement('div');fill.id='playerScrubFill';fill.className='player-scrub-fill';t.appendChild(fill)}
  if(!preview){preview=document.createElement('div');preview.id='playerSeekPreview';preview.className='player-seek-preview';t.appendChild(preview)}
  return {timeline:t,fill:fill,preview:preview};
}
function removeTimelineFocus(){
  var t=timeline();if(!t)return;
  t.classList.remove('focused');t.classList.remove('scrubbing');
  if(document.activeElement===t){try{t.blur()}catch(_){}}
}
function clearScrubUi(){
  var ui=ensureScrubUi();if(!ui)return;
  ui.timeline.classList.remove('scrubbing');ui.fill.style.width='0%';ui.preview.style.display='none';
}
function clearPlayerFocus(){
  $$('.player-focusable').forEach(function(x){x.classList.remove('focused')});
}
function focusTimeline(){
  var t=timeline();if(!t||!playerChromeVisible()||settingsOpen())return;
  clearPlayerFocus();t.classList.add('focused');try{t.focus()}catch(_){}
  setHint('←/→ — выбрать позицию · OK — перейти · ↓ — перейти и к кнопкам · Назад — отменить');
}
function focusControl(){
  var c=lastControl;
  if(!c||!document.documentElement.contains(c)||!visible(c))c=$('#playerToggleButton');
  if(!c)return;
  removeTimelineFocus();clearPlayerFocus();c.classList.add('focused');try{c.focus()}catch(_){}
  setHint('↑ — шкала времени · ←/→ — выбор кнопок · OK — действие · Назад — выйти');
}
function timelineFocused(){
  var t=timeline();
  return playerChromeVisible()&&!settingsOpen()&&!!t&&(document.activeElement===t||t.classList.contains('focused'));
}
function renderScrub(){
  var ui=ensureScrubUi();if(!ui||!scrubDuration)return;
  var pct=clamp(scrubTarget/scrubDuration*100,0,100);
  ui.timeline.classList.add('scrubbing');
  ui.fill.style.width=pct+'%';
  ui.preview.style.display='block';
  ui.preview.style.left=pct+'%';
  ui.preview.textContent=formatTime(scrubTarget);
  var state=$('#playerStateText');
  if(state){
    var diff=Math.round((scrubTarget-scrubOrigin)/1000);
    state.textContent='Выбрано '+formatTime(scrubTarget)+(diff===0?'':(' · '+(diff>0?'+':'')+diff+' сек'));
  }
}
function beginScrub(){
  if(!playbackReady()||seekInFlight)return false;
  var p=av(),pos=0,dur=0,st='';
  try{st=p.getState();pos=Number(p.getCurrentTime()||0);dur=Number(p.getDuration()||0)}catch(_){return false}
  if(!dur)return false;
  scrubWasPlaying=st==='PLAYING';
  if(scrubWasPlaying){try{p.pause()}catch(_){scrubWasPlaying=false}}
  scrubActive=true;scrubOrigin=pos;scrubTarget=pos;scrubDuration=dur;
  renderScrub();return true;
}
function stepScrub(delta){
  if(!scrubActive&&!beginScrub())return;
  scrubTarget=clamp(scrubTarget+delta,0,Math.max(0,scrubDuration-1000));
  renderScrub();
}
function finishPendingAction(){
  var fn=pendingAfterSeek;pendingAfterSeek=null;
  if(fn)try{fn()}catch(_){}
}
function commitScrub(onDone){
  if(seekInFlight){if(onDone)pendingAfterSeek=onDone;return}
  if(!scrubActive){if(onDone)onDone();return}
  var p=av(),target=Math.round(scrubTarget),label=formatTime(target),resume=scrubWasPlaying;
  var token=++seekToken;
  scrubActive=false;seekInFlight=true;scrubWasPlaying=false;
  if(onDone)pendingAfterSeek=onDone;
  if(!p){seekInFlight=false;clearScrubUi();finishPendingAction();return}
  var state=$('#playerStateText');if(state)state.textContent='Переход к '+label;
  var done=function(){
    if(token!==seekToken)return;
    seekInFlight=false;
    if(resume&&playerActive()){try{if(p.getState()==='PAUSED')p.play()}catch(_){}}
    if(state&&playerActive())state.textContent=resume?'Воспроизведение':'Пауза';
    clearScrubUi();
    finishPendingAction();
  };
  try{p.seekTo(target,done,function(){done()})}catch(_){done()}
}
function cancelScrub(resumePlayback){
  var p=av(),resume=scrubWasPlaying;
  scrubActive=false;scrubWasPlaying=false;
  clearScrubUi();
  if(resumePlayback!==false&&resume&&p&&playerActive()){
    try{if(p.getState()==='PAUSED')p.play()}catch(_){}
  }
  var state=$('#playerStateText');if(state&&playerActive())state.textContent=resume?'Воспроизведение':'Пауза';
}
function abortSeekForExit(){
  seekToken++;
  seekInFlight=false;
  pendingAfterSeek=null;
}
function cleanupPlayerNavigation(){
  if(scrubActive)cancelScrub(false);
  abortSeekForExit();
  scrubActive=false;scrubWasPlaying=false;scrubTarget=0;scrubDuration=0;scrubOrigin=0;
  clearScrubUi();removeTimelineFocus();lastControl=null;
}

document.addEventListener('focusin',function(e){
  var control=closest(e.target,'#playerControls .player-focusable');
  if(control){lastControl=control;removeTimelineFocus()}
},true);

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!playerChromeVisible()||settingsOpen())return;

  if(timelineFocused()){
    if(code===37||code===412){consume(e);stepScrub(-SCRUB_STEP);return false}
    if(code===39||code===417){consume(e);stepScrub(SCRUB_STEP);return false}
    if(code===13){consume(e);commitScrub(null);return false}
    if(code===40){
      consume(e);
      if(scrubActive||seekInFlight)commitScrub(focusControl);else focusControl();
      return false;
    }
    if(code===38){consume(e);return false}
    if(code===10009||code===27){
      if(scrubActive)cancelScrub(true);
      if(seekInFlight)abortSeekForExit();
      removeTimelineFocus();
      return;
    }
    return;
  }

  /* All normal player controls stay owned by app.js. This is critical for
   * Audio, Subtitles, Play/Pause, horizontal navigation and Back. */
  var active=closest(document.activeElement,'#playerControls .player-focusable');
  if(active&&code===38){
    lastControl=active;
    consume(e);
    focusTimeline();
    return false;
  }
},true);

/* Hard cleanup prevents a hidden timeline from stealing Left/Right after
 * leaving playback and returning to the Home/Details screens. */
if(typeof MutationObserver!=='undefined'){
  var player=$('#player'),chrome=$('#playerChrome');
  var observer=new MutationObserver(function(){
    if(!playerActive()||!playerChromeVisible())cleanupPlayerNavigation();
  });
  if(player)observer.observe(player,{attributes:true,attributeFilter:['class']});
  if(chrome)observer.observe(chrome,{attributes:true,attributeFilter:['class']});
}

document.addEventListener('visibilitychange',function(){
  if(document.hidden||!playerActive())cleanupPlayerNavigation();
});

ensureScrubUi();
setHint('↑ — шкала времени · ←/→ — выбор кнопок · OK — действие · Назад — выйти');
})();
