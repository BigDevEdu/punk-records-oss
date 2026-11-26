// Biblioteca isométrica compartilhada pelas animações do README (estilo diagrama-iso, acento roxo).
// A página define antes: W, H, T, FPS, OX, OY, S e um <svg id="stage">.
// Exportar: python render.py <pagina>.html --mp4 x.mp4 --gif x.gif (ver README desta pasta)
const clamp=(x,a=0,b=1)=>Math.min(b,Math.max(a,x));
const lerp=(a,b,p)=>a+(b-a)*p;
const mod=(x,m)=>((x%m)+m)%m;
const ease={ inOut:p=>p<.5?4*p*p*p:1-Math.pow(-2*p+2,3)/2,
             out:p=>1-Math.pow(1-p,3), back:p=>1+2.7*Math.pow(p-1,3)+1.7*Math.pow(p-1,2) };
const seg=(t,a,b,e=ease.inOut)=>e(clamp((t-a)/(b-a)));
const cyc=(t,n)=>((t*n/T)%1+1)%1;
const win=(t,a,b,f=.25)=>Math.min(seg(t,a-f,a),1-seg(t,b,b+f)); // 0→1→0 no trecho [a,b]

const C={bg:'#eeeeee',slabTop:'#f8f8f8',slabL:'#e4e4e4',slabR:'#d8d8d8',tab:'#8c8c8c',
  top:'#ffffff',fy:'#ececec',fx:'#dadada',edge:'#a2a2a2',icon:'#6e6e6e',
  or:'#7C3AED',pad:'#D9C9FB',line:'#5c5c5c',ink:'#2b2b2b',grey:'#6a6a6a',off:'#bdbdbd'};
const PUR={top:'#A78BFA',fy:'#8B5CF6',fx:'#6D28D9'}, PUR2={top:'#EDE9FE',fy:'#C4B5FD',fx:'#A78BFA'},
      GRY={top:'#E2E8F0',fy:'#CBD5E1',fx:'#94A3B8'};

const CS=Math.cos(Math.PI/6),SN=Math.sin(Math.PI/6);
const iso=(x,y,z=0)=>[OX+(x-y)*CS*S, OY+((x+y)*SN-z)*S];
const pts=a=>a.map(p=>iso(...p).map(v=>v.toFixed(1)).join(',')).join(' ');
const mTop=(x,y,z)=>{const [e,f]=iso(x,y,z);return `matrix(${CS*S},${SN*S},${-CS*S},${SN*S},${e},${f})`;};
const mEdgeY=(x,y,z)=>{const [e,f]=iso(x,y,z);return `matrix(${CS*S},${-SN*S},${CS*S},${SN*S},${e},${f})`;};
const mFaceX=(x,y,z)=>{const [e,f]=iso(x,y,z);return `matrix(${CS*S},${-SN*S},0,${S},${e},${f})`;};
const mFaceY=(x,y,z)=>{const [e,f]=iso(x,y,z);return `matrix(${CS*S},${SN*S},0,${S},${e},${f})`;};

const NS='http://www.w3.org/2000/svg',stage=document.getElementById('stage');
function el(tag,attrs={},parent=stage){const e=document.createElementNS(NS,tag);
  for(const k in attrs)e.setAttribute(k,attrs[k]);parent.appendChild(e);return e;}

el('rect',{width:W,height:H,fill:C.bg});
const defs=el('defs');
{const fl=el('filter',{id:'blur',x:'-50%',y:'-50%',width:'200%',height:'200%'},defs);el('feGaussianBlur',{stdDeviation:7},fl);
 const fs=el('filter',{id:'tagsh',x:'-30%',y:'-30%',width:'160%',height:'180%'},defs);
 el('feDropShadow',{dx:0,dy:3,stdDeviation:4,'flood-color':'#000','flood-opacity':.14},fs);
 const lg=el('linearGradient',{id:'arrowg',x1:0,y1:0,x2:1,y2:0},defs);
 el('stop',{offset:0,'stop-color':C.or,'stop-opacity':0},lg);el('stop',{offset:.55,'stop-color':C.or,'stop-opacity':.85},lg);el('stop',{offset:1,'stop-color':C.or,'stop-opacity':1},lg);}

