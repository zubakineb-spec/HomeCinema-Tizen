(function(){
'use strict';

var overlay=document.getElementById('searchOverlay');
var input=document.getElementById('searchInput');
var player=document.getElementById('player');
var details=document.getElementById('details');
var restoreSearchAfterDetails=false;
var restoreTimer=null;

if(!overlay||!input||!player||!details)return;

function hidden(el){return !el||el.classList.contains('hidden')}
function searchNav(){return document.querySelector('.nav-item[data-view="search"]')}
function searchNavActive(){var nav=searchNav();return !!(nav&&nav.classList.contains('active'))}

function hideSearchSurface(){
  // Samsung Tizen can keep a focused INPUT in a native composition layer above AVPlay.
  // Blur and hide the input itself before hiding its overlay so no search artifact survives.
  input.classList.remove('focused');
  try{input.blur()}catch(_){}
  input.style.visibility='hidden';
  overlay.classList.add('hidden');
}

function restoreSearchInputVisibility(){
  if(hidden(player)&&hidden(details)&&!hidden(overlay))input.style.visibility='';
}

function restoreSearchMode(){
  if(restoreTimer)clearTimeout(restoreTimer);
  restoreTimer=setTimeout(function(){
    restoreTimer=null;
    if(!restoreSearchAfterDetails||!hidden(player)||!hidden(details)||!searchNavActive())return;
    restoreSearchAfterDetails=false;
    var nav=searchNav();
    if(nav){try{nav.click()}catch(_){} }
  },0);
}

function sync(){
  if(!hidden(player)){
    hideSearchSurface();
    return;
  }

  if(!hidden(details)){
    if(searchNavActive()&&!hidden(overlay))restoreSearchAfterDetails=true;
    hideSearchSurface();
    return;
  }

  if(restoreSearchAfterDetails&&searchNavActive()){
    restoreSearchMode();
    return;
  }

  restoreSearchInputVisibility();
}

if(typeof MutationObserver==='function'){
  var observer=new MutationObserver(sync);
  observer.observe(player,{attributes:true,attributeFilter:['class']});
  observer.observe(details,{attributes:true,attributeFilter:['class']});
  observer.observe(overlay,{attributes:true,attributeFilter:['class']});
}

sync();
})();
