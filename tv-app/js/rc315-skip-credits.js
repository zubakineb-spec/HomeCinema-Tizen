(function(){
'use strict';

var dismissedSource='';
var lastSource='';
var pollTimer=null;
var nextSource='';
var nextItem=null;
var nextLoaded=false;
var nextLoading=false;
var countdownTimer=null;
var countdownSource='';
var countdownValue=0;
var countdownMode='';
var handoff=null;
var handoffLaunchTimer=null;

var FALLBACK_PROMPT_MS=25000;
var FALLBACK_AUTOPLAY_MS=7000;
var CREDITS_AUTOPLAY_SECONDS=7;
var AUTOPLAY_KEY='homecinema.autoplay.next';
var HANDOFF_BACK_RETRY_MS=80;
var HANDOFF_COMPLETE_DELAY_MS=550;
var HANDOFF_MAX_BACK_ATTEMPTS=3;

function $(selector,root){return (root||document).querySelector(selector)}
function trim(v){return String(v||'').replace(/^\s+|\s+$/g,'')}
function consume(e){try{e.preventDefault()}catch(_){}try{e.stopPropagation()}catch(_){}try{e.stopImmediatePropagation()}catch(_){}return false}
function runtime(){return window.HOME_CINEMA_RC37_RUNTIME||null}
function profiles(){return window.HOME_CINEMA_AUDIO_PROFILES||{}}
function apiBase(){return String(window.HOME_CINEMA_API||'').replace(/\/+$/,'')}
function safeGet(key){try{return window.localStorage.getItem(key)}catch(_){return null}}
function autoplayEnabled(){return safeGet(AUTOPLAY_KEY)!=='0'}
function playerVisible(){var p=$('#player');return !!p&&!p.classList.contains('hidden')}
function currentSource(){var r=runtime();return trim(r&&r.lastSource||'')}
function sourceMeta(source){var r=runtime();return r&&r.sourceMeta&&r.sourceMeta[source]||null}
function currentProfile(){
  var source=currentSource(),meta=sourceMeta(source);
  return source?(profiles()[source]||(meta&&meta.item&&meta.item.media_profile)||null):null;
}
function isEpisodeSource(source){
  var r=runtime();if(!r||!source)return false;
  var meta=r.sourceMeta&&r.sourceMeta[source];
  if(meta&&meta.kind==='episode')return true;
  var hist=r.historyBySource&&r.historyBySource[source];
  return !!(hist&&hist.media_type==='episode');
}
function creditsStart(profile){return Number(profile&&profile.credits_start_ms||0)}
function pad2(v){v=String(v||0);return v.length<2?'0'+v:v}
function button(){return $('#rc315SkipCredits')}
function panel(){return $('#rc335NextEpisodePanel')}
function nextButton(){return $('#rc335NextEpisode')}
function stayButton(){return $('#rc335WatchCredits')}
function countdownEl(){return $('#rc335NextCountdown')}
function hideButton(){var b=button();if(b)b.classList.add('hidden')}
function hidePanel(){var p=panel();if(p)p.classList.add('hidden')}
function clearCountdown(){
  if(countdownTimer){clearInterval(countdownTimer);countdownTimer=null}
  countdownSource='';countdownValue=0;countdownMode='';
}
function hidePrompts(){hideButton();hidePanel();clearCountdown()}
function resetNext(source){
  nextSource=source||'';nextItem=null;nextLoaded=false;nextLoading=false;
  clearCountdown();
}
function ensureUI(){
  var player=$('#player');if(!player)return;
  if(!button()){
    var b=document.createElement('button');
    b.id='rc315SkipCredits';
    b.className='rc315-skip-credits hidden';
    b.type='button';
    b.textContent='Пропустить титры';
    b.setAttribute('aria-label','Пропустить титры');
    player.appendChild(b);
    b.addEventListener('click',function(e){consume(e);skipCredits()});
  }
  if(!panel()){
    var card=document.createElement('div');
    card.id='rc335NextEpisodePanel';
    card.className='rc335-next-episode-panel hidden';
    card.innerHTML='<div class="rc335-next-kicker">ДАЛЬШЕ</div>'+ 
      '<div id="rc335NextTitle" class="rc335-next-title"></div>'+ 
      '<div id="rc335NextSubtitle" class="rc335-next-subtitle"></div>'+ 
      '<div id="rc335NextCountdown" class="rc335-next-countdown"></div>'+ 
      '<div class="rc335-next-actions">'+ 
      '<button id="rc335NextEpisode" class="rc335-focusable rc335-next-primary" type="button">▶ Следующая серия</button>'+ 
      '<button id="rc335WatchCredits" class="rc335-focusable rc335-next-secondary" type="button">Смотреть титры</button>'+ 
      '</div>';
    player.appendChild(card);
    nextButton().addEventListener('click',function(e){consume(e);handoffToNext()});
    stayButton().addEventListener('click',function(e){consume(e);dismissPrompt()});
  }
}
function avState(){try{return webapis.avplay.getState()}catch(_){return ''}}
function playbackTimes(){
  try{return {position:Number(webapis.avplay.getCurrentTime()||0),duration:Number(webapis.avplay.getDuration()||0)}}catch(_){return {position:0,duration:0}}
}
function nextTitle(item){
  if(!item)return 'Следующая серия';
  return (item.parent_title||'Следующая серия')+' · S'+pad2(item.season)+'E'+pad2(item.episode);
}
function nextSubtitle(item){return item&&item.title||'Следующая серия'}
function nextPlayTitle(item){return (item&&item.parent_title||'Сериал')+' — '+(item&&item.title||('Серия '+(item&&item.episode||'')))}
function fetchNext(source){
  if(!source||nextLoading||(nextLoaded&&nextSource===source))return;
  nextSource=source;nextLoading=true;nextLoaded=false;nextItem=null;
  var url=apiBase()+'/api/next?source_url='+encodeURIComponent(source);
  window.fetch(url,{method:'GET'}).then(function(resp){
    if(!resp||!resp.ok)throw new Error('next '+(resp&&resp.status));
    return resp.json();
  }).then(function(data){
    if(nextSource!==source)return;
    nextItem=data&&data.item&&data.item.source_url?data.item:null;
    nextLoaded=true;
  }).catch(function(){
    if(nextSource===source){nextItem=null;nextLoaded=true}
  }).then(function(){if(nextSource===source)nextLoading=false},function(){if(nextSource===source)nextLoading=false});
}
function focusNext(which){
  var a=nextButton(),b=stayButton(),target=which==='stay'?b:a;
  if(!target)return;
  try{target.focus()}catch(_){}
}
function showButton(){
  hidePanel();clearCountdown();
  var b=button();if(!b)return;
  if(b.classList.contains('hidden'))b.classList.remove('hidden');
  try{b.focus()}catch(_){}
}
function updateCountdownText(){
  var el=countdownEl();if(!el)return;
  if(!autoplayEnabled()){el.textContent='Автопереход выключен';return}
  if(countdownTimer&&countdownValue>0){el.textContent='Следующая серия через '+countdownValue+' сек';return}
  if(countdownMode==='natural'){el.textContent='Автопереход в конце серии';return}
  el.textContent='OK — перейти к следующей серии';
}
function showNext(item,mode,seconds){
  hideButton();
  var p=panel();if(!p||!item)return;
  $('#rc335NextTitle').textContent=nextTitle(item);
  $('#rc335NextSubtitle').textContent=nextSubtitle(item);
  p.classList.remove('hidden');
  if(mode==='credits'&&autoplayEnabled()&&!countdownTimer&&countdownSource!==currentSource()){
    startCountdown(CREDITS_AUTOPLAY_SECONDS,'credits');
  }else if(mode==='natural'&&autoplayEnabled()&&seconds>0&&!countdownTimer){
    startCountdown(seconds,'natural');
  }else{
    countdownMode=mode||'';
    updateCountdownText();
  }
  if(document.activeElement!==nextButton()&&document.activeElement!==stayButton())focusNext('next');
}
function startCountdown(seconds,mode){
  clearCountdown();
  countdownSource=currentSource();
  countdownMode=mode||'';
  countdownValue=Math.max(1,Number(seconds||1));
  updateCountdownText();
  countdownTimer=setInterval(function(){
    countdownValue--;
    updateCountdownText();
    if(countdownValue<=0){
      clearCountdown();
      handoffToNext();
    }
  },1000);
}
function dismissPrompt(){
  dismissedSource=currentSource();
  hidePrompts();
}
function markCompleted(){
  var r=runtime();if(r)r.lastPlaybackRatio=1;
}
function launchHiddenPlay(item){
  if(!item||!item.source_url)return;
  var tmp=document.createElement('button');
  tmp.type='button';
  tmp.style.display='none';
  tmp.setAttribute('data-play-source',item.source_url);
  tmp.setAttribute('data-play-title',nextPlayTitle(item));
  document.body.appendChild(tmp);
  try{tmp.click()}catch(_){}
  setTimeout(function(){try{if(tmp.parentNode)tmp.parentNode.removeChild(tmp)}catch(_){}},40);
}
function persistHandoffCompletion(data){
  var source=trim(data&&data.fromSource||''),duration=Math.max(0,Number(data&&data.duration||0));
  if(!source||duration<=1500)return Promise.resolve(false);
  return window.fetch(apiBase()+'/api/progress',{
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body:JSON.stringify({source_url:source,position_ms:Math.round(duration),duration_ms:Math.round(duration),completed:1})
  }).then(function(resp){return !!(resp&&resp.ok)}).catch(function(){return false});
}
function scheduleHandoffLaunch(){
  if(!handoff||playerVisible()||handoffLaunchTimer)return;
  handoffLaunchTimer=setTimeout(function(){
    handoffLaunchTimer=null;
    if(!handoff||playerVisible())return;
    var pending=handoff,item=pending.item;
    handoff=null;
    var r=runtime();if(r)r.lastPlaybackRatio=0;
    persistHandoffCompletion(pending).then(function(){launchHiddenPlay(item)},function(){launchHiddenPlay(item)});
  },HANDOFF_COMPLETE_DELAY_MS);
}
function finishCurrentForHandoff(){
  var times=playbackTimes();
  if(times.duration<=1500)return false;
  markCompleted();
  var target=Math.max(0,times.duration-500);
  try{
    webapis.avplay.seekTo(target,function(){markCompleted()},function(){markCompleted()});
    return true;
  }catch(_){
    markCompleted();
    return false;
  }
}
function dispatchBackForHandoff(){
  var evt=null;
  try{
    evt=document.createEvent('Event');
    evt.initEvent('keydown',true,true);
    evt.keyCode=10009;
    evt.which=10009;
    window.dispatchEvent(evt);
    return true;
  }catch(_){}
  try{
    evt=new KeyboardEvent('keydown',{bubbles:true,cancelable:true,keyCode:10009,which:10009});
    window.dispatchEvent(evt);
    return true;
  }catch(_){}
  return false;
}
function closeCurrentForHandoff(attempt){
  if(!handoff||!playerVisible()){scheduleHandoffLaunch();return}
  attempt=Number(attempt||0);
  dispatchBackForHandoff();
  if(!playerVisible()){scheduleHandoffLaunch();return}
  if(attempt+1<HANDOFF_MAX_BACK_ATTEMPTS){
    setTimeout(function(){closeCurrentForHandoff(attempt+1)},HANDOFF_BACK_RETRY_MS);
    return;
  }
  // Samsung fallback only: preserve the previous end-seek path if synthetic Back
  // cannot unwind an open settings/menu layer on a particular firmware build.
  finishCurrentForHandoff();
}
function handoffToNext(){
  var source=currentSource(),item=nextItem;
  if(!source||!item||!item.source_url){skipCredits();return}
  if(typeof webapis==='undefined'||!webapis.avplay)return;
  var times=playbackTimes();
  handoff={fromSource:source,item:item,duration:times.duration,requestedAt:Date.now()};
  dismissedSource=source;
  hidePrompts();
  var r=runtime();if(r)r.lastPlaybackRatio=0;
  closeCurrentForHandoff(0);
}
function skipCredits(){
  var source=currentSource(),r=runtime();
  if(!source||!r||typeof webapis==='undefined'||!webapis.avplay)return;
  if(nextItem&&nextItem.source_url){handoffToNext();return}
  var times=playbackTimes();
  if(times.duration<=1500)return;
  dismissedSource=source;
  hidePrompts();
  // RC3.15 baseline: mark complete and seek to the end. RC3.35 keeps this
  // behavior when there is no next episode and uses the same completion path.
  r.lastPlaybackRatio=1;
  var target=Math.max(0,times.duration-500);
  try{
    webapis.avplay.seekTo(target,function(){r.lastPlaybackRatio=1},function(){r.lastPlaybackRatio=1});
  }catch(_){
    r.lastPlaybackRatio=1;
  }
}
function panelVisible(){var p=panel();return !!p&&!p.classList.contains('hidden')}
function buttonVisible(){var b=button();return !!b&&!b.classList.contains('hidden')}
function remainingSeconds(times){return Math.max(1,Math.ceil(Math.max(0,times.duration-times.position)/1000))}
function poll(){
  ensureUI();
  var source=currentSource();
  if(source!==lastSource){
    lastSource=source;dismissedSource='';hidePrompts();resetNext(source);
    if(source&&isEpisodeSource(source))fetchNext(source);
  }
  if(handoff){
    if(!playerVisible())scheduleHandoffLaunch();
    else if(Date.now()-handoff.requestedAt>12000)handoff=null;
    return;
  }
  if(!source||!playerVisible()||!isEpisodeSource(source)){hidePrompts();return}
  if(!nextLoaded&&!nextLoading)fetchNext(source);
  if(dismissedSource===source){hidePrompts();return}
  if(typeof webapis==='undefined'||!webapis.avplay){hidePrompts();return}
  var state=avState();if(state!=='PLAYING'&&state!=='PAUSED'){hidePrompts();return}
  var profile=currentProfile(),marker=creditsStart(profile),times=playbackTimes();
  if(times.duration<=0){hidePrompts();return}
  var markerValid=marker>0&&marker<times.duration-1000;
  var creditsActive=markerValid&&times.position>=Math.max(0,marker-750)&&times.position<times.duration-500;
  if(creditsActive){
    if(nextItem&&nextItem.source_url)showNext(nextItem,'credits',CREDITS_AUTOPLAY_SECONDS);
    else showButton();
    return;
  }
  var fallbackActive=!!(nextItem&&nextItem.source_url)&&!markerValid&&times.position>=Math.max(0,times.duration-FALLBACK_PROMPT_MS)&&times.position<times.duration-500;
  if(fallbackActive){
    var remaining=times.duration-times.position;
    if(autoplayEnabled()&&remaining<=FALLBACK_AUTOPLAY_MS){
      showNext(nextItem,'natural',remainingSeconds(times));
    }else{
      showNext(nextItem,'natural',0);
    }
    return;
  }
  hidePrompts();
}
function panelFocusables(){
  var p=panel();if(!p)return [];
  return [nextButton(),stayButton()].filter(function(x){return !!x&&!x.disabled});
}
function movePanelFocus(delta){
  var list=panelFocusables();if(!list.length)return;
  var ix=list.indexOf(document.activeElement);if(ix<0)ix=0;
  ix=Math.max(0,Math.min(list.length-1,ix+delta));
  try{list[ix].focus()}catch(_){}
}

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(panelVisible()){
    if([13,27,37,38,39,40,10009].indexOf(code)<0)return;
    consume(e);
    if(code===10009||code===27){dismissPrompt();return false}
    if(code===37||code===38){movePanelFocus(-1);return false}
    if(code===39||code===40){movePanelFocus(1);return false}
    if(code===13){
      var active=document.activeElement;
      if(active===stayButton())dismissPrompt();else handoffToNext();
      return false;
    }
  }
  if(buttonVisible()){
    if(code===13){consume(e);skipCredits();return false}
    if(code===10009||code===27){consume(e);dismissPrompt();return false}
  }
},true);

document.addEventListener('DOMContentLoaded',function(){ensureUI()},false);
ensureUI();
pollTimer=window.setInterval(poll,250);

window.HOME_CINEMA_RC315={
  poll:poll,
  skipCredits:skipCredits,
  creditsStart:creditsStart,
  isEpisodeSource:isEpisodeSource
};
window.HOME_CINEMA_RC335={
  marker:'rc3.35-smart-credits-next',
  poll:poll,
  handoffToNext:handoffToNext,
  fetchNext:fetchNext,
  fallbackPromptMs:FALLBACK_PROMPT_MS,
  fallbackAutoplayMs:FALLBACK_AUTOPLAY_MS
};
window.HOME_CINEMA_RC338={
  marker:'rc3.38-atomic-next-handoff',
  handoffToNext:handoffToNext,
  closeCurrentForHandoff:closeCurrentForHandoff,
  completionDelayMs:HANDOFF_COMPLETE_DELAY_MS,
  maxBackAttempts:HANDOFF_MAX_BACK_ATTEMPTS
};
})();
