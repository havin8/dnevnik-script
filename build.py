import re
import os
os.chdir(os.path.dirname(os.path.abspath(__file__)))
css=open('src/base.css').read()
src=open('src/icons.js').read()
css=re.sub(r'@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme="light"\]\)\{.*?\}\s*\}\n','',css,flags=re.S)
css=css.replace(':root[data-theme="dark"]{','.dn[data-theme="dark"]{').replace(':root{','.dn{')
css=css.replace('html,body{background:var(--bg)}','.dn{background:var(--bg);min-height:100%}')
css=css.replace('body{color:var(--ink);','.dn{color:var(--ink);')
css=re.sub(r'\.photo\{width:38px;height:38px;border-radius:50%;flex:none;background:#1a0d0d url\(data:image/jpeg;base64,[^)]+\) center/cover;','.photo{width:38px;height:38px;border-radius:50%;flex:none;background:linear-gradient(135deg,#27313d,#161c24);background-size:cover;background-position:center;',css)
css+='''
.hero-id{gap:24px;margin-bottom:10px}
.sync{font-size:12.5px;color:var(--soft);padding:0 6px;white-space:nowrap}
.sync.ok{color:var(--good)} .sync.bad{color:var(--bad)} .sync.busy{color:var(--gold)}
.sync.busy::before,.spin{content:"";display:inline-block;width:9px;height:9px;border-radius:50%;border:2px solid var(--gold);border-right-color:transparent;margin-right:7px;vertical-align:-1px;animation:dnspin .8s linear infinite}
@keyframes dnspin{to{transform:rotate(360deg)}}
@keyframes dnin{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.page.enter>*{animation:dnin .28s ease both}
@media (max-width:640px){.sync{display:none}}
.side{gap:14px}
.nav{overflow:auto;flex:1;min-height:0;scrollbar-width:none;padding-bottom:6px}
.ngrp{font-size:10.5px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--soft);padding:12px 12px 4px}
.ngrp:first-child{padding-top:0}
.ngrp:empty{padding:6px 0 0;border-top:1px solid var(--hair);margin:8px 12px 4px}
@media (max-width:980px){.ngrp{display:none}}
.classic{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:10px;border:1px dashed var(--line);background:none;color:var(--muted);font-weight:700;text-align:left}
.classic:hover{color:var(--ink);border-color:var(--gold)}
@media (max-width:980px){.classic{display:none}}
.mark5.ot{background:#8a6fb8} .mark5.sw{width:14px;height:14px;font-size:0;display:inline-block}
.les.late::after{content:"О";position:absolute;top:5px;right:6px;font-size:10.5px;font-weight:700;color:var(--gold)}
.hw .th2{font-size:12.5px;color:var(--muted);margin-top:4px;line-height:1.3;max-height:3.9em;overflow:hidden}
.hw .wait.bad{border-color:var(--bad);color:var(--bad)}
.hw .submit{margin:0 12px 12px;border:0;border-radius:10px;padding:9px 12px;background:var(--sel);color:var(--sel-ink);font-weight:700;display:flex;gap:8px;align-items:center;justify-content:center}
.hw .submit:hover{filter:brightness(1.08)}
.hint{display:flex;align-items:center;gap:14px;flex-wrap:wrap;padding:14px 18px}
.hint>svg{color:var(--gold);width:24px;height:24px}
.hint>div{flex:1;min-width:220px}.hint b{display:block}.hint span{font-size:13.5px;color:var(--muted)}
svg.i.big{width:26px;height:26px}
.dn a{cursor:pointer}
.toast{position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:50;background:var(--sel);color:var(--sel-ink);padding:11px 18px;border-radius:12px;font-weight:700;box-shadow:0 16px 40px -12px rgba(0,0,0,.5);max-width:calc(100vw - 32px);animation:dnin .25s ease}
/* разделы журнала */
.m-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:18px 20px;border-radius:20px;color:var(--hero-ink);background:radial-gradient(90% 160% at 100% 0%,rgba(220,188,126,.18),transparent 55%),linear-gradient(135deg,var(--hero-a),var(--hero-b));box-shadow:inset 0 0 0 1px rgba(220,188,126,.22)}
.m-hero>div:nth-child(2){flex:1;min-width:200px}.m-hero b{display:block;font-size:19px}.m-hero span{opacity:.75;font-size:14px}
.m-ic{width:50px;height:50px;border-radius:14px;display:grid;place-items:center;background:rgba(220,188,126,.12);color:var(--gold-hi);box-shadow:inset 0 0 0 1px rgba(220,188,126,.3)}
.m-hero .m-btn{background:rgba(241,236,226,.08);border-color:rgba(241,236,226,.2);color:var(--hero-ink)}
.m-body{display:flex;flex-direction:column;gap:16px}
.m-stack{display:flex;flex-direction:column;gap:10px;min-width:0}
.m-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;align-items:start}
.m-card{display:flex;flex-direction:column;gap:10px;align-items:stretch}
.m-body h3{margin:0;font-size:16px;line-height:1.3;color:var(--ink)}
.m-card>h3:first-child,.m-card>.m-stack:first-child>h3:first-child{padding-bottom:10px;border-bottom:1px solid var(--hair);margin-bottom:4px}
.m-body p{margin:0;line-height:1.55;color:var(--muted)}
.m-body p b{color:var(--ink)}
.m-t1{color:var(--muted)}
.m-alert{color:var(--bad)!important;background:var(--bad-wash);padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--bad) 30%,transparent)}
.m-btn{border:1px solid var(--line);background:var(--surface-2);color:var(--ink);border-radius:10px;padding:9px 14px;font-weight:700;display:inline-flex;gap:8px;align-items:center;align-self:flex-start;cursor:pointer;transition:filter .15s,transform .15s}
.m-btn:hover{filter:brightness(1.08);transform:translateY(-1px)}
.m-btn.pri{background:var(--sel);color:var(--sel-ink);border-color:transparent}
.m-field{display:flex;flex-direction:column;gap:5px;font-size:12.5px;color:var(--soft);min-width:0}
.m-field>span:empty{display:none}
.m-in{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--ink);font:inherit;font-size:15px;width:100%;min-width:0}
.m-in:focus{outline:2px solid var(--gold);outline-offset:1px}
.m-in:disabled{opacity:.65}
textarea.m-in{resize:vertical;min-height:90px}
.m-kv{display:grid;grid-template-columns:minmax(110px,220px) 1fr;gap:12px;padding:9px 0;margin:0;border-top:1px solid var(--hair)}
.m-kv dt{color:var(--soft)} .m-kv dd{margin:0;font-weight:700;overflow-wrap:anywhere}
.m-list{margin:0;padding-left:20px;color:var(--muted);line-height:1.65}
.m-list li::marker{color:var(--gold)}
.m-link{color:var(--gold);font-weight:700;background:none;border:0;padding:0;text-decoration:none;cursor:pointer;font:inherit}
.m-link:hover{text-decoration:underline}
.m-img{border-radius:16px;max-width:100%;height:auto;align-self:flex-start}
.m-note{display:flex;gap:10px;align-items:center;color:var(--soft);font-size:13.5px;padding:12px;border:1px dashed var(--line);border-radius:12px}
.m-check{display:inline-flex;gap:8px;align-items:center}
.m-check input{width:18px;height:18px;accent-color:var(--gold)}
.m-t th{background:var(--surface-2);padding:10px 12px!important;border-bottom:0!important}
.m-t th:first-child{border-radius:10px 0 0 10px}.m-t th:last-child{border-radius:0 10px 10px 0}
.m-t td{padding:11px 12px!important}
.m-load{display:flex;align-items:center;gap:6px;color:var(--muted);padding:40px;justify-content:center}
.set-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}
.sw{display:flex;align-items:center;gap:11px;padding:10px 12px;border:1px solid var(--hair);border-radius:12px;cursor:pointer;font-weight:700;background:var(--surface-2)}
.sw input{position:absolute;opacity:0;pointer-events:none}
.sw .tr{width:34px;height:20px;border-radius:999px;background:var(--line);position:relative;flex:none;transition:background .2s}
.sw .tr::after{content:"";position:absolute;left:3px;top:3px;width:14px;height:14px;border-radius:50%;background:var(--surface);transition:transform .2s}
.sw input:checked+.tr{background:var(--gold)}
.sw input:checked+.tr::after{transform:translateX(14px)}
.sw input:focus-visible+.tr{outline:2px solid var(--gold);outline-offset:2px}
.sw svg{color:var(--soft)}
.set-row{display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;padding:10px 0;border-top:1px solid var(--hair)}
.set-row:first-of-type{border-top:0}
.btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
.m-alert{display:flex;gap:10px;align-items:flex-start}
.m-alert svg{flex:none;margin-top:1px}
.hwx{margin:0 14px 10px;font-size:13px;color:var(--ink);line-height:1.45;overflow-wrap:anywhere}
.hwx span{display:block;font-size:11px;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);font-weight:700;margin-bottom:2px}
.hwx a{color:var(--gold)}
.hwx.tc{background:var(--gold-wash);border-radius:10px;padding:8px 10px}
.hwf{display:flex;gap:6px;flex-wrap:wrap;margin:0 14px 12px}
.hwf a{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;color:var(--ink);text-decoration:none;border:1px solid var(--line);border-radius:8px;padding:5px 9px;background:var(--surface-2)}
.hwf a:hover{border-color:var(--gold)}
.hwf svg{width:15px;height:15px;color:var(--gold)}
.mat{display:flex;align-items:center;gap:14px}
.mat>svg{color:var(--gold);flex:none}
.mat>div{flex:1}.mat b{display:block}.mat span{font-size:13px;color:var(--soft)}
.mat .cnt{font-size:26px;font-weight:700;color:var(--soft)}
.cpy{border:0;background:none;color:var(--soft);padding:2px 4px;margin-left:6px;vertical-align:middle;cursor:pointer;border-radius:6px}
.cpy:hover{color:var(--gold);background:var(--surface-2)}
.cpy svg{width:16px;height:16px}
.acts2{display:flex;flex-direction:column;gap:8px}
.acts2 .m-btn{align-self:stretch;justify-content:flex-start}
.li2{display:flex;gap:10px;align-items:flex-start;padding:6px 0;color:var(--muted)}
.li2 svg{color:var(--good);width:18px;height:18px;flex:none;margin-top:1px}
.qa{border-top:1px solid var(--hair)}
.qa:first-of-type{border-top:0}
.qa summary{list-style:none;cursor:pointer;display:flex;justify-content:space-between;gap:12px;align-items:center;padding:12px 0;font-weight:700}
.qa summary::-webkit-details-marker{display:none}
.qa summary svg{color:var(--soft);transition:transform .2s;flex:none}
.qa[open] summary svg{transform:rotate(180deg);color:var(--gold)}
.qa p{margin:0 0 14px;color:var(--muted);line-height:1.6;max-width:80ch}
.search{display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:4px 14px;box-shadow:var(--shadow)}
.search svg{color:var(--soft)}
.search input{flex:1;border:0;background:none;color:var(--ink);font:inherit;font-size:15px;padding:10px 0;outline:none}
.photo.xl{width:92px;height:92px;box-shadow:0 0 0 3px rgba(15,24,34,.9),0 0 0 5px rgba(220,188,126,.8)}
.hero.prof h2{font-size:28px}
.hero.prof .facts{margin-top:12px}
@media (max-width:560px){.photo.xl{width:66px;height:66px}.hero-id{gap:14px}}
dialog.wide{width:min(760px,calc(100vw - 32px))}
.nbody{padding:18px 22px 22px;max-height:70vh;overflow:auto;line-height:1.65;color:var(--ink);font-size:15.5px}
.nbody p{margin:0 0 12px}.nbody img{max-width:100%;height:auto;border-radius:12px}
.nbody a{color:var(--gold);font-weight:700}
.nbody b,.nbody strong{color:var(--ink)}
.nbody em,.nbody i{color:var(--muted)}
.nbody ul,.nbody ol{padding-left:20px}
.mkt{display:flex;flex-direction:column;gap:8px}.mkt img{width:100%;border-radius:12px;aspect-ratio:4/3;object-fit:cover}
.nw{cursor:pointer}
.top,.page{max-width:none!important}
.mark svg{width:22px;height:22px}
.fbody{padding:18px 22px 6px;display:flex;flex-direction:column;gap:14px;max-height:62vh;overflow:auto}
.ff{display:flex;flex-direction:column;gap:6px;font-size:12.5px;color:var(--soft);font-weight:700}
.ff .m-in{font-weight:400}
.ffoot{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;padding:14px 22px 20px;border-top:1px solid var(--hair);margin-top:10px}
.ffoot .m-btn{align-self:auto}
.ffoot .m-btn:disabled{opacity:.6;cursor:progress}
.fstat{margin:6px 22px 0;padding:10px 12px;border-radius:10px;font-size:14px;display:flex;align-items:center;gap:6px}
.fstat.busy{background:var(--gold-wash);color:var(--gold)}
.fstat.ok{background:var(--good-wash);color:var(--good);font-weight:700}
.fstat.bad{background:var(--bad-wash);color:var(--bad)}
.drop{display:flex;flex-direction:column;align-items:center;gap:4px;padding:22px;border:1.5px dashed var(--line);border-radius:14px;cursor:pointer;text-align:center;color:var(--muted);transition:border-color .15s,background .15s}
.drop svg{width:28px;height:28px;color:var(--gold)}
.drop b{color:var(--ink)}
.drop input{position:absolute;opacity:0;width:1px;height:1px}
.drop.over,.drop:hover{border-color:var(--gold);background:var(--gold-wash)}
.drop.has{border-style:solid;border-color:var(--good)}
.drop.has span{color:var(--good);font-weight:700}
'''+open('src/extra.css').read()+'\n'+open('src/market.css').read()+'\n'+open('src/neo.css').read()
ic=re.search(r'const IC=(\{.*?\n\});',src,re.S).group(1)
ic=ic.rstrip('}').rstrip().rstrip(',')+''',
  ext:'<path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
  download:'<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
  hand:'<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-2a1.5 1.5 0 0 1 3 0V12M14 10.5a1.5 1.5 0 0 1 3 0V12M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15.5a1.6 1.6 0 0 1 2.6-1.8L8 15"/>',
  trend:'<path d="M4 17l5-5 4 3 7-8"/><path d="M15 7h5v5"/>',
  refresh:'<path d="M20 11a8 8 0 0 0-14.7-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4L20 16M20 20v-4h-4"/>',
  bug:'<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8V6a3 3 0 0 1 6 0v2M3 13h4M17 13h4M4 19l3-2M20 19l-3-2M4 7l3 2M20 7l-3 2"/>',
  book:'<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13"/><path d="M8 7h7M8 11h5"/>',
  card:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
  help:'<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
  pin:'<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
  chat:'<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
  alert:'<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
  bag:'<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  upload:'<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
  copy:'<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
  play:'<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/>',
  chev:'<path d="M6 9l6 6 6-6"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
  send:'<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>'
}'''
def accentize(c):
    out=[]
    for line in c.split('\n'):
        if re.match(r'\s*--[\w-]+\s*:',line): out.append(line); continue
        line=re.sub(r'rgba\(220,188,126,\s*([\d.]+)\)',lambda m:'color-mix(in srgb,var(--gold-hi) %g%%,transparent)'%(float(m.group(1))*100),line)
        line=line.replace('#a47f3e','var(--gold)').replace('#b48c4a','var(--gold)').replace('#e8cf9c','var(--gold-hi)').replace('#dcbc7e','var(--gold-hi)')
        out.append(line)
    return '\n'.join(out)