const L={slab:el('g'),pad:el('g'),shadow:el('g',{filter:'url(#blur)'}),route:el('g'),pk:el('g'),obj:el('g'),tag:el('g'),ui:el('g')};
const noShadow=el('g',{display:'none'});

function slab(x0,y0,w,d,h,title){
  el('polygon',{points:pts([[x0+w,y0,0],[x0+w,y0+d,0],[x0+w,y0+d,h],[x0+w,y0,h]]),fill:C.slabR},L.slab);
  el('polygon',{points:pts([[x0,y0+d,0],[x0+w,y0+d,0],[x0+w,y0+d,h],[x0,y0+d,h]]),fill:C.slabL},L.slab);
  el('polygon',{points:pts([[x0,y0,h],[x0+w,y0,h],[x0+w,y0+d,h],[x0,y0+d,h]]),fill:C.slabTop,stroke:'#e2e2e2','stroke-width':1},L.slab);
  if(title){const tw=title.length*15+40;const ye=y0+d-24;
    el('polygon',{points:pts([[x0+16,ye,h],[x0+16,ye-tw,h],[x0+50,ye-tw,h],[x0+50,ye,h]]),fill:C.tab},L.slab);
    const g=el('g',{transform:mEdgeY(x0+42,ye-20,h)},L.slab);
    el('text',{x:0,y:0,'font-size':21,'font-weight':700,fill:'#fff','letter-spacing':2},g).textContent=title;}
}
function pad(x0,y0,w,d,r,z,fill,op){const P=[];const arc=(cx,cy,a0)=>{for(let k=0;k<=6;k++){const a=a0+k*Math.PI/12;P.push([cx+r*Math.cos(a),cy+r*Math.sin(a),z]);}};
  arc(x0+w-r,y0+d-r,0);arc(x0+r,y0+d-r,Math.PI/2);arc(x0+r,y0+r,Math.PI);arc(x0+w-r,y0+r,1.5*Math.PI);
  return el('polygon',{points:pts(P),fill,opacity:op},L.pad);}
// contorno de uma placa (destaque sólido ou tracejado), invisível até o render mudar a opacidade
const outline=(p,dash)=>el('polygon',{points:p.getAttribute('points'),fill:'none',stroke:C.or,'stroke-width':3,...(dash?{'stroke-dasharray':'9 7'}:{}),opacity:0},L.pad);
// texto deitado no plano z, lendo ao longo de +x
function floorText(x,y,z,text,size=18,fill=C.grey){const g=el('g',{transform:mTop(x,y,z)},L.slab);
  el('text',{x:0,y:0,'font-size':size,'font-weight':700,fill,'letter-spacing':2},g).textContent=text;return g;}

function cube(g,shadowG,col){const sh=el('polygon',{fill:'#000',opacity:.16},shadowG);
  const c=col||{top:C.top,fy:C.fy,fx:C.fx};
  const mk=f=>el('polygon',{fill:f,stroke:col?'none':C.edge,'stroke-width':1.3,'stroke-linejoin':'round'},g);
  const R=mk(c.fx),Lf=mk(c.fy),top=mk(c.top);
  return {sh,R,L:Lf,top,set(x0,y0,z0,w,d,h){const z1=z0+h;
    sh.setAttribute('points',pts([[x0+10,y0+10,z0],[x0+w+16,y0+10,z0],[x0+w+16,y0+d+16,z0],[x0+10,y0+d+16,z0]]));
    top.setAttribute('points',pts([[x0,y0,z1],[x0+w,y0,z1],[x0+w,y0+d,z1],[x0,y0+d,z1]]));
    R.setAttribute('points',pts([[x0+w,y0,z0],[x0+w,y0+d,z0],[x0+w,y0+d,z1],[x0+w,y0,z1]]));
    Lf.setAttribute('points',pts([[x0,y0+d,z0],[x0+w,y0+d,z0],[x0+w,y0+d,z1],[x0,y0+d,z1]]));}};}
// componente: cubo centrado em (x,y) com ícone no topo; on = cópia roxa do ícone (opacidade no render)
function box(x,y,z,s,h,icon,parent=L.obj){const g=el('g',{},parent);const c=cube(g,L.shadow);c.set(x-s/2,y-s/2,z,s,s,h);
  const ig=el('g',{transform:mTop(x,y,z+h)},g);const a=el('g',{},ig),on=el('g',{opacity:0},ig);
  if(icon){ICON[icon](a,C.icon);ICON[icon](on,C.or);}return {g,c,on};}
