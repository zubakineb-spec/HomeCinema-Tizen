'use strict';

const fs = require('fs');
const vm = require('vm');

function fail(message){throw new Error(message)}
const source=fs.readFileSync('tv-app/js/rc32-player-navigation.js','utf8');

function makeClassList(initial){
  const set=new Set(initial||[]);
  return {
    add:function(x){set.add(x)},
    remove:function(x){set.delete(x)},
    contains:function(x){return set.has(x)},
    toggle:function(x,on){if(on===undefined){if(set.has(x))set.delete(x);else set.add(x)}else if(on)set.add(x);else set.delete(x)}
  };
}

function makeClock(){
  let now=0,nextId=1,tasks=[];
  function setTimeoutFake(fn,delay){const task={id:nextId++,at:now+Number(delay||0),fn:fn,cancelled:false};tasks.push(task);return task.id}
  function clearTimeoutFake(id){tasks.forEach(function(t){if(t.id===id)t.cancelled=true})}
  function advance(ms){
    const end=now+ms;
    while(true){
      tasks.sort(function(a,b){return a.at-b.at||a.id-b.id});
      let ix=-1;
      for(let i=0;i<tasks.length;i++)if(!tasks[i].cancelled&&tasks[i].at<=end){ix=i;break}
      if(ix<0)break;
      const task=tasks.splice(ix,1)[0];now=task.at;task.fn();
    }
    now=end;
  }
  return {setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,advance:advance,now:function(){return now}};
}

function makeRuntime(){
  const clock=makeClock();
  const handlers={keydown:[],keyup:[]};
  const byId={};
  let documentRef=null;

  function element(id,classes,parent){
    const el={
      id:id||'',parentElement:parent||null,children:[],classList:makeClassList(classes||[]),style:{},textContent:'',disabled:false,
      matches:function(selector){
        if(selector==='.hidden')return this.classList.contains('hidden');
        if(selector==='#playerControls .player-focusable')return this.classList.contains('player-focusable')&&this.parentElement&&this.parentElement.id==='playerControls';
        if(selector.charAt(0)==='#')return this.id===selector.slice(1);
        if(selector.charAt(0)==='.')return this.classList.contains(selector.slice(1));
        return false;
      },
      focus:function(){documentRef.activeElement=this},
      blur:function(){if(documentRef.activeElement===this)documentRef.activeElement=null},
      appendChild:function(child){child.parentElement=this;this.children.push(child);if(child.id)byId[child.id]=child},
      querySelector:function(selector){if(selector.charAt(0)==='#')return byId[selector.slice(1)]||null;return null}
    };
    if(id)byId[id]=el;return el;
  }

  const player=element('player',[]);
  const chrome=element('playerChrome',[],player);
  const settings=element('playerSettings',['hidden'],player);
  const controls=element('playerControls',[],chrome);
  const timeline=element('playerTimelineButton',['progress','player-timeline-focusable'],chrome);
  const toggle=element('playerToggleButton',['player-focusable'],controls);
  const stateText=element('playerStateText',[],chrome);
  const hint=element('playerHint',['player-hint'],chrome);

  documentRef={
    activeElement:toggle,
    documentElement:{contains:function(){return true}},
    querySelector:function(selector){if(selector.charAt(0)==='#')return byId[selector.slice(1)]||null;if(selector==='.player-hint')return hint;return null},
    querySelectorAll:function(selector){if(selector==='.player-focusable,#playerTimelineButton')return [toggle,timeline];if(selector==='.player-focusable')return [toggle];return []},
    createElement:function(){return element('',[])},
    addEventListener:function(){}
  };

  const av={
    state:'PLAYING',pauseCalls:0,playCalls:0,seekCalls:[],seekResultState:'READY',
    getState:function(){return this.state},
    getCurrentTime:function(){return 60000},
    getDuration:function(){return 600000},
    pause:function(){this.pauseCalls++;this.state='PAUSED'},
    play:function(){this.playCalls++;this.state='PLAYING'},
    seekTo:function(target,success){this.seekCalls.push(target);this.state=this.seekResultState;if(success)success()}
  };

  const windowObj={setTimeout:clock.setTimeout,clearTimeout:clock.clearTimeout,addEventListener:function(type,fn){if(handlers[type])handlers[type].push(fn)}};
  windowObj.window=windowObj;
  const FakeDate={now:function(){return clock.now()}};
  const sandbox={window:windowObj,document:documentRef,webapis:{avplay:av},console:console,Math:Math,Number:Number,String:String,Array:Array,Object:Object,Date:FakeDate};
  vm.runInNewContext(source,sandbox,{filename:'rc32-player-navigation.js'});

  function fire(type,code){
    const e={keyCode:code,which:code,stopped:false,preventDefault:function(){},stopPropagation:function(){},stopImmediatePropagation:function(){this.stopped=true}};
    (handlers[type]||[]).forEach(function(fn){if(!e.stopped)fn(e)});
  }
  function focusTimeline(){timeline.classList.add('focused');timeline.focus()}
  return {clock:clock,av:av,fire:fire,focusTimeline:focusTimeline,timeline:timeline,toggle:toggle,stateText:stateText,byId:byId};
}

