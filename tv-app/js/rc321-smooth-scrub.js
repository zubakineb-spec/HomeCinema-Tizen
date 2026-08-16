(function(){
'use strict';

var FRAME_MS=50;
var INITIAL_NUDGE_MS=1500;
var active=false;
var direction=0;
var origin=0;
var target=0;
var duration=0;
var wasPlaying=false;
var chromeWasVisible=false;
var holdStartedAt=0;
var lastTickAt=0;
var frameTimer=null;
var hideTimer=null;
var nativeSetInterval=window.setInterval;
var nativeClearInterval=window.clearInterval;
var nativeSetTimeout=window.setTimeout;
var nativeClearTimeout=window.clearTimeout;

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function clamp(v,min,max){return Math.max(min,Math.min(max,v))}
function player(){return $('#player')}
function chrome(){return $('#playerChrome')}
function timeline(){return $('#playerTimelineButton')}
function settingsOpen(){var s=$('#playerSettings');return !!s&&!s.classList.contains('hidden')}
function playerActive(){var p=player();return !!p&&!p.classList.contains('hidden')}
function chromeVisible(){var c=chrome();return !!c&&!c.classList.contains('hidden')}
function timelineFocused(){var t=timeline();return !!t&&(document.activeElement===t||t.classList.contains('focused'))}
function av(){return (typeof webapis!=='undefined'&&webapis.avplay)?webapis.avplay:null}
function playbackReady(){var p=av();if(!p)return false;try{var s=p.getState();return s==='PLAYING'||s==='PAUSED'}catch(_){return false}}
function formatTime(ms){var sec=Math.max(0,Math.floor(Number(ms||0)/1000)),h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;function z(n){return n<10?'0'+n:String(n)}return h>0?(h+':'+z(m)+':'+z(s)):(z(m)+':'+z(s))}
function ensureUi(){
  var t=timeline();if(!t)return null;
  var fill=$('#playerScrubFill',t),preview=$('#playerSeekPreview',t);
  if(!fill){fill=document.createElement('div');fill.id='playerScrubFill';fill.className='player-scrub-fill';t.appendChild(fill)}
  if(!preview){preview=document.createElement('div');preview.id='playerSeekPreview';preview.className='player-seek-preview';t.appendChild(preview)}
  return {timeline:t,fill:fill,preview:preview};
}
function clearHideTimer(){if(hideTimer!==null){try{nativeClearTimeout(hideTimer)}catch(_){}hideTimer=null}}
function clearFrame(){if(frameTimer!==null){try{nativeClearInterval(frameTimer)}catch(_){}frameTimer=null}}
function clearVisuals(){
  var ui=ensureUi();if(!ui)return;
  ui.timeline.classList.remove('scrubbing');
  ui.fill.style.width='0%';
  ui.preview.style.display='none';
  ui.preview.style.left='0%';
  ui.preview.textContent='';
}
function focusTimeline(){
  var t=timeline();if(!t)return;
  $$('.player-focusable,#playerTimelineButton').forEach(function(x){x.classList.remove('focused')});
  t.classList.add('focused');try{t.focus()}catch(_){}
}
function showChromeForScrub(){var c=chrome();if(c)c.classList.remove('hidden');focusTimeline()}
function speedFor(elapsed){
  if(elapsed<700)return 4500;
  if(elapsed<1800)return 12000;
  if(elapsed<3500)return 30000;
  return 60000;
}
function render(){
  var ui=ensureUi();if(!ui||!duration)return;
  var pct=clamp(target/duration*100,0,100);
  ui.timeline.classList.add('scrubbing');
  ui.fill.style.width=pct+'%';
  ui.preview.style.display='block';
  ui.preview.style.left=pct+'%';
  ui.preview.textContent=formatTime(target);
  var state=$('#playerStateText');
  if(state){
    var diff=Math.round((target-origin)/1000);
    state.textContent='Позиция '+formatTime(target)+' · '+(diff>=0?'+':'')+diff+' сек';
  }
}
function tick(){
  if(!active||!direction||!duration)return;
  var now=Date.now(),dt=Math.max(0,Math.min(120,now-lastTickAt));
  lastTickAt=now;
  var speed=speedFor(now-holdStartedAt);
  target=clamp(target+(direction*speed*dt/1000),0,Math.max(0,duration-500));
  render();
}
function begin(dir){
  if(active){
    if(direction!==dir){direction=dir;holdStartedAt=Date.now();lastTickAt=holdStartedAt}
    return true;
  }
  if(!playerActive()||settingsOpen()||!playbackReady())return false;
  var p=av(),state='',pos=0,dur=0;
  try{state=p.getState();pos=Number(p.getCurrentTime()||0);dur=Number(p.getDuration()||0)}catch(_){return false}
  if(!dur)return false;
  clearHideTimer();
  chromeWasVisible=chromeVisible();
  wasPlaying=state==='PLAYING';
  if(wasPlaying){try{p.pause()}catch(_){wasPlaying=false}}
  active=true;direction=dir;origin=pos;duration=dur;
  target=clamp(origin+(dir*INITIAL_NUDGE_MS),0,Math.max(0,duration-500));
  holdStartedAt=Date.now();lastTickAt=holdStartedAt;
  showChromeForScrub();render();
  clearFrame();frameTimer=nativeSetInterval(tick,FRAME_MS);
  return true;
}
function restoreChromeAfterDirectScrub(){
  if(chromeWasVisible)return;
  var t=timeline();if(t){t.classList.remove('focused');try{t.blur()}catch(_){}}
  hideTimer=nativeSetTimeout(function(){var c=chrome();if(c&&!settingsOpen())c.classList.add('hidden');hideTimer=null},450);
}
function finishPlaybackUi(p){
  if(wasPlaying&&playerActive()){try{if(p.getState()==='PAUSED')p.play()}catch(_){}}
  var state=$('#playerStateText');if(state&&playerActive())state.textContent=wasPlaying?'Воспроизведение':'Пауза';
  restoreChromeAfterDirectScrub();
}
function commit(){
  if(!active)return;
  var p=av(),delta=Math.round(target-origin),resume=wasPlaying;
  active=false;direction=0;wasPlaying=false;clearFrame();clearVisuals();
  if(!p){restoreChromeAfterDirectScrub();return}
  var doneCalled=false;
  function done(){if(doneCalled)return;doneCalled=true;wasPlaying=resume;finishPlaybackUi(p);wasPlaying=false}
  try{
    if(Math.abs(delta)<250){done();return}
    if(delta>0&&typeof p.jumpForward==='function'){p.jumpForward(delta,done,function(){done()});return}
    if(delta<0&&typeof p.jumpBackward==='function'){p.jumpBackward(Math.abs(delta),done,function(){done()});return}
    p.seekTo(Math.round(target),done,function(){done()});
  }catch(_){done()}
}
function cancel(){
  if(!active)return;
  var p=av(),resume=wasPlaying;
  active=false;direction=0;wasPlaying=false;clearFrame();clearVisuals();
  if(resume&&p&&playerActive()){try{if(p.getState()==='PAUSED')p.play()}catch(_){}}
  restoreChromeAfterDirectScrub();
}
function seekKey(code){return code===37||code===39||code===412||code===417}
function keyDirection(code){return (code===37||code===412)?-1:1}

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!playerActive()||settingsOpen())return;

  if(active){
    if(seekKey(code)){consume(e);begin(keyDirection(code));return false}
    if(code===13){consume(e);commit();return false}
    if(code===10009||code===27){consume(e);cancel();return false}
    return;
  }

  if(!seekKey(code))return;

  /* Preserve left/right navigation between visible player controls. Smooth
   * scrubbing owns the arrows only when the chrome is hidden or the timeline
   * itself is focused. */
  if(chromeVisible()&&!timelineFocused())return;

  if(begin(keyDirection(code))){consume(e);return false}
},true);

window.addEventListener('keyup',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!active||!seekKey(code))return;
  consume(e);commit();return false;
},true);

window.HOME_CINEMA_RC321={
  marker:'rc3.21-smooth-scrub',
  frameMs:FRAME_MS,
  initialNudgeMs:INITIAL_NUDGE_MS,
  speedFor:speedFor
};
window.HOME_CINEMA_RC='rc3.21-smooth-scrub';
})();
