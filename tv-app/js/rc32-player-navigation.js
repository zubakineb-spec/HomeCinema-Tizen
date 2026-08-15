(function(){
'use strict';

var lastControl=null;
var scrubActive=false;
var scrubTarget=0;
var scrubDuration=0;
var scrubOrigin=0;
var scrubTimer=null;
var SCRUB_STEP=10000;
var SCRUB_COMMIT_DELAY=550;

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}
function closest(el,selector){while(el&&el!==document){if(el.matches&&el.matches(selector))return el;el=el.parentElement}return null}
function visible(el){return !!el&&!closest(el,'.hidden')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function timeline(){return $('#playerTimelineButton')}
function playerChromeVisible(){var c=$('#playerChrome');return !!c&&visible(c)}
function clearPlayerFocus(){$$('.player-focusable').forEach(function(x){x.classList.remove('focused')})}
function clearScrubTimer(){if(scrubTimer){clearTimeout(scrubTimer);scrubTimer=null}}
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
function focusTimeline(){
  var t=timeline();if(!t)return;
  clearPlayerFocus();t.classList.add('focused');try{t.focus()}catch(_){}
  var hint=$('.player-hint');if(hint)hint.textContent='←/→ — выбрать позицию · отпустили — переход · OK — сразу · ↓ — к кнопкам';
}
function focusControl(){
  var c=lastControl;
  if(!c||!document.documentElement.contains(c)||!visible(c))c=$('#playerToggleButton');
  if(!c)return;
  clearPlayerFocus();c.classList.add('focused');try{c.focus()}catch(_){}
}
function timelineFocused(){var t=timeline();return !!t&&(document.activeElement===t||t.classList.contains('focused'))}
function hideScrubUi(delay){
  setTimeout(function(){
    var ui=ensureScrubUi();if(!ui||scrubActive)return;
    ui.timeline.classList.remove('scrubbing');ui.fill.style.width='0%';ui.preview.style.display='none';
  },delay||0);
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
    state.textContent='Позиция '+formatTime(scrubTarget)+(diff===0?'':(' · '+(diff>0?'+':'')+diff+' сек'));
  }
}
function beginScrub(){
  if(!playbackReady())return false;
  var p=av(),pos=0,dur=0;
  try{pos=Number(p.getCurrentTime()||0);dur=Number(p.getDuration()||0)}catch(_){return false}
  if(!dur)return false;
  scrubActive=true;scrubOrigin=pos;scrubTarget=pos;scrubDuration=dur;
  renderScrub();return true;
}
function scheduleCommit(){clearScrubTimer();scrubTimer=setTimeout(function(){commitScrub(false)},SCRUB_COMMIT_DELAY)}
function stepScrub(delta){
  if(!scrubActive&&!beginScrub())return;
  scrubTarget=clamp(scrubTarget+delta,0,Math.max(0,scrubDuration-1000));
  renderScrub();scheduleCommit();
}
function commitScrub(immediateFeedback){
  if(!scrubActive)return;
  clearScrubTimer();
  var p=av(),target=Math.round(scrubTarget),label=formatTime(target);
  scrubActive=false;
  if(!p){hideScrubUi(0);return}
  var state=$('#playerStateText');if(state)state.textContent='Переход к '+label;
  var done=function(){
    focusTimeline();
    if(state)state.textContent='Воспроизведение';
    hideScrubUi(immediateFeedback?300:650);
  };
  try{p.seekTo(target,done,function(){done()})}catch(_){done()}
}
function cancelScrub(){
  clearScrubTimer();scrubActive=false;hideScrubUi(0);
  var state=$('#playerStateText');if(state)state.textContent='Воспроизведение';
}

document.addEventListener('focusin',function(e){
  var control=closest(e.target,'#playerControls .player-focusable');
  if(control){lastControl=control;if(scrubActive)commitScrub(true)}
},true);

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(!playerChromeVisible())return;

  if(timelineFocused()){
    if(code===37||code===412){consume(e);stepScrub(-SCRUB_STEP);return false}
    if(code===39||code===417){consume(e);stepScrub(SCRUB_STEP);return false}
    if(code===13){consume(e);commitScrub(true);return false}
    if(code===40){consume(e);if(scrubActive)commitScrub(true);focusControl();return false}
    if(code===38){consume(e);return false}
    if(code===10009||code===27){if(scrubActive){consume(e);cancelScrub();return false}}
    return;
  }

  var active=closest(document.activeElement,'#playerControls .player-focusable');
  if(active&&code===38){
    lastControl=active;
    consume(e);
    focusTimeline();
    return false;
  }
},true);

ensureScrubUi();
})();
