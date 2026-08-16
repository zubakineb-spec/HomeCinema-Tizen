(function(){
'use strict';

var WATCHDOG_MS=1800;
var RETRY_MS=250;
var MAX_RETRIES=20;
var retryCount=0;
var retryTimer=null;
var patchedMethods={};
var nativeSetTimeout=window.setTimeout;
var nativeClearTimeout=window.clearTimeout;

function mark(name,value){patchedMethods[name]=!!value}
function alreadyWrapped(fn){return !!(fn&&fn.__homeCinemaRC320SeekWatchdog)}

function installMethod(av,name){
  if(!av||typeof av[name]!=='function'){mark(name,false);return false}
  if(alreadyWrapped(av[name])){mark(name,true);return true}

  var nativeMethod=av[name];
  var wrapped=function(value,onSuccess,onError){
    var settled=false;
    var timer=null;

    function clearTimer(){
      if(timer!==null){try{nativeClearTimeout(timer)}catch(_){}timer=null}
    }
    function success(){
      if(settled)return;
      settled=true;clearTimer();
      if(typeof onSuccess==='function'){
        try{onSuccess.apply(null,arguments)}catch(e){try{console.warn('RC3.20 seek success callback',e)}catch(_){} }
      }
    }
    function failure(error){
      if(settled)return;
      settled=true;clearTimer();
      if(typeof onError==='function'){
        try{onError(error)}catch(e){try{console.warn('RC3.20 seek error callback',e)}catch(_){} }
      }else if(typeof onSuccess==='function'){
        /* The caller mainly needs its seekBusy/seekInFlight latch released. */
        try{onSuccess()}catch(_){}
      }
    }

    /* Samsung 2018 / Tizen 4 can complete an AVPlay seek without invoking the
     * supplied callback. app.js and the timeline both use that callback to
     * release their seek-busy latch, so guarantee one terminal callback. */
    timer=nativeSetTimeout(function(){success()},WATCHDOG_MS);

    try{
      return nativeMethod.call(av,value,success,failure);
    }catch(error){
      failure(error);
      throw error;
    }
  };

  wrapped.__homeCinemaRC320SeekWatchdog=true;
  wrapped.__homeCinemaRC320Native=nativeMethod;

  try{av[name]=wrapped}catch(_){}
  if(av[name]!==wrapped){
    try{Object.defineProperty(av,name,{value:wrapped,writable:true,configurable:true})}catch(_){}
  }

  var ok=av[name]===wrapped||alreadyWrapped(av[name]);
  mark(name,ok);
  return ok;
}

function patch(){
  var av=null;
  try{av=window.webapis&&window.webapis.avplay}catch(_){}
  if(!av)return false;
  var seekTo=installMethod(av,'seekTo');
  var forward=installMethod(av,'jumpForward');
  var backward=installMethod(av,'jumpBackward');
  return seekTo&&forward&&backward;
}

function ensurePatched(){
  if(patch()){
    if(retryTimer!==null){try{nativeClearTimeout(retryTimer)}catch(_){}retryTimer=null}
    return;
  }
  if(retryCount>=MAX_RETRIES)return;
  retryCount++;
  retryTimer=nativeSetTimeout(ensurePatched,RETRY_MS);
}

ensurePatched();
try{window.addEventListener('load',ensurePatched,false)}catch(_){}

window.HOME_CINEMA_RC320={
  marker:'rc3.20-seek-watchdog',
  watchdogMs:WATCHDOG_MS,
  patch:patch,
  patchedMethods:patchedMethods
};
window.HOME_CINEMA_RC='rc3.20-seek-watchdog';
})();
