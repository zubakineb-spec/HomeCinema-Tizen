// Home Cinema Samsung TV target configuration.
// AVPlay lifecycle is owned by app.js; no monkey-patching on Tizen 4.0.
(function(){
  var backend='http://192.168.0.101:8096';
  window.HOME_CINEMA_API=backend;

  // Tizen Studio can launch an imported WGT with an http(s) origin. In that mode
  // app.js intentionally uses root-relative API URLs. Redirect only those API
  // calls to the configured QNAP backend; absolute media/image URLs are untouched.
  var nativeFetch=window.fetch;
  if(typeof nativeFetch==='function'){
    window.fetch=function(input,opts){
      if(typeof input==='string'&&input.indexOf('/api/')===0){
        input=backend+input;
      }
      return nativeFetch.call(window,input,opts);
    };
  }
})();
