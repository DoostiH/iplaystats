/* ================= Translation layer =================
   Visible text is looked up by its English wording, numbers replaced by {0}, {1}…
   A sentence that mixes plain text with bold/italic words is translated as one unit:
   inline elements become <0>…</0>, <1>…</1> and untranslatable names become [[0]], [[1]].
   Dictionaries: window.SS_DICT = {zh:{...}, fa:{...}, ar:{...}}. Missing entries stay in English. */
(function(){
const A = window.APP || (window.APP = {});
const LANGS = [{id:"en",name:"English"},{id:"zh",name:"中文"},{id:"fa",name:"فارسی",rtl:true},{id:"ar",name:"العربية",rtl:true}];
A.LANGS = LANGS;
let lang = "";
try{ lang = JSON.parse(localStorage.getItem("ss.lang")) || ""; }catch(e){ lang = ""; }
if(!LANGS.some(l=>l.id===lang)){
  const nav = ((navigator.languages&&navigator.languages[0])||navigator.language||"en").toLowerCase();
  lang = nav.startsWith("zh")?"zh":nav.startsWith("fa")?"fa":nav.startsWith("ar")?"ar":"en";
}
A.lang = lang;
A.setLang = id => { try{localStorage.setItem("ss.lang",JSON.stringify(id))}catch(e){} location.reload(); };
const L = LANGS.find(l=>l.id===lang);
document.documentElement.lang = lang==="zh"?"zh-Hans":lang;
document.documentElement.dir = L.rtl?"rtl":"ltr";

const NUM = /[-−]?\d+(?:[.,]\d+)*%?/g;
const dict = (window.SS_DICT && window.SS_DICT[lang]) || {};
const capture = window.SS_CAPTURE || null;
const INLINE = new Set(["STRONG","EM","B","I","SPAN","SUB","SUP","CODE","BR"]);
const SKIP = new Set(["SCRIPT","STYLE","TEXTAREA"]);
const hasLetters = s => /[A-Za-z]/.test(s);

function lookup(key){ if(capture) capture.add(key); if(lang==="en") return null; const d=dict[key]; return d==null?null:d; }
function fill(tpl,nums){ return tpl.replace(/\{(\d+)\}/g,(_,i)=>nums[+i]!=null?nums[+i]:""); }

/* plain text */
function translate(s){
  const t = s.replace(/\s+/g," ").trim();
  if(!t) return null;
  const nums = [];
  const key = t.replace(NUM, m => { nums.push(m); return "{"+(nums.length-1)+"}"; });
  if(!hasLetters(key)) return null;
  const d = lookup(key);
  if(d==null) return null;
  return s.match(/^\s*/)[0] + fill(d,nums) + s.match(/\s*$/)[0];
}
A.tr = s => translate(String(s)) ?? String(s);

/* mixed sentence */
const isNo = el => el.getAttribute && el.getAttribute("translate")==="no";
function unitOK(el){
  if(INLINE.has(el.nodeName) || SKIP.has(el.nodeName) || isNo(el)) return false;
  let text=false, elem=false;
  for(const c of el.childNodes){
    if(c.nodeType===3){ if(c.data.trim()) text=true; }
    else if(c.nodeType===1){
      if(!INLINE.has(c.nodeName)) return false;
      if(!isNo(c) && c.nodeName!=="BR") for(const g of c.childNodes) if(g.nodeType!==3) return false;
      elem=true;
    } else if(c.nodeType!==8) return false;
  }
  return text && elem;
}
const units = new WeakMap();
function doUnit(el){
  if(units.get(el)===el.innerHTML) return true;
  const nums=[], parts=[], inl=[], keep=[];
  const norm = s => s.replace(NUM, m => { nums.push(m); return "{"+(nums.length-1)+"}"; });
  for(const c of el.childNodes){
    if(c.nodeType===3) parts.push(norm(c.data));
    else if(c.nodeType===1){
      if(c.nodeName==="BR"){ parts.push("<br>"); }
      else if(isNo(c)){ keep.push(c); parts.push("[["+(keep.length-1)+"]]"); }
      else { inl.push(c); parts.push("<"+(inl.length-1)+">"+norm(c.textContent)+"</"+(inl.length-1)+">"); }
    }
  }
  const key = parts.join("").replace(/\s+/g," ").trim();
  if(!hasLetters(key.replace(/<\/?\d+>|\[\[\d+\]\]|<br>/g,""))){ units.set(el,el.innerHTML); return true; }
  const d = lookup(key);
  if(d==null){ units.set(el,el.innerHTML); return !!capture; }
  const frag = document.createDocumentFragment();
  const re = /<(\d+)>([\s\S]*?)<\/\1>|\[\[(\d+)\]\]|<br>/g; let last=0, m;
  const txt = s => { if(s) frag.appendChild(document.createTextNode(fill(s,nums))); };
  while((m=re.exec(d))){
    txt(d.slice(last,m.index));
    if(m[1]!=null){ const o=inl[+m[1]]; if(o){ const n=o.cloneNode(false); n.textContent=fill(m[2],nums); frag.appendChild(n); } }
    else if(m[3]!=null){ const o=keep[+m[3]]; if(o) frag.appendChild(o.cloneNode(true)); }
    else frag.appendChild(document.createElement("br"));
    last = re.lastIndex;
  }
  txt(d.slice(last));
  el.textContent=""; el.appendChild(frag);
  units.set(el,el.innerHTML);
  return true;
}

const seen = new WeakMap();
function doText(n){
  if(seen.get(n)===n.data) return;
  const p = n.parentNode;
  if(p && (SKIP.has(p.nodeName) || (p.closest && p.closest("[translate=no]")))) return;
  if(p && p.nodeType===1 && unitOK(p)){ if(doUnit(p)) return; }
  if(p && p.parentNode && p.parentNode.nodeType===1 && INLINE.has(p.nodeName) && unitOK(p.parentNode)){ if(doUnit(p.parentNode)) return; }
  const r = translate(n.data);
  if(r!=null){ seen.set(n,r); n.data = r; } else seen.set(n,n.data);
}
function doAttrs(el){
  for(const a of ["placeholder","aria-label","title"]){
    if(el.hasAttribute && el.hasAttribute(a)){ const v=el.getAttribute(a), r=translate(v); if(r!=null && r!==v) el.setAttribute(a,r); }
  }
}
function walk(node){
  if(!node) return;
  if(node.nodeType===3){ doText(node); return; }
  if(node.nodeType===11){ for(const c of [...node.childNodes]) walk(c); return; }
  if(node.nodeType!==1 || SKIP.has(node.nodeName) || isNo(node)) return;
  doAttrs(node);
  if(unitOK(node) && doUnit(node)) return;
  for(const c of [...node.childNodes]) walk(c);
}
A.translateTree = walk;
function start(){
  walk(document.body);
  new MutationObserver(ms=>{ for(const m of ms){ if(m.type==="characterData") doText(m.target); else m.addedNodes.forEach(walk); } })
    .observe(document.body,{subtree:true,childList:true,characterData:true});
}
if(document.body) start(); else document.addEventListener("DOMContentLoaded",start);
})();