const ICON={
  gear(g,c){el('circle',{r:15,fill:'none',stroke:c,'stroke-width':8,'stroke-dasharray':'5.2 4.2'},g);el('circle',{r:12,fill:c},g);el('circle',{r:5,fill:'#fff'},g);},
  user(g,c){el('circle',{cx:0,cy:-9,r:8,fill:c},g);el('path',{d:'M-15 16 Q-15 2 0 2 Q15 2 15 16 Z',fill:c},g);},
  screen(g,c){el('rect',{x:-18,y:-16,width:36,height:24,rx:3,fill:'none',stroke:c,'stroke-width':3},g);el('line',{x1:-8,y1:16,x2:8,y2:16,stroke:c,'stroke-width':3,'stroke-linecap':'round'},g);el('line',{x1:0,y1:8,x2:0,y2:16,stroke:c,'stroke-width':3},g);},
  code(g,c){el('path',{d:'M-8 -12 L-18 0 L-8 12 M8 -12 L18 0 L8 12',fill:'none',stroke:c,'stroke-width':3.4,'stroke-linecap':'round','stroke-linejoin':'round'},g);},
  shield(g,c){el('path',{d:'M0 -26 L21 -18 V0 C21 14 11 22 0 27 C-11 22 -21 14 -21 0 V-18 Z',fill:'none',stroke:c,'stroke-width':4,'stroke-linejoin':'round'},g);
    el('path',{d:'M-8 1 L-2 7 L10 -6',fill:'none',stroke:c,'stroke-width':4,'stroke-linecap':'round','stroke-linejoin':'round'},g);},
  lock(g,c){el('rect',{x:-15,y:-4,width:30,height:22,rx:4,fill:c},g);el('path',{d:'M-9 -4 V-11 A9 9 0 0 1 9 -11 V-4',fill:'none',stroke:c,'stroke-width':4},g);},
  key(g,c){el('circle',{cx:-9,cy:0,r:9,fill:'none',stroke:c,'stroke-width':4},g);el('path',{d:'M0 0 H20 M14 0 V8 M20 0 V6',fill:'none',stroke:c,'stroke-width':4,'stroke-linecap':'round'},g);},
  doc(g,c){el('path',{d:'M-13 -18 H5 L13 -10 V18 H-13 Z',fill:'none',stroke:c,'stroke-width':3,'stroke-linejoin':'round'},g);[-4,3,10].forEach(y=>el('line',{x1:-7,y1:y,x2:7,y2:y,stroke:c,'stroke-width':2.6,'stroke-linecap':'round'},g));},
  list(g,c){[-10,0,10].forEach(y=>{el('circle',{cx:-13,cy:y,r:2.8,fill:c},g);el('line',{x1:-6,y1:y,x2:15,y2:y,stroke:c,'stroke-width':3,'stroke-linecap':'round'},g);});},
  db(g,c){el('ellipse',{cx:0,cy:-12,rx:16,ry:6,fill:'none',stroke:c,'stroke-width':3},g);el('path',{d:'M-16 -12 V12 A16 6 0 0 0 16 12 V-12 M-16 0 A16 6 0 0 0 16 0',fill:'none',stroke:c,'stroke-width':3},g);},
  clock(g,c){el('circle',{r:17,fill:'none',stroke:c,'stroke-width':3.4},g);el('path',{d:'M0 -9 V0 L7 5',fill:'none',stroke:c,'stroke-width':3.4,'stroke-linecap':'round','stroke-linejoin':'round'},g);},
  cloud(g,c){el('path',{d:'M-14 10 H14 A8 8 0 0 0 12 -5 A11 11 0 0 0 -9 -6 A8 8 0 0 0 -14 10 Z',fill:'none',stroke:c,'stroke-width':3,'stroke-linejoin':'round'},g);},
  panel(g,c){el('rect',{x:-18,y:-15,width:36,height:30,rx:4,fill:'none',stroke:c,'stroke-width':3},g);el('rect',{x:-12,y:-2,width:6,height:11,fill:c},g);el('rect',{x:-3,y:-8,width:6,height:17,fill:c},g);el('rect',{x:6,y:-4,width:6,height:13,fill:c},g);},
  filter(g,c){el('path',{d:'M-17 -14 H17 L4 2 V15 L-4 11 V2 Z',fill:'none',stroke:c,'stroke-width':3.2,'stroke-linejoin':'round'},g);},
};
// etiqueta à esquerda do ponto (x,y,z), a gap px da borda
const leftOf=(g,x,y,z,gap)=>place(g,x,y,z,6,-(gap+g.w/2));
function tag(text,parent=L.tag){const g=el('g',{},parent);const w=text.length*11.5+30;
  el('rect',{x:-w/2,y:-20,width:w,height:36,rx:6,fill:'#fff',filter:'url(#tagsh)'},g);
  el('text',{x:0,y:5,'font-size':19,'font-weight':600,fill:C.ink,'text-anchor':'middle'},g).textContent=text;
  g.w=w;return g;}
