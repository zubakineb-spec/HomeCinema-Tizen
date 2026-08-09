(function(){
'use strict';

var lastDetails=null;
var restoredSource='';
var nativeFetch=window.fetch;

function $(s,root){return (root||document).querySelector(s)}
function $$(s,root){return Array.prototype.slice.call((root||document).querySelectorAll(s))}

function showToast(message){
  var toast=$('#toast');
  if(!toast)return;
  toast.textContent=message;
  toast.classList.remove('hidden');
  setTimeout(function(){toast.classList.add('hidden')},2200);
}

function api(path,opts){return fetch(path,opts).then(function(r){if(!r.ok)throw new Error('HTTP '+r.status);return r.json()})}

function progressSource(video){return (video&&video.getAttribute('data-original-source'))||video.currentSrc||video.src||''}
function playbackOffset(video){return Math.max(0,Number(video&&video.getAttribute('data-start-offset-ms')||0)||0)}

function patchProgressFetch(){
  if(!nativeFetch||window.__hcProgressFetchPatched)return;
  window.fetch=function(input,opts){
    try{
      var url=typeof input==='string'?input:(input&&input.url)||'';
      if(opts&&String(opts.method||'GET').toUpperCase()==='POST'&&url.indexOf('/api/progress')>=0&&opts.body){
        var p=JSON.parse(opts.body),v=$('#htmlVideo');
        if(v&&progressSource(v)){
          p.source_url=progressSource(v);
          p.position_ms=Math.max(0,Number(p.position_ms||0)+playbackOffset(v));
          p.completed=p.completed===true||Number(p.completed)!==0?1:0;
          opts=Object.assign({},opts,{body:JSON.stringify(p)});
        }
      }
    }catch(_){}
    return nativeFetch.call(window,input,opts);
  };
  window.__hcProgressFetchPatched=true;
}
patchProgressFetch();

function sendKey(code){
  var ev;
  try{ev=document.createEvent('Event');ev.initEvent('keydown',true,true);try{Object.defineProperty(ev,'keyCode',{get:function(){return code}})}catch(_){}try{Object.defineProperty(ev,'which',{get:function(){return code}})}catch(_){}document.dispatchEvent(ev)}catch(e){if(window.console)console.warn('Synthetic key failed',e)}
}

function scrollAmount(row){return Math.max(420,Math.floor(row.clientWidth*0.82))}
function scrollRow(row,delta){var target=Math.max(0,Math.min(row.scrollWidth-row.clientWidth,row.scrollLeft+delta));try{if(row.scrollTo)row.scrollTo({left:target,top:0,behavior:'smooth'});else row.scrollLeft=target}catch(_){row.scrollLeft=target}}
function updateShelfButtons(row){var shelf=row.parentNode;if(!shelf)return;var left=$('.shelf-arrow-left',shelf),right=$('.shelf-arrow-right',shelf);if(!left||!right)return;var max=Math.max(0,row.scrollWidth-row.clientWidth);left.disabled=row.scrollLeft<=4;right.disabled=row.scrollLeft>=max-4;shelf.classList.toggle('shelf-scrollable',max>8)}
function enhanceRow(row){
  if(!row||row.getAttribute('data-web-scroll')==='1')return;row.setAttribute('data-web-scroll','1');var shelf=row.parentNode;if(!shelf)return;
  var left=document.createElement('button');left.type='button';left.className='shelf-arrow shelf-arrow-left';left.setAttribute('aria-label','Прокрутить влево');left.innerHTML='‹';
  var right=document.createElement('button');right.type='button';right.className='shelf-arrow shelf-arrow-right';right.setAttribute('aria-label','Прокрутить вправо');right.innerHTML='›';shelf.appendChild(left);shelf.appendChild(right);
  left.onclick=function(){scrollRow(row,-scrollAmount(row));setTimeout(function(){updateShelfButtons(row)},260)};right.onclick=function(){scrollRow(row,scrollAmount(row));setTimeout(function(){updateShelfButtons(row)},260)};
  row.addEventListener('scroll',function(){updateShelfButtons(row)});row.addEventListener('wheel',function(e){if(row.scrollWidth<=row.clientWidth+8)return;if(Math.abs(e.deltaY)>=Math.abs(e.deltaX)){e.preventDefault();row.scrollLeft+=e.deltaY}},false);
  var dragging=false,startX=0,startLeft=0;row.addEventListener('mousedown',function(e){if(e.button!==0)return;if(e.target&&e.target.closest&&e.target.closest('button'))return;dragging=true;startX=e.clientX;startLeft=row.scrollLeft;row.classList.add('dragging')});document.addEventListener('mousemove',function(e){if(dragging)row.scrollLeft=startLeft-(e.clientX-startX)});document.addEventListener('mouseup',function(){if(dragging){dragging=false;row.classList.remove('dragging')}});setTimeout(function(){updateShelfButtons(row)},0)
}
function enhanceShelves(){$$('.row').forEach(enhanceRow)}

function formatTime(sec){sec=Math.max(0,Math.floor(Number(sec)||0));var h=Math.floor(sec/3600),m=Math.floor((sec%3600)/60),s=sec%60;return h>0?(h+':'+(m<10?'0':'')+m+':'+(s<10?'0':'')+s):(m+':'+(s<10?'0':'')+s)}

function loadBackendSubtitleTracks(video){
  var source=progressSource(video);if(!source)return;
  api('/api/playback/tracks?source_url='+encodeURIComponent(source)).then(function(x){
    var tracks=(x&&x.subtitles)||[];if(!tracks.length){showToast('Субтитры не обнаружены');return}
    openTrackPanel('Субтитры',tracks,function(t,panel){
      var old=$$('track[data-hc-backend="1"]',video);old.forEach(function(x){x.parentNode.removeChild(x)});
      for(var i=0;i<video.textTracks.length;i++)video.textTracks[i].mode='disabled';
      var tr=document.createElement('track');tr.kind='subtitles';tr.label=((t.language||'').toUpperCase()||'SUB')+(t.codec?' • '+t.codec:'');tr.srclang=t.language||'und';tr.src='/api/playback/subtitle?source_url='+encodeURIComponent(source)+'&stream_index='+encodeURIComponent(t.stream_index);tr.default=true;tr.setAttribute('data-hc-backend','1');video.appendChild(tr);
      tr.addEventListener('load',function(){try{tr.track.mode='showing';showToast('Субтитры: '+tr.label)}catch(_){}});
      if(panel&&panel.parentNode)panel.parentNode.removeChild(panel);
    });
  }).catch(function(){showToast('Не удалось получить список субтитров')});
}
function cycleSubtitles(video){
  var tracks=video&&video.textTracks;
  if(!tracks||!tracks.length){loadBackendSubtitleTracks(video);return}
  var current=-1,i;for(i=0;i<tracks.length;i++)if(tracks[i].mode==='showing')current=i;for(i=0;i<tracks.length;i++)tracks[i].mode='disabled';var next=current+1;if(next>=tracks.length){showToast('Субтитры: выкл.');return}tracks[next].mode='showing';showToast('Субтитры: '+(tracks[next].label||tracks[next].language||('дорожка '+(next+1))))
}

function openTrackPanel(title,tracks,onSelect){
  var old=$('#webAudioPanel');if(old)old.parentNode.removeChild(old);
  var panel=document.createElement('div');panel.id='webAudioPanel';panel.className='web-audio-panel';
  panel.innerHTML='<div class="web-audio-title">'+title+'</div>'+tracks.map(function(t,i){var label=(t.language||'').toUpperCase();if(t.title)label+=(label?' • ':'')+t.title;if(t.codec)label+=(label?' • ':'')+t.codec;return '<button type="button" data-track-index="'+i+'">'+(label||('Дорожка '+(i+1)))+'</button>'}).join('')+'<button type="button" data-close="1">Закрыть</button>';
  $('#player').appendChild(panel);panel.addEventListener('click',function(e){var b=e.target.closest?e.target.closest('button'):null;if(!b)return;if(b.getAttribute('data-close')){panel.parentNode.removeChild(panel);return}var i=Number(b.getAttribute('data-track-index'));if(isFinite(i)&&tracks[i])onSelect(tracks[i],panel)});return panel;
}
function loadBackendAudioTracks(video){
  var source=progressSource(video);if(!source)return;
  api('/api/playback/tracks?source_url='+encodeURIComponent(source)).then(function(x){var tracks=(x&&x.audio)||[];if(!tracks.length){showToast('Аудиодорожки не обнаружены');return}openTrackPanel('Аудиодорожки',tracks,function(t,panel){switchBackendAudio(video,source,t.stream_index,panel)})}).catch(function(){showToast('Не удалось получить список аудиодорожек')});
}
function cycleAudio(video){
  var tracks=video&&video.audioTracks;if(!tracks||!tracks.length){loadBackendAudioTracks(video);return}
  var enabled=-1,i;for(i=0;i<tracks.length;i++)if(tracks[i].enabled)enabled=i;var next=(enabled+1)%tracks.length;for(i=0;i<tracks.length;i++)tracks[i].enabled=(i===next);showToast('Аудио: '+(tracks[next].label||tracks[next].language||('дорожка '+(next+1))))
}

function saveHtmlProgress(video){
  var source=progressSource(video);if(!video||!source||!isFinite(video.duration)||video.duration<=0)return;
  var payload={source_url:source,position_ms:Math.round((video.currentTime||0)*1000),duration_ms:Math.round((video.duration||0)*1000+playbackOffset(video)),completed:(video.duration>0&&video.currentTime/video.duration>0.95)?1:0};
  try{fetch('/api/progress',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}).catch(function(){})}catch(_){}
}
function restoreHtmlProgress(video){
  var source=progressSource(video);if(!source||restoredSource===source)return;restoredSource=source;
  api('/api/progress?source_url='+encodeURIComponent(source)).then(function(p){var ms=Number(p.position_ms||0),completed=Number(p.completed||0);if(ms>15000&&completed!==1&&isFinite(video.duration)&&video.duration>0){var sec=Math.min(video.duration-1,ms/1000);if(sec>0){video.currentTime=sec;showToast('Продолжаем с '+formatTime(sec))}}}).catch(function(){});
}
function switchBackendAudio(video,source,streamIndex,panel){
  var absoluteMS=playbackOffset(video)+Math.max(0,isFinite(video.currentTime)?Math.floor(video.currentTime*1000):0);saveHtmlProgress(video);
  var url='/api/playback/audio?source_url='+encodeURIComponent(source)+'&stream_index='+encodeURIComponent(streamIndex)+'&start_ms='+absoluteMS;
  video.setAttribute('data-original-source',source);video.setAttribute('data-start-offset-ms',String(absoluteMS));restoredSource=source;video.src=url;video.load();video.play().then(function(){showToast('Аудиодорожка переключена')}).catch(function(){showToast('Не удалось запустить выбранную дорожку')});if(panel&&panel.parentNode)panel.parentNode.removeChild(panel)
}

function enhancePlayer(){
  var ui=$('#playerUi'),video=$('#htmlVideo');if(!ui||!video||$('#webPlayerControls'))return;
  var controls=document.createElement('div');controls.id='webPlayerControls';controls.className='web-player-controls';controls.innerHTML='<button type="button" data-web-action="back">← Назад</button><button type="button" data-web-action="rewind">−10 сек</button><button type="button" class="web-play-primary" data-web-action="toggle">Пауза / ▶</button><button type="button" data-web-action="forward">+10 сек</button><button type="button" data-web-action="audio">Аудио</button><button type="button" data-web-action="subtitles">CC</button><button type="button" data-web-action="fullscreen">⛶</button>';ui.appendChild(controls);
  controls.addEventListener('click',function(e){var button=e.target.closest?e.target.closest('[data-web-action]'):null;if(!button)return;var action=button.getAttribute('data-web-action');if(action==='back'){saveHtmlProgress(video);sendKey(27);return}if(action==='rewind'){if(!video.classList.contains('hidden')&&isFinite(video.currentTime)){video.currentTime=Math.max(0,video.currentTime-10)}else sendKey(37);return}if(action==='forward'){if(!video.classList.contains('hidden')&&isFinite(video.currentTime)){video.currentTime=Math.min(video.duration||Infinity,video.currentTime+10)}else sendKey(39);return}if(action==='toggle'){if(!video.classList.contains('hidden')){if(video.paused)video.play();else video.pause()}else sendKey(13);return}if(action==='audio'){cycleAudio(video);return}if(action==='subtitles'){cycleSubtitles(video);return}if(action==='fullscreen'){var player=$('#player');try{if(player.requestFullscreen)player.requestFullscreen();else if(player.webkitRequestFullscreen)player.webkitRequestFullscreen()}catch(_){}}});
  var progress=$('#playerUi .progress');if(progress){progress.classList.add('web-seekbar');progress.addEventListener('click',function(e){if(video.classList.contains('hidden')||!isFinite(video.duration)||video.duration<=0)return;var r=progress.getBoundingClientRect();var ratio=Math.max(0,Math.min(1,(e.clientX-r.left)/r.width));video.currentTime=video.duration*ratio;saveHtmlProgress(video)})}
  var lastSave=0;video.addEventListener('loadedmetadata',function(){if(!video.getAttribute('data-original-source')){video.setAttribute('data-original-source',video.currentSrc||video.src||'');video.setAttribute('data-start-offset-ms','0')}restoreHtmlProgress(video)});video.addEventListener('emptied',function(){if(!video.src){video.removeAttribute('data-original-source');video.removeAttribute('data-start-offset-ms');restoredSource=''}});video.addEventListener('timeupdate',function(){var now=Date.now();if(now-lastSave>=5000){lastSave=now;saveHtmlProgress(video)}});video.addEventListener('pause',function(){saveHtmlProgress(video);var s=$('#playerState');if(s)s.textContent='❚❚'});video.addEventListener('play',function(){var s=$('#playerState');if(s)s.textContent='▶'});video.addEventListener('seeking',function(){saveHtmlProgress(video)});video.addEventListener('ended',function(){saveHtmlProgress(video)});window.addEventListener('pagehide',function(){saveHtmlProgress(video)});document.addEventListener('visibilitychange',function(){if(document.hidden)saveHtmlProgress(video)})
}

function rememberDetailsClick(e){var card=e.target&&e.target.closest?e.target.closest('.card[data-type][data-id]'):null;if(card)lastDetails={type:card.getAttribute('data-type'),id:Number(card.getAttribute('data-id'))}}
function enhanceDetails(){
  var details=$('#details');if(!details||details.classList.contains('hidden')||!lastDetails)return;var key=lastDetails.type+':'+lastDetails.id;if(details.getAttribute('data-web-details')===key)return;details.setAttribute('data-web-details',key);var path=lastDetails.type==='movie'?'/api/movies/'+lastDetails.id:'/api/shows/'+lastDetails.id;
  api(path).then(function(item){var content=$('.details-content',details);if(!content)return;if(item.poster_url&&!$('.web-details-poster',details)){var poster=document.createElement('div');poster.className='web-details-poster';poster.style.backgroundImage='url("'+String(item.poster_url).replace(/"/g,'%22')+'")';details.appendChild(poster)}if(lastDetails.type!=='movie'||!item.source_url)return;return api('/api/progress?source_url='+encodeURIComponent(item.source_url)).then(function(p){var ms=Number(p.position_ms||0),dur=Number(p.duration_ms||0),completed=Number(p.completed||0);if(ms<=15000||dur<=0||completed===1)return;var buttons=$('.details-buttons',details);if(!buttons||$('[data-web-continue]',buttons))return;var btn=document.createElement('button');btn.type='button';btn.className='focusable primary web-continue-button';btn.setAttribute('data-web-continue','1');btn.textContent='▶ Продолжить с '+formatTime(ms/1000);btn.onclick=function(){var play=$('[data-source]',buttons);if(play)play.click()};buttons.insertBefore(btn,buttons.firstChild);var normal=$('[data-source]',buttons);if(normal&&normal!==btn)normal.classList.remove('primary')})}).catch(function(){});
}
function enhanceEpisodePane(){var pane=$('#seriesPane');if(!pane||pane.getAttribute('data-web-scroll')==='1')return;pane.setAttribute('data-web-scroll','1');pane.addEventListener('wheel',function(e){if(pane.scrollHeight>pane.clientHeight+8){e.preventDefault();pane.scrollTop+=e.deltaY}},false)}
function refreshEnhancements(){enhanceShelves();enhancePlayer();enhanceEpisodePane();enhanceDetails()}

document.addEventListener('click',rememberDetailsClick,true);var observer=new MutationObserver(function(){refreshEnhancements()});observer.observe(document.documentElement,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});window.addEventListener('load',refreshEnhancements);refreshEnhancements();
})();