css=accentize(css)
# убираем правила для классов, которых больше нет в Дневнике (старое «зеркало» журнала и т.п.)
DEAD=['sky','lines','t-morning','t-day','t-evening','t-night','ev-head','ev-prog','hs-grid','hs-task','hwf-row','m-body','m-card','m-field','m-grid','m-img','m-list','m-note','m-t1','tfile','gsel']
def prune(css):
    out=[];i=0;n=len(css)
    while i<n:
        j=css.find('{',i)
        if j<0: out.append(css[i:]);break
        sel=css[i:j]
        k=css.find('}',j); nb=css.find('{',j+1)
        if nb!=-1 and nb<k:   # вложенный блок (@media): обрабатываем содержимое рекурсивно
            depth=0;m=j
            while m<n:
                if css[m]=='{':depth+=1
                elif css[m]=='}':
                    depth-=1
                    if depth==0:break
                m+=1
            out.append(sel+'{'+prune(css[j+1:m])+'}');i=m+1;continue
        parts=[x.strip() for x in sel.split(',')]
        dead=all(any(re.search(r'\.'+re.escape(d)+r'(?![\w-])',p) for d in DEAD) for p in parts if p)
        if not dead: out.append(css[i:k+1])
        i=k+1
    return ''.join(out)
css=re.sub(r'/\*.*?\*/','',css,flags=re.S); css=re.sub(r'\n\s*\n+','\n',css)
before=len(css); css=prune(css); print('css',before,'->',len(css))
js=open('src/app.js').read()
import base64,json
_nf={k:base64.b64encode(open(f'fonts/{n}-{sub}-r.woff2','rb').read()).decode() for k,n,sub in [('u-lat','unbounded','lat'),('u-cyr','unbounded','cyr'),('m-lat','manrope','lat'),('m-cyr','manrope','cyr')]}
js=js.replace('/*NEOFONTS*/',json.dumps(_nf))
js=js.replace('/*CSS*/',css.replace('\\','\\\\').replace('`','\\`').replace('${','\\${')).replace('/*ICONS*/',ic)
import os, subprocess
os.makedirs('dist',exist_ok=True)
open('dist/dnevnik.min.user.js','w').write(js)
# читаемая сборка (prettier): это и есть файл для установки
subprocess.check_call(['node','scripts/pretty.js','dist/dnevnik.min.user.js','dist/dnevnik.user.js'])
os.remove('dist/dnevnik.min.user.js')
