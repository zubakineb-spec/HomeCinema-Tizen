(function(){
'use strict';
if(typeof window.Response==='function')return;
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
})();
