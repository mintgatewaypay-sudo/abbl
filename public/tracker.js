(function(){
  if(location.pathname.includes('/admin')) return;
  var key='appl_visitor_sid';
  var sid=sessionStorage.getItem(key);
  if(!sid){sid=Math.random().toString(36).slice(2)+Date.now().toString(36);sessionStorage.setItem(key,sid)}
  function page(){
    var p=location.pathname.replace(/^\//,'').replace('.html','');
    return p||'home';
  }
  function send(){
    fetch('/api/presence',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({session_id:sid,current_page:page()})
    }).then(function(r){return r.json()}).then(function(d){
      if(d&&d.redirectTo) location.href=d.redirectTo;
    }).catch(function(){});
  }
  send();
  setInterval(send,5000);
})();