const place=(g,x,y,z,dy=0,dx=0)=>{const p=iso(x,y,z);g.setAttribute('transform',`translate(${(p[0]+dx).toFixed(1)},${(p[1]+dy).toFixed(1)})`);return g;};
function stepBadge(tg,n){const g=el('g',{transform:`translate(${-tg.w/2-22},-2)`},tg);const r=el('rect',{x:-15,y:-15,width:30,height:30,rx:6,fill:'#9e9e9e'},g);
  el('text',{x:0,y:7,'font-size':18,'font-weight':800,fill:'#fff','text-anchor':'middle'},g).textContent=n;return {g,r};}
function sign(kind){const g=el('g',{opacity:0},L.tag);el('circle',{r:17,fill:C.or,stroke:'#fff','stroke-width':3},g);
  el('path',{d:kind==='ok'?'M-7 0 L-2 6 L8 -6':'M-6 -6 L6 6 M6 -6 L-6 6',fill:'none',stroke:'#fff','stroke-width':4,'stroke-linecap':'round','stroke-linejoin':'round'},g);return g;}
function cylinder(g,shadowG,cx,cy,z,r,h){const RX=1.2247*r*S,RY=0.7071*r*S,b=iso(cx,cy,z),t=iso(cx,cy,z+h);
  el('ellipse',{cx:b[0]+8,cy:b[1]+8,rx:RX,ry:RY,fill:'#000',opacity:.16},shadowG);
  el('path',{d:`M${b[0]-RX},${t[1]} L${b[0]-RX},${b[1]} A${RX},${RY} 0 0 0 ${b[0]+RX},${b[1]} L${b[0]+RX},${t[1]} Z`,fill:C.fx,stroke:C.edge,'stroke-width':1.3},g);
  el('ellipse',{cx:t[0],cy:t[1],rx:RX,ry:RY,fill:C.top,stroke:C.edge,'stroke-width':1.3},g);
  el('ellipse',{cx:t[0],cy:t[1],rx:RX*.62,ry:RY*.62,fill:'none',stroke:C.icon,'stroke-width':2},g);
  return {top:[t[0],t[1]],RX,RY};}

// ===== rotas e pacotes =====
function polyLen(P){let L=[0];for(let i=1;i<P.length;i++)L.push(L[i-1]+Math.hypot(P[i][0]-P[i-1][0],P[i][1]-P[i-1][1]));return L;}
function along(P,Lc,q){const d=q*Lc[Lc.length-1];let i=1;while(i<Lc.length-1&&Lc[i]<d)i++;
  const u=(d-Lc[i-1])/((Lc[i]-Lc[i-1])||1);return [lerp(P[i-1][0],P[i][0],u),lerp(P[i-1][1],P[i][1],u)];}
const ZS=15, V=420; // altura dos trilhos e velocidade dos pacotes (unidades do mundo por segundo)
function rail(P){el('polyline',{points:pts(P.map(p=>[...p,ZS])),fill:'none',stroke:C.line,'stroke-width':2.4,'stroke-linejoin':'round'},L.route);
  return el('polyline',{points:pts(P.map(p=>[...p,ZS])),fill:'none',stroke:C.or,'stroke-width':3.2,'stroke-dasharray':'10 12','stroke-linejoin':'round',opacity:0},L.route);}
