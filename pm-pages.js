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
