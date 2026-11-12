// Script de la landing del embudo (capitaljuridico.com.ar/aplicar y /aplicar-gracias). Framer solo tiene
// <div id="cj-embudo"></div><script src=".../api/embudo-wa/script" defer></script>; todo lo demás vive acá.
// Colores y letras de la marca: verde #012D25, oro #BE8F49, crema #F2EADC, Source Serif 4 + Inter.
import { FACTURACIONES, URGENCIAS } from './letra'

export function scriptLanding(api: string, whatsapp: string, evento: string, logo = ''): string {
  const cfg = JSON.stringify({ api, whatsapp, evento, logo, facturaciones: FACTURACIONES, urgencias: URGENCIAS })
  return `(function(){
var C=${cfg};
var css='#cj-embudo{box-sizing:border-box;width:100%;max-width:560px;margin:0 auto;padding:32px 16px 48px;font-family:Inter,system-ui,sans-serif;color:#F2EADC}'
+'#cj-embudo *{box-sizing:border-box}'
+'#cj-embudo h1{font-family:"Source Serif 4",Georgia,serif;font-weight:600;color:#BE8F49;font-size:clamp(26px,6vw,36px);line-height:1.15;margin:0 0 12px;text-align:center}'
+'#cj-embudo p.sub{font-size:16px;line-height:1.5;margin:0 0 28px;text-align:center;color:#F2EADC}'
+'#cj-embudo form{display:grid;gap:18px;background:rgba(242,234,220,.05);border:1px solid rgba(190,143,73,.35);border-radius:16px;padding:24px}'
+'#cj-embudo label{display:grid;gap:8px;font-size:15px;line-height:1.35;font-weight:500}'
+'#cj-embudo .fila{display:grid;grid-template-columns:1fr 1fr;gap:14px}'
+'@media (max-width:480px){#cj-embudo .fila{grid-template-columns:1fr}}'
+'#cj-embudo input,#cj-embudo select{width:100%;font:inherit;font-size:16px;color:#1d1d1b;background:#F2EADC;border:1px solid #BE8F49;border-radius:10px;padding:13px 12px;min-height:48px}'
+'#cj-embudo input:focus,#cj-embudo select:focus{outline:2px solid #BE8F49;outline-offset:2px}'
+'#cj-embudo button,#cj-embudo a.wa{display:flex;align-items:center;justify-content:center;gap:10px;width:100%;min-height:54px;border:0;border-radius:12px;background:#BE8F49;color:#012D25;font:inherit;font-size:17px;font-weight:700;cursor:pointer;text-decoration:none}'
+'#cj-embudo button[disabled]{opacity:.6;cursor:wait}'
+'#cj-embudo .err{color:#F0B1B8;font-size:14px;min-height:1em;margin:0}'
+'#cj-embudo .nota{font-size:13px;opacity:.75;text-align:center;margin:14px 0 0}'
+'#cj-embudo .marca{display:block;margin:0 auto 18px;width:min(120px,32vw);height:auto}'
+'#cj-embudo .trampa{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}';
var st=document.createElement('style');st.textContent=css;document.head.appendChild(st);
function el(id){return document.getElementById(id)}
function esc(s){return String(s).replace(/[&<>"]/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]})}
function cookie(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):''}
function opciones(lista){return '<option value="" disabled selected>Elegí una opción</option>'+lista.map(function(o){return '<option>'+esc(o)+'</option>'}).join('')}
var raiz=el('cj-embudo');if(!raiz){raiz=document.createElement('div');raiz.id='cj-embudo'}function montar(){var ov=document.getElementById('overlay'),host=(ov&&ov.nextElementSibling)||document.body;if(raiz.parentElement!==host)host.insertBefore(raiz,host.firstChild);if(host!==document.body){host.style.height='auto';host.style.minHeight='calc(100vh - 94px)';host.style.background='#012D25';host.style.display='block';host.style.width='100%';host.style.alignSelf='stretch'}document.body.style.background='#012D25'}montar();window.addEventListener('load',function(){setTimeout(montar,50)});try{new MutationObserver(function(){if(!document.body.contains(raiz))montar()}).observe(document.body,{childList:true,subtree:true})}catch(e){}
var q=new URLSearchParams(location.search);
var marca=C.logo?'<img class="marca" src="'+C.logo+'" alt="Capital Jurídico" width="200" height="96">':'<p style="text-align:center;color:#BE8F49">Capital Jurídico</p>';
if(/gracias/.test(location.pathname)){
  var nombre=(q.get('n')||'').slice(0,40),id=q.get('id')||'';
  var msg='Hola! Completé el formulario y quiero más información para captar más y mejores clientes en mi estudio jurídico.';
  raiz.innerHTML=marca+'<h1>'+(nombre?'¡Listo, '+esc(nombre)+'!':'¡Listo!')+'</h1>'
    +'<p class="sub">Recibimos tus datos. El último paso es escribirnos por WhatsApp: ahí te contamos cómo podemos ayudarte a captar más y mejores clientes para tu estudio.</p>'
    +'<a class="wa" id="cj-wa" href="https://wa.me/'+C.whatsapp+'?text='+encodeURIComponent(msg)+'" target="_blank" rel="noopener">'
    +'<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path fill="#012D25" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8s-.4-.1-.6.1-.7.8-.8 1-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.3-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.9 11.9 0 0 0 4.6 4c1.7.7 2.4.8 3.2.7.5-.1 1.5-.6 1.7-1.2s.2-1.1.2-1.2l-.4-.3z"/></svg>'
    +'Hablame por WhatsApp</a>'
    +'<p class="nota">Te responde una persona de nuestro equipo, no un bot.</p>';
  el('cj-wa').addEventListener('click',function(){
    if(!id)return;var b=JSON.stringify({id:id});
    try{fetch(C.api+'/click',{method:'POST',headers:{'content-type':'application/json'},body:b,keepalive:true,mode:'cors'})}catch(e){}
  });
  return;
}
raiz.innerHTML=marca+'<h1>Contanos sobre tu estudio</h1>'
  +'<p class="sub">Completá estos datos y te contamos por WhatsApp cómo ayudarte a captar más y mejores clientes por medios digitales.</p>'
  +'<form id="cj-form" novalidate>'
  +'<div class="fila"><label>Nombre<input name="nombre" autocomplete="given-name" required maxlength="60"></label>'
  +'<label>Apellido<input name="apellido" autocomplete="family-name" required maxlength="60"></label></div>'
  +'<label>WhatsApp (con código de país y área)<input name="telefono" type="tel" inputmode="tel" autocomplete="tel" required placeholder="+54 9 11 1234 5678" maxlength="30"></label>'
  +'<label>Según los últimos 3 meses, ¿cuánto generó tu estudio por mes en promedio?<select name="facturacion" required>'+opciones(C.facturaciones)+'</select></label>'
  +'<label>¿Qué tan pronto querés resolver los obstáculos que hoy te impiden alcanzar tu meta de ingresos?<select name="urgencia" required>'+opciones(C.urgencias)+'</select></label>'
  +'<div class="trampa" aria-hidden="true"><input name="web" tabindex="-1" autocomplete="off"></div>'
  +'<p class="err" id="cj-err" role="alert"></p>'
  +'<button type="submit" id="cj-btn">Continuar</button>'
  +'</form>';
el('cj-form').addEventListener('submit',function(ev){
  ev.preventDefault();var f=ev.target,d={};
  ['nombre','apellido','telefono','facturacion','urgencia','web'].forEach(function(k){d[k]=(f.elements[k].value||'').trim()});
  var dig=d.telefono.replace(/\\D/g,'');
  if(!d.nombre||!d.apellido){el('cj-err').textContent='Completá tu nombre y apellido.';return}
  if(dig.length<10||dig.length>15){el('cj-err').textContent='Revisá tu WhatsApp: tiene que llevar código de país y área (por ejemplo +54 9 11 1234 5678).';return}
  if(!d.facturacion||!d.urgencia){el('cj-err').textContent='Elegí una opción en las dos preguntas.';return}
  el('cj-err').textContent='';var btn=el('cj-btn');btn.disabled=true;btn.textContent='Enviando…';
  ['utm_source','utm_medium','utm_campaign','utm_content','utm_term','fbclid'].forEach(function(k){if(q.get(k))d[k]=q.get(k)});
  d.fbp=cookie('_fbp');d.fbc=cookie('_fbc')||(q.get('fbclid')?'fb.1.'+Date.now()+'.'+q.get('fbclid'):'');d.url=location.href;
  fetch(C.api+'/lead',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d),mode:'cors'})
    .then(function(r){return r.json().then(function(j){if(!r.ok)throw new Error(j.error||'Error');return j})})
    .then(function(j){
      if(j.calificado&&window.fbq){try{fbq('trackCustom',C.evento,{},{eventID:j.id})}catch(e){}}
      setTimeout(function(){location.href='/aplicar-gracias?id='+encodeURIComponent(j.id||'')+'&n='+encodeURIComponent(d.nombre)},j.calificado?400:0);
    })
    .catch(function(){btn.disabled=false;btn.textContent='Continuar';el('cj-err').textContent='No pudimos enviar tus datos. Probá de nuevo en un momento.'});
});
})();`
}
