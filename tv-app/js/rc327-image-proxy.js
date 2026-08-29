(function(){
'use strict';

/* RC3.27: dynamic artwork bridge for a mutable library.
 * Existing packaged image-map entries remain local assets. Any new TMDB image
 * that is not present in the static WGT map is routed through QNAP /api/image,
 * where it is cached on the NAS and served over the LAN to the Samsung TV.
 */
var TMDB_PREFIX='https://image.tmdb.org/t/p/';
var originalMap=window.HOME_CINEMA_IMAGE_MAP||{};

function apiBase(){
  var base=String(window.HOME_CINEMA_API||'').replace(/\/+$/,'');
  return base;
}
function isTmdb(value){return String(value||'').indexOf(TMDB_PREFIX)===0}
function proxied(value){
  var v=String(value||'');
  if(!isTmdb(v))return v;
  var base=apiBase();
  return base?(base+'/api/image?url='+encodeURIComponent(v)):v;
}
function resolve(value){
  var v=String(value||'');
  if(!v)return '';
  if(originalMap[v])return originalMap[v];
  return proxied(v);
}

// Chromium M56 supports ES6 Proxy. Wrapping the existing map means legacy
// helpers such as `map[value]||value` transparently gain dynamic NAS routing
// without changing player/application ownership.
if(typeof Proxy==='function'){
  try{
    window.HOME_CINEMA_IMAGE_MAP=new Proxy(originalMap,{
      get:function(target,prop){
        if(typeof prop==='string'){
          if(Object.prototype.hasOwnProperty.call(target,prop))return target[prop];
          if(isTmdb(prop))return proxied(prop);
        }
        return target[prop];
      }
    });
  }catch(_){}
}

function rewriteElement(el){
  if(!el||el.nodeType!==1)return;
  try{
    if(el.tagName==='IMG'){
      var src=el.getAttribute('src')||'';
      if(isTmdb(src))el.setAttribute('src',proxied(src));
    }
  }catch(_){}
  try{
    var bg=String(el.style&&el.style.backgroundImage||'');
    if(bg.indexOf(TMDB_PREFIX)>=0){
      var m=bg.match(/url\(["']?(https:\/\/image\.tmdb\.org\/t\/p\/[^"')]+)["']?\)/i);
      if(m&&m[1])el.style.backgroundImage='url("'+proxied(m[1]).replace(/"/g,'%22')+'")';
    }
  }catch(_){}
}
function rewriteTree(root){
  rewriteElement(root);
  if(!root||!root.querySelectorAll)return;
  var all=root.querySelectorAll('[style],img[src]');
  for(var i=0;i<all.length;i++)rewriteElement(all[i]);
}

if(typeof MutationObserver==='function'&&document&&document.documentElement){
  try{
    var observer=new MutationObserver(function(records){
      for(var i=0;i<records.length;i++){
        var r=records[i];
        if(r.type==='attributes')rewriteElement(r.target);
        var nodes=r.addedNodes||[];
        for(var j=0;j<nodes.length;j++)rewriteTree(nodes[j]);
      }
    });
    observer.observe(document.documentElement,{subtree:true,childList:true,attributes:true,attributeFilter:['style','src']});
    window.setTimeout(function(){rewriteTree(document.documentElement)},0);
  }catch(_){}
}

window.HOME_CINEMA_RC327={
  marker:'rc3.27-dynamic-artwork-proxy',
  tmdbPrefix:TMDB_PREFIX,
  resolve:resolve,
  proxyEndpoint:'/api/image?url=',
  packagedMapPreserved:true,
  domFallback:true
};
window.HOME_CINEMA_RESOLVE_IMAGE=resolve;
window.HOME_CINEMA_RC='rc3.27-dynamic-artwork-proxy';
})();
