(function(){
'use strict';

var lastControl=null;
var scrubActive=false;
var scrubTarget=0;
var scrubDuration=0;
var scrubOrigin=0;
var scrubWasPlaying=false;
var seekInFlight=false;
var SCRUB_STEP=10000;
var nativeSetTimeout=window.setTimeout;

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function visible(el){return !!el&&!closest(el,'.hidden')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function timeline(){return $('#playerTimelineButton')}
function playerActive(){var p=$('#player');return !!p&&!p.classList.contains('hidden')}
function playerChromeVisible(){var c=$('#playerChrome');return playerActive()&&!!c&&!c.classList.contains('hidden')}
function settingsOpen(){var s=$('#playerSettings');return !!s&&!s.classList.contains('hidden')}
function clearPlayerFocus(){$$('.player-focusable,#playerTimelineButton').forEach(function(x){x.classList.remove('focused')})}
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
function ensureScrubUi(){
  var t=timeline();if(!t)return null;
  var fill=$('#playerScrubFill',t),preview=$('#playerSeekPreview',t);
  if(!fill){fill=document.createElement('div');fill.id='playerScrubFill';fill.className='player-scrub-fill';t.appendChild(fill)}
  if(!preview){preview=document.createElement('div');preview.id='playerSeekPreview';preview.className='player-seek-preview';t.appendChild(preview)}
  return {timeline:t,fill:fill,preview:preview};
}
function setHint(text){var hint=$('.player-hint');if(hint)hint.textContent=text}
function focusTimeline(){
  var t=timeline();if(!t||!playerChromeVisible()||settingsOpen())return;
  clearPlayerFocus();t.classList.add('focused');try{t.focus()}catch(_){}
  setHint('←/→ — выбрать позицию · отпустить — перейти · OK — сразу · ↓ — к кнопкам · Назад — отменить');
}
function focusControl(){
  var c=lastControl;
  if(!c||!document.documentElement.contains(c)||!visible(c))c=$('#playerToggleButton');
  if(!c)return;
  clearPlayerFocus();c.classList.add('focused');try{c.focus()}catch(_){}
}
function timelineFocused(){
  var t=timeline();
  return playerChromeVisible()&&!settingsOpen()&&!!t&&(document.activeElement===t||t.classList.contains('focused'));
}
function hideScrubUi(delay){
  nativeSetTimeout(function(){
    var ui=ensureScrubUi();if(!ui||scrubActive)return;
    ui.timeline.classList.remove('scrubbing');ui.fill.style.width='0%';ui.preview.style.display='none';
  },delay||0);
}
function clearTimelineState(){
  var t=timeline(),ui=ensureScrubUi();
  scrubActive=false;scrubWasPlaying=false;seekInFlight=false;
  scrubTarget=0;scrubDuration=0;scrubOrigin=0;lastControl=null;
  if(ui){ui.timeline.classList.remove('scrubbing');ui.fill.style.width='0%';ui.preview.style.display='none'}
  if(t){t.classList.remove('focused');if(document.activeElement===t){try{t.blur()}catch(_){}}}
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
function restorePlaybackAfterScrub(p){
  if(!scrubWasPlaying||!playerActive())return;
  try{if(p&&p.getState&&p.getState()==='PAUSED')p.play()}catch(_){}
}
function commitScrub(immediateFeedback){
  if(!scrubActive||seekInFlight)return;
  var p=av(),target=Math.round(scrubTarget),label=formatTime(target),resume=scrubWasPlaying;
  scrubActive=false;seekInFlight=true;scrubWasPlaying=false;
  if(!p){seekInFlight=false;hideScrubUi(0);return}
  var state=$('#playerStateText');if(state)state.textContent='Переход к '+label;
  var done=function(){
    if(!seekInFlight)return;
    seekInFlight=false;
    if(resume&&playerActive()){try{if(p.getState()==='PAUSED')p.play()}catch(_){}}
    if(state&&playerActive())state.textContent=resume?'Воспроизведение':'Пауза';
    if(playerChromeVisible()&&!settingsOpen()&&timelineFocused())focusTimeline();
    hideScrubUi(immediateFeedback?250:500);
  };
  try{p.seekTo(target,done,function(){done()})}catch(_){done()}
}
function cancelScrub(){
  if(!scrubActive)return;
  var p=av(),resume=scrubWasPlaying;
  scrubActive=false;scrubWasPlaying=false;hideScrubUi(0);
  if(resume&&p&&playerActive()){try{if(p.getState()==='PAUSED')p.play()}catch(_){}
  }
  var state=$('#playerStateText');if(state&&playerActive())state.textContent=resume?'Воспроизведение':'Пауза';
}

/*
 * app.js hides the player menu after 7 seconds. While the user is holding
 * Left/Right on the timeline that timeout must not terminate scrub mode.
 * Suppress only that one menu-hide callback while the timeline owns focus.
 * The next normal control movement schedules a fresh native app timeout.
 */
window.setTimeout=function(fn,delay){
  var args=Array.prototype.slice.call(arguments,2);
  if(Number(delay)===7000&&typeof fn==='function'){
    return nativeSetTimeout(function(){
      if(timelineFocused()||scrubActive||seekInFlight)return;
      fn.apply(window,args);
    },delay);
  }
  return nativeSetTimeout.apply(window,arguments);
};

document.addEventListener('focusin',function(e){
  var control=closest(e.target,'#playerControls .player-focusable');
  if(control){
    lastControl=control;
    var t=timeline();if(t)t.classList.remove('focused');
  }
},true);

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!playerChromeVisible()||settingsOpen())return;

  if(timelineFocused()){
    if(code===37||code===412){consume(e);stepScrub(-SCRUB_STEP);return false}
    if(code===39||code===417){consume(e);stepScrub(SCRUB_STEP);return false}
    if(code===13){consume(e);commitScrub(true);return false}
    if(code===40){consume(e);if(scrubActive)commitScrub(true);focusControl();return false}
    if(code===38){consume(e);return false}
    if(code===10009||code===27){
      /* Cancel an uncommitted target, but DO NOT consume Back.
       * app.js must still see the same Back event so it can close the menu;
       * the next Back then stops the movie normally. */
      if(scrubActive)cancelScrub();
      var t=timeline();if(t){t.classList.remove('focused');if(document.activeElement===t){try{t.blur()}catch(_){}}}
      return;
    }
    return;
  }

  /* Outside the timeline, app.js remains the single source of truth for
   * Left/Right/OK, Audio, Subtitles, Play/Pause and Back. */
  var active=closest(document.activeElement,'#playerControls .player-focusable');
  if(active&&code===38){
    lastControl=active;
    consume(e);
    focusTimeline();
    return false;
  }
},true);

window.addEventListener('keyup',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!playerChromeVisible()||settingsOpen()||!timelineFocused()||!scrubActive)return;
  if(code!==37&&code!==39&&code!==412&&code!==417)return;
  consume(e);
  commitScrub(false);
  return false;
},true);

/*
 * Critical RC3.4 cleanup: the timeline is intentionally outside app.js's
 * native player-focusable list. Therefore app.js cannot clear its DOM focus
 * when playback closes. Without this cleanup the hidden timeline can keep
 * intercepting Left/Right on Home after a movie is stopped.
 */
if(typeof MutationObserver!=='undefined'){
  var player=$('#player'),chrome=$('#playerChrome');
  var cleanupObserver=new MutationObserver(function(){
    if(!playerActive()||!playerChromeVisible())clearTimelineState();
  });
  if(player)cleanupObserver.observe(player,{attributes:true,attributeFilter:['class']});
  if(chrome)cleanupObserver.observe(chrome,{attributes:true,attributeFilter:['class']});
}

document.addEventListener('visibilitychange',function(){
  if(document.hidden||!playerActive())clearTimelineState();
});

ensureScrubUi();
})();
