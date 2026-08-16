(function(){
'use strict';

var lastControl=null;
var scrubActive=false;
var scrubTarget=0;
var scrubDuration=0;
var scrubOrigin=0;
var scrubWasPlaying=false;
var scrubPausedForHold=false;
var seekInFlight=false;
var seekWatchdog=null;

/* RC3.24: Samsung TV Web officially documents remote handling around keydown.
 * Some physical TVs do not deliver a dependable DOM keyup for Smart Remote.
 * Keep keyup as the fastest release signal, but never depend on it:
 *   Up -> focus timeline
 *   Left/Right first keydown -> choose +/-10 sec target only
 *   repeated keydown -> confirms a physical hold
 *   internal 80ms clock -> smooth accelerated target movement
 *   keyup OR repeat stream going quiet -> exactly one absolute seekTo()
 */
var SCRUB_STEP=10000;
var SCRUB_STEP_MEDIUM=30000;
var SCRUB_STEP_FAST=60000;
var SCRUB_FRAME_MS=80;
var SCRUB_INITIAL_RELEASE_MS=750;
var SCRUB_REPEAT_RELEASE_MS=360;
var scrubHoldCount=0;
var scrubHoldDirection=0;
var scrubHoldTimer=null;
var scrubReleaseTimer=null;
var scrubKeyHeld=false;
var scrubRepeatSeen=false;

var nativeSetTimeout=window.setTimeout;
var nativeClearTimeout=window.clearTimeout;

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function visible(el){return !!el&&!closest(el,'.hidden')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function timeline(){return $('#playerTimelineButton')}
function playerChromeVisible(){var c=$('#playerChrome');return !!c&&visible(c)}
function playerActive(){var p=$('#player');return !!p&&!p.classList.contains('hidden')}
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
function clearHoldTimer(){
  if(scrubHoldTimer!==null){try{nativeClearTimeout(scrubHoldTimer)}catch(_){}scrubHoldTimer=null}
}
function clearReleaseTimer(){
  if(scrubReleaseTimer!==null){try{nativeClearTimeout(scrubReleaseTimer)}catch(_){}scrubReleaseTimer=null}
}
function resetHold(){
  clearHoldTimer();clearReleaseTimer();
  scrubHoldCount=0;
  scrubHoldDirection=0;
  scrubKeyHeld=false;
  scrubRepeatSeen=false;
  scrubPausedForHold=false;
}
function holdStep(direction){
  if(scrubHoldDirection!==direction){scrubHoldDirection=direction;scrubHoldCount=0}
  scrubHoldCount++;
  if(scrubHoldCount>=11)return SCRUB_STEP_FAST;
  if(scrubHoldCount>=5)return SCRUB_STEP_MEDIUM;
  return SCRUB_STEP;
}
function ensureScrubUi(){
  var t=timeline();if(!t)return null;
  var fill=$('#playerScrubFill',t),preview=$('#playerSeekPreview',t);
  if(!fill){fill=document.createElement('div');fill.id='playerScrubFill';fill.className='player-scrub-fill';t.appendChild(fill)}
  if(!preview){preview=document.createElement('div');preview.id='playerSeekPreview';preview.className='player-seek-preview';t.appendChild(preview)}
  return {timeline:t,fill:fill,preview:preview};
}
function clearSeekWatchdog(){
  if(seekWatchdog!==null){try{nativeClearTimeout(seekWatchdog)}catch(_){}seekWatchdog=null}
}
function clearScrubVisuals(){
  var ui=ensureScrubUi();if(!ui)return;
  ui.timeline.classList.remove('scrubbing');
  ui.fill.style.width='0%';
  ui.preview.style.display='none';
  ui.preview.style.left='0%';
  ui.preview.textContent='';
}
function setHint(text){var hint=$('.player-hint');if(hint)hint.textContent=text}
function focusTimeline(){
  var t=timeline();if(!t)return;
  clearPlayerFocus();t.classList.add('focused');try{t.focus()}catch(_){}
  setHint('←/→ — выбрать позицию · удерживать — плавно ускорить · отпустить — один переход · ↓ — к кнопкам · Назад — отменить');
}
function focusControl(){
  var c=lastControl;
  if(!c||!document.documentElement.contains(c)||!visible(c))c=$('#playerToggleButton');
  if(!c)return;
  clearPlayerFocus();c.classList.add('focused');try{c.focus()}catch(_){}
}
function timelineFocused(){var t=timeline();return !!t&&(document.activeElement===t||t.classList.contains('focused'))}
function resetInactivePlayerNavigation(){
  if(playerActive())return false;
  scrubActive=false;scrubWasPlaying=false;seekInFlight=false;clearSeekWatchdog();resetHold();
  clearScrubVisuals();
  var t=timeline();
  if(t)t.classList.remove('focused');
  clearPlayerFocus();
  try{
    var active=document.activeElement;
    if(active&&closest(active,'#player')&&active.blur)active.blur();
  }catch(_){}
  lastControl=null;
  return true;
}
function hideScrubUi(delay){
  nativeSetTimeout(function(){
    if(scrubActive||seekInFlight)return;
    clearScrubVisuals();
  },delay||0);
}
function renderScrub(speed){
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
    var speedText=speed?(' · '+Math.round(speed/1000)+' сек/с'):'';
    state.textContent='Выбрано '+formatTime(scrubTarget)+(diff===0?'':(' · '+(diff>0?'+':'')+diff+' сек'))+speedText;
  }
}
function beginScrub(){
  if(!playbackReady()||seekInFlight)return false;
  var p=av(),pos=0,dur=0,st='';
  try{st=p.getState();pos=Number(p.getCurrentTime()||0);dur=Number(p.getDuration()||0)}catch(_){return false}
  if(!dur)return false;
  scrubWasPlaying=st==='PLAYING';
  scrubPausedForHold=false;
  scrubActive=true;scrubOrigin=pos;scrubTarget=pos;scrubDuration=dur;resetHold();
  renderScrub(0);return true;
}
function pauseForConfirmedHold(){
  if(scrubPausedForHold||!scrubWasPlaying)return;
  var p=av();if(!p)return;
  try{if(p.getState()==='PLAYING'){p.pause();scrubPausedForHold=true}}catch(_){}
}
function smoothHoldTick(){
  if(!scrubActive||!scrubKeyHeld||!scrubHoldDirection||!scrubRepeatSeen){clearHoldTimer();return}
  var speed=holdStep(scrubHoldDirection);
  var delta=speed*SCRUB_FRAME_MS/1000;
  scrubTarget=clamp(scrubTarget+(scrubHoldDirection*delta),0,Math.max(0,scrubDuration-1000));
  renderScrub(speed);
  scrubHoldTimer=nativeSetTimeout(smoothHoldTick,SCRUB_FRAME_MS);
}
function startSmoothMotion(){
  if(!scrubRepeatSeen)return;
  pauseForConfirmedHold();
  clearHoldTimer();
  smoothHoldTick();
}
function armReleaseFallback(delay){
  clearReleaseTimer();
  scrubReleaseTimer=nativeSetTimeout(function(){
    scrubReleaseTimer=null;
    if(!scrubActive||!scrubKeyHeld)return;
    clearHoldTimer();
    scrubKeyHeld=false;
    commitScrub(false);
  },delay);
}
function handleScrubArrow(direction){
  if(!scrubActive&&!beginScrub())return false;

  /* First keydown selects a single +/-10s target. Do not start continuous
   * motion yet: without a dependable keyup, only a repeated keydown proves
   * that the physical button is actually being held. */
  if(!scrubKeyHeld||scrubHoldDirection!==direction){
    clearHoldTimer();clearReleaseTimer();
    scrubHoldCount=0;
    scrubHoldDirection=direction;
    scrubKeyHeld=true;
    scrubRepeatSeen=false;
    scrubTarget=clamp(scrubTarget+(direction*SCRUB_STEP),0,Math.max(0,scrubDuration-1000));
    renderScrub(SCRUB_STEP);
    armReleaseFallback(SCRUB_INITIAL_RELEASE_MS);
    return true;
  }

  /* Same-direction keydown while the key is already logically held is a
   * Samsung repeat. Use it only to confirm/refresh the hold; target movement
   * itself remains on our stable 80ms clock. */
  if(!scrubRepeatSeen){scrubRepeatSeen=true;startSmoothMotion()}
  armReleaseFallback(SCRUB_REPEAT_RELEASE_MS);
  return true;
}
function stepScrub(direction){return handleScrubArrow(direction)}
function commitScrub(immediateFeedback){
  if(!scrubActive||seekInFlight)return;
  clearHoldTimer();clearReleaseTimer();
  var p=av(),target=Math.round(scrubTarget),label=formatTime(target),resume=scrubWasPlaying;
  scrubActive=false;seekInFlight=true;scrubWasPlaying=false;resetHold();

  /* RC3.13: clear the temporary seek surface immediately. On Tizen 4 the
   * preview/fill can otherwise remain composited over AVPlay after seekTo(). */
  clearScrubVisuals();

  if(!p){seekInFlight=false;clearSeekWatchdog();return}
  var state=$('#playerStateText');if(state)state.textContent='Переход к '+label;
  var settled=false;
  var done=function(){
    if(settled)return;
    settled=true;clearSeekWatchdog();seekInFlight=false;clearScrubVisuals();
    if(resume&&playerActive()){try{if(p.getState()==='PAUSED')p.play()}catch(_){}}
    if(state&&playerActive())state.textContent=resume?'Воспроизведение':'Пауза';
    if(playerChromeVisible()&&!settingsOpen()&&timelineFocused())focusTimeline();
  };

  /* Some older AVPlay builds occasionally miss the seek callback. Never let
   * seekInFlight or the seek overlay survive indefinitely. */
  seekWatchdog=nativeSetTimeout(done,1800);
  try{p.seekTo(target,done,function(){done()})}catch(_){done()}
}
function cancelScrub(){
  if(!scrubActive)return;
  clearHoldTimer();clearReleaseTimer();
  var p=av(),resume=scrubWasPlaying;
  scrubActive=false;scrubWasPlaying=false;clearSeekWatchdog();resetHold();clearScrubVisuals();
  if(resume&&p&&playerActive()){try{if(p.getState()==='PAUSED')p.play()}catch(_){}}
  var state=$('#playerStateText');if(state&&playerActive())state.textContent=resume?'Воспроизведение':'Пауза';
}

window.setTimeout=function(fn,delay){
  var args=Array.prototype.slice.call(arguments,2);
  if(Number(delay)===7000&&typeof fn==='function'){
    return nativeSetTimeout(function waitForSeekToSettle(){
      /* RC3.13: a focused-but-idle timeline must not suppress player chrome
       * auto-hide forever. Only an active scrub/seek postpones the timer. */
      if(scrubActive||seekInFlight){nativeSetTimeout(waitForSeekToSettle,350);return}
      fn.apply(window,args);
    },delay);
  }
  return nativeSetTimeout.apply(window,arguments);
};

document.addEventListener('focusin',function(e){
  var control=closest(e.target,'#playerControls .player-focusable');
  if(control){
    lastControl=control;resetHold();
    var t=timeline();if(t)t.classList.remove('focused');
  }
},true);

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(resetInactivePlayerNavigation())return;
  if(!playerChromeVisible()||settingsOpen())return;

  if(timelineFocused()){
    if(code===37||code===412){consume(e);stepScrub(-1);return false}
    if(code===39||code===417){consume(e);stepScrub(1);return false}
    if(code===13){consume(e);commitScrub(true);return false}
    if(code===40){consume(e);if(scrubActive)commitScrub(true);focusControl();return false}
    if(code===38){consume(e);return false}
    if(code===10009||code===27){
      /* Cancel an uncommitted target, but DO NOT consume Back.
       * app.js must still see the same Back event so it can close the menu;
       * the next Back then stops the movie normally. */
      if(scrubActive)cancelScrub();
      return;
    }
    return;
  }

  /* Outside the timeline, app.js remains the single source of truth for
   * Left/Right/OK, Audio, Subtitles, Play/Pause and Back. */
  var active=closest(document.activeElement,'#playerControls .player-focusable');
  if(active&&code===38){
    lastControl=active;resetHold();consume(e);focusTimeline();return false;
  }
},true);

window.addEventListener('keyup',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!playerChromeVisible()||settingsOpen()||!timelineFocused()||!scrubActive)return;
  if(code!==37&&code!==39&&code!==412&&code!==417)return;
  consume(e);clearHoldTimer();clearReleaseTimer();scrubKeyHeld=false;commitScrub(false);return false;
},true);

window.HOME_CINEMA_RC324={
  marker:'rc3.24-samsung-release-detection',
  frameMs:SCRUB_FRAME_MS,
  initialReleaseMs:SCRUB_INITIAL_RELEASE_MS,
  repeatReleaseMs:SCRUB_REPEAT_RELEASE_MS,
  tapStepMs:SCRUB_STEP,
  owner:'rc32-player-navigation.js',
  holdConfirm:'repeated-keydown',
  commit:'keyup-or-repeat-gap-one-seekTo'
};

ensureScrubUi();
})();
