/* SLP — comportements communs des pages intérieures : bandeau transparent puis plein, diaporama du hero, apparition au défilement. */
(function(){
  var d=document,h=d.documentElement;h.classList.add('pm-js');
  var $$=function(s){return [].slice.call(d.querySelectorAll(s))};
  var run=function(){
    var hd=d.querySelector('header');
    if(hd){var f=function(){hd.classList.toggle('pm-solid',window.scrollY>40)};f();addEventListener('scroll',f,{passive:true});}
    var reduce=matchMedia('(prefers-reduced-motion:reduce)').matches;
    var sl=$$('.pm-slide'),dt=$$('.pm-dots i'),i=0;
    if(sl.length>1&&!reduce){setInterval(function(){sl[i].classList.remove('on');dt[i]&&dt[i].classList.remove('on');i=(i+1)%sl.length;sl[i].classList.add('on');dt[i]&&dt[i].classList.add('on')},6500)}
    var els=$$('.pm-rv,.section-head,.info-item,.show-card,.faq-it,.cat2,.gal li');
    els.forEach(function(el){el.classList.add('pm-rv')});
    if('IntersectionObserver' in window&&!reduce){
      var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('pm-in');io.unobserve(e.target)}})},{threshold:.08});
      els.forEach(function(el){io.observe(el)});
      setTimeout(function(){els.forEach(function(el){el.classList.add('pm-in')})},5000);
    }else{els.forEach(function(el){el.classList.add('pm-in')})}
  };
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',run);else run();
})();

/* Lecture automatique (muette, imposée par les navigateurs) de la 1re vidéo YouTube d'une fiche dès qu'elle est bien visible à l'écran. */
(function(){
  var d=document;
  var go=function(){
    if(matchMedia('(prefers-reduced-motion:reduce)').matches)return;
    var c=navigator.connection;if(c&&c.saveData)return;
    var f=d.querySelector('iframe[src*="youtube.com/embed/"],iframe[src*="youtube-nocookie.com/embed/"]');
    if(!f||!('IntersectionObserver' in window))return;
    if(!/[?&]enablejsapi=1/.test(f.src))f.src=f.src+(f.src.indexOf('?')<0?'?':'&')+'enablejsapi=1&origin='+encodeURIComponent(location.origin);
    var done=false;
    var cmd=function(fn,a){try{f.contentWindow.postMessage(JSON.stringify({event:'command',func:fn,args:a||[]}),'*')}catch(e){}};
    var play=function(){
      try{f.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*')}catch(e){}
      cmd('mute');cmd('playVideo');
    };
    var start=function(){
      var n=0,t=setInterval(function(){play();if(++n>=6)clearInterval(t)},700);
      play();
    };
    var io=new IntersectionObserver(function(es){
      if(done||!es[0].isIntersecting)return;
      done=true;io.disconnect();
      if(f.getAttribute('data-ready')==='1'){start()}else{f.addEventListener('load',start,{once:true});setTimeout(start,1200)}
    },{threshold:.6});
    f.addEventListener('load',function(){f.setAttribute('data-ready','1')});
    io.observe(f);
  };
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',go);else go();
})();
