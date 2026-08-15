(function(){
'use strict';

// Development-only AVPlay compatibility layer for ordinary desktop browsers.
// On a real Samsung TV the native webapis.avplay object already exists and
// this file exits without changing the platform API.
if(window.webapis&&window.webapis.avplay)return;
if(typeof window.tizen!=='undefined')return;

var video=null;
var listener={};
var state='NONE';
var suspendedWasPlaying=false;
var bound=false;

function ensureVideo(){
  if(!video)video=document.getElementById('htmlVideo');
  if(!video)throw new Error('HTML5 video element not found');
  if(!bound){
    bound=true;
    video.addEventListener('waiting',function(){if(listener.onbufferingstart)listener.onbufferingstart()});
    video.addEventListener('canplay',function(){if(listener.onbufferingcomplete)listener.onbufferingcomplete()});
    video.addEventListener('timeupdate',function(){
      if(listener.oncurrentplaytime)listener.oncurrentplaytime(Math.round((video.currentTime||0)*1000));
    });
    video.addEventListener('ended',function(){state='READY';if(listener.onstreamcompleted)listener.onstreamcompleted()});
    video.addEventListener('error',function(){
      var code=video.error&&video.error.code?video.error.code:'HTML5_VIDEO_ERROR';
      if(listener.onerror)listener.onerror(code);
    });
  }
  return video;
}

function durationMs(){
  var v=ensureVideo();
  return isFinite(v.duration)&&v.duration>0?Math.round(v.duration*1000):0;
}

var avplay={
  open:function(url){
    var v=ensureVideo();
    try{v.pause()}catch(_){}
    v.classList.remove('hidden');
    v.src=String(url||'');
    state='IDLE';
    v.load();
  },
  close:function(){
    var v=ensureVideo();
    try{v.pause()}catch(_){}
    v.removeAttribute('src');
    try{v.load()}catch(_){}
    v.classList.add('hidden');
    state='NONE';
  },
  stop:function(){
    var v=ensureVideo();
    try{v.pause();v.currentTime=0}catch(_){}
    state='READY';
  },
  play:function(){
    var v=ensureVideo();
    state='PLAYING';
    var p=v.play();
    if(p&&p.catch)p.catch(function(e){state='READY';if(listener.onerror)listener.onerror(e&&e.message?e.message:String(e))});
  },
  pause:function(){
    var v=ensureVideo();
    v.pause();
    state='PAUSED';
  },
  prepareAsync:function(onSuccess,onError){
    var v=ensureVideo();
    var done=false;
    function ok(){if(done)return;done=true;cleanup();state='READY';if(onSuccess)onSuccess()}
    function fail(){if(done)return;done=true;cleanup();if(onError)onError(video.error||'HTML5_VIDEO_ERROR')}
    function cleanup(){v.removeEventListener('loadedmetadata',ok);v.removeEventListener('canplay',ok);v.removeEventListener('error',fail)}
    if(v.readyState>=1){setTimeout(ok,0);return}
    v.addEventListener('loadedmetadata',ok);
    v.addEventListener('canplay',ok);
    v.addEventListener('error',fail);
    try{v.load()}catch(e){fail()}
  },
  setListener:function(x){listener=x||{}},
  setDisplayRect:function(){},
  setDisplayMethod:function(){},
  getState:function(){return state},
  getCurrentTime:function(){return Math.round((ensureVideo().currentTime||0)*1000)},
  getDuration:function(){return durationMs()},
  seekTo:function(ms,onSuccess,onError){try{ensureVideo().currentTime=Math.max(0,Number(ms||0)/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},
  jumpForward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.min(isFinite(v.duration)?v.duration:Infinity,v.currentTime+Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},
  jumpBackward:function(ms,onSuccess,onError){try{var v=ensureVideo();v.currentTime=Math.max(0,v.currentTime-Math.max(0,Number(ms||0))/1000);if(onSuccess)setTimeout(onSuccess,0)}catch(e){if(onError)onError(e);else throw e}},
  getTotalTrackInfo:function(){return []},
  getCurrentStreamInfo:function(){return []},
  setSelectTrack:function(){},
  setSilentSubtitle:function(silent){
    var v=ensureVideo();
    for(var i=0;i<v.textTracks.length;i++)v.textTracks[i].mode=silent?'disabled':'showing';
  },
  suspend:function(){
    var v=ensureVideo();
    suspendedWasPlaying=!v.paused;
    if(suspendedWasPlaying)v.pause();
  },
  restore:function(){
    if(!suspendedWasPlaying)return;
    suspendedWasPlaying=false;
    var p=ensureVideo().play();
    if(p&&p.catch)p.catch(function(){})
  }
};

window.webapis=window.webapis||{};
window.webapis.avplay=avplay;
window.HOME_CINEMA_BROWSER_AVPLAY=true;
})();
