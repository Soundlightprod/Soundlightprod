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

/* Lecteur épuré : aucun élément YouTube visible (barre, titre, logo, liens) ; commandes SLP : lecture/pause au clic et bouton son. */
(function(){
  var d=document;
  var st=d.createElement('style');
  st.textContent='.slp-vw{position:relative;overflow:hidden}.slp-vw iframe{pointer-events:none;position:absolute!important;top:50%!important;left:50%!important;width:100%!important;height:100%!important;transform:translate(-50%,-50%) scale(1.22)}'+
   '.slp-vc{position:absolute;inset:0;z-index:3;cursor:pointer;-webkit-tap-highlight-color:transparent}'+
   '.slp-vb{position:absolute;right:14px;bottom:14px;z-index:4;display:flex;gap:8px}'+
   '.slp-vb button{width:44px;height:44px;border-radius:50%;border:1px solid rgba(255,255,255,.35);background:rgba(8,7,16,.6);color:#fff;cursor:pointer;display:grid;place-items:center;backdrop-filter:blur(6px);transition:background .2s}'+
   '.slp-vb button:hover{background:rgba(8,7,16,.85)}.slp-vb button:focus-visible{outline:3px solid #fbc608;outline-offset:2px}.slp-vb svg{width:20px;height:20px;fill:currentColor}'+
   '.video-alt{display:none!important}';
  d.head.appendChild(st);
  var ICON={snd:'<svg viewBox="0 0 24 24"><path d="M3 9v6h4l5 4V5L7 9H3zm13.5 3A4.5 4.5 0 0 0 14 8v8a4.5 4.5 0 0 0 2.5-4zM14 3.2v2.1a7 7 0 0 1 0 13.4v2.1a9 9 0 0 0 0-17.6z"/></svg>',
            mut:'<svg viewBox="0 0 24 24"><path d="M16.5 12A4.5 4.5 0 0 0 14 8v2.2l2.5 2.5V12zM19 12a7 7 0 0 1-.9 3.4l1.5 1.5A9 9 0 0 0 21 12a9 9 0 0 0-7-8.8v2.1A7 7 0 0 1 19 12zM4.3 3 3 4.3 7.7 9H3v6h4l5 4v-6.7l4.3 4.3a7 7 0 0 1-2.3 1.2v2.1a9 9 0 0 0 3.7-1.9l2 2 1.3-1.3L4.3 3zM12 5 9.9 7.1 12 9.2V5z"/></svg>',
            pau:'<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zm8 0h4v14h-4z"/></svg>',ply:'<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>'};
  var setup=function(f){
    var w=f.parentElement;if(!w||w.classList.contains('slp-vw'))return;
    w.classList.add('slp-vw');
    var cs=getComputedStyle(w);if(cs.position==='static')w.style.position='relative';
    if(!/[?&]enablejsapi=1/.test(f.src))f.src=f.src+(f.src.indexOf('?')<0?'?':'&')+'enablejsapi=1&origin='+encodeURIComponent(location.origin);
    var ov=d.createElement('div');ov.className='slp-vc';ov.setAttribute('role','button');ov.setAttribute('tabindex','0');
    var bar=d.createElement('div');bar.className='slp-vb';
    var bp=d.createElement('button');bp.type='button';bp.setAttribute('aria-label','Pause');bp.innerHTML=ICON.pau;
    var bs=d.createElement('button');bs.type='button';bs.setAttribute('aria-label','Son');bs.innerHTML=ICON.mut;
    bar.appendChild(bp);bar.appendChild(bs);w.appendChild(ov);w.appendChild(bar);
    var playing=true,muted=true;
    var cmd=function(fn){try{f.contentWindow.postMessage(JSON.stringify({event:'command',func:fn,args:[]}),'*')}catch(e){}};
    var ui=function(){bp.innerHTML=playing?ICON.pau:ICON.ply;bp.setAttribute('aria-label',playing?'Pause':'Lecture');bs.innerHTML=muted?ICON.mut:ICON.snd;bs.setAttribute('aria-label',muted?'Activer le son':'Couper le son')};
    var tp=function(){playing=!playing;cmd(playing?'playVideo':'pauseVideo');ui()};
    var tm=function(){muted=!muted;cmd(muted?'mute':'unMute');ui()};
    ov.addEventListener('click',tp);ov.addEventListener('keydown',function(e){if(e.key==='Enter'||e.key===' '){e.preventDefault();tp()}});
    bp.addEventListener('click',function(e){e.stopPropagation();tp()});bs.addEventListener('click',function(e){e.stopPropagation();tm()});
    addEventListener('message',function(e){
      if(e.source!==f.contentWindow)return;
      try{var m=typeof e.data==='string'?JSON.parse(e.data):e.data;var i=m&&m.info;if(!i)return;
        if(typeof i.playerState==='number'){playing=(i.playerState===1||i.playerState===3)}
        if(typeof i.muted==='boolean')muted=i.muted;
        ui()}catch(x){}
    });
    f.addEventListener('load',function(){playing=true;muted=true;ui();try{f.contentWindow.postMessage(JSON.stringify({event:'listening',id:1,channel:'widget'}),'*')}catch(e){}});
    ui();
  };
  var go=function(){[].slice.call(d.querySelectorAll('iframe[src*="youtube.com/embed/"],iframe[src*="youtube-nocookie.com/embed/"]')).forEach(setup)};
  if(d.readyState==='loading')d.addEventListener('DOMContentLoaded',go);else go();
})();
