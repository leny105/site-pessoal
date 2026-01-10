window.Instrumentation = (function(){
  var k = 'site.instrument';
  function log(name,payload){
    try{
      var o = {t:Date.now(),name:name,payload:payload||{}};
      var a = JSON.parse(localStorage.getItem(k)||'[]');
      a.push(o);
      if(a.length>1000) a = a.slice(-1000);
      localStorage.setItem(k, JSON.stringify(a));
      if(window.console && console.info) console.info('[I]', name, payload);
    }catch(e){}
  }
  return {log:log};
})();