const dashedRail=P=>el('polyline',{points:pts(P.map(p=>[...p,ZS])),fill:'none',stroke:C.off,'stroke-width':2.2,'stroke-dasharray':'6 7'},L.route);
const flowOff=t=>-cyc(t,28)*88;
// trecho: rota P a partir de t0 (rev = de trás para frente, v = velocidade); chain encadeia [P, atraso, rev, v]
function leg(P,t0,rev=false,v=V){const Q=rev?[...P].reverse():P;const Lc=polyLen(Q);return {Q,Lc,t0,t1:t0+Lc.at(-1)/v};}
function chain(...specs){let t=specs[0][1];const out=[];for(const [P,gap,rev,v] of specs){const l=leg(P,out.length?t+gap:t,rev,v);out.push(l);t=l.t1;}return out;}
const pkt=(col=PUR,s=22)=>{const c=cube(L.pk,noShadow,col);c.s=s;return c;};
function showPk(pk,on){[pk.top,pk.L,pk.R].forEach(e=>on?e.removeAttribute('display'):e.setAttribute('display','none'));}
function drive(pk,lists,t){for(const legs of lists)for(const l of legs){if(t>=l.t0&&t<=l.t1){
  const [x,y]=along(l.Q,l.Lc,(t-l.t0)/(l.t1-l.t0));pk.set(x-pk.s/2,y-pk.s/2,ZS-6,pk.s,pk.s,14);showPk(pk,true);return true;}}
  showPk(pk,false);return false;}

// ===== legendas: coluna da esquerda =====
// title=null → legenda no topo (seções do README); com título → coluna da esquerda (banner)
function captions(kicker,title,SC,TXT){
  el('text',{x:64,y:title?86:72,'font-size':17,'font-weight':700,fill:C.or,'letter-spacing':3},L.ui).textContent=kicker;
  if(title)el('text',{x:62,y:136,'font-size':44,'font-weight':800,fill:C.ink,'letter-spacing':-1},L.ui).textContent=title;
  const box=el('g',{transform:title?'':'translate(0,-140)'},L.ui);
  const caps=TXT.map(([a,l1,l2],i)=>{const g=el('g',{},box);
    const n=el('g',{transform:'translate(64,236)'},g);el('rect',{x:0,y:0,width:44,height:44,rx:9,fill:C.or},n);
    el('text',{x:22,y:32,'font-size':27,'font-weight':800,fill:'#fff','text-anchor':'middle'},n).textContent=i+1;
    el('text',{x:122,y:270,'font-size':32,'font-weight':700,fill:C.ink},g).textContent=a;
    el('text',{x:64,y:326,'font-size':25,fill:C.grey},g).textContent=l1;
    const t2=el('text',{x:64,y:360,'font-size':25,fill:C.grey},g);
    el('tspan',{},t2).textContent=l2[0];el('tspan',{fill:C.or,'font-weight':700},t2).textContent=l2[1]||'';el('tspan',{},t2).textContent=l2[2]||'';return g;});
  const prog=SC.map(()=>el('rect',{y:H-74,height:7,rx:3.5},L.ui));
  const stx=el('text',{x:title?404:W-64,y:H-64,'font-size':21,'font-weight':700,fill:C.ink,'text-anchor':'end'},L.ui);
  const alpha=t=>SC.map(([a,b])=>{let best=0;for(const o of[-T,0,T]){const tt=t+o;best=Math.max(best,Math.min(seg(tt,a,a+0.35),1-seg(tt,b-0.35,b)));}return best;});
  return {alpha,update(t){const al=alpha(t);
    caps.forEach((g,i)=>{g.setAttribute('opacity',al[i]);g.setAttribute('transform',`translate(0,${(1-al[i])*12})`);});
    const cur=SC.findIndex(([s,e])=>t>=s&&t<e);let x=64;
    prog.forEach((r,i)=>{const w=i===cur?60:16;r.setAttribute('x',x);r.setAttribute('width',w);r.setAttribute('fill',i===cur?C.or:'#c9c9c9');x+=w+9;});
    stx.textContent=`0${cur+1} / 0${SC.length}`;return al;}};}

// ===== preview em loop / exportador =====
function start(render,still){
  window.__T=T; window.__FPS=FPS; window.__seek=t=>render(mod(t,T));
  const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(!/[?&]capture/.test(location.search)&&!reduce){
    const t0=performance.now(); (function loop(now){ render(mod((now-t0)/1000,T)); requestAnimationFrame(loop); })(t0);
  } else render(reduce?still:0);
}
