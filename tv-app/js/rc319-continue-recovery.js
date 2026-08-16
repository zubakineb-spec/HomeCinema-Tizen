(function(){
'use strict';

var previousFetch=window.fetch;
var END_RATIO=0.9995;
var END_MARGIN_MS=2000;
var manualStopUntil=0;

function $(selector,root){return (root||document).querySelector(selector)}
function requestMethod(opts){return String(opts&&opts.method||'GET').toUpperCase()}
function apiPath(input){
  var value=typeof input==='string'?input:(input&&input.url)||'';
  var ix=String(value).indexOf('/api/');
  return ix>=0?String(value).substring(ix):'';
}
function apiSibling(input,path){
  var value=typeof input==='string'?input:(input&&input.url)||'';
  value=String(value||'');
  var ix=value.indexOf('/api/');
  return ix>=0?value.substring(0,ix)+path:path;
}
function playerVisible(){var p=$('#player');return !!p&&!p.classList.contains('hidden')}
function number(v){var n=Number(v);return isFinite(n)?n:0}
function bool(v){return v===true||v===1||v==='1'||String(v).toLowerCase()==='true'}
function copyObject(value){var out={};for(var key in value)if(Object.prototype.hasOwnProperty.call(value,key))out[key]=value[key];return out}
function progressRatio(item){var d=number(item&&item.duration_ms),p=number(item&&item.position_ms);return d>0?Math.max(0,Math.min(1,p/d)):0}
function effectiveIncomplete(item){
  if(!item)return false;
  if(!bool(item.completed))return number(item.position_ms)>0;
  var d=number(item.duration_ms),p=number(item.position_ms);
  if(d<=0||p<=0)return false;
  var remaining=Math.max(0,d-p),ratio=progressRatio(item);
  return remaining>END_MARGIN_MS&&ratio<END_RATIO;
}
function rewriteProgressOptions(opts){
  if(!opts||!opts.body)return opts;
  try{
    var body=JSON.parse(String(opts.body||'{}'));
    if(!body||!body.source_url)return opts;
    var completed=bool(body.completed),d=number(body.duration_ms),p=number(body.position_ms);
    var nearEnd=d>0&&(Math.max(0,d-p)<=END_MARGIN_MS||p/d>=END_RATIO);
    if(completed&&(playerVisible()||Date.now()<manualStopUntil||!nearEnd))completed=false;
    body.completed=completed?1:0;
    body.rc319_progress_contract=319;
    var next=copyObject(opts);next.body=JSON.stringify(body);return next;
  }catch(_){return opts}
}
function chooseHistoryCandidate(items){
  if(!items||!items.length)return null;
  var started=null,startedMS=0,i,item,value;
  for(i=0;i<items.length;i++){
    item=items[i];value=number(item.started_at_ms);
    if(value<=0)continue;
    if(!started||value>startedMS||(value===startedMS&&String(item.updated_at||'')>String(started.updated_at||''))){started=item;startedMS=value}
  }
  if(started)return started;
  var legacy=null;
  for(i=0;i<items.length;i++){
    item=items[i];if(!legacy){legacy=item;continue}
    var s=number(item.season),e=number(item.episode),ls=number(legacy.season),le=number(legacy.episode);
    if(s>ls||(s===ls&&e>le)||(s===ls&&e===le&&String(item.updated_at||'')>String(legacy.updated_at||'')))legacy=item;
  }
  return legacy;
}
function recoveredEpisodes(historyItems){
  var groups={},out={},i,item,showId,candidate;
  historyItems=historyItems||[];
  for(i=0;i<historyItems.length;i++){
    item=historyItems[i];
    if(!item||String(item.media_type||'')!=='episode')continue;
    showId=number(item.show_id);if(showId<=0||number(item.position_ms)<=0||number(item.duration_ms)<=0)continue;
    if(!groups[showId])groups[showId]=[];groups[showId].push(item);
  }
  for(showId in groups)if(Object.prototype.hasOwnProperty.call(groups,showId)){
    candidate=chooseHistoryCandidate(groups[showId]);
    if(!candidate||!effectiveIncomplete(candidate))continue;
    var fixed=copyObject(candidate);fixed.completed=0;fixed.progress_percent=progressRatio(candidate)*100;fixed.rc319_recovered=true;out[String(showId)]=fixed;
  }
  return out;
}
function mergeContinueData(data,history){
  data=data&&typeof data==='object'?data:{items:[]};
  var serverItems=Object.prototype.toString.call(data.items)==='[object Array]'?data.items:[];
  var historyItems=history&&Object.prototype.toString.call(history.items)==='[object Array]'?history.items:[];
  var recovery=recoveredEpisodes(historyItems),used={},result=[],seenShows={},i,item,showId,key;
  for(i=0;i<serverItems.length;i++){
    item=serverItems[i];if(!item||typeof item!=='object')continue;
    if(String(item.media_type||'')==='episode'&&number(item.show_id)>0){
      showId=number(item.show_id);key=String(showId);
      if(seenShows[key])continue;
      seenShows[key]=true;
      if(recovery[key]){result.push(recovery[key]);used[key]=true}else result.push(item);
    }else result.push(item);
  }
  for(key in recovery)if(Object.prototype.hasOwnProperty.call(recovery,key)&&!used[key])result.push(recovery[key]);
  data.items=result.slice(0,20);
  try{window.localStorage.setItem('homecinema.cache./api/continue',JSON.stringify(data))}catch(_){}
  return data;
}
function jsonResponseLike(original,data){
  var status=number(original&&original.status)||200;
  if(typeof window.Response==='function'){
    try{return new window.Response(JSON.stringify(data),{status:status,headers:{'Content-Type':'application/json; charset=utf-8'}})}catch(_){}
  }
  var text=JSON.stringify(data);
  return {ok:status>=200&&status<300,status:status,json:function(){return Promise.resolve(JSON.parse(text))},text:function(){return Promise.resolve(text)},clone:function(){return jsonResponseLike(original,data)}};
}
function mergeContinueResponse(input,opts){
  return previousFetch(input,opts).then(function(resp){
    if(!resp||!resp.ok||!resp.clone)return resp;
    var clone;try{clone=resp.clone()}catch(_){return resp}
    return clone.json().then(function(data){
      return previousFetch(apiSibling(input,'/api/history'),{method:'GET'}).then(function(historyResp){
        if(!historyResp||!historyResp.ok)return resp;
        return historyResp.json().then(function(history){return jsonResponseLike(resp,mergeContinueData(data,history))},function(){return resp});
      },function(){return resp});
    },function(){return resp});
  });
}

if(typeof previousFetch==='function'){
  window.fetch=function(input,opts){
    var path=apiPath(input),method=requestMethod(opts);
    if(method==='POST'&&path==='/api/progress')opts=rewriteProgressOptions(opts);
    if(method==='GET'&&path.indexOf('/api/continue')===0)return mergeContinueResponse(input,opts);
    return previousFetch(input,opts);
  };
}

window.addEventListener('keydown',function(e){
  if(!playerVisible())return;
  var code=Number(e.keyCode||e.which||0);
  if(code===10009||code===27||code===413)manualStopUntil=Date.now()+3500;
},true);

window.HOME_CINEMA_RC319={
  marker:'rc3.19-explicit-completion',
  endRatio:END_RATIO,
  endMarginMs:END_MARGIN_MS,
  rewriteProgressOptions:rewriteProgressOptions,
  mergeContinueData:mergeContinueData,
  recoveredEpisodes:recoveredEpisodes
};
window.HOME_CINEMA_RC='rc3.19-explicit-completion';
})();