function testVisibleSurfaceRestored(){
  const r=makeRuntime();r.focusTimeline();
  const fill=r.byId.playerScrubFill,preview=r.byId.playerSeekPreview;
  fill.style.opacity='0';fill.style.visibility='hidden';preview.style.opacity='0';preview.style.visibility='hidden';preview.style.display='none';
  r.fire('keydown',39);
  if(!r.timeline.classList.contains('scrubbing'))fail('scrubbing class was not activated');
  if(fill.style.opacity!=='1'||fill.style.visibility!=='visible')fail('purple target fill was not restored after prior cleanup');
  if(preview.style.display!=='block'||preview.style.opacity!=='1'||preview.style.visibility!=='visible')fail('seek time preview was not restored after prior cleanup');
}

function testKeyupFastPath(){
  const r=makeRuntime();r.focusTimeline();r.fire('keydown',39);r.fire('keyup',39);
  if(r.av.seekCalls.length!==1)fail('keyup must commit exactly one seek');
  if(r.av.seekCalls[0]!==70000)fail('short Right tap must choose exactly +10 seconds');
  if(r.av.state!=='PLAYING')fail('READY seek callback state was not auto-resumed');
  if(r.av.playCalls<1)fail('autoresume did not call play for non-PLAYING state');
}

function testNoKeyupShortTap(){
  const r=makeRuntime();r.focusTimeline();r.fire('keydown',39);
  r.clock.advance(1099);
  if(r.av.seekCalls.length!==0)fail('no-keyup short tap committed before fallback deadline');
  r.clock.advance(1);
  if(r.av.seekCalls.length!==1)fail('no-keyup short tap did not commit after fallback deadline');
  if(r.av.seekCalls[0]!==70000)fail('no-keyup short tap target drifted from +10 seconds');
  if(r.av.state!=='PLAYING')fail('no-keyup short tap did not resume playback');
}

function testNoKeyupHoldAdaptiveRelease(){
  const r=makeRuntime();r.focusTimeline();
  r.fire('keydown',39);
  r.clock.advance(300);r.fire('keydown',39); // first repeat confirms hold; learned cadence 300ms -> release delay 780ms
  if(r.av.pauseCalls!==1)fail('confirmed hold must pause playback once');
  if(r.av.seekCalls.length!==0)fail('hold confirmation performed an intermediate seek');
  r.clock.advance(200);r.fire('keydown',39); // EWMA cadence -> adaptive release stays safely above repeat interval
  r.clock.advance(200);r.fire('keydown',39);
  r.clock.advance(200);r.fire('keydown',39);
  if(r.av.seekCalls.length!==0)fail('held repeat stream performed an intermediate seek');
  r.clock.advance(519);
  if(r.av.seekCalls.length!==0)fail('adaptive release committed too early');
  r.clock.advance(400);
  if(r.av.seekCalls.length!==1)fail('repeat-stream silence did not commit exactly one seek');
  if(!(r.av.seekCalls[0]>70000))fail('held Right did not move target beyond initial +10 seconds');
  if(r.av.state!=='PLAYING')fail('held scrub did not auto-resume playback');
}

try{
  testVisibleSurfaceRestored();
  testKeyupFastPath();
  testNoKeyupShortTap();
  testNoKeyupHoldAdaptiveRelease();
  console.log('PASS: purple scrub target and time preview reappear after RC3.16 cleanup');
  console.log('PASS: keyup commits one seek and resumes even when Tizen reports READY at callback');
  console.log('PASS: no-keyup short tap commits automatically without OK');
  console.log('PASS: adaptive repeat-gap silence commits held scrub once and auto-resumes playback');
  console.log('HOME_CINEMA_RC325_SCRUB_RUNTIME=PASS');
}catch(err){console.error(err&&err.stack?err.stack:err);process.exit(1)}
