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
  function setTimeoutFake(fn,delay){
    const task={id:nextId++,at:now+Number(delay||0),fn:fn,cancelled:false};
    tasks.push(task);return task.id;
  }
  function clearTimeoutFake(id){tasks.forEach(function(t){if(t.id===id)t.cancelled=true})}
  function advance(ms){
    const end=now+ms;
    while(true){
      tasks.sort(function(a,b){return a.at-b.at||a.id-b.id});
      let ix=-1;
      for(let i=0;i<tasks.length;i++)if(!tasks[i].cancelled&&tasks[i].at<=end){ix=i;break}
      if(ix<0)break;
      const task=tasks.splice(ix,1)[0];
      now=task.at;task.fn();
    }
    now=end;
  }
  return {setTimeout:setTimeoutFake,clearTimeout:clearTimeoutFake,advance:advance,now:function(){return now}};
}

function makeRuntime(){
  const clock=makeClock();
  const handlers={keydown:[],keyup:[]};
  const byId={};
  const all=[];
  let documentRef=null;

  function element(id,classes,parent){
    const el={
      id:id||'',
      parentElement:parent||null,
      children:[],
      classList:makeClassList(classes||[]),
      style:{},
      textContent:'',
      disabled:false,
      matches:function(selector){
        if(selector==='.hidden')return this.classList.contains('hidden');
        if(selector==='#playerControls .player-focusable')return this.classList.contains('player-focusable')&&this.parentElement&&this.parentElement.id==='playerControls';
        if(selector.charAt(0)==='#')return this.id===selector.slice(1);
        if(selector.charAt(0)==='.')return this.classList.contains(selector.slice(1));
        return false;
      },
      focus:function(){documentRef.activeElement=this},
      blur:function(){if(documentRef.activeElement===this)documentRef.activeElement=null},
      appendChild:function(child){child.parentElement=this;this.children.push(child);if(child.id)byId[child.id]=child;all.push(child)},
      querySelector:function(selector){
        if(selector.charAt(0)==='#')return byId[selector.slice(1)]||null;
        return null;
      }
    };
    if(id)byId[id]=el;all.push(el);return el;
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
    querySelector:function(selector){
      if(selector.charAt(0)==='#')return byId[selector.slice(1)]||null;
      if(selector==='.player-hint')return hint;
      return null;
    },
    querySelectorAll:function(selector){
      if(selector==='.player-focusable,#playerTimelineButton')return [toggle,timeline];
      if(selector==='.player-focusable')return [toggle];
      return [];
    },
    createElement:function(){return element('',[])},
    addEventListener:function(){}
  };

  const av={
    state:'PLAYING',
    pauseCalls:0,
    playCalls:0,
    seekCalls:[],
    getState:function(){return this.state},
    getCurrentTime:function(){return 60000},
    getDuration:function(){return 600000},
    pause:function(){this.pauseCalls++;this.state='PAUSED'},
    play:function(){this.playCalls++;this.state='PLAYING'},
    seekTo:function(target,success){this.seekCalls.push(target);if(success)success()}
  };

  const windowObj={
    setTimeout:clock.setTimeout,
    clearTimeout:clock.clearTimeout,
    addEventListener:function(type,fn){if(handlers[type])handlers[type].push(fn)}
  };
  windowObj.window=windowObj;

  const sandbox={
    window:windowObj,
    document:documentRef,
    webapis:{avplay:av},
    console:console,
    Math:Math,
    Number:Number,
    String:String,
    Array:Array,
    Object:Object
  };
  vm.runInNewContext(source,sandbox,{filename:'rc32-player-navigation.js'});

  function fire(type,code){
    const e={
      keyCode:code,which:code,stopped:false,
      preventDefault:function(){},
      stopPropagation:function(){},
      stopImmediatePropagation:function(){this.stopped=true}
    };
    (handlers[type]||[]).forEach(function(fn){if(!e.stopped)fn(e)});
  }
  function focusTimeline(){
    timeline.classList.add('focused');timeline.focus();
  }

  return {clock:clock,av:av,fire:fire,focusTimeline:focusTimeline,timeline:timeline,toggle:toggle,stateText:stateText};
}

function testUpFocus(){
  const r=makeRuntime();
  r.fire('keydown',38);
  if(!r.timeline.classList.contains('focused'))fail('Up did not move focus from player controls to timeline');
}

function testKeyupFastPath(){
  const r=makeRuntime();r.focusTimeline();
  r.fire('keydown',39);
  if(r.av.seekCalls.length!==0)fail('first Right keydown performed an immediate seek');
  r.fire('keyup',39);
  if(r.av.seekCalls.length!==1)fail('keyup must commit exactly one seek');
  if(r.av.seekCalls[0]!==70000)fail('short Right tap must choose exactly +10 seconds');
}

function testNoKeyupShortTap(){
  const r=makeRuntime();r.focusTimeline();
  r.fire('keydown',39);
  r.clock.advance(749);
  if(r.av.seekCalls.length!==0)fail('no-keyup short tap committed before initial fallback deadline');
  if(r.av.pauseCalls!==0)fail('short tap must not pause playback while waiting for no-keyup fallback');
  r.clock.advance(1);
  if(r.av.seekCalls.length!==1)fail('no-keyup short tap did not commit exactly once after quiet period');
  if(r.av.seekCalls[0]!==70000)fail('no-keyup short tap target drifted from +10 seconds');
}

function testNoKeyupHold(){
  const r=makeRuntime();r.focusTimeline();
  r.fire('keydown',39);
  r.clock.advance(300);
  r.fire('keydown',39); // Samsung repeat confirms physical hold.
  if(r.av.pauseCalls!==1)fail('confirmed hold must pause playback once while target is moving');
  if(r.av.seekCalls.length!==0)fail('hold confirmation performed an intermediate seek');
  r.clock.advance(120);r.fire('keydown',39);
  r.clock.advance(120);r.fire('keydown',39);
  r.clock.advance(120);r.fire('keydown',39);
  if(r.av.seekCalls.length!==0)fail('held repeat stream performed an intermediate seek');
  r.clock.advance(359);
  if(r.av.seekCalls.length!==0)fail('hold committed before repeat stream became quiet');
  r.clock.advance(1);
  if(r.av.seekCalls.length!==1)fail('repeat-stream silence must commit exactly one seek');
  if(!(r.av.seekCalls[0]>70000))fail('held Right did not move target beyond the initial +10 seconds');
  if(r.av.state!=='PLAYING')fail('playback was not resumed after held scrub commit');
}

try{
  testUpFocus();
  testKeyupFastPath();
  testNoKeyupShortTap();
  testNoKeyupHold();
  console.log('PASS: Up moves focus to timeline');
  console.log('PASS: keyup remains an immediate one-seek release path');
  console.log('PASS: Samsung no-keyup short tap commits +10s after quiet fallback without pausing');
  console.log('PASS: repeated keydown confirms hold; repeat silence commits exactly one seek and resumes playback');
  console.log('HOME_CINEMA_RC324_SAMSUNG_RELEASE_RUNTIME=PASS');
}catch(err){
  console.error(err&&err.stack?err.stack:err);
  process.exit(1);
}
