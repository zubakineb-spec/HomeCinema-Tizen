(function(){
'use strict';

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}

function showToast(message){
  var toast=$('#toast');
  if(!toast)return;
  toast.textContent=message;
  toast.classList.remove('hidden');
  setTimeout(function(){toast.classList.add('hidden')},2200);
}

function sendKey(code){
  var ev;
  try{
    ev=document.createEvent('Event');
    ev.initEvent('keydown',true,true);
    try{Object.defineProperty(ev,'keyCode',{get:function(){return code}})}catch(_){}
    try{Object.defineProperty(ev,'which',{get:function(){return code}})}catch(_){}
    document.dispatchEvent(ev);
  }catch(e){
    if(window.console)console.warn('Synthetic key failed',e);
  }
}

function scrollAmount(row){
  return Math.max(420,Math.floor(row.clientWidth*0.82));
}

function scrollRow(row,delta){
  var target=Math.max(0,Math.min(row.scrollWidth-row.clientWidth,row.scrollLeft+delta));
  try{
    if(row.scrollTo)row.scrollTo({left:target,top:0,behavior:'smooth'});
    else row.scrollLeft=target;
  }catch(_){row.scrollLeft=target}
}

function updateShelfButtons(row){
  var shelf=row.parentNode;
  if(!shelf)return;
  var left=$('.shelf-arrow-left',shelf);
  var right=$('.shelf-arrow-right',shelf);
  if(!left||!right)return;
  var max=Math.max(0,row.scrollWidth-row.clientWidth);
  left.disabled=row.scrollLeft<=4;
  right.disabled=row.scrollLeft>=max-4;
  shelf.classList.toggle('shelf-scrollable',max>8);
}

function enhanceRow(row){
  if(!row||row.getAttribute('data-web-scroll')==='1')return;
  row.setAttribute('data-web-scroll','1');
  var shelf=row.parentNode;
  if(!shelf)return;

  var left=document.createElement('button');
  left.type='button';
  left.className='shelf-arrow shelf-arrow-left';
  left.setAttribute('aria-label','Прокрутить влево');
  left.innerHTML='‹';

  var right=document.createElement('button');
  right.type='button';
  right.className='shelf-arrow shelf-arrow-right';
  right.setAttribute('aria-label','Прокрутить вправо');
  right.innerHTML='›';

  shelf.appendChild(left);
  shelf.appendChild(right);

  left.onclick=function(){scrollRow(row,-scrollAmount(row));setTimeout(function(){updateShelfButtons(row)},260)};
  right.onclick=function(){scrollRow(row,scrollAmount(row));setTimeout(function(){updateShelfButtons(row)},260)};

  row.addEventListener('scroll',function(){updateShelfButtons(row)});
  row.addEventListener('wheel',function(e){
    if(row.scrollWidth<=row.clientWidth+8)return;
    if(Math.abs(e.deltaY)>=Math.abs(e.deltaX)){
      e.preventDefault();
      row.scrollLeft+=e.deltaY;
    }
  },false);

  var dragging=false,startX=0,startLeft=0;
  row.addEventListener('mousedown',function(e){
    if(e.button!==0)return;
    if(e.target&&e.target.closest&&e.target.closest('button'))return;
    dragging=true;startX=e.clientX;startLeft=row.scrollLeft;row.classList.add('dragging');
  });
  document.addEventListener('mousemove',function(e){if(dragging)row.scrollLeft=startLeft-(e.clientX-startX)});
  document.addEventListener('mouseup',function(){if(dragging){dragging=false;row.classList.remove('dragging')}});

  setTimeout(function(){updateShelfButtons(row)},0);
}

function enhanceShelves(){
  $$('.row').forEach(enhanceRow);
}

function cycleSubtitles(video){
  var tracks=video&&video.textTracks;
  if(!tracks||!tracks.length){showToast('В браузере субтитры в этом файле не обнаружены');return}
  var current=-1,i;
  for(i=0;i<tracks.length;i++)if(tracks[i].mode==='showing')current=i;
  for(i=0;i<tracks.length;i++)tracks[i].mode='disabled';
  var next=current+1;
  if(next>=tracks.length){showToast('Субтитры: выкл.');return}
  tracks[next].mode='showing';
  showToast('Субтитры: '+(tracks[next].label||tracks[next].language||('дорожка '+(next+1))));
}

function cycleAudio(video){
  var tracks=video&&video.audioTracks;
  if(!tracks||!tracks.length){showToast('Выбор аудио браузером не поддерживается; на Samsung будет AVPlay');return}
  var enabled=-1,i;
  for(i=0;i<tracks.length;i++)if(tracks[i].enabled)enabled=i;
  var next=(enabled+1)%tracks.length;
  for(i=0;i<tracks.length;i++)tracks[i].enabled=(i===next);
  showToast('Аудио: '+(tracks[next].label||tracks[next].language||('дорожка '+(next+1))));
}

function saveHtmlProgress(video){
  if(!video||!video.currentSrc||!isFinite(video.duration)||video.duration<=0)return;
  var payload={
    source_url:video.currentSrc,
    position_ms:Math.round((video.currentTime||0)*1000),
    duration_ms:Math.round(video.duration*1000),
    completed:video.duration>0&&video.currentTime/video.duration>0.95
  };
  try{
    fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(function(){});
  }catch(_){}
}

function enhancePlayer(){
  var ui=$('#playerUi');
  var video=$('#htmlVideo');
  if(!ui||!video||$('#webPlayerControls'))return;

  var controls=document.createElement('div');
  controls.id='webPlayerControls';
  controls.className='web-player-controls';
  controls.innerHTML=''+
    '<button type="button" data-web-action="back">← Назад</button>'+
    '<button type="button" data-web-action="rewind">−10 сек</button>'+
    '<button type="button" class="web-play-primary" data-web-action="toggle">Пауза / ▶</button>'+
    '<button type="button" data-web-action="forward">+10 сек</button>'+
    '<button type="button" data-web-action="audio">Аудио</button>'+
    '<button type="button" data-web-action="subtitles">CC</button>'+
    '<button type="button" data-web-action="fullscreen">⛶</button>';
  ui.appendChild(controls);

  controls.addEventListener('click',function(e){
    var button=e.target.closest?e.target.closest('[data-web-action]'):null;
    if(!button)return;
    var action=button.getAttribute('data-web-action');
    if(action==='back'){saveHtmlProgress(video);sendKey(27);return}
    if(action==='rewind'){if(!video.classList.contains('hidden')&&isFinite(video.currentTime)){video.currentTime=Math.max(0,video.currentTime-10)}else sendKey(37);return}
    if(action==='forward'){if(!video.classList.contains('hidden')&&isFinite(video.currentTime)){video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10)}else sendKey(39);return}
    if(action==='toggle'){if(!video.classList.contains('hidden')){if(video.paused)video.play();else video.pause()}else sendKey(13);return}
    if(action==='audio'){cycleAudio(video);return}
    if(action==='subtitles'){cycleSubtitles(video);return}
    if(action==='fullscreen'){
      var player=$('#player');
      try{if(player.requestFullscreen)player.requestFullscreen();else if(player.webkitRequestFullscreen)player.webkitRequestFullscreen()}catch(_){}
    }
  });

  var progress=$('#playerUi .progress');
  if(progress){
    progress.classList.add('web-seekbar');
    progress.addEventListener('click',function(e){
      if(video.classList.contains('hidden')||!isFinite(video.duration)||video.duration<=0)return;
      var r=progress.getBoundingClientRect();
      var ratio=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));
      video.currentTime=video.duration*ratio;
      saveHtmlProgress(video);
    });
  }

  var lastSave=0;
  video.addEventListener('timeupdate',function(){
    var now=Date.now();
    if(now-lastSave>=5000){lastSave=now;saveHtmlProgress(video)}
  });
  video.addEventListener('pause',function(){saveHtmlProgress(video);var s=$('#playerState');if(s)s.textContent='❚❚'});
  video.addEventListener('play',function(){var s=$('#playerState');if(s)s.textContent='▶'});
  video.addEventListener('seeking',function(){saveHtmlProgress(video)});
  video.addEventListener('ended',function(){saveHtmlProgress(video)});

  window.addEventListener('pagehide',function(){saveHtmlProgress(video)});
  document.addEventListener('visibilitychange',function(){if(document.hidden)saveHtmlProgress(video)});
}

function enhanceEpisodePane(){
  var pane=$('#seriesPane');
  if(!pane||pane.getAttribute('data-web-scroll')==='1')return;
  pane.setAttribute('data-web-scroll','1');
  pane.addEventListener('wheel',function(e){
    if(pane.scrollHeight>pane.clientHeight+8){e.preventDefault();pane.scrollTop+=e.deltaY}
  },false);
}

function refreshEnhancements(){
  enhanceShelves();
  enhancePlayer();
  enhanceEpisodePane();
}

var observer=new MutationObserver(function(){refreshEnhancements()});
observer.observe(document.documentElement,{childList:true,subtree:true});
window.addEventListener('load',refreshEnhancements);
refreshEnhancements();
})();
