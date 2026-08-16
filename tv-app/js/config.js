// Home Cinema Samsung TV target configuration.
// AVPlay lifecycle is owned by app.js; this file only owns API endpoint routing.
(function(){
  'use strict';

  // RC3.7 enhancement code needs to synthesize small JSON responses when the NAS
  // is temporarily offline. Capture a deterministic constructor now, then restore
  // the browser-native Response after synchronous scripts have loaded.
  var nativeResponse=window.Response;
  function MiniResponse(body,init){
    init=init||{};
    this._body=String(body==null?'':body);
    this.status=Number(init.status||200);
    this.ok=this.status>=200&&this.status<300;
    this.statusText=this.ok?'OK':'ERROR';
    this.headers=init.headers||{};
  }
  MiniResponse.prototype.text=function(){return Promise.resolve(this._body)};
  MiniResponse.prototype.json=function(){var body=this._body;return Promise.resolve().then(function(){return JSON.parse(body)})};
  MiniResponse.prototype.clone=function(){return new MiniResponse(this._body,{status:this.status,headers:this.headers})};
  window.Response=MiniResponse;
  if(typeof nativeResponse==='function'){
    window.setTimeout(function(){window.Response=nativeResponse},0);
  }

  var DEFAULT_BACKEND='http://192.168.0.101:8096';
  var STORAGE_KEY='homecinema.api.base';

  function normalize(value){
    value=String(value||'').replace(/^\s+|\s+$/g,'').replace(/\/+$/,'');
    if(!/^https?:\/\//i.test(value))return '';
    return value;
  }
  function savedBackend(){
    try{return normalize(window.localStorage.getItem(STORAGE_KEY))}catch(_){return ''}
  }

  var backend=savedBackend()||DEFAULT_BACKEND;
  window.HOME_CINEMA_API=backend;
  window.HOME_CINEMA_DEFAULT_API=DEFAULT_BACKEND;
  window.HOME_CINEMA_NATIVE_FETCH=window.fetch;
  window.HOME_CINEMA_SET_API=function(value){
    var next=normalize(value);
    if(!next)return false;
    try{window.localStorage.setItem(STORAGE_KEY,next)}catch(_){}
    window.HOME_CINEMA_API=next;
    return true;
  };
  window.HOME_CINEMA_RESET_API=function(){
    try{window.localStorage.removeItem(STORAGE_KEY)}catch(_){}
    window.HOME_CINEMA_API=DEFAULT_BACKEND;
    return DEFAULT_BACKEND;
  };

  var nativeFetch=window.fetch;
  if(typeof nativeFetch==='function'){
    window.fetch=function(input,opts){
      if(typeof input==='string'&&input.indexOf('/api/')===0){
        input=window.HOME_CINEMA_API+input;
      }
      return nativeFetch.call(window,input,opts);
    };
  }
})();

// RC3.14 must wrap fetch before app.js starts loading the catalog. During normal
// Tizen document parsing this parser-inserted local script is synchronous, which
// keeps the audio metadata observer deterministic on Chromium 56. The document
// guard preserves the existing headless API-origin regression harness.
(function(){
  if(typeof document==='undefined')return;
  if(document.readyState==='loading'){
    document.write('<script src="js/rc314-audio-metadata.js"><\/script>');
    return;
  }
  var s=document.createElement('script');
  s.src='js/rc314-audio-metadata.js';
  s.async=false;
  (document.head||document.documentElement).appendChild(s);
})();
