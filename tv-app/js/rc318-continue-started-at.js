(function(){
'use strict';

var previousFetch=window.fetch;
var startedAtBySource={};

function requestMethod(opts){return String(opts&&opts.method||'GET').toUpperCase()}
function apiPath(input){
  if(typeof input!=='string')return '';
  var ix=input.indexOf('/api/');
  return ix>=0?input.substring(ix):'';
}
function progressSource(path){
  if(path.indexOf('/api/progress?')!==0)return '';
  var raw='';
  try{raw=(path.split('source_url=')[1]||'').split('&')[0]||'';return decodeURIComponent(raw)}catch(_){return ''}
}
function markPlaybackStarted(source){
  if(!source)return;
  startedAtBySource[source]=Date.now();
}
function augmentProgressBody(opts){
  if(!opts||!opts.body)return opts;
  try{
    var body=JSON.parse(String(opts.body||'{}'));
    var source=String(body.source_url||'');
    if(!source)return opts;
    if(startedAtBySource[source])body.started_at_ms=startedAtBySource[source];
    var copy={};
    for(var key in opts)if(Object.prototype.hasOwnProperty.call(opts,key))copy[key]=opts[key];
    copy.body=JSON.stringify(body);
    return copy;
  }catch(_){return opts}
}

if(typeof previousFetch==='function'){
  window.fetch=function(input,opts){
    var path=apiPath(input),method=requestMethod(opts);
    if(method==='GET'&&path.indexOf('/api/progress?')===0){
      var source=progressSource(path);
      if(source)markPlaybackStarted(source);
    }else if(method==='POST'&&path==='/api/progress'){
      opts=augmentProgressBody(opts);
    }
    return previousFetch(input,opts);
  };
}

window.HOME_CINEMA_RC318={
  marker:'rc3.18-continue-started-at',
  startedAtBySource:startedAtBySource
};
window.HOME_CINEMA_RC='rc3.18-continue-started-at';
})();
