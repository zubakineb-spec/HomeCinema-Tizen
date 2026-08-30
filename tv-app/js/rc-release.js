(function(){
'use strict';

function closest(el,selector){
  while(el&&el!==document){
    if(el.matches&&el.matches(selector))return el;
    el=el.parentElement;
  }
  return null;
}
function consume(e){
  try{e.preventDefault()}catch(_){}
  try{e.stopPropagation()}catch(_){}
  try{e.stopImmediatePropagation()}catch(_){}
}
function aboutOverlay(){return document.getElementById('aboutOverlay')}
function aboutOpen(){var x=aboutOverlay();return !!x&&!x.classList.contains('hidden')}
function setAboutActive(active){
  var items=document.querySelectorAll('.nav-item');
  for(var i=0;i<items.length;i++)items[i].classList.toggle('active',active&&items[i].getAttribute('data-view')==='about');
}
function openAbout(){
  var x=aboutOverlay();if(!x)return;
  x.classList.remove('hidden');
  setAboutActive(true);
  var back=document.getElementById('aboutBack');
  if(back)try{back.focus()}catch(_){}
}
function closeAbout(){
  var x=aboutOverlay();if(x)x.classList.add('hidden');
  var home=document.querySelector('.nav-item[data-view="home"]');
  if(home){
    try{home.click()}catch(_){}
    try{home.focus()}catch(_){}
  }else setAboutActive(false);
}
function playerVisible(){
  var p=document.getElementById('player');
  return !!p&&!p.classList.contains('hidden');
}
function seriesPageOpen(){
  var p=document.getElementById('series310Page');
  return !!p&&!p.classList.contains('hidden');
}
function hidden(id){
  var x=document.getElementById(id);
  return !x||x.classList.contains('hidden');
}
function rootScreenActive(){
  return !playerVisible()&&!seriesPageOpen()&&hidden('details')&&hidden('searchOverlay')&&!aboutOpen();
}
function exitApplication(){
  try{
    if(typeof tizen!=='undefined'&&tizen.application&&tizen.application.getCurrentApplication){
      tizen.application.getCurrentApplication().exit();
      return true;
    }
  }catch(e){console.warn('Application exit failed',e)}
  try{window.close();return true}catch(_){}
  return false;
}
function handleDedicatedMediaKey(code,e){
  if(code!==415&&code!==19)return false;
  if(!playerVisible()||!window.webapis||!window.webapis.avplay)return false;
  var state='';
  try{state=window.webapis.avplay.getState()}catch(_){return false}
  var toggle=document.getElementById('playerToggleButton');
  if(!toggle)return false;
  if(code===415&&state==='PAUSED'){
    consume(e);try{toggle.click()}catch(_){}return true;
  }
  if(code===19&&state==='PLAYING'){
    consume(e);try{toggle.click()}catch(_){}return true;
  }
  return false;
}

// RC3.37: /api/next is requested once by the smart-credits module. A short
// QNAP restart used to turn one failed request into a permanent "no next
// episode" result for the current playback session. Keep that one request
// pending and retry only the next-episode endpoint until the backend is back.
var NEXT_RETRY_MS=3000;
var nextFetchGeneration=0;
function isNextEpisodeRequest(input){
  var url='';
  if(typeof input==='string')url=input;
  else if(input&&typeof input.url==='string')url=input.url;
  return url.indexOf('/api/next?source_url=')>=0;
}
function installNextEpisodeFetchRetry(){
  if(typeof window.fetch!=='function'||window.fetch.__homeCinemaRC337Wrapped)return;
  var nativeFetch=window.fetch;
  var wrapped=function(input,init){
    if(!isNextEpisodeRequest(input))return nativeFetch.call(window,input,init);
    var generation=++nextFetchGeneration;
    return new Promise(function(resolve,reject){
      function retry(){setTimeout(attempt,NEXT_RETRY_MS)}
      function attempt(){
        if(generation!==nextFetchGeneration){reject(new Error('next request superseded'));return}
        var request;
        try{request=nativeFetch.call(window,input,init)}catch(_){retry();return}
        Promise.resolve(request).then(function(resp){
          if(resp&&resp.ok){resolve(resp);return}
          retry();
        },function(){retry()});
      }
      attempt();
    });
  };
  wrapped.__homeCinemaRC337Wrapped=true;
  window.fetch=wrapped;
}
installNextEpisodeFetchRetry();

window.addEventListener('keydown',function(e){
  var code=Number(e.keyCode||e.which||0);
  if(aboutOpen()){
    if(code===10009||code===27||code===13){consume(e);closeAbout();return}
    if(code===37||code===38||code===39||code===40){consume(e);return}
  }
  if((code===10009||code===27)&&rootScreenActive()){
    consume(e);exitApplication();return;
  }
  handleDedicatedMediaKey(code,e);
},true);

document.addEventListener('click',function(e){
  var about=closest(e.target,'.nav-item[data-view="about"]');
  if(about){consume(e);openAbout();return}
  var back=closest(e.target,'#aboutBack');
  if(back){consume(e);closeAbout();return}
},true);

window.HOME_CINEMA_RC337_NEXT_RETRY={
  marker:'rc3.37-next-fetch-retry',
  retryMs:NEXT_RETRY_MS
};
window.HOME_CINEMA_RC_RELEASE=true;
})();
