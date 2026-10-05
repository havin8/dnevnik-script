// ==UserScript==
// @name         Дневник - новый дизайн журнала
// @namespace    dnevnik.artem
// @version      4.5.6
// @description  Полноценный дизайн "Дневника" поверх журнала: свои страницы, живые данные из журнала, мгновенная загрузка из кэша.
// @match        https://journal.top-academy.ru/*
// @run-at       document-start
// @inject-into  content
// @grant        GM_xmlhttpRequest
// @grant        GM.xmlHttpRequest
// @grant        unsafeWindow
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM.getValue
// @grant        GM.setValue
// @connect      msapi.top-academy.ru
// @connect      top-academy.ru
// @connect      yandexcloud.net
// @connect      storage.yandexcloud.net
// @connect      gist.githubusercontent.com
// @connect      api.rapira.net
// @connect      api.bybit.com
// @connect      api.binance.com
// @connect      api.alternative.me
// @connect      api.kraken.com
// @connect      www.cbr.ru
// @connect      www.cbr-xml-daily.ru
// @connect      cdn.jsdelivr.net
// @connect      currency-api.pages.dev
// @noframes
// @updateURL    https://gist.githubusercontent.com/havin8/1dfbe9d913d7e000c0de52ad11a9317f/raw/dnevnik.user.js
// @downloadURL  https://gist.githubusercontent.com/havin8/1dfbe9d913d7e000c0de52ad11a9317f/raw/dnevnik.user.js
// ==/UserScript==

(function () {
  "use strict";
  // Tampermonkey/Violentmonkey дают unsafeWindow. В Safari (приложение Userscripts) его нет:
  // тогда перехватчик запросов ставится прямо в страницу и передаёт данные событиями.
  function VERSION_HDR() { try { const i = typeof GM_info !== "undefined" ? GM_info : typeof GM !== "undefined" && GM && GM.info ? GM.info : null; return (i && i.script && i.script.version) || "?"; } catch (e) { return "?"; } }
  const HAS_UW = typeof unsafeWindow !== "undefined" && unsafeWindow !== window;
  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  if (W.__dnLoaded) {
    W.__dnDup = (W.__dnDup || []).concat(VERSION_HDR());
    // старые копии (до 4.0.6) пишут сюда true, новые - свою версию
    const other = typeof W.__dnLoaded === "string" ? W.__dnLoaded : "", me = VERSION_HDR();
    const older = !other || other.split(".").map(Number).reduce((r, x, i) => r !== 0 ? r : (x || 0) - (+me.split(".")[i] || 0), 0) < 0;
    if (older) {
      const show = () => setTimeout(() => {
        if (document.getElementById("dn-dup")) return;
        const b = document.createElement("div"); b.id = "dn-dup";
        b.style.cssText = "position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 12px);z-index:2147483647;background:#2a1a1a;color:#fff;border:1px solid #e06c6c;border-radius:16px;padding:14px 44px 14px 16px;font:15px/1.4 Calibri,-apple-system,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4)";
        b.innerHTML = `<b>Запустилась старая копия Дневника${other ? " " + other : ""}</b><br>Установлено две копии: старая и ${me}. Открой приложение Userscripts (или Tampermonkey) и удали старую, оставь одну.<button aria-label="Закрыть" style="position:absolute;right:8px;top:8px;background:none;border:0;color:#fff;font-size:22px;line-height:1;padding:4px 8px">×</button>`;
        b.querySelector("button").onclick = () => b.remove();
        document.documentElement.appendChild(b);
      }, 1500);
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show); else show();
    }
    return;
  }
  W.__dnLoaded = VERSION_HDR();
  const VERSION = (() => { try { const i = typeof GM_info !== "undefined" ? GM_info : typeof GM !== "undefined" && GM && GM.info ? GM.info : null; const v = i && i.script && i.script.version; if (v && /^\d+(\.\d+)*$/.test(v)) return v; } catch (e) {} return "4.5.6"; })();

  /* ======================= настройки и хранилище ======================= */
  // небольшие настройки дублируются в хранилище расширения: журнал иногда очищает хранилище сайта (при входе/выходе),
  // и без копии сбрасывались бы акцент, скрытые карточки, цели и т.п.
  const KEEP = new Set(["cfg", "mdis", "paydis", "quizdis", "upddis", "bdaydis", "goal", "agoal", "lb", "mkper", "read"]);
  const GMS = typeof GM_setValue === "function" ? GM_setValue : typeof GM !== "undefined" && GM && typeof GM.setValue === "function" ? (k, v) => GM.setValue(k, v) : null;
  const LS = {
    get(k, d) { try { const v = localStorage.getItem("dn2." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem("dn2." + k, JSON.stringify(v)); } catch (e) {} if (GMS && KEEP.has(k)) try { const p = GMS("dn2." + k, JSON.stringify(v)); if (p && p.catch) p.catch(() => {}); } catch (e) {} }
  };
  const restoreKept = getter => KEEP.forEach(k => { try { if (localStorage.getItem("dn2." + k) == null) { const v = getter("dn2." + k); if (v != null && typeof v === "string") localStorage.setItem("dn2." + k, v); } } catch (e) {} });
  if (typeof GM_getValue === "function") restoreKept(k => GM_getValue(k, null));
  const cfg = Object.assign({ on: true, theme: "dark", accent: "gold", mc: false, hidden: [], raise: true, mkt: false, gpv: "week", goals: true, gfx: "auto" }, LS.get("cfg", {}));
  const saveCfg = () => LS.set("cfg", cfg);
  // 4.5.0: значки валюты как в журнале стали видом по умолчанию - один раз переключаем всех, пиксельный можно вернуть в Настройках
  if (!LS.get("mc50", 0)) { cfg.mc = false; saveCfg(); LS.set("mc50", 1); }
  cfg.raise = true;
  // Safari (Userscripts): хранилище расширения асинхронное - восстанавливаем и перерисовываем
  if (typeof GM_getValue !== "function" && typeof GM !== "undefined" && GM && typeof GM.getValue === "function") {
    Promise.all([...KEEP].map(k => GM.getValue("dn2." + k, null).then(v => [k, v]).catch(() => [k, null]))).then(L => {
      const got = Object.fromEntries(L.map(([k, v]) => ["dn2." + k, v])); let changed = false;
      KEEP.forEach(k => { try { if (localStorage.getItem("dn2." + k) == null && got["dn2." + k] != null) { localStorage.setItem("dn2." + k, got["dn2." + k]); changed = true; } } catch (e) {} });
      if (changed) { Object.assign(cfg, LS.get("cfg", {})); cfg.raise = true; if (typeof render === "function") try { render(); } catch (e) {} }
      else KEEP.forEach(k => { const v = localStorage.getItem("dn2." + k); if (v != null && got["dn2." + k] == null) try { GM.setValue("dn2." + k, v).catch(() => {}); } catch (e) {} });
    }).catch(() => {});
  } else if (GMS) KEEP.forEach(k => { try { const v = localStorage.getItem("dn2." + k); if (v != null) GMS("dn2." + k, v); } catch (e) {} });
  const DEFAULT_API = "https://msapi.top-academy.ru/api/v2";
  const origFetch = W.fetch.bind(W);

  /* ======================= перехват токена и адреса API ======================= */
  const NET = { token: null, base: null, headers: {}, raw: {}, status: {}, writes: [], mode: "" };
  const JWT_RX = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/;
  function noteRequest(url, headers) {
    try {
      const u = new URL(url, location.href); if (!/(^|\.)top-academy\.ru$/i.test(u.hostname)) return;
      const i = u.pathname.indexOf("/api/v2/");
      if (i >= 0 && !NET.base) NET.base = u.origin + u.pathname.slice(0, i + 7);
      if (!headers) return;
      const h = {};
      if (headers instanceof Headers) headers.forEach((v, k) => h[k.toLowerCase()] = v);
      else if (Array.isArray(headers)) headers.forEach(([k, v]) => h[k.toLowerCase()] = v);
      else Object.keys(headers).forEach(k => h[k.toLowerCase()] = headers[k]);
      if (h.authorization && /bearer/i.test(h.authorization)) {
        const t = h.authorization.replace(/^bearer\s+/i, ""), changed = t !== NET.token;
        NET.token = t; NET.tokenSrc = "перехват";
        if (changed) { saveToken(t); onToken(); }
      }
      for (const k of Object.keys(h)) if (!/^(authorization|content-length|content-type|cookie|host)$/.test(k)) NET.headers[k] = h[k];
    } catch (e) {}
  }
  function noteWrite(method, url, body) {
    try {
      if (!method || /^(GET|HEAD|OPTIONS)$/i.test(method)) return;
      const u = new URL(url, location.href); if (/auth|login|token|password/i.test(u.pathname)) return;
      let shape = "";
      const kj = (j, d = 0) => j && typeof j === "object" && !Array.isArray(j) && d < 3 ? Object.keys(j).map(k => j[k] && typeof j[k] === "object" && !Array.isArray(j[k]) ? `${k}{${kj(j[k], d + 1)}}` : k).join(", ") : "";
      if (body instanceof W.FormData) shape = "FormData: " + [...body.entries()].map(([k, v]) => v && typeof v === "object" && "size" in v ? `${k}=[файл, ${Math.round(v.size / 1024)} КБ]` : k).join(", ");
      else if (typeof body === "string") { try { shape = "JSON: " + kj(JSON.parse(body)); } catch (e) { shape = "text"; } }
      else if (body) shape = typeof body;
      pushW(`${method.toUpperCase()} ${u.pathname} · ${shape}`);
    } catch (e) {}
  }
  const WL = [];
  const pushW = (...l) => { NET.writes.push(...l); if (NET.writes.length > 60) NET.writes.splice(0, NET.writes.length - 60); };
  // Каждый ответ сервера журналу: запоминаем, не выкинуло ли его самого (401), и забираем новый вход после продления
  NET.site401 = 0;
  function noteSiteStatus(url, status, text) {
    try {
      const pth = pathOf(url); if (!/\/api\//.test(pth)) return;
      if (/auth\/(refresh|login)|\/login\b|token/i.test(pth)) {
        if (status >= 200 && status < 300 && text) { const j = JSON.parse(text); let t = null;
          const look = (o, d) => { if (!o || typeof o !== "object" || d > 3 || t) return; for (const k of Object.keys(o)) { const v = o[k]; if (typeof v === "string" && !/refresh/i.test(k) && /access|token|jwt/i.test(k) && JWT_RX.test(v)) { t = v.match(JWT_RX)[0]; return; } if (v && typeof v === "object") look(v, d + 1); } };
          if (/auth\/login/i.test(pth)) { try { localStorage.removeItem("dn2.out"); } catch (e) {} }
          if (localStorage.getItem("dn2.out")) return;
          look(j, 0); if (t && t !== NET.token) { NET.token = t; NET.tokenSrc = "перехват"; NET.site401 = 0; saveToken(t); onToken(); } }
        return;
      }
      if (status === 401) { NET.site401 = Date.now(); if (typeof staleCheck === "function") setTimeout(staleCheck, 2500); }
      else if (status >= 200 && status < 300) NET.site401 = 0;
    } catch (e) {}
  }
  function emitWrite(ev) { const sec = /auth|login|token|password|logout/i.test(ev.path || ""); let msg = ""; if (!sec && ev.status >= 400) try { const j = JSON.parse(ev.text); msg = String(j.message || j.error || "").slice(0, 120); } catch (e) {}
    pushW(`  ↳ ответ ${ev.status}${msg ? ": " + msg : ""}`); WL.slice().forEach(f => { try { f(ev); } catch (e) {} }); }
  function waitWrite(ms = 15000, expect) {
    return new Promise((res, rej) => {
      const clean = () => { clearTimeout(t); const i = WL.indexOf(f); if (i >= 0) WL.splice(i, 1); };
      const f = ev => { if (!/\/api\//.test(ev.path)) return; clean(); if (expect && !expect.test(ev.path)) rej(new Error("журнал отправил не тот запрос (" + ev.path.replace(/^.*\/api\/v\d\//, "") + "). Проверь раздел в журнале")); else res(ev); };
      const t = setTimeout(() => { clean(); rej(new Error("журнал не отправил запрос")); }, ms); WL.push(f);
    });
  }
  // после выхода из Дневника журнал не должен сам продлевать вход: запрос продления блокируется до следующего входа по логину
  const outBlocked = u => { try { return /auth\/refresh/i.test(String(u)) && !!localStorage.getItem("dn2.out"); } catch (e) { return false; } };
  const pathOf = u => { try { return new URL(u, location.href).pathname; } catch (e) { return String(u); } };
  NET.site = {};
  function tagLabels() {
    if (!NET.tagRaw || !NET.tr) return; const o = LS.get("evtags", {});
    NET.tagRaw.forEach(t => { const lb = NET.tr[t.translate_key]; if (!lb) return; const L = o[t.type] = o[t.type] || []; if (!L.some(x => x.id === t.id)) L.push({ id: t.id, label: lb }); });
    NET.evTags = o; LS.set("evtags", o);
  }
  function noteSite(url, data) {
    try { const u = new URL(url, location.href); if (!/\/api\//.test(u.pathname) || /auth|login|token/i.test(u.pathname)) return;
      const k = u.pathname.replace(/^.*\/api\/v\d\//, "");
      if (/translations/.test(k) && data && typeof data === "object") { NET.tr = data; tagLabels(); return; } if (/languages/.test(k)) return;
      if (Array.isArray(data) && data.length && data[0] && data[0].translate_key && data[0].type) { NET.tagRaw = (NET.tagRaw || []).concat(data); tagLabels(); } NET.site[k] = JSON.stringify((SENS_PATH.test(k) ? shape : scrub)(Array.isArray(data) ? data.slice(0, 2) : data)).slice(0, 1500); } catch (e) {}
  }
  const PAGE_HOOK = `(function(){if(window.__dnHook)return;window.__dnHook=1;
var send=function(t,d){try{document.dispatchEvent(new CustomEvent("dn-net",{detail:JSON.stringify({t:t,d:d})}))}catch(e){}};
var hdr=function(h){var o={};try{if(!h)return o;if(typeof Headers!=="undefined"&&h instanceof Headers)h.forEach(function(v,k){o[k.toLowerCase()]=v});else if(Array.isArray(h))h.forEach(function(x){o[String(x[0]).toLowerCase()]=x[1]});else Object.keys(h).forEach(function(k){o[k.toLowerCase()]=h[k]})}catch(e){}return o};
var out=function(u){try{return /auth.refresh/i.test(String(u))&&!!localStorage.getItem("dn2.out")}catch(e){return false}};
var F=window.fetch;window.fetch=function(i,n){var url="",m="GET",h={};try{url=typeof i==="string"?i:(i&&i.url)||String(i);if(out(url))return Promise.resolve(new Response('{"message":"Unauthorized"}',{status:401,headers:{"content-type":"application/json"}}));m=(n&&n.method)||(i&&i.method)||"GET";h=Object.assign(hdr(i&&i.headers),hdr(n&&n.headers))}catch(e){}
send("req",{url:url,m:m,a:h.authorization||""});var p=F.apply(this,arguments);
p.then(function(r){try{r.clone().text().then(function(tx){send("res",{url:r.url||url,m:m,status:r.status,ct:r.headers.get("content-type")||"",tx:tx.length<300000?tx:""})})}catch(e){}},function(){send("res",{url:url,m:m,status:0,ct:"",tx:""})});return p};
var X=XMLHttpRequest.prototype,O=X.open,S=X.setRequestHeader,D=X.send;
X.open=function(m,u){if(out(u)){arguments[1]=String(u).replace(/auth.refresh[^?#]*/i,"auth/dn-signed-out");u=arguments[1]}this.__u=String(u);this.__m=m;send("req",{url:String(u),m:m,a:""});return O.apply(this,arguments)};
X.setRequestHeader=function(k,v){if(/^authorization$/i.test(k))send("req",{url:this.__u,m:this.__m,a:v});return S.apply(this,arguments)};
var okU=function(u){try{var x=new URL(String(u)),h=x.hostname;return x.protocol==="https:"&&(h==="top-academy.ru"||h.slice(-15)===".top-academy.ru")}catch(e){return false}};
document.addEventListener("dn-req",function(e){var q;try{q=JSON.parse(e.detail)}catch(x){return}if(!okU(q.url))return;
F.call(window,q.url,{headers:q.h}).then(function(r){return r.text().then(function(t){send("rpc",{id:q.id,status:r.status,tx:t})})},function(){send("rpc",{id:q.id,status:0,tx:""})})});
document.addEventListener("dn-post",function(e){var q;try{q=JSON.parse(e.detail)}catch(x){return}if(!okU(q.url))return;
if(q.json!=null){F.call(window,q.url,{method:"POST",headers:Object.assign({"content-type":"application/json"},q.h),body:q.json}).then(function(r){return r.text().then(function(t){send("rpc",{id:q.id,status:r.status,tx:t})})},function(){send("rpc",{id:q.id,status:0,tx:""})});return}
var fd=new FormData();(q.f||[]).forEach(function(p){fd.append(p[0],p[1])});
if(q.file){var b=atob(q.file.b64),u=new Uint8Array(b.length);for(var i=0;i<b.length;i++)u[i]=b.charCodeAt(i);fd.append(q.file.k,new File([u],q.file.name,{type:q.file.type||"application/octet-stream"}))}
F.call(window,q.url,{method:"POST",headers:q.h,body:fd}).then(function(r){return r.text().then(function(t){send("rpc",{id:q.id,status:r.status,tx:t})})},function(){send("rpc",{id:q.id,status:0,tx:""})})});
X.send=function(){var x=this;x.addEventListener("loadend",function(){var tx="";try{tx=x.responseType===""||x.responseType==="text"?x.responseText:(x.responseType==="json"?JSON.stringify(x.response):"")}catch(e){}send("res",{url:x.responseURL||x.__u,m:x.__m||"GET",status:x.status,ct:x.getResponseHeader("content-type")||"",tx:tx&&tx.length<300000?tx:""})});return D.apply(this,arguments)};
send("ready",{});
})();`;
  if (HAS_UW) {
  W.fetch = function (input, init) {
      try { if (outBlocked(typeof input === "string" ? input : input && input.url)) return Promise.resolve(new Response('{"message":"Unauthorized"}', { status: 401, headers: { "content-type": "application/json" } })); } catch (e) {}
      try { const url = typeof input === "string" ? input : input.url; noteRequest(url, (init && init.headers) || (input && input.headers)); noteWrite((init && init.method) || (input && input.method), url, init && init.body); } catch (e) {}
      const pr = origFetch(input, init);
      try { const m = (init && init.method) || (input && input.method) || "GET"; if (!/^(GET|HEAD|OPTIONS)$/i.test(m)) { const url = typeof input === "string" ? input : input.url; pr.then(r => r.clone().text().then(t => emitWrite({ method: m, path: pathOf(url), status: r.status, text: t }))).catch(() => emitWrite({ method: m, path: pathOf(url), status: 0, text: "" })); } } catch (e) {}
      pr.then(r => { try { const u0 = r.url || (typeof input === "string" ? input : input.url); if (/auth|login|token/i.test(u0)) r.clone().text().then(t => noteSiteStatus(u0, r.status, t)).catch(() => {}); else noteSiteStatus(u0, r.status); } catch (e) {} }).catch(() => {});
      pr.then(r => { try { if ((r.headers.get("content-type") || "").includes("json") && !(init && init.method && init.method !== "GET")) r.clone().json().then(j => noteSite(r.url, j)).catch(() => {}); } catch (e) {} }).catch(() => {});
      return pr;
    };
    const XP = W.XMLHttpRequest.prototype, XO = XP.open, XH = XP.setRequestHeader, XS = XP.send;
    XP.open = function (m, u) { if (outBlocked(u)) { arguments[1] = String(u).replace(/auth\/refresh[^?#]*/i, "auth/dn-signed-out"); u = arguments[1]; } this.__dnUrl = u; this.__dnM = m; try { noteRequest(u); } catch (e) {} return XO.apply(this, arguments); };
    XP.setRequestHeader = function (k, v) { try { if (this.__dnUrl) noteRequest(this.__dnUrl, { [k]: v }); } catch (e) {} return XH.apply(this, arguments); };
    XP.send = function (b) {
      try { if (this.__dnM && !/^(GET|HEAD|OPTIONS)$/i.test(this.__dnM)) { const m = this.__dnM, u = this.__dnUrl; this.addEventListener("loadend", function () { let t = ""; try { t = this.responseType === "" || this.responseType === "text" ? this.responseText : ""; } catch (e) {} emitWrite({ method: m, path: pathOf(u), status: this.status, text: t }); }); } } catch (e) {}
      try { this.addEventListener("loadend", function () { try { const u0 = this.responseURL || String(this.__dnUrl || ""); let t = ""; if (/auth|login|token/i.test(u0)) try { t = this.responseType === "" || this.responseType === "text" ? this.responseText : this.responseType === "json" ? JSON.stringify(this.response) : ""; } catch (e) {} noteSiteStatus(u0, this.status, t); } catch (e) {} }); } catch (e) {}
      try { noteWrite(this.__dnM, this.__dnUrl, b); if (!this.__dnM || /get/i.test(this.__dnM)) this.addEventListener("load", function () { try { if ((this.getResponseHeader("content-type") || "").includes("json")) noteSite(this.responseURL || this.__dnUrl, this.responseType === "json" ? this.response : JSON.parse(this.responseText)); } catch (e) {} }); } catch (e) {}
      return XS.apply(this, arguments);
    };
  } else {
    NET.hook = "page"; NET.hookEvents = 0;
    var RPC = {}, rpcN = 0;
    // запрос через страницу журнала: у него правильный адрес-источник, поэтому сервер его пропускает
    var pageRequest = (url, headers) => new Promise((res, rej) => {
      const id = ++rpcN; const t = setTimeout(() => { delete RPC[id]; rej(new Error("страница не ответила")); }, 12000);
      RPC[id] = d => { clearTimeout(t); res({ status: d.status, text: d.tx || "" }); };
      document.dispatchEvent(new CustomEvent("dn-req", { detail: JSON.stringify({ id, url, h: headers }) }));
    });
    document.addEventListener("dn-net", e => { NET.hookEvents++;
      let o; try { o = JSON.parse(e.detail); } catch (x) { return; } const d = o.d || {};
      try {
        if (o.t === "ready") { NET.pageReady = true; return; }
        if (o.t === "rpc") { const cb = RPC[d.id]; if (cb) { delete RPC[d.id]; cb(d); } return; }
        if (o.t === "req") { noteRequest(d.url, d.a ? { authorization: d.a } : null); return; }
        const m = String(d.m || "GET").toUpperCase();
        noteSiteStatus(d.url, d.status, d.tx);
        if (!/^(GET|HEAD|OPTIONS)$/.test(m)) { if (!/\/g\/collect/.test(d.url)) pushW(`${m} ${pathOf(d.url)}`); emitWrite({ method: m, path: pathOf(d.url), status: d.status, text: d.tx || "" }); }
        else if (/json/i.test(d.ct || "") && d.tx) noteSite(d.url, JSON.parse(d.tx));
      } catch (x) {}
    });
    const inject = () => { try { const sc = document.createElement("script"); sc.textContent = PAGE_HOOK; document.documentElement.appendChild(sc); sc.remove(); } catch (x) {} };
    if (document.documentElement) inject(); else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); inject(); } }).observe(document, { childList: true });
  }
  function jwtExp(t) { try { const p = JSON.parse(atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))); return p && p.exp ? p.exp * 1000 : 0; } catch (e) { return 0; } }
  function saveToken(t) {
    NET.authDead = 0;
    try { sessionStorage.setItem("dn2.t", t); } catch (e) {}
    const exp = jwtExp(t); try { if (exp > Date.now()) localStorage.setItem("dn2.tk", JSON.stringify({ t, exp })); } catch (e) {}
  }
  function forgetToken() { try { sessionStorage.removeItem("dn2.t"); localStorage.removeItem("dn2.tk"); } catch (e) {} }
  // журнал показал страницу входа (вышли кнопкой журнала или вход истёк) - старый вход больше не нужен
  function onSignedOut() { if (NET.token || localStorage.getItem("dn2.tk")) { forgetToken(); NET.token = null; NET.tokenSrc = null; } }
  // Ищем сохранённый вход журнала: JWT в любом хранилище или значение под ключом вроде token/access (в т.ч. внутри JSON)
  function scanStorageForToken() {
    try { const k = JSON.parse(localStorage.getItem("dn2.tk") || "null"); if (k && k.t && k.exp > Date.now() + 30000) { NET.tokenSrc = NET.tokenSrc || "сохранён Дневником"; return k.t; } } catch (e) {}
    try { const t = sessionStorage.getItem("dn2.t"); if (t && !(jwtExp(t) && jwtExp(t) < Date.now())) { NET.tokenSrc = NET.tokenSrc || "сохранён Дневником"; return t; } } catch (e) {}
    const found = [];
    const look = (v, path, d) => {
      if (v == null || d > 5) return;
      if (typeof v === "string") {
        const m = v.match(JWT_RX); if (m) { found.push([path, m[0], 2]); return; }
        if (/token|auth|access|jwt|bearer/i.test(path) && /^[\w\-.~+/=]{24,}$/.test(v)) found.push([path, v, 1]);
        if (/^\s*[\[{]/.test(v)) { try { look(JSON.parse(v), path, d + 1); } catch (e) {} }
      } else if (typeof v === "object") for (const k of Object.keys(v)) look(v[k], path + "." + k, d + 1);
    };
    for (const [nm, get] of [["localStorage", () => localStorage], ["sessionStorage", () => sessionStorage]]) {
      try { const st = get(); for (let i = 0; i < st.length; i++) { const k = st.key(i); if (!k || k.startsWith("dn2.")) continue; look(st.getItem(k), nm + ":" + k, 0); } } catch (e) {}
    }
    try { document.cookie.split(";").forEach(c => { const i = c.indexOf("="); if (i < 0) return; let v = c.slice(i + 1).trim(); try { v = decodeURIComponent(v); } catch (e) {} look(v, "cookie:" + c.slice(0, i).trim(), 0); }); } catch (e) {}
    if (!found.length) return null;
    const rank = f => f[2] * 10 + (/refresh/i.test(f[0]) ? -15 : 0) + (/access/i.test(f[0]) ? 3 : 0) + (jwtExp(f[1]) && jwtExp(f[1]) < Date.now() ? -30 : 0);
    found.sort((a, b) => rank(b) - rank(a));
    NET.tokenSrc = found[0][0].replace(/\..*$/, "");
    return found[0][1];
  }


  /* ======================= новая версия Дневника ======================= */
  // что нового в текущей версии - показывается в Настройках
  const CHANGES = ["Главная: у каждого задания свой значок - новое, просрочено, на проверке, оценено", "Оценки: подписано, где средний балл за всё время, а где за эту неделю", "Домашние задания: компактные кнопки на телефоне, срок и преподаватель в одну строку", "Крипта в Safari: без ошибки Rapira, курс ЦБ подписан как курс ЦБ", "Крипта в Safari (iPhone, iPad, Mac): курс доллара и график из источников, которые Safari разрешает", "Домашние задания: кнопки файлов и «Сдать задание» внизу карточки, ровно и без обрезанного текста", "Крипта: график доллара берётся из запасных источников, если сайт Банка России не отвечает (часто с VPN)", "iPad: при наборе текста окно поднимается над клавиатурой и не прыгает при прокрутке", "Расписание: метка «сегодня» не вылезает за колонку", "Домашние задания: кнопки файлов не вылезают за карточку", "Короткие разделы (материалы, контакты, жалобы и др.) больше не прокручиваются в пустую чёрную полосу", "iPad: короткие разделы при прокрутке больше не сдвигают экран и не оставляют чёрную полосу", "Топкоины и топгемы - значками как в журнале", "iPad и iPhone: нажатия больше не сползают на соседние кнопки и пункты меню", "Итоги месяца: только завершённый месяц - текущий появится в последние 3 дня", "Настройки: графика - авто, полная или лёгкая для слабых устройств", "Безопасность: запросы с ключом входа уходят только на серверы журнала", "Если журнал поменяет вёрстку и Дневник не запустится - откроется обычный журнал с кнопкой Дневника", "Главная: под ближайшим учебным днём показан следующий за ним день, а не тот же", "Настройки: цели по баллу и посещаемости можно скрыть", "Средние показатели: вернулся прежний вид графика", "Все пары: при открытии всегда текущая неделя и её итог", "Меню: двузначные счётчики больше не обрезаются", "Метка «новое» - справа от названия, новая карточка обведена цветом акцента", "День рождения: конфетти не перекрывают текст", "Уведомления на главной: в две колонки, кнопки по центру"];
  // карточка «Крипта» есть в основной версии; по умолчанию выключена (Настройки → Внешний вид)
  const CRYPTO = true;
  const UPD_URL = "https://gist.githubusercontent.com/havin8/1dfbe9d913d7e000c0de52ad11a9317f/raw/dnevnik.user.js";
  const verNewer = (a, b) => { const x = String(a).split(".").map(Number), y = String(b).split(".").map(Number); for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d > 0; } return false; };
  async function checkUpdate(force) {
    const last = LS.get("updAt", 0); if (!force && Date.now() - last < 20 * 60e3) return; LS.set("updAt", Date.now());
    const url = UPD_URL + "?t=" + Math.floor(Date.now() / 60000);
    let text = "";
    try { const gm = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) || null;
      if (gm) text = await new Promise((res, rej) => gm({ method: "GET", url, timeout: 15000, onload: r => r.status === 200 ? res(r.responseText) : rej(), onerror: rej, ontimeout: rej })); } catch (e) {}
    if (!text) try { const r = await origFetch(url, { cache: "no-store" }); if (r.ok) text = await r.text(); } catch (e) {}
    const m = String(text).slice(0, 3000).match(/@version\s+([\d.]+)/); if (!m) return;
    const prev = LS.get("upd", null); LS.set("upd", { v: m[1], at: Date.now() });
    if ((!prev || prev.v !== m[1]) && R && (page === "home" || page === "settings")) { render(); if (verNewer(m[1], VERSION)) toast(`Вышла новая версия ${m[1]} - плашка на главной`); }
  }

  /* ======================= рынок: карточка «Крипта» (включается в Настройках) ======================= */
  // выключена - ничего не делает: нет таймеров, запросов, чтения сохранённых курсов и обработчиков жестов
  // доллар - USDT/RUB на Rapira (если не ответила - курс ЦБ), история доллара - курс ЦБ (cbr.ru), крипта - Bybit (запасной вариант Binance),
  // индекс страха и жадности - alternative.me. Ничего не рассчитываем «от себя»: только то, что отдают источники.
  const COINS = [["BTC", "Bitcoin", "#f7931a", "₿"], ["TON", "Toncoin", "#0098ea", "◆"], ["SOL", "Solana", "#9945ff", "◎"], ["ETH", "Ethereum", "#8a92b2", "Ξ"]];
  const FNG_RU = { "Extreme Fear": "сильный страх", Fear: "страх", Neutral: "нейтрально", Greed: "жадность", "Extreme Greed": "сильная жадность" };
  const MK_PER = { 7: { bb: "60", bn: "1h", n: 168, ttl: 10 * 60e3, l: "7 дней" }, 30: { bb: "240", bn: "4h", n: 180, ttl: 30 * 60e3, l: "30 дней" }, 90: { bb: "D", bn: "1d", n: 90, ttl: 60 * 60e3, l: "90 дней" } };
  const MKT = { usd: null, cbr: null, cbrHist: [], coins: {}, hist: {}, histAt: {}, fng: null, fngHist: [], at: 0, fngAt: 0, cbrAt: 0, fail: 0 };
  // сохранённые курсы читаем только когда карточка нужна; цены (маленькие) и графики (большие) хранятся отдельно - графики пишутся только когда обновились
  let mkLoaded = false, mkHistDirty = false, mkTimer = 0, mkBound = false;
  const mkEnsure = () => { if (mkLoaded) return; mkLoaded = true; Object.assign(MKT, LS.get("mkt2", {}), LS.get("mkth", {})); if (!NO_CORS_OK) { MKT.rapErr = null; MKT.usd = null; } };
  function mkSave() {
    LS.set("mkt2", { usd: MKT.usd, cbr: MKT.cbr, cbrSrc: MKT.cbrSrc, coins: MKT.coins, fng: MKT.fng, at: MKT.at, fngAt: MKT.fngAt, cbrAt: MKT.cbrAt, fail: MKT.fail, rapErr: NO_CORS_OK ? MKT.rapErr : null });
    if (mkHistDirty) { mkHistDirty = false; LS.set("mkth", { cbrHist: MKT.cbrHist, hist: MKT.hist, histAt: MKT.histAt, fngHist: MKT.fngHist }); }
  }
  // карточка на экране? (не грузим курсы, пока её не видно)
  const mkVisible = () => { const el = R && page === "home" && R.querySelector(".mkt"); if (!el) return false; const r = el.getBoundingClientRect(); return r.bottom > 0 && r.top < innerHeight; };
  function mkStart() {
    if (!CRYPTO || !cfg.mkt) return; mkEnsure(); if (R) mkBind(R);
    if (!mkTimer) mkTimer = setInterval(() => { if (host && !document.hidden && mkVisible()) marketLoad(); }, 60 * 1000);
    setTimeout(() => marketLoad(), 600);
  }
  function mkStop() { clearInterval(mkTimer); mkTimer = 0; }
  document.addEventListener("visibilitychange", () => { if (mkTimer && !document.hidden && mkVisible()) marketLoad(); });
  let mkPer = [7, 30, 90].includes(+LS.get("mkper", 30)) ? +LS.get("mkper", 30) : 30, mkBusy = false, mkSheet = null;
  const MK_CH = {}; let mkLast = ""; // графики на экране: id -> { pts: [[время, значение]], fmt }

  function xget(url, asText) {
    const gm = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function" ? GM.xmlHttpRequest : null);
    const parse = (t, st) => { if (asText) return t; try { return JSON.parse(t); } catch (e) { throw new Error(`ответ ${st || "?"}, не JSON: ${String(t || "").replace(/\s+/g, " ").slice(0, 60)}`); } };
    const viaFetch = () => origFetch(url, { cache: "no-store", credentials: "omit", headers: { accept: "application/json, text/plain, */*" } })
      .then(async r => { const t = await r.text(); if (!r.ok) throw new Error("ответ " + r.status); return parse(t, r.status); });
    if (!gm) return viaFetch();
    return new Promise((res, rej) => gm({ method: "GET", url, timeout: 12000, headers: { accept: "application/json, text/plain, */*" },
      onload: r => { try { if (r.status !== 200) throw new Error("ответ " + r.status); res(parse(r.responseText, r.status)); } catch (e) { rej(e); } },
      onerror: () => rej(new Error("сеть")), ontimeout: () => rej(new Error("таймаут")) }))
      .catch(e1 => viaFetch().catch(e2 => { throw new Error(e1.message + (e2.message !== e1.message ? " / " + e2.message : "")); }));
  }
  const mnum = v => { const n = parseFloat(String(v).replace(",", ".")); return isFinite(n) ? n : null; };
  const ddmmyyyy = d => `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  const KR = { BTC: "XBT" };
  async function coinTicker(t) {
    for (let a = 0; a < 2; a++) try { const j = await xget(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${t}USDT`); const x = j && j.result && j.result.list && j.result.list[0];
      if (x && mnum(x.lastPrice)) return { p: mnum(x.lastPrice), ch: mnum(x.price24hPcnt) * 100, hi: mnum(x.highPrice24h), lo: mnum(x.lowPrice24h), vol: mnum(x.turnover24h), src: "Bybit" }; } catch (e) {}
    try { const x = await xget(`https://api.binance.com/api/v3/ticker/24hr?symbol=${t}USDT`);
      if (x && mnum(x.lastPrice)) return { p: mnum(x.lastPrice), ch: mnum(x.priceChangePercent), hi: mnum(x.highPrice), lo: mnum(x.lowPrice), vol: mnum(x.quoteVolume), src: "Binance" }; } catch (e) {}
    const k = await xget(`https://api.kraken.com/0/public/Ticker?pair=${KR[t] || t}USD`), x = k && k.result && Object.values(k.result)[0];
    if (x && mnum(x.c[0])) { const p = mnum(x.c[0]), o = mnum(x.o); return { p, ch: o ? (p - o) / o * 100 : null, hi: mnum(x.h[1]), lo: mnum(x.l[1]), vol: mnum(x.v[1]) * p, src: "Kraken" }; }
    throw new Error("нет цены");
  }
  async function coinHist(t, per) {
    const P = MK_PER[per];
    for (let a = 0; a < 2; a++) try { const j = await xget(`https://api.bybit.com/v5/market/kline?category=spot&symbol=${t}USDT&interval=${P.bb}&limit=${P.n}`); const l = j && j.result && j.result.list;
      if (Array.isArray(l) && l.length > 2) return l.map(k => [+k[0], mnum(k[4])]).filter(x => x[1] != null).reverse(); } catch (e) {}
    try { const l = await xget(`https://api.binance.com/api/v3/klines?symbol=${t}USDT&interval=${P.bn}&limit=${P.n}`);
      if (Array.isArray(l) && l.length > 2) return l.map(k => [+k[0], mnum(k[4])]).filter(x => x[1] != null); } catch (e) {}
    const k = await xget(`https://api.kraken.com/0/public/OHLC?pair=${KR[t] || t}USD&interval=${{ 60: 60, 240: 240, D: 1440 }[P.bb] || 1440}`), r = k && k.result && Object.entries(k.result).find(([n]) => n !== "last");
    if (r && r[1].length > 2) return r[1].slice(-P.n).map(c => [c[0] * 1000, mnum(c[4])]).filter(x => x[1] != null);
    throw new Error("нет графика");
  }
  // курс ЦБ за 90 дней одним запросом (официальный XML Банка России)
  async function cbrHistory() {
    const to = new Date(Date.now() + 864e5), from = new Date(Date.now() - 95 * 864e5);
    const x = await xget(`https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${ddmmyyyy(from)}&date_req2=${ddmmyyyy(to)}&VAL_NM_RQ=R01235`, true);
    const out = [...String(x).matchAll(/<Record Date="(\d\d)\.(\d\d)\.(\d{4})"[^>]*>[\s\S]*?<Nominal>(\d+)<\/Nominal>[\s\S]*?<Value>([\d,]+)<\/Value>/g)]
      .map(m => [new Date(+m[3], +m[2] - 1, +m[1]).getTime(), mnum(m[5]) / (+m[4] || 1)]).filter(r => r[1]);
    if (out.length < 2) throw new Error("пусто"); return out;
  }
  // запасные источники истории: дни уже прошедшие не меняются - храним в кэше и докачиваем только новые
  const dayKey = d => d.getFullYear() + "/" + String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0");
  async function histByDays(cacheKey, url, pick, step) {
    const cache = LS.get(cacheKey, {}), now = Date.now(), days = [];
    for (let k = 0; k <= 94; k += step) days.push(new Date(now - k * 864e5));
    const todo = days.filter(d => !(dayKey(d) in cache));
    for (let i = 0; i < todo.length; i += 6) await Promise.all(todo.slice(i, i + 6).map(d => xget(url(d)).then(j => { const v = pick(j); if (v) cache[dayKey(d)] = v; else if (now - d > 3 * 864e5) cache[dayKey(d)] = 0; })
      .catch(e => { if (/404/.test(String(e && e.message)) && now - d > 3 * 864e5) cache[dayKey(d)] = 0; })));
    const keep = {}; days.forEach(d => { const k = dayKey(d); if (k in cache) keep[k] = cache[k]; }); LS.set(cacheKey, keep);
    const out = Object.entries(keep).filter(([, v]) => v > 0).map(([k, v]) => { const [y, m, d] = k.split("/").map(Number); return [new Date(y, m - 1, d).getTime(), v]; }).sort((a, b) => a[0] - b[0]);
    if (out.length < 2) throw new Error("пусто"); return out;
  }
  const cbrArchive = () => histByDays("cbrd", d => `https://www.cbr-xml-daily.ru/archive/${dayKey(d)}/daily_json.js`, j => j && j.Valute && j.Valute.USD && mnum(j.Valute.USD.Value), 2);
  const fxMarket = () => histByDays("fxd", d => `https://cdn.jsdelivr.net/npm/@fawazahmed0/currency-api@${dayKey(d).replace(/\//g, "-")}/v1/currencies/usd.min.json`, j => j && j.usd && mnum(j.usd.rub), 3);
  const NO_CORS_OK = HAS_UW && typeof GM_xmlhttpRequest === "function";   // Tampermonkey ходит куда угодно, Safari - только к сайтам с CORS
  async function usdHistory() {
    if (NO_CORS_OK) try { MKT.cbrSrc = "cbr"; return await cbrHistory(); } catch (e) {}
    try { MKT.cbrSrc = "cbr"; return await cbrArchive(); } catch (e) {}
    MKT.cbrSrc = "fx"; return await fxMarket();
  }
  async function marketLoad(force) {
    if (!CRYPTO || !cfg.mkt || mkBusy || (mkEnsure(), !force && Date.now() - MKT.at < 55e3)) return;
    mkBusy = true; const now = Date.now(); let ok = 0;
    const jobs = [
      (NO_CORS_OK ? rapiraLoad() : Promise.reject(new Error("в Safari недоступна"))).then(() => { ok++; }).catch(e => { MKT.rapErr = NO_CORS_OK ? { m: String(e.message || e).slice(0, 120), at: now } : null; if (!NO_CORS_OK) MKT.usd = null; }),
      ...COINS.map(([t]) => coinTicker(t).then(r => { MKT.coins[t] = r; ok++; }).catch(() => {})),
      mkHistLoad(mkPer, force)];
    if (force || now - MKT.fngAt > 30 * 60e3) jobs.push(xget("https://api.alternative.me/fng/?limit=31").then(j => { const d = j && j.data;
      if (d && d[0]) { MKT.fng = { v: +d[0].value, c: d[0].value_classification, y: d[1] ? +d[1].value : null, w: d[7] ? +d[7].value : null, m: d[30] ? +d[30].value : null };
        MKT.fngHist = d.map(x => [+x.timestamp * 1000, +x.value]).reverse(); MKT.fngAt = now; mkHistDirty = true; } }).catch(() => {}));
    if (force || now - MKT.cbrAt > (MKT.cbrHist && MKT.cbrHist.length > 1 ? 3600e3 : 120e3)) jobs.push(usdHistory().then(h => { MKT.cbrHist = h; mkHistDirty = true; MKT.cbrAt = now; ok++; const a = h[h.length - 1], b = h[h.length - 2];
      if (MKT.cbrSrc !== "fx") { MKT.cbr = { v: a[1], d: a[0], prev: b[1], pd: b[0] }; return; }
      return xget("https://www.cbr-xml-daily.ru/daily_json.js").then(j => { const u = j && j.Valute && j.Valute.USD; if (u && mnum(u.Value)) MKT.cbr = { v: mnum(u.Value), prev: mnum(u.Previous), d: Date.parse(j.Date) || now }; }).catch(() => {}); })
      .catch(() => xget("https://www.cbr-xml-daily.ru/daily_json.js").then(j => { const u = j && j.Valute && j.Valute.USD; if (u && mnum(u.Value)) { MKT.cbr = { v: mnum(u.Value), prev: mnum(u.Previous), d: Date.parse(j.Date) || now }; MKT.cbrAt = now; } }).catch(() => {})));
    await Promise.all(jobs);
    if (!MKT.cbr && !MKT.usd) await xget("https://www.cbr-xml-daily.ru/daily_json.js").then(j => { const u = j && j.Valute && j.Valute.USD; if (u && mnum(u.Value)) { MKT.cbr = { v: mnum(u.Value), prev: mnum(u.Previous), d: Date.parse(j.Date) || now }; ok++; } }).catch(() => {});
    if (!MKT.cbr && !MKT.usd && (MKT.cbrHist || []).length > 1) { const h = MKT.cbrHist, x = h[h.length - 1], y = h[h.length - 2]; MKT.cbr = { v: x[1], d: x[0], prev: y[1], pd: y[0], fx: true }; }
    MKT.diag = `Крипта: курс ${MKT.usd ? "Rapira" : MKT.cbr ? "ЦБ" : "нет"} · график ${(MKT.cbrHist || []).length > 1 ? (MKT.cbrSrc === "fx" ? "рыночный" : "ЦБ") + " " + MKT.cbrHist.length + " дн." : "нет"} · монет ${Object.keys(MKT.coins || {}).length} · ${NO_CORS_OK ? "Tampermonkey" : "Safari"}${MKT.rapErr ? " · Rapira: " + MKT.rapErr.m : ""}`;
    if (ok) { MKT.at = now; MKT.fail = 0; } else MKT.fail = now;
    mkSave(); mkBusy = false; mkPaint();
  }
  async function rapiraLoad() {
    let err;
    for (let a = 0; a < 2; a++) {
      try {
        const j = await xget("https://api.rapira.net/open/market/rates"), list = Array.isArray(j) ? j : (j && (j.data || j.rates || j.list)) || [];
        const x = list.find(r => String(r.symbol || "").replace(/[_-]/, "/").toUpperCase() === "USDT/RUB");
        if (!x || !mnum(x.close)) throw new Error("нет пары USDT/RUB в ответе");
        MKT.usd = { v: mnum(x.close), prev: mnum(x.lastDayClose), hi: mnum(x.high), lo: mnum(x.low), bid: mnum(x.bidPrice), ask: mnum(x.askPrice), at: Date.now() }; MKT.rapErr = null; return;
      } catch (e) { err = e; await new Promise(r => setTimeout(r, 800)); }
    }
    throw err;
  }
  async function mkHistLoad(per, force) {
    const k = String(per), now = Date.now(); if (!force && now - (MKT.histAt[k] || 0) < MK_PER[per].ttl) return;
    await Promise.all(COINS.map(([t]) => coinHist(t, per).then(a => { (MKT.hist[t] = MKT.hist[t] || {})[k] = a; mkHistDirty = true; }).catch(() => {})));
    MKT.histAt[k] = now;
  }
  function mkPaint() {
    const el = R && R.querySelector(".mkt"); if (el && page === "home") { const h = marketHTML(); if (h !== mkLast) { mkLast = h; el.outerHTML = h; } }
    const d = R && R.querySelector("#dlg"); if (mkSheet && d && d.open && d.querySelector(".mks")) { const h = mkSheetHTML(mkSheet); if (h !== d.innerHTML) d.innerHTML = h; }
  }

  /* ---------- вид ---------- */
  const fx = (v, d) => v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  // ≥1000 - с пробелом между разрядами, 1-1000 - два знака после запятой, <1 - четыре (чтобы «1,600» не читалось как 1600)
  const usdF = (v, full) => "$" + fx(v, v >= 1000 ? (full ? 2 : 0) : v >= 1 ? 2 : 4);
  const bigF = v => v >= 1e9 ? fx(v / 1e9, 2) + " млрд" : v >= 1e6 ? fx(v / 1e6, 1) + " млн" : fx(v, 0);
  const chPill = v => v == null || !isFinite(v) ? "" : `<span class="mk-ch ${v < 0 ? "mdn" : "mup"}">${v < 0 ? "▼" : "▲"} ${fx(Math.abs(v), 2)}%</span>`;
  const perCh = a => a && a.length > 1 && a[0][1] ? (a[a.length - 1][1] / a[0][1] - 1) * 100 : null;
  const histOf = (t, per) => (MKT.hist[t] || {})[String(per)] || null;
  const cbrPer = per => { const h = MKT.cbrHist || [], from = Date.now() - per * 864e5; const s = h.filter(r => r[0] >= from); return s.length > 1 ? s : null; };
  const dm2 = ts => { const d = new Date(ts); return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`; };
  const hm2 = ts => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  // линия/область: SVG растягивается по ширине, точки и подписи - HTML поверх (не искажаются)
  function mkChart(id, pts, o) {
    // длинные ряды прореживаем (меньше узлов в SVG), последняя точка - всегда настоящая текущая
    const lim = o.max || (innerWidth < 760 ? 80 : 120); if (pts && pts.length > lim) { const src = pts, k = (src.length - 1) / (lim - 1); pts = Array.from({ length: lim }, (_, i) => src[Math.round(i * k)]); }
    if (!pts || pts.length < 2) return `<div class="mk-chart empty ${o.cls || ""}"><span>${o.empty || "Нет данных для графика"}</span></div>`;
    const vs = pts.map(p => p[1]), mn = Math.min(...vs), mx = Math.max(...vs), pad = (mx - mn) * .12 || mx * .01;
    const lo = mn - pad, hi = mx + pad, X = i => i / (pts.length - 1) * 100, Y = v => (1 - (v - lo) / (hi - lo)) * 100;
    const line = pts.map((p, i) => `${X(i).toFixed(2)},${Y(p[1]).toFixed(2)}`).join(" ");
    MK_CH[id] = { pts, fmt: o.fmt, tfmt: o.tfmt || dm2 };
    const last = pts[pts.length - 1], gid = "mkg" + id;
    const tn = Math.min(o.ticks || 0, pts.length), ticks = tn > 1 ? [...new Set(Array.from({ length: tn }, (_, i) => dm2(pts[Math.round(i / (tn - 1) * (pts.length - 1))][0])))] : [];
    return `<div class="mk-chart ${o.cls || ""}" data-mkc="${id}" style="--lc:${o.col}"><div class="mk-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.col}" stop-opacity="${o.area ? .34 : 0}"/><stop offset="1" stop-color="${o.col}" stop-opacity="0"/></linearGradient></defs>
      ${o.area ? `<polygon points="0,100 ${line} 100,100" fill="url(#${gid})"/>` : ""}<polyline points="${line}" fill="none" stroke="${o.col}" stroke-width="${o.w || 2}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
      ${o.dot ? `<i class="mk-last" style="left:${X(pts.length - 1)}%;top:${Y(last[1])}%"></i>` : ""}<div class="mk-scrub" hidden><i class="mk-vl"></i><i class="mk-dot"></i><span class="mk-tip"></span></div></div>
      ${ticks.length ? `<div class="mk-ticks">${ticks.map(t => `<span>${t}</span>`).join("")}</div>` : ""}</div>`;
  }
  const MK_URL = { rapira: "https://rapira.net/exchange/USDT_RUB", cbr: "https://www.cbr.ru/currency_base/daily/", fng: "https://alternative.me/crypto/fear-and-greed-index/",
    Bybit: t => `https://www.bybit.com/trade/spot/${t}/USDT`, Binance: t => `https://www.binance.com/ru/trade/${t}_USDT?type=spot` };
  const mkLink = (url, label) => `<a class="m-btn mk-go" href="${url}" target="_blank" rel="noopener noreferrer">${ic("ext")}${label}</a>`;
  const coinIc = (col, sym) => `<span class="mk-ic" style="--c:${col}">${sym}</span>`;
  function fngBar(f) {
    const v = Math.max(0, Math.min(100, f.v));
    return `<div class="mk-fg" data-hold="fng"><div class="mk-fgh"><span>Индекс страха и жадности</span><b class="num">${f.v} · ${esc(FNG_RU[f.c] || f.c || "")}</b></div>
      <div class="mk-fgbar"><i style="left:${v}%"></i></div><div class="mk-fgl"><span>страх</span>${f.y != null ? `<span>вчера ${f.y}</span>` : ""}<span>жадность</span></div></div>`;
  }
  // доллар: Rapira, если ответила; иначе курс ЦБ - чтобы вместо «-» всегда был настоящий курс
  function usdNow() {
    const u = MKT.usd, c = MKT.cbr, fresh = u && Date.now() - (u.at || MKT.at) < 6 * 3600e3;
    if (fresh) return { v: u.v, ch: u.prev ? (u.v / u.prev - 1) * 100 : null, src: "Rapira", sub: "USDT/RUB", note: u.prev ? `вчера закрылся на ${fx(u.prev, 2)} ₽` : "" };
    if (c) return { v: c.v, ch: c.prev ? (c.v / c.prev - 1) * 100 : null, src: c.fx ? "рынок" : "ЦБ РФ", sub: c.d ? "курс на " + dm2(c.d) : "официальный курс", note: MKT.rapErr && NO_CORS_OK ? "Rapira сейчас не отвечает - показан курс ЦБ" : c.fx ? "рыночный курс доллара - ЦБ сейчас недоступен" : !NO_CORS_OK ? "официальный курс Банка России" : (c.prev ? `${c.pd ? dm2(c.pd) : "до этого"} было ${fx(c.prev, 2)} ₽` : "") };
    return null;
  }
  const mkRub = (v, cls) => `${fx(v, 2)}<small class="${cls || ""}">₽</small>`;
  function marketHTML() {
    mkEnsure();
    const c = MKT.cbr, U = usdNow(), stale = MKT.at && Date.now() - MKT.at > 5 * 60e3, ch = cbrPer(mkPer), pc = perCh(ch);
    const st = ch ? { mx: Math.max(...ch.map(r => r[1])), mn: Math.min(...ch.map(r => r[1])) } : null;
    const status = !MKT.at ? (mkBusy || !MKT.fail ? "загрузка…" : "нет связи") : (stale ? "нет связи · данные от " : "обновлено в ") + hm2(MKT.at);
    const pers = [7, 30, 90].map(p => `<button data-mkp="${p}" aria-pressed="${p === mkPer}">${p === 7 ? "7 дн" : p === 30 ? "30 дн" : "90 дн"}</button>`).join("");
    const srcs = [...new Set(COINS.map(([t]) => MKT.coins[t] && MKT.coins[t].src).filter(Boolean))].join(", ") || "Bybit";
    const spread = MKT.usd && U && U.src === "Rapira" && c ? (MKT.usd.v / c.v - 1) * 100 : null;
    return `<section class="card mkt">
      <div class="mk-hd"><div class="mk-tt"><span class="mk-badge">${ic("trend")}</span><div><h2>Крипта</h2><small><button class="mk-upd" data-act="mkt" title="Обновить">${ic("refresh")}${status}</button></small></div></div>
        <div class="mk-hr"><div class="pill mk-pill">${pers}</div><button class="mk-x" data-act="mktoff" aria-label="Скрыть карточку" title="Скрыть (вернуть можно в Настройках)">×</button></div></div>
      <div class="mk-grid">
        <div class="mk-main" data-hold="usd">
          <div class="mk-mtop"><span class="mk-lbl">Доллар США</span><span class="mk-src">${U ? U.src + " · " + U.sub : "загрузка"}</span></div>
          <div class="mk-bigrow"><div class="mk-big num">${U ? mkRub(U.v) : "…"}</div>${chPill(U && U.ch)}</div>
          <div class="mk-bsub">${U && U.note ? esc(U.note) : "&nbsp;"}${spread != null ? `<span class="mk-dotsep"></span>ЦБ ${fx(c.v, 2)} ₽ · ${spread >= 0 ? "+" : "−"}${fx(Math.abs(spread), 2)}% к ЦБ` : ""}</div>
          ${mkChart("usd", ch, { col: "var(--gold)", area: 1, dot: 1, ticks: 5, w: 2.4, cls: "big", fmt: v => fx(v, 2) + " ₽", empty: "График курса пока не загрузился - попробуй обновить или выключить VPN" })}
          <div class="mk-stats"><div><span>Макс.</span><b class="num">${st ? fx(st.mx, 2) + " ₽" : "-"}</b></div><div><span>Мин.</span><b class="num">${st ? fx(st.mn, 2) + " ₽" : "-"}</b></div>
            <div><span>За ${MK_PER[mkPer].l}</span><b class="num ${pc == null ? "" : pc >= 0 ? "mup" : "mdn"}">${pc != null ? (pc >= 0 ? "+" : "−") + fx(Math.abs(pc), 2) + "%" : "-"}</b></div><div class="mk-sfoot">график и мин./макс. - ${MKT.cbrSrc === "fx" ? "рыночный курс по дням" : "курс ЦБ по дням"}</div></div>
        </div>
        <div class="mk-side">
          <div class="mk-list"><div class="mk-lh"><span>Монеты</span><span>${esc(srcs)} · за ${MK_PER[mkPer].l}</span></div>
          ${COINS.map(([t, nm, col, sym]) => { const x = MKT.coins[t], h = histOf(t, mkPer), pc = perCh(h); const up = (pc != null ? pc : x ? x.ch : 0) >= 0;
            return `<div class="mk-row" data-hold="${t}">${coinIc(col, sym)}<div class="mk-nm"><b>${nm}</b><span>${t}</span></div>
              ${mkChart("s" + t, h, { col: up ? "var(--good)" : "var(--bad)", w: 1.6, cls: "spark", fmt: usdF, empty: "", max: 48 })}
              <div class="mk-pr"><b class="num">${x ? usdF(x.p) : "-"}</b>${chPill(pc != null ? pc : x && x.ch)}</div></div>`; }).join("")}</div>
          ${MKT.fng ? fngBar(MKT.fng) : ""}
        </div>
      </div>
      <div class="mk-foot"><span>${ic("hand")}Нажми на доллар, монету или индекс - откроются подробности</span><span>Только для информации</span></div>
    </section>`;
  }
  // подробности по зажатию
  function mkSheetHTML(k) {
    mkEnsure();
    const per = () => `<div class="pill mk-pill">${[7, 30, 90].map(p => `<button data-mkp="${p}" aria-pressed="${p === mkPer}">${p === 7 ? "7 дн" : p === 30 ? "30 дн" : "90 дн"}</button>`).join("")}</div>`;
    const row = (a, b) => `<div><span>${a}</span><b class="num">${b}</b></div>`;
    let head = "", body = "";
    if (k === "usd") {
      const c = MKT.cbr, ch = cbrPer(mkPer), pc = perCh(ch), U = usdNow(), u = MKT.usd;
      head = `${coinIc("#3fb67e", "$")}<div class="mk-nm"><b>Доллар к рублю</b><span>${U ? U.src + " · " + U.sub : ""}</span></div>`;
      body = `<div class="mks-price"><b class="num">${U ? (U.src === "ЦБ РФ" ? fx(U.v, 4) + "<small>₽</small>" : mkRub(U.v)) : "-"}</b>${chPill(U && U.ch)}</div>
        ${u || MKT.rapErr ? `<div class="mks-sec">Rapira · USDT/RUB</div>` : ""}
        ${u ? `<div class="mks-grid">${row("Покупка", u.bid ? fx(u.bid, 2) + " ₽" : "-")}${row("Продажа", u.ask ? fx(u.ask, 2) + " ₽" : "-")}${row("Макс. за сутки", u.hi ? fx(u.hi, 2) + " ₽" : "-")}${row("Мин. за сутки", u.lo ? fx(u.lo, 2) + " ₽" : "-")}</div>` : ""}
        ${MKT.rapErr && NO_CORS_OK ? `<div class="mks-err">Rapira не ответила в ${hm2(MKT.rapErr.at)}: ${esc(MKT.rapErr.m)}</div>` : ""}
        <div class="mks-sec">Курс ЦБ РФ${c && c.d ? " на " + dm2(c.d) : ""}</div>${per()}
        ${mkChart("dusd", ch, { col: "var(--gold)", area: 1, dot: 1, ticks: 5, w: 2.4, cls: "sheet", fmt: v => fx(v, 2) + " ₽", empty: "График курса пока не загрузился" })}
        <div class="mks-grid">${row("Курс ЦБ (точно)", c ? fx(c.v, 4) + " ₽" : "-")}${row("Прошлый курс" + (c && c.pd ? " (" + dm2(c.pd) + ")" : ""), c && c.prev ? fx(c.prev, 2) + " ₽" : "-")}${row("За " + MK_PER[mkPer].l, pc != null ? (pc >= 0 ? "+" : "−") + fx(Math.abs(pc), 2) + "%" : "-")}
        ${row("Макс. за " + MK_PER[mkPer].l, ch ? fx(Math.max(...ch.map(r => r[1])), 2) + " ₽" : "-")}${row("Мин. за " + MK_PER[mkPer].l, ch ? fx(Math.min(...ch.map(r => r[1])), 2) + " ₽" : "-")}${u && c ? row("Rapira к ЦБ", (u.v >= c.v ? "+" : "−") + fx(Math.abs(u.v / c.v - 1) * 100, 2) + "%") : ""}</div>`;
    } else if (k === "fng") {
      const f = MKT.fng || {}, h = MKT.fngHist || [];
      head = `<span class="mk-ic" style="--c:#e3b04b">${f.v != null ? f.v : "?"}</span><div class="mk-nm"><b>Индекс страха и жадности</b><span>${esc(FNG_RU[f.c] || f.c || "")} · alternative.me</span></div>`;
      body = `${f.v != null ? fngBar(f) : ""}
        <div class="mks-bars">${h.map(r => `<i title="${dm2(r[0])}: ${r[1]}" style="height:${Math.max(4, r[1])}%;background:${r[1] < 25 ? "#e5534b" : r[1] < 47 ? "#e39a4b" : r[1] <= 54 ? "#9aa1b2" : r[1] <= 75 ? "#8fcf6a" : "#3fb67e"}"></i>`).join("")}</div>
        <div class="mk-cap">последние ${h.length} ${plural(h.length, "день", "дня", "дней")} · 0 - сильный страх, 100 - сильная жадность</div>
        <div class="mks-grid">${row("Сегодня", f.v != null ? f.v : "-")}${row("Вчера", f.y != null ? f.y : "-")}${row("Неделю назад", f.w != null ? f.w : "-")}${row("Месяц назад", f.m != null ? f.m : "-")}</div>`;
    } else {
      const c = COINS.find(x => x[0] === k); if (!c) return "";
      const [t, nm, col, sym] = c, x = MKT.coins[t], h = histOf(t, mkPer), pc = perCh(h);
      const up = (pc != null ? pc : x ? x.ch : 0) >= 0;
      head = `${coinIc(col, sym)}<div class="mk-nm"><b>${nm}</b><span>${t}/USDT · ${x ? x.src : "Bybit"}</span></div>`;
      body = `<div class="mks-price"><b class="num">${x ? usdF(x.p, true) : "-"}</b>${chPill(x && x.ch)}<span class="soft">за сутки</span></div>${per()}
        ${mkChart("d" + t, h, { col: up ? "var(--good)" : "var(--bad)", area: 1, dot: 1, ticks: 5, w: 2.2, cls: "sheet", fmt: usdF, tfmt: mkPer === 7 ? ts => dm2(ts) + " " + hm2(ts) : dm2, empty: "Нет данных для графика" })}
        <div class="mks-grid">${row("Макс. за сутки", x && x.hi ? usdF(x.hi, true) : "-")}${row("Мин. за сутки", x && x.lo ? usdF(x.lo, true) : "-")}
        ${row("За " + MK_PER[mkPer].l, pc != null ? (pc >= 0 ? "+" : "−") + fx(Math.abs(pc), 2) + "%" : "-")}${row("Оборот за сутки", x && x.vol ? "$" + bigF(x.vol) : "-")}
        ${(() => { const U = usdNow(); return row("В рублях" + (U ? " (" + U.src + ")" : ""), x && U ? fx(x.p * U.v, x.p * U.v >= 1000 ? 0 : 2) + " ₽" : "-"); })()}${row(`Макс. за ${MK_PER[mkPer].l}`, h ? usdF(Math.max(...h.map(r => r[1]))) : "-")}</div>`;
    }
    const cx = MKT.coins[k], links = k === "usd" ? mkLink(MK_URL.rapira, "Открыть USDT/RUB на Rapira") + mkLink(MK_URL.cbr, "Курсы ЦБ на сайте Банка России")
      : k === "fng" ? mkLink(MK_URL.fng, "Открыть индекс на alternative.me")
      : mkLink((MK_URL[cx && cx.src] || MK_URL.Bybit)(k), `Открыть ${k}/USDT на ${cx && cx.src || "Bybit"}`);
    return `<div class="dlg mks"><div class="mks-hd">${head}<button class="x" data-act="close" aria-label="Закрыть">×</button></div><div class="mks-b">${body}<div class="mks-links">${links}</div></div></div>`;
  }
  function mkOpen(k) {
    const d = R.querySelector("#dlg"); mkSheet = k; d.className = ""; d.innerHTML = mkSheetHTML(k);
    if (!d.open) d.showModal();
    d.addEventListener("close", () => { mkSheet = null; }, { once: true });
  }

  /* ---------- жесты: зажатие открывает подробности, ведение по графику показывает значение ---------- */
  let mkHold = null, mkSwallow = 0;
  function mkBind(root) {
    if (mkBound) return; mkBound = true;
    root.addEventListener("pointerdown", e => {
      const h = e.target.closest("[data-hold]"); if (!h || e.target.closest(".mk-chart:not(.spark),.mk-pill,button")) return;
      h.classList.add("pressing");
      mkHold = { el: h, x: e.clientX, y: e.clientY, t: setTimeout(() => { h.classList.remove("pressing"); h.classList.add("popped"); setTimeout(() => h.classList.remove("popped"), 260);
        try { navigator.vibrate && navigator.vibrate(12); } catch (er) {} mkSwallow = Date.now(); mkHold = null; mkOpen(h.dataset.hold); }, 420) };
    });
    const cancel = () => { if (mkHold) { clearTimeout(mkHold.t); mkHold.el.classList.remove("pressing"); mkHold = null; } };
    root.addEventListener("pointermove", e => { if (mkHold && Math.hypot(e.clientX - mkHold.x, e.clientY - mkHold.y) > 10) cancel(); mkScrub(e); });
    ["pointerup", "pointercancel"].forEach(ev => root.addEventListener(ev, e => { cancel(); if (e.pointerType !== "mouse") mkScrubEnd(); }, true));
    root.addEventListener("pointerout", e => { const c = e.target.closest && e.target.closest(".mk-chart"); if (c && e.pointerType === "mouse" && !c.contains(e.relatedTarget)) mkScrubEnd(c); });
    root.addEventListener("contextmenu", e => { if (e.target.closest("[data-hold],.mk-chart")) e.preventDefault(); });
  }
  function mkScrub(e) {
    const c = e.target.closest && e.target.closest(".mk-chart[data-mkc]:not(.spark)"); if (!c) return;
    if (e.pointerType !== "mouse" && !e.buttons && e.pressure === 0) return;
    const ch = MK_CH[c.dataset.mkc]; if (!ch) return;
    const plot = c.querySelector(".mk-plot"), r = plot.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const i = Math.round(f * (ch.pts.length - 1)), p = ch.pts[i], vs = ch.pts.map(q => q[1]), mn = Math.min(...vs), mx = Math.max(...vs), pad = (mx - mn) * .12 || mx * .01;
    const x = i / (ch.pts.length - 1) * 100, y = (1 - (p[1] - (mn - pad)) / ((mx + pad) - (mn - pad))) * 100;
    const s = plot.querySelector(".mk-scrub"); s.hidden = false; c.classList.add("scrubbing");
    s.querySelector(".mk-vl").style.left = x + "%"; const d = s.querySelector(".mk-dot"); d.style.left = x + "%"; d.style.top = y + "%";
    const tip = s.querySelector(".mk-tip"); tip.innerHTML = `<b>${ch.fmt(p[1])}</b><span>${ch.tfmt(p[0])}</span>`; tip.style.left = Math.max(12, Math.min(88, x)) + "%";
  }
  function mkScrubEnd(c) { (c ? [c] : [...R.querySelectorAll(".mk-chart.scrubbing"), ...(R.querySelector("#dlg") ? R.querySelector("#dlg").querySelectorAll(".mk-chart.scrubbing") : [])]).forEach(x => { x.classList.remove("scrubbing"); const s = x.querySelector(".mk-scrub"); if (s) s.hidden = true; }); }
  // клики рынка: период, обновить; клик сразу после зажатия глотаем
  function mkClick(e) {
    if (Date.now() - mkSwallow < 500 && e.target.closest("[data-hold]")) { e.preventDefault(); return true; }
    const p = e.target.closest("[data-mkp]"); if (p) { mkPer = +p.dataset.mkp; LS.set("mkper", mkPer); mkPaint(); mkHistLoad(mkPer).then(() => { mkSave(); mkPaint(); }); return true; }
    if (e.target.closest("[data-act=mktoff]")) { cfg.mkt = false; saveCfg(); mkStop(); render(); toast("Крипта выключена - включить можно в Настройках"); return true; }
    const a = e.target.closest("[data-act=mkt]"); if (a) { toast("Обновляю курсы…"); marketLoad(true); return true; }
    const h = e.target.closest("[data-hold]"); if (h && !e.target.closest(".mk-chart.big,.mk-pill,button,a,#dlg")) { mkOpen(h.dataset.hold); return true; }
    return false;
  }

  /* ======================= запросы к API ======================= */
  const SECRET_KEY = /token|password|secret|session|refresh|access_key|cookie/i;
  // в диагностике не нужны личные данные: телефон, почта, адрес, дата рождения, реквизиты оплаты
  const PII_KEY = /phone|email|mail$|fio|full_name|ful_name|student_name|login|birth|^adress$|^address|date_birth|birthday|settlement_account|okpo|mfo|one_c_code|payer|fio_stud|amount_in_words|bank_name|passport|snils|inn$/i;
  const SENS_PATH = /leader|profile\/operations\/settings|settings\/user-info|payment\/|contacts\/operations|reviews\/|signal\/operations\/signals/;
  // структура без значений: строки заменяем пометкой, числа и флажки оставляем (по ним видно, как журнал отдаёт данные)
  const shape = (v, d = 0) => d > 8 || v == null ? v : typeof v === "string" ? (v ? "[текст]" : "") : Array.isArray(v) ? v.slice(0, 2).map(x => shape(x, d + 1)).concat(v.length > 2 ? [`…ещё ${v.length - 2}`] : []) : typeof v === "object" ? Object.fromEntries(Object.keys(v).map(k => [k, shape(v[k], d + 1)])) : v;
  const scrub = (v, d = 0) => (d > 10 || v == null || typeof v !== "object") ? v : Array.isArray(v) ? v.map(x => scrub(x, d + 1)) : Object.fromEntries(Object.keys(v).map(k => [k, SECRET_KEY.test(k) || (PII_KEY.test(k) && !/^is_|_type$|_verified$/.test(k) && v[k] != null && typeof v[k] !== "object" && typeof v[k] !== "boolean") || (typeof v[k] === "string" && (JWT_RX.test(v[k]) || /[?&](x-amz-|signature|sig|token)=/i.test(v[k]))) ? "[скрыто]" : scrub(v[k], d + 1)]));
  let apiActive = 0; const apiQ = [];
  const slot = () => new Promise(r => { if (apiActive < 6) { apiActive++; r(); } else apiQ.push(r); });
  const unslot = () => { const n = apiQ.shift(); if (n) n(); else apiActive--; };
  async function api(name, path) {
    if (NET.authDead && Date.now() - NET.authDead < 4000) throw Object.assign(new Error("auth"), { auth: true });
    await slot();
    try {
      for (let a = 0; ; a++) {
        try { return await apiOnce(name, path); }
        catch (e) { const st = e.status; if (a >= 2 || e.auth || (NET.ddos && Date.now() - NET.ddos < 60000) || (st && st !== 429 && st < 500)) throw e; delete NET.status[name]; await sleep(700 * (a + 1) + Math.random() * 400); }
      }
    } finally { unslot(); }
  }
  async function apiOnce(name, path) {
    const base = NET.base || DEFAULT_API;
    const headers = Object.assign({ accept: "application/json, text/plain, */*" }, NET.headers);
    if (NET.token) headers.authorization = "Bearer " + NET.token;
    if (NET.resetAt && Date.now() - NET.resetAt < 20000) headers["x-reset-cache"] = "true";
    const url = base + "/" + path;
    try {
      let r;
      try { r = await request(url, headers); } catch (e) { r = { status: 0, text: "", err: e }; }
      if (NET.mode === "page" && r.status === 0) { NET.mode = "gm-only"; try { r = await request(url, headers); } catch (e) {} }
      if (/gm/.test(NET.mode) && (r.status === 0 || r.status === 401 || r.status === 403)) {
        try { const f = await origFetch(url, { headers, mode: "cors", credentials: "include" }); const t2 = await f.text();
          if (f.status >= 200 && f.status < 300) { NET.mode = "fetch"; NET.modeNote = "расширение получило " + r.status + ", работает обычный запрос"; }
          if (f.status >= 200 && f.status < 300 || r.status === 0) r = { status: f.status, text: t2 }; } catch (e) {}
      }
      if (r.status === 0 && r.err) throw r.err;
      const { status, text } = r;
      NET.status[name] = status;
      if (/ddos-guard|ddos guard/i.test(String(text || "").slice(0, 3000))) { NET.ddos = Date.now(); throw new Error("DDoS-Guard"); }
      if (status === 401) NET.authDead = Date.now();
      if (status === 401 || status === 403) throw Object.assign(new Error("auth"), { auth: true });
      if (status >= 200 && status < 300) { NET.authDead = 0; NET.ddos = 0; }
      if (status < 200 || status >= 300) throw Object.assign(new Error("HTTP " + status), { status });
      if (!String(text || "").trim()) { NET.status[name] = 200; return null; }   // 204 / пустой ответ = данных нет
      const j = JSON.parse(text);
      NET.raw[name] = { path, data: (SENS_PATH.test(path) ? shape : scrub)(Array.isArray(j) ? j.slice(0, 2) : j) };
      return j;
    } catch (e) { NET.status[name] = NET.status[name] || String(e.message || e); throw e; }
  }
  // Запрос в обход ограничений браузера (CORS): через Tampermonkey, иначе обычный fetch
  const journalHost = u => { try { const x = new URL(String(u)); return x.protocol === "https:" && /(^|\.)top-academy\.ru$/i.test(x.hostname); } catch (e) { return false; } };
  function request(url, headers) {
    if (!journalHost(url)) return Promise.reject(new Error("адрес не журнала"));
    if (NET.pageReady && typeof pageRequest === "function" && NET.mode !== "gm-only") { NET.mode = "page"; return pageRequest(url, headers); }
    const gm = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : (typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function" ? GM.xmlHttpRequest : null);
    if (gm && NET.mode !== "fetch") {
      if (NET.mode !== "gm-only") NET.mode = "gm";
      return new Promise((res, rej) => gm({
        method: "GET", url, headers: Object.assign({ referer: location.origin + "/", origin: location.origin }, headers), timeout: 20000,
        onload: r => res({ status: r.status, text: r.responseText }), onerror: () => rej(new Error("сеть")), ontimeout: () => rej(new Error("таймаут"))
      }));
    }
    NET.mode = "fetch";
    const go = cred => origFetch(url, { headers, credentials: cred, mode: "cors" }).then(async r => ({ status: r.status, text: await r.text() }));
    return go("omit").catch(() => go("include"));
  }
  const arr = r => Array.isArray(r) ? r : r && typeof r === "object" ? (r.data || r.items || r.result || r.list || r.rows || Object.values(r).find(Array.isArray) || []) : [];
  const pick = (o, keys) => { if (!o) return undefined; for (const k of keys) { const v = o[k]; if (v !== undefined && v !== null && v !== "") return v; } return undefined; };
  const num = v => v === undefined || v === null || v === "" ? null : isFinite(+v) ? +v : null;
  function isoOf(s) {
    if (!s) return null; s = String(s);
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/); if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/); if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }
  const hm = s => { const m = String(s || "").match(/(\d{1,2}):(\d{2})/); return m ? m[1].padStart(2, "0") + ":" + m[2] : ""; };

  /* ======================= модель ======================= */
  const EMPTY = () => ({ live: false, updatedAt: null, user: { name: "", group: "", coins: null, gems: null, photo: null, id: null }, groupPlace: null, streamPlace: null, streamSize: null,
    schedule: {}, schedLive: {}, visits: [], leaders: [], feed: [], hw: [], hwStat: { all: 0, cur: 0, done: 0, wait: 0, late: 0 }, news: [], reviews: [], exams: [], avg: [] });
  // кэш только с реальными данными этого аккаунта (никаких встроенных снимков)
  let M = (() => { const c = LS.get("model", null); return c && c.live ? Object.assign(EMPTY(), c) : EMPTY(); })();
  const SEEDED = !M.live;

  let syncing = null, lastSync = 0, hwCountVal = null, retryN = 0, retryT = 0;
  // нет данных и журнал не ответил - пробуем снова через 15, 30, 60 секунд (например, пока идёт вход)
  function scheduleRetry() { if (retryN >= 5 || retryT) return; retryT = setTimeout(() => { retryT = 0; retryN++; if (!isLoginRoute()) sync("retry"); }, (M.live ? 20000 : 4000) * Math.pow(2, retryN)); }
  let syncStart = 0, authFails = 0, syncGen = 0, pollSig = "";
  // редко меняющиеся разделы (оплата, профиль, контакты, экзамены…) - раз в час или по кнопке «Обновить»
  const SLOW_MS = 3600e3;
  // Вход устарел: журнал сам получает 401, а Дневник - ни одного ответа. Не заставляем искать кнопку «Выйти» - выходим сами,
  // чтобы сразу появилось окно входа. Не чаще раза в 3 минуты, чтобы не зациклиться.
  function staleCheck() {
    if (!started || !cfg.on || isLoginRoute() || syncState !== "auth") return false;
    const siteSays = NET.site401 && Date.now() - NET.site401 < 90000;
    if (!(siteSays && authFails >= 1) && authFails < 3) return false;
    let last = 0; try { last = +sessionStorage.getItem("dn2.ao") || 0; } catch (e) {}
    if (Date.now() - last < 180000) return false;
    try { sessionStorage.setItem("dn2.ao", String(Date.now())); sessionStorage.setItem("dn2.why", "Вход в журнал устарел - войди заново"); } catch (e) {}
    if (R) toast("Вход устарел - выхожу из аккаунта…");
    setTimeout(() => logout(true), 700); return true;
  }
  function sync(reason) {
    if (syncing && reason === "manual" && Date.now() - syncStart > 15000) syncing = null;   // зависла - начинаем заново
    if (syncing) return syncing;
    syncStart = Date.now();                       // не запускаем вторую синхронизацию поверх первой
    const g = ++syncGen, pr = doSync(reason, g).finally(() => { clearTimeout(slowT); if (syncing === pr) syncing = null; lastSync = Date.now(); });
    const slowT = setTimeout(() => { if (syncing === pr && syncState === "loading" && M.live) { syncState = "ok"; paintSync(); } }, 20000);
    return syncing = pr;
  }
  const strip = m => { const c = Object.assign({}, m); delete c.updatedAt; delete c.schedLive; return JSON.stringify(c); };
  let freshAt = 0;
  async function freshToken() {
    if (Date.now() - freshAt < 120000 || bridging || isLoginRoute()) return; freshAt = Date.now();
    const old = NET.token; kicks = Math.min(kicks, 1); kickJournal();
    for (let i = 0; i < 25 && NET.token === old; i++) await sleep(200);
  }
  async function doSync(reason, gen) {
    if (navigator.onLine === false) { setSync("error"); return; }
    if (reason === "manual") NET.resetAt = Date.now();
    const slow = !M.live || reason === "manual" || reason === "start" || Date.now() - (LS.get("slowAt", 0) || 0) > SLOW_MS;
    const opt = (n, pth) => slow ? api(n, pth) : Promise.reject({ skip: true });
    setSync("loading");
    { const ex = NET.token && jwtExp(NET.token); if (ex && ex < Date.now() + 20000) { await freshToken(); if (jwtExp(NET.token) && jwtExp(NET.token) < Date.now()) { forgetToken(); NET.token = null; } } }
    if (NET.tokenSrc !== "перехват") { const t = scanStorageForToken(); if (t) NET.token = t; }
    const today = new Date(), mon = mondayOf(today);
    // счётчики ДЗ - один лёгкий запрос; полный список заданий (10+ запросов) - только если счётчики изменились или раз в час
    const hwcP = api("hwCount", "count/homework");
    const hwP = hwcP.then(r => { const sig = JSON.stringify(r); if (!slow && (M.hw || []).length && LS.get("hwsig", "") === sig) return null; return loadHomework().then(x => { LS.set("hwsig", sig); return x; }); }, () => loadHomework());
    hwP.catch(() => {});
    const tasks = {
      user: api("user", "settings/user-info"),
      sched: loadWeeks([dayDate(mon, -7), mon, dayDate(mon, 7)]),
      visits: api("visits", "progress/operations/student-visits"),
      lg: api("leadersGroup", "dashboard/progress/leader-group"),
      ls: api("leadersStream", "dashboard/progress/leader-stream"),
      act: api("activity", "dashboard/progress/activity"),
      news: api("news", "news/operations/latest-news"),
      rev: opt("reviews", "reviews/index/list"),
      exams: opt("exams", "dashboard/info/future-exams"),
      hwc: hwcP,
      payI: opt("payIndex", "payment/operations/index"), payS: opt("paySchedule", "payment/operations/schedule"), payH: opt("payHistory", "payment/operations/history"),
      prof: opt("profile", "profile/operations/settings"), sig: api("signals", "signal/operations/signals-list"), sigT: opt("signalTypes", "signal/operations/problems-list"), evl: api("evalLessons", "feedback/students/evaluate-lesson-list"),
      libC: opt("libraryCount", "count/library"), cont: opt("contacts", "contacts/operations/index"),
      avg: opt("avgProgress", "dashboard/chart/average-progress"),
      attC: opt("attendanceChart", "dashboard/chart/attendance"),
      quiz: api("quizOpen", "library/quiz/opened-interview"), quizD: opt("quizDebt", "library/operations/quizzes-academic-debt")
    };
    const keys = Object.keys(tasks), res = await Promise.allSettled(Object.values(tasks));
    if (gen !== syncGen) return;                // пока ждали, началась более новая синхронизация
    const R = {}; keys.forEach((k, i) => R[k] = res[i]);
    const asked = keys.filter(k => !(R[k].reason && R[k].reason.skip));
    const good = asked.filter(k => R[k].status === "fulfilled").length;
    if (good && good < asked.length * 0.7) scheduleRetry(); else if (good) retryN = 0;
    if (slow && good >= asked.length * 0.7) LS.set("slowAt", Date.now());
    NET.totalCount = asked.length;
    if (!good) { const auth = res.some(r => r.reason && r.reason.auth); if (auth && NET.tokenSrc !== "перехват") { forgetToken(); NET.token = null; }
      authFails = auth ? authFails + 1 : 0; setSync(auth ? "auth" : "error"); if (auth) { if (staleCheck()) return; kickJournal(); } scheduleRetry(); return; }
    authFails = 0;
    NET.okCount = good;
    // другой аккаунт в этом же браузере - начинаем с чистого листа
    let base = M;
    try { if (R.user.status === "fulfilled") { const uid = pick(userObj(R.user.value), ["student_id", "id", "user_id"]); if (uid != null && M.user.id != null && String(uid) !== String(M.user.id)) { base = EMPTY(); readSet = new Set(); LS.set("read", []); avaMem = null; LS.set("ava", null); seen = null; LS.set("seen", null); } } } catch (e) {}
    const N = JSON.parse(JSON.stringify(base));
    setTimeout(() => { try { if (M.groupPlace) { const ym = iso(new Date()).slice(0, 7), h = LS.get("rankHist", {}); h[ym] = Object.assign({ first: M.groupPlace }, h[ym] || {}, { last: M.groupPlace }); LS.set("rankHist", h); } } catch (e) {} }, 0);
    const prevNews = new Set((base.news || []).map(n => n.id)), wasLive = base.live;
    N.live = true;
    try { if (R.user.status === "fulfilled") parseUser(N, R.user.value); } catch (e) {}
    try { if (R.visits.status === "fulfilled") parseVisits(N, R.visits.value); } catch (e) {}
    try { if (R.lg.status === "fulfilled") N.leaders = parseLeaders(R.lg.value, N); } catch (e) {}
    try { if (R.ls.status === "fulfilled") { const s = parseLeaders(R.ls.value, N); const me = s.find(x => x.me); N.streamPlace = me ? me.pos : N.streamPlace; N.streamSize = s.length; N.streamLeaders = s; } } catch (e) {}
    try { if (R.act.status === "fulfilled") { const all = arr(R.act.value).map(parseActivity).filter(Boolean); N.feed = all.slice(0, 30); N.feedAll = all.slice(0, 400); } } catch (e) {}
    try { if (R.news.status === "fulfilled") N.news = arr(R.news.value).map(parseNews).filter(Boolean); } catch (e) {}
    try { if (R.rev.status === "fulfilled") N.reviews = arr(R.rev.value).map(parseReview).filter(Boolean); } catch (e) {}
    try { if (R.exams.status === "fulfilled") N.exams = arr(R.exams.value).map(parseExam).filter(Boolean); } catch (e) {}
    hwCountVal = R.hwc.status === "fulfilled" ? R.hwc.value : null;
    try { if (hwCountVal) parseHwCount(N, hwCountVal); } catch (e) {}
    try { if (R.payI.status === "fulfilled") parsePay(N, R.payI.value, R.payS.status === "fulfilled" ? R.payS.value : null, R.payH.status === "fulfilled" ? R.payH.value : null); } catch (e) {}
    try { if (R.prof.status === "fulfilled") N.prof = parseProfile(R.prof.value); } catch (e) {}
    try { if (R.sig.status === "fulfilled") N.signals = arr(R.sig.value).map(o => ({ title: String(pick(o, ["theme", "title", "subject", "name"]) || "Обращение"), status: String(pick(o, ["status_name", "status", "state"]) ?? ""), date: isoOf(pick(o, ["date", "created_at", "date_create", "time"])), days: num(pick(o, ["days_in_work", "days", "work_days"])) })); } catch (e) {}
    try { if (R.sigT.status === "fulfilled") { const L = arr(R.sigT.value); N.sigTypes = L.map(o => String(pick(o, ["title", "name"]) || "")).filter(Boolean); N.sigIds = Object.fromEntries(L.map(o => [String(pick(o, ["title", "name"]) || ""), pick(o, ["id"])])); } } catch (e) {}
    try { if (R.evl.status === "fulfilled") N.evalList = parseEval(R.evl.value); } catch (e) {}
    try { if (R.cont.status === "fulfilled") { const c = R.cont.value || {}; N.contacts = { address: arr(c.adress).map(a => a.adress_name).filter(Boolean)[0] || "", curators: arr(c.teach_main).map(t => ({ name: t.teachMain_name || "", mails: arr(t.href_teach) })), site: arr(c.site_shag)[0] || "" }; } } catch (e) {}
    try { if (R.avg.status === "fulfilled") N.avg = arr(R.avg.value).map(o => ({ date: isoOf(pick(o, ["date", "month", "period"])), v: num(pick(o, ["points", "value", "avg", "average"])), p: num(pick(o, ["previous_points", "prev", "previous"])) })).filter(x => x.date && x.v != null); } catch (e) {}
    try { if (R.attC.status === "fulfilled") N.attChart = arr(R.attC.value).map(o => ({ date: isoOf(pick(o, ["date", "month", "period"])), v: num(pick(o, ["points", "value", "percent", "attendance"])) })).filter(x => x.date && x.v != null && x.v <= 100); } catch (e) {}
    try { const qL = [R.quiz, R.quizD].filter(x => x.status === "fulfilled").map(x => x.value); if (qL.length) { const all = qL.flatMap(v => arr(v).length ? arr(v) : v && typeof v === "object" && (v.id || v.interview_id || v.name || v.title) ? [v] : []);
      N.quiz = all.length ? { n: all.length, title: String(pick(all[0], ["name", "title", "theme", "interview_name"]) || "") } : null; } } catch (e) {}
    try { if (R.libC.status === "fulfilled") N.libCount = arr(R.libC.value).reduce((a, x) => a + (num(pick(x, ["materials_count", "count"])) || 0), 0); } catch (e) {}
    try { if (R.sched.status === "fulfilled") { if (!M.live) N.schedule = {}; N.schedLive = N.schedLive || {}; Object.assign(N.schedule, R.sched.value.days); Object.assign(N.schedLive, R.sched.value.weeks); } } catch (e) {}
    const me = (N.leaders || []).find(x => x.me); if (me) N.groupPlace = me.pos;
    // старые недели расписания не храним (кэш не растёт бесконечно)
    { const lim = iso(dayDate(mondayOf(new Date()), -56)); Object.keys(N.schedule || {}).forEach(d => { if (d < lim) delete N.schedule[d]; }); Object.keys(N.schedLive || {}).forEach(d => { if (d < lim) delete N.schedLive[d]; }); }
    const changed = strip(N) !== strip(M);
    N.updatedAt = Date.now();
    M = N; LS.set("model", M);
    const hadFresh = JSON.stringify(Object.keys(fresh).map(k => fresh[k].size));
    computeFresh();
    setSync("ok");
    if (changed || !wasLive || hadFresh !== JSON.stringify(Object.keys(fresh).map(k => fresh[k].size))) render();   // экран обновляется только если в журнале что-то поменялось
    // новые объявления с прошлой синхронизации - показываем окно (в нашем дизайне)
    if (wasLive) { const nw = (M.news || []).filter(n => !prevNews.has(n.id) && !isRead(n)); if (nw.length) newsNotice(nw); }
    if (wasLive) try { const had = new Set(); (base.visits || []).forEach(v => MK.forEach(k => v[k] != null && had.add(v.date + "|" + v.ln + "|" + v.subj + "|" + k)));
      const add = []; (M.visits || []).forEach(v => MK.forEach(k => { if (v[k] != null && !had.has(v.date + "|" + v.ln + "|" + v.subj + "|" + k)) add.push(`«${v[k]}» ${subjShort(v.subj)}`); }));
      if (add.length && add.length <= 12) toast(add.length === 1 ? "Новая оценка: " + add[0] : `Новые оценки: ${add.slice(0, 3).join(", ")}${add.length > 3 ? ` и ещё ${add.length - 3}` : ""}`); } catch (e) {}
    try {
      const items = await hwP; if (!items || !items.length || gen !== syncGen) return;
      const before = JSON.stringify(M.hw), st = JSON.stringify(M.hwStat), c0 = fresh.homework ? fresh.homework.size : 0, wasDone = new Set((M.hw || []).filter(h => h.status === "done").map(h => h.id)), hadHw = (M.hw || []).length;
      parseHomework(M, items); if (hwCountVal) parseHwCount(M, hwCountVal);
      if (hadHw) { const nd = (M.hw || []).filter(h => h.status === "done" && h.id != null && !wasDone.has(h.id)); if (nd.length === 1) toast(`ДЗ проверено: «${nd[0].mark}» ${subjShort(nd[0].subj)}${nd[0].teacherComment ? " · есть комментарий" : ""}`); else if (nd.length > 1 && nd.length < 10) toast(`Проверено заданий: ${nd.length}`); }
      if (JSON.stringify(M.hw) !== before || JSON.stringify(M.hwStat) !== st) { LS.set("model", M); computeFresh(); if (["home", "homework"].includes(page) || (fresh.homework && fresh.homework.size !== c0)) render(); }
    } catch (e) {}
  }
  async function loadWeeks(mons) {
    const out = {}, weeks = {};
    await Promise.allSettled(mons.map(async m => {
      const a = iso(m), b = iso(dayDate(m, 6));
      const r = await api("schedule " + a, `schedule/operations/get-by-date-range?date_start=${a}&date_end=${b}`);
      for (let i = 0; i < 7; i++) out[iso(dayDate(m, i))] = [];
      arr(r).forEach(o => {
        const d = isoOf(pick(o, ["date", "lesson_date", "day"])); if (!d) return;
        (out[d] = out[d] || []).push({
          start: hm(pick(o, ["started_at", "start", "time_start", "begin"])), end: hm(pick(o, ["finished_at", "end", "time_end", "finish"])),
          subj: String(pick(o, ["subject_name", "spec_name", "subject", "name_spec"]) || "Занятие"),
          teacher: String(pick(o, ["teacher_name", "teacher", "fio_teach"]) || ""), room: String(pick(o, ["room_name", "room", "auditorium", "classroom"]) || ""),
          n: num(pick(o, ["lesson", "lesson_number", "para"]))
        });
      });
      weeks[a] = Date.now();
    }));
    Object.values(out).forEach(l => l.sort((a, b) => a.start.localeCompare(b.start)));
    if (!Object.keys(weeks).length) throw new Error("расписание не загрузилось");
    return { days: out, weeks };
  }
  const weekLoading = {};
  async function ensureWeek(mon) {
    const k = iso(mon), ts = M.schedLive && M.schedLive[k];
    if (!M.live || (weekLoading[k] && Date.now() - weekLoading[k] < 120000) || (ts && Date.now() - ts < 30 * 60 * 1000)) return;   // неделя свежее 30 минут - не перезапрашиваем
    weekLoading[k] = Date.now();
    try {
      const r = await loadWeeks([mon]); const before = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map(d => M.schedule[iso(dayDate(mon, d))]));
      Object.assign(M.schedule, r.days); M.schedLive = Object.assign(M.schedLive || {}, r.weeks); LS.set("model", M);
      if (JSON.stringify([0, 1, 2, 3, 4, 5, 6].map(d => M.schedule[iso(dayDate(mon, d))])) !== before && (page === "schedule" || page === "grades" || page === "home")) { const sc0 = host && host.scrollTop; render(); if (host) host.scrollTop = sc0; }
      weekLoading[k] = 0;
    } catch (e) {}
  }
  // type=0 - домашние, type=1 - лабораторные (журнал отдаёт по 6 на страницу)
  async function loadHomework() {
    const seen = new Map();
    const run = (type, sts) => Promise.all(sts.map(async st => {
      for (let page = 1; page <= 10; page++) {
        let r; try { r = await api(`homework t${type} s${st} p${page}`, `homework/operations/list?page=${page}&status=${st}&type=${type}`); } catch (e) { break; }
        const items = arr(r); if (!items.length) break;
        let fresh = 0;
        items.forEach(o => { const id = type + ":" + (pick(o, ["id", "homework_id"]) ?? JSON.stringify(o).slice(0, 120)); if (!seen.has(id)) { seen.set(id, Object.assign({ __st: st, __lab: type === 1 }, o)); fresh++; } });
        if (!fresh || items.length < 6 || st !== 4) break;
      }
    }));
    await run(0, [4, 0, 3, 2, 5]);
    // лабораторные: сначала общий список; если он пуст - остальные статусы не спрашиваем
    const labs0 = seen.size; await run(1, [4]); if (seen.size > labs0) await run(1, [0, 3, 2, 5]);
    return [...seen.values()];
  }
  const parseEval = r => arr(r).map(o => ({ key: o.key, date: isoOf(o.date_visit), teacher: String(o.fio_teach || ""), subj: String(o.spec_name || ""), photo: safeUrl(o.teach_photo) || null })).filter(o => o.key);
  const userObj = r => Array.isArray(r) ? r[0] : (r && r.data && !Array.isArray(r.data) ? r.data : r);
  function parseUser(N, r) {
    const o = userObj(r);
    const name = pick(o, ["full_name", "fio", "name", "student_name"]); if (name) N.user.name = String(name);
    const g = pick(o, ["group_name", "group", "name_group"]); if (g) N.user.group = String(typeof g === "object" ? (g.name || "") : g).replace(/\.$/, "");
    ["stream_name", "level", "birthday", "age", "registration_date", "achieves_count"].forEach(k => { if (o[k] != null) N.user[k] = o[k]; });
    if (o.visibility) { N.user.emailOk = !!o.visibility.is_email_verified; N.user.phoneOk = !!o.visibility.is_phone_verified; N.user.bday = !!o.visibility.is_birthday; N.user.debtor = !!o.visibility.is_debtor; N.user.quizLate = !!o.visibility.is_quizzes_expired; }
    const ph = pick(o, ["photo", "photo_path", "avatar", "photo_url"]); N.user.photo = ph && /^https?:|^\//.test(ph) && safeUrl(ph) ? String(ph) : null;
    const id = pick(o, ["student_id", "id", "user_id"]); if (id != null) N.user.id = id;
    const gp = arr(pick(o, ["gaming_points", "points", "balance"]) || []);
    if (gp.length) {
      const val = x => num(pick(x, ["points", "point", "amount", "value", "count"]));
      const typ = x => num(pick(x, ["new_gaming_point_types__id", "point_types_id", "type", "type_id", "id"]));
      const s = [...gp].sort((a, b) => (typ(a) || 0) - (typ(b) || 0));
      if (val(s[0]) != null) N.user.coins = val(s[0]);
      if (s[1] && val(s[1]) != null) N.user.gems = val(s[1]);
    }
  }
  function parseVisits(N, r) {
    const list = arr(r).map(o => {
      const d = isoOf(pick(o, ["date_visit", "date", "lesson_date", "visit_date"])); if (!d) return null;
      const st = num(pick(o, ["status_was", "status", "was", "visit_status"]));
      return {
        date: d, ln: num(pick(o, ["lesson_number", "lesson", "para"])) ?? 0,
        miss: st === 0, late: st === 2,
        hw: num(pick(o, ["home_work_mark", "homework_mark", "hw_mark"])), cw: num(pick(o, ["class_work_mark", "classwork_mark", "cw_mark"])),
        lab: num(pick(o, ["lab_work_mark", "lab_mark"])), ctrl: num(pick(o, ["control_work_mark", "control_mark", "exam_mark"])), prac: num(pick(o, ["practical_work_mark", "practical_mark"])), fin: num(pick(o, ["final_work_mark", "final_mark"])),
        subj: String(pick(o, ["spec_name", "subject_name", "name_spec", "subject"]) || "Занятие"),
        teacher: String(pick(o, ["teacher_name", "teacher", "fio_teach"]) || ""), topic: String(pick(o, ["lesson_theme", "theme", "topic"]) || "")
      };
    }).filter(Boolean);
    if (!list.length) { if (Array.isArray(r) && !r.length) N.visits = []; return; }
    list.sort((a, b) => a.date.localeCompare(b.date) || a.ln - b.ln);
    list.forEach((v, i) => v.n = i + 1);
    N.visits = list;
  }
  function parseLeaders(r, N) {
    const me = (N.user.name || "").toLowerCase().split(/\s+/).slice(0, 2).join(" ");
    return arr(r).map((o, i) => {
      const name = String(pick(o, ["full_name", "fio", "name", "student_name"]) || "");
      const id = pick(o, ["id", "student_id"]);
      const ph = pick(o, ["photo_path", "photo", "avatar"]);
      return { name, photo: ph && /^https?:|^\//.test(ph) ? String(ph) : null, pts: num(pick(o, ["amount", "points", "total", "sum"])) ?? 0, pos: num(pick(o, ["position", "place", "rank"])) ?? i + 1,
        me: (N.user.id != null && id === N.user.id) || (me && name.toLowerCase().startsWith(me)) };
    }).filter(x => x.name).sort((a, b) => a.pos - b.pos);
  }
  function parseActivity(o) {
    const d = isoOf(pick(o, ["date", "created_at", "time"])); const amt = num(pick(o, ["current_point", "points", "amount", "point"]));
    if (!d || amt == null) return null;
    const t = num(pick(o, ["point_types_id", "type", "point_type"]));
    const label = String(pick(o, ["achievements_name", "action_name", "name", "action", "point_types_name", "description"]) || "Начисление");
    return { date: d, label: actName(label), code: label, amt, kind: t === 2 ? "gem" : "coin", plus: num(o.action) !== 0 };
  }
  const ACTION_NAMES = { "EVALUATION_LESSON_MARK": "Оценка занятия", "ASSESMENT": "Оценка", "ASSESSMENT": "Оценка", "HOMETASK_INTIME": "Своевременное выполнение домашнего задания", "VISIT": "Посещение пары", "PAIR_VISIT": "Посещение пары" };
  // журнал иногда присылает внутренние коды (20_VISITS_WITHOUT_GAP) - переводим по смыслу
  function actName(c) {
    c = String(c || "").trim(); if (ACTION_NAMES[c]) return ACTION_NAMES[c];
    if (!/^[A-Z0-9_ -]+$/.test(c) || !/[A-Z]/.test(c)) return c || "Начисление";
    const m = c.match(/(\d+)_?VISITS?_WITHOUT_(GAP|DELAY|LATE|MISS)/); if (m) return `${m[1]} посещений подряд без ${/GAP|MISS/.test(m[2]) ? "пропусков" : "опозданий"}`;
    const R = [[/E?_?MAIL/, "Подтверждение электронной почты"], [/PROFILE/, "Заполненный профиль"], [/FRIEND|INVITE|REFERR/, "Привёл друга учиться"], [/SHIRT|LOGO/, "Футболка с логотипом"], [/POLL|SURVEY|QUESTION/, "Участие в опросе"],
      [/CONTEST|COMPET|OLYMP/, "Участие в конкурсе"], [/REVIEW|SOCIAL/, "Отзыв"], [/PORTFOLIO/, "Работа в портфолио"], [/EXAM|COURSE/, "Экзамен или курсовая"], [/LAB/, "Лабораторная работа"], [/HOME|TASK|HW/, "Домашнее задание"],
      [/TEACHER|BONUS|ENCOURAG|PRAISE|REWARD/, "Поощрение преподавателя"], [/EVALUAT/, "Оценка занятия"], [/MARK|ASSES/, "Оценка"], [/VISIT|ATTEND/, "Посещение пары"]];
    const f = R.find(([rx]) => rx.test(c)); return f ? f[1] : "Начисление";
  }
  function parseNews(o) {
    const t = pick(o, ["theme", "title", "name", "subject"]); if (!t) return null;
    return { id: pick(o, ["id", "id_bbs"]) ?? t, title: String(t).replace(/<[^>]+>/g, ""), date: isoOf(pick(o, ["time", "date", "created_at", "publish_date"])), read: !!num(pick(o, ["viewed", "is_read", "read"])) };
  }
  function parseReview(o) {
    const text = pick(o, ["message", "text", "review", "comment"]); if (!text) return null;
    return { text: String(text).replace(/<[^>]+>/g, ""), teacher: String(pick(o, ["teacher", "fio_teach", "teacher_name", "author"]) || ""), subj: String(pick(o, ["spec", "subject", "spec_name", "subject_name"]) || ""), date: isoOf(pick(o, ["date", "created_at", "time"])) };
  }
  function parseExam(o) {
    const s = pick(o, ["spec", "subject", "spec_name", "subject_name", "name"]); if (!s) return null;
    return { subj: String(s), date: isoOf(pick(o, ["date", "date_exam", "exam_date"])), type: String(pick(o, ["type", "exam_type", "form"]) || "") };
  }
  // текст из журнала может прийти с HTML (<p>, <br>, &nbsp;) - оставляем только сам текст
  function plainTx(v) { let t = String(v == null ? "" : v); if (/[<&]/.test(t)) { try { const d = new W.DOMParser().parseFromString(t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "</p>\n"), "text/html"); t = d.body.textContent || ""; } catch (e) {} }
    return t.replace(/\u00a0/g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim(); }
  function parseHomework(N, items) {
    const now = new Date();
    N.hw = items.map(o => {
      const stud = o.homework_stud || o.student_homework || o.homework_student || {};
      const mark = num(pick(stud, ["mark", "grade"])) ?? num(pick(o, ["mark", "grade"]));
      const sub = isoOf(pick(stud, ["creation_time", "date", "send_time", "created_at"]));
      const due = isoOf(pick(o, ["completion_time", "deadline", "date_end", "overdue_time"]));
      // overdue_time - после неё работа считается просроченной (может быть позже срока сдачи)
      const overRaw = o.overdue_time ? String(o.overdue_time) : "", over = isoOf(overRaw), overAt = overRaw ? new Date(overRaw.replace(" ", "T")) : null;
      const hc = o.homework_comment && typeof o.homework_comment === "object" ? o.homework_comment : {};
      const tc = o.homework_comment && typeof o.homework_comment === "object" ? o.homework_comment.text_comment : null;
      const comment = !!tc;
      const extra = { task: plainTx(o.comment), teacherComment: plainTx(tc), answer: plainTx(stud.stud_answer), taskFile: safeUrl(o.file_path) || null, myFile: safeUrl(stud.file_path) || null, cover: safeUrl(o.cover_image) || null,
        tFile: safeUrl(hc.attachment_path) || null, checked: isoOf(hc.date_updated), auto: !!num(stud.auto_mark), lab: !!o.__lab, over: over && over !== due ? over : null };
      const lateNow = due && dayDate(fromIso(due), 1) <= now;
      // статус 5 - «Удалено преподавателем»: показываем в просроченных с пометкой
      const removed = num(o.status) === 5 && mark == null;
      let status = mark != null ? "done" : removed ? "late" : sub ? "wait" : (lateNow ? "late" : "cur");
      extra.removed = removed;
      return { id: pick(o, ["id", "homework_id"]) ?? null, subj: String(pick(o, ["name_spec", "spec_name", "subject_name", "subject"]) || "Задание"), theme: String(pick(o, ["theme", "name", "title"]) || ""), due, sub, mark, status, comment, teacher: String(pick(o, ["fio_teach", "teacher_name", "teacher"]) || ""), ...extra };
    }).sort((a, b) => (b.due || "").localeCompare(a.due || ""));
    const c = { all: N.hw.length, cur: 0, done: 0, wait: 0, late: 0 }; N.hw.forEach(h => c[h.status]++);
    N.hwStat = c;
  }
  function parsePay(N, idx, sch, hist) {
    const p = idx && idx.payment ? idx.payment : null; if (!p) return;
    N.pay = {
      recv: p.organization_name || "", inn: p.okpo || "", bik: p.mfo || "", acc: p.settlement_account || "", bank: p.bank_name || "",
      purpose: [p.purpose_of_payment, p.one_c_code ? "1С код: " + p.one_c_code : ""].filter(Boolean).join(" "), debt: num(p.amount_debt), next: num(p.amount_next), nextDate: isoOf(p.pay_date_start), updated: isoOf(p.updated_at), invoice: !!idx.has_invoice_access,
      plan: arr(sch).map(x => [isoOf(x.payment_date), String(x.description || ""), num(x.price) || 0, num(x.status) || 0]).filter(x => x[0]),
      hist: arr(hist).map(x => [isoOf(x.date), String(x.description || "").replace(/;.*$/, ""), num(x.amount) || 0]).filter(x => x[0])
    };
  }
  function parseProfile(o) {
    if (!o || typeof o !== "object") return null;
    const ph = arr(o.phones).map(x => String(x.phone_number || "")).filter(Boolean);
    return { name: o.ful_name || o.full_name || "", address: o.address || "", study: o.study || "", email: o.email || "", phones: ph, birth: isoOf(o.date_birth),
      links: arr(o.links).filter(l => l.value).map(l => ({ name: l.name === "LINK_TO_SOCIAL" ? "Соцсеть" : l.name, value: String(l.value) })),
      fill: num(o.fill_percentage), pending: !!(o.has_not_approved_data || o.has_not_approved_photo), decline: o.decline_comment || "", photo: o.photo_path || null };
  }
  // counter_type журнала: 3 текущие (новые), 0 просроченные, 2 на проверке, 4 всего (проверено считаем сами)
  function parseHwCount(N, r) {
    const a = arr(r); if (!a.length) return;
    const c = {}; a.forEach(x => { const t = num(pick(x, ["counter_type", "type"])); if (t != null) c[t] = num(pick(x, ["counter", "count", "value"])) || 0; });
    if (c[4] == null) return;
    const loc = { done: 0 }; (N.hw || []).forEach(h => { if (h.status === "done") loc.done++; });
    N.hwStat = { all: c[4], total: c[4], cur: c[3] || 0, done: loc.done || Math.max(0, (c[4] || 0) - (c[3] || 0) - (c[0] || 0) - (c[2] || 0)), wait: c[2] || 0, late: c[0] || 0 };
  }

  /* ======================= утилиты дат и текста ======================= */
  function mondayOf(d) { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; }
  function dayDate(mon, d) { const x = new Date(mon); x.setDate(x.getDate() + d); return x; }
  function iso(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function fromIso(s) { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); }
  function atTime(isoDay, t) { const d = fromIso(isoDay); const [h, m] = t.split(":").map(Number); d.setHours(h || 0, m || 0, 0, 0); return d; }
  const sameDay = (a, b) => a.getFullYear() == b.getFullYear() && a.getMonth() == b.getMonth() && a.getDate() == b.getDate();
  const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"], DSH = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const MON = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
  const MONN = ["Январь", "Февраль", "Март", "Апрель", "Май", "Июнь", "Июль", "Август", "Сентябрь", "Октябрь", "Ноябрь", "Декабрь"];
  const dm = d => String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0");
  const longDate = d => `${d.getDate()} ${MON[d.getMonth()]}`;
  const dayDiff = (a, b) => Math.round((new Date(b.getFullYear(), b.getMonth(), b.getDate()) - new Date(a.getFullYear(), a.getMonth(), a.getDate())) / 864e5);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  // только http(s): javascript:, data: и прочее отбрасываем
  const safeUrl = u => { if (!u) return ""; try { const x = new URL(String(u).trim(), location.href); return /^https?:$/.test(x.protocol) ? x.href : ""; } catch (e) { return ""; } };
  const plural = (n, a, b, c) => { const m10 = n % 10, m100 = n % 100; return m10 == 1 && m100 != 11 ? a : (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c); };
  const pairsW = n => n + " " + plural(n, "пара", "пары", "пар");
  // этажи филиала: 4 этаж - кабинеты 1-3 (3 - конференц-зал), 5 этаж - кабинеты 5-11
  // всё, что не просто номер (спортзал, другой адрес, «онлайн»), показываем ровно как в журнале
  const roomTxt = r => { const s = String(r || "").trim(); if (!/^\d{1,3}$/.test(s)) return s;
    const n = +s, fl = n >= 1 && n <= 3 ? 4 : n >= 5 && n <= 11 ? 5 : null; return "каб. " + s + (fl ? " · " + fl + " этаж" : ""); };
  // короткие названия длинных предметов (полное - в подсказке)
  const SUBJ_SHORT = { "элективные курсы по физической культуре и спорту": "Элективы по физкультуре", "физическая культура и спорт": "Физкультура", "технологии эффективной коммуникации": "Эфф. коммуникации",
    "введение в специальность": "Введ. в специальность", "современные методы и средства разработки программного обеспечения": "Методы разработки ПО", "программирование на языке с++ и ооп": "C++ и ООП",
    "платформа microsoft .net и программирование c#": "C# и .NET", "теория вероятностей и математическая статистика": "Теорвер и статистика", "защита интеллектуальной собственности": "Защита ИС", "иностранный язык": "Ин. язык",
    "теория информации и кодирования": "Теория информации", "алгоритмы и структуры данных": "Алгоритмы и СД", "компьютерные системы и сети": "Компьютерные сети", "информационные технологии": "Инф. технологии",
    "нейронные сети в машинном обучении": "Нейросети", "информационная безопасность": "Инфобез", "проектирование информационных систем": "Проект. ИС", "разработка мобильных приложений": "Мобильная разработка",
    // факультет дизайна
    "история культуры и искусства": "История искусств", "история и теория дизайна": "История дизайна", "типографика и печатная продукция": "Типографика",
    "визуальный анализ данных": "Виз. анализ данных", "рисунок и проектная графика": "Рисунок и графика", "проектирование в растровой графике": "Растровая графика",
    "пропедевтика и основы композиции": "Пропедевтика", "проектирование в графическом дизайне": "Графический дизайн", "проектирование в векторной графике": "Векторная графика",
    "создание интерьеров планов и чертежей autocad 3ds max": "AutoCAD и 3ds Max", "проектирование объектов анимации и визуализации maya": "Анимация в Maya",
    "концептуальное проектирование сайтов web дизайн": "Web-дизайн", "звуковые спецэффекты и дизайн звука": "Дизайн звука", "визуальные коммуникации в рекламе": "Виз. коммуникации",
    "основы промышленного дизайна": "Осн. пром. дизайна", "cgi и визуальные эффекты": "CGI и VFX", "проектирование объектов промышленного дизайна": "Пром. дизайн",
    "проектирование цифровых объектов и систем": "Цифровые объекты", "информационные технологии в дизайне": "ИТ в дизайне", "системы искусственного интеллекта": "Системы ИИ",
    "современные технологии в дизайне": "Технологии в дизайне", "управление цифровым продуктом": "Цифровой продукт", "продюсирование и маркетинг проектов": "Продюсирование",
    "управление человеческими ресурсами": "Управление персоналом",
    // обязательные для бакалавриата
    "безопасность жизнедеятельности": "БЖД", "основы российской государственности": "ОРГ", "выпускная квалификационная работа": "ВКР" };
  // ключ без регистра, «ё», знаков и скобок - «Web-дизайн» и «Web дизайн» совпадут
  const attCls = v => v == null ? "" : v < 70 ? "stat-bad" : v < 90 ? "stat-warn" : "stat-good";
  const subjKeyN = t => String(t || "").toLowerCase().replace(/ё/g, "е").replace(/[^a-zа-я0-9]+/g, " ").trim();
  const SUBJ_SHORT_N = Object.fromEntries(Object.entries(SUBJ_SHORT).map(([k, v]) => [subjKeyN(k), v]));
  // сокращаем только на главной; остальное длиннее лимита - по целым словам
  const subjShort = t => { const k = String(t || "").trim(); const v = SUBJ_SHORT_N[subjKeyN(k)] || (/практик/i.test(k) && k.length > 24 ? "Практика" : ""); return v || (k.length > 24 ? k.slice(0, 22).replace(/\s+\S*$/, "") + "…" : k); };
  const shortT = t => { const p = String(t || "").split(" ").filter(Boolean); return p.length ? p[0] + " " + p.slice(1).map(x => x[0] + ".").join(" ") : ""; };
  const f1 = x => x.toFixed(1).replace(".", ","), f2 = x => x.toFixed(2).replace(".", ",");
  function subjKey(name) {
    const s = String(name || "").toLowerCase();
    if (/математ|алгебр|геометр/.test(s)) return "math";
    if (/электив/.test(s)) return "pe";
    if (/физическ|спорт/.test(s)) return "pe";
    if (/физик/.test(s)) return "phys";
    if (/информат|программ|алгоритм/.test(s)) return "inf";
    if (/введени|специальн/.test(s)) return "intro";
    if (/делов/.test(s)) return "biz";
    if (/коммуникац|технолог/.test(s)) return "tec";
    if (/иностран|англ|язык/.test(s)) return "lang";
    const k = ["math", "phys", "inf", "pe", "intro", "tec", "lang", "biz"]; let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0; return k[h % k.length];
  }

  /* ======================= расчёты ======================= */
  function stats() {
    const V = M.visits || [], total = V.length, miss = V.filter(v => v.miss).length, late = V.filter(v => v.late).length;
    const marks = []; let hwN = 0, cwN = 0, otherN = 0;
    V.forEach(v => { if (v.hw != null) { marks.push(v.hw); hwN++; } if (v.cw != null) { marks.push(v.cw); cwN++; } ["lab", "ctrl", "prac"].forEach(k => { if (v[k] != null) { marks.push(v[k]); otherN++; } }); });
    const avg = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : 0;
    const maxMark = marks.length ? Math.max(...marks) : 5; const scale = maxMark > 5 || (M.avg || []).some(x => x.v > 5) ? 12 : 5;
    // Журнал считает «посещения подряд» по учебным дням: день с пропуском обнуляет серию без пропусков,
    // день с опозданием обнуляет серию без опозданий, а полностью пропущенный день её не прерывает.
    const D = []; V.forEach(v => { const d = D[D.length - 1]; if (d && d.date === v.date) { d.n++; if (v.miss) d.x++; if (v.late) d.l++; } else D.push({ date: v.date, n: 1, x: v.miss ? 1 : 0, l: v.late ? 1 : 0 }); });
    let streak = 0, best = 0, run = 0, lateCur = 0, bestNoLate = 0, run2 = 0;
    D.forEach(d => { run = d.x ? 0 : run + 1; best = Math.max(best, run); if (d.x < d.n) { run2 = d.l ? 0 : run2 + 1; bestNoLate = Math.max(bestNoLate, run2); } });
    streak = run; lateCur = run2;
    // журнал считает «посещения подряд» по парам: пропуск обнуляет серию без пропусков, опоздание - серию без опозданий (пропущенная пара её не прерывает)
    let pRun = 0, pBest = 0, lRun = 0, lBest = 0; V.forEach(v => { pRun = v.miss ? 0 : pRun + 1; pBest = Math.max(pBest, pRun); if (!v.miss) { lRun = v.late ? 0 : lRun + 1; lBest = Math.max(lBest, lRun); } });
    const hwAll = (M.hw || []).filter(h => h.sub && h.due);
    const early = hwAll.map(h => dayDiff(fromIso(h.sub), fromIso(h.due)));
    return { total, miss, late, present: total - miss, att: total ? Math.round((total - miss) / total * 100) : 0, hwN, cwN, otherN, marks: marks.length, avg, scale, allTop: marks.length && marks.every(m => m === maxMark), maxMark, streak, best, bestNoLate, lateCur, days: D.length, pStreak: pRun, pBest, pLate: lRun, pLateBest: lBest,
      earlyAvg: early.length ? early.reduce((a, b) => a + b, 0) / early.length : 0, onTime: early.filter(x => x >= 0).length, hwCount: early.length };
  }
  const lessonsOn = d => (M.schedule[iso(d)] || []);
  function pairIndex() {
    const starts = new Set(); Object.values(M.schedule).forEach(l => l.forEach(x => x.start && starts.add(x.start)));
    const s = [...starts].sort(); return t => s.indexOf(t);
  }
  function occurrences(now) {
    const out = []; const m0 = mondayOf(now);
    for (let i = 0; i < 14; i++) { const d = dayDate(m0, i); lessonsOn(d).forEach(l => l.start && l.end && out.push({ l, day: iso(d), s: atTime(iso(d), l.start), e: atTime(iso(d), l.end) })); }
    return out.sort((a, b) => a.s - b.s);
  }
  let occC = null, occAt = 0, occM = null;
  const focus = now => { if (!occC || occM !== M || Math.abs(now - occAt) > 20000) { occC = occurrences(now); occAt = +now; occM = M; } const o = occC; return { cur: o.find(x => x.s <= now && now < x.e), next: o.find(x => x.s > now) }; };

  /* ======================= интерфейс ======================= */
  const DN_CSS = `/*CSS*/`;
  const IC = /*ICONS*/;
  const ic = (k, cls = "i") => `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || ""}</svg>`;
  const ACH = [
    { t: "5 посещений подряд без пропусков", r: 1, goal: 5, kind: "streak", ic: "check" }, { t: "10 посещений подряд без пропусков", r: 2, goal: 10, kind: "streak", ic: "check" }, { t: "20 посещений подряд без пропусков", r: 5, goal: 20, kind: "streak", ic: "check" },
    { t: "5 посещений подряд без опозданий", r: 1, goal: 5, kind: "late", ic: "timer" }, { t: "10 посещений подряд без опозданий", r: 2, goal: 10, kind: "late", ic: "timer" }, { t: "20 посещений подряд без опозданий", r: 5, goal: 20, kind: "late", ic: "timer" },
    { t: "Полностью заполненный профиль", r: 5, kind: "profile", ic: "profile" }, { t: "Привёл друга учиться", r: 10, rx: /друг/i, ic: "users" }, { t: "Посещение академии в футболке с логотипом", r: 1, rx: /футболк/i, ic: "shirt" },
    { t: "Участие в опросе", r: 20, rx: /опрос/i, ic: "poll" }, { t: "Участие в конкурсе", r: "1 - 100", rx: /конкурс/i, ic: "medal" }, { t: "Подтверждение электронной почты", r: 3, kind: "mail", ic: "mail" }, { t: "Отзыв", r: 20, rx: /отзыв/i, ic: "star" }
  ];
  let host, R, page = sessionStorage.getItem("dn2.page") || "home";
  if (page === "requests" || page === "complaints") page = "home";
  let sc = { view: LS.get("view", "week"), mon: null, day: 0 };
  let gf = { mode: "all", subj: "" }, nf = "all", hwq = "", faqq = "";
  let readSet = new Set(LS.get("read", []));
  let syncState = SEEDED ? "seed" : "cache";

  const unread = () => (M.news || []).filter(n => !n.read && !readSet.has(n.id)).length;
  const PAGES = [
    { id: "home", n: "Главная", ic: "home", g: "Учёба" }, { id: "schedule", n: "Расписание", ic: "cal", g: "Учёба" }, { id: "grades", n: "Оценки", ic: "grade", g: "Учёба" },
    { id: "homework", n: "Домашние задания", ic: "hw", g: "Учёба" }, { id: "materials", n: "Учебные материалы", ic: "book", g: "Учёба", classic: "Учебные материалы", d: "Уроки, библиотека, видео, статьи и тесты от преподавателей" },
    { id: "awards", n: "Награды", ic: "trophy", g: "Активность" }, { id: "news", n: "Объявления", ic: "bell", g: "Активность" }, { id: "reviews", n: "Отзывы", ic: "quote", g: "Активность" },
    { id: "market", n: "Маркет", ic: "bag", g: "Активность", classic: "Маркет", d: "Товары за монеты и гемы" },
    { id: "payment", n: "Оплата", ic: "card", g: "Сервис", classic: "Оплата", d: "Реквизиты, график и история платежей" },
    { id: "profile", n: "Личный кабинет", ic: "profile", g: "Сервис", classic: "Личный кабинет", d: "Фото, контакты и смена пароля" },
    { id: "requests", n: "Обращения", ic: "chat", g: "Сервис", classic: "Обращения", d: "Вопросы в учебную часть и их статус" },
    { id: "complaints", n: "Жалобы", ic: "alert", g: "Сервис", classic: "Жалобы", d: "Жалоба генеральному директору" },
    { id: "faq", n: "Вопросы и ответы", ic: "help", g: "Сервис", classic: "F.A.Q.", d: "Частые вопросы о журнале, оплате и наградах" },
    { id: "contacts", n: "Контакты", ic: "pin", g: "Сервис", classic: "Контакты", d: "Адрес, приёмная комиссия и учебная часть" },
    { id: "settings", n: "Настройки", ic: "gear", g: "" }
  ];
  const visiblePages = () => PAGES.filter(p => p.id === "home" || p.id === "settings" || !cfg.hidden.includes(p.id));
  const photoUrl = u => safeUrl(u).replace(/['"()\\\s]/g, c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  const initials = n => String(n || "").split(/\s+/).filter(Boolean).slice(0, 2).map(x => x[0]).join("").toUpperCase();
  // фото из журнала поверх инициалов: если картинка не загрузится, останутся инициалы
  // своё фото храним уменьшенной копией: после перезагрузки оно видно сразу, без инициалов. Копия привязана к id и адресу фото
  let avaMem = LS.get("ava", null), avaBusy = false; const avaFail = {}, imgPre = {};
  // картинку держим в памяти: после первой загрузки фото рисуется сразу, инициалы не мелькают
  function avaSrc(url) {
    if (!url || url !== M.user.photo || M.user.id == null) return null;
    if (avaMem && avaMem.id === String(M.user.id) && avaMem.url === url && avaMem.data) return avaMem.data;
    if (!avaBusy && !avaFail[url]) { avaBusy = true; cacheAva(url, String(M.user.id)).then(() => { if (!avaMem || avaMem.url !== url) avaFail[url] = 1; }, () => { avaFail[url] = 1; }).finally(() => { avaBusy = false; }); }
    return null;
  }
  async function cacheAva(url, id) {
    const full = safeUrl(url.startsWith("/") ? location.origin + url : url); if (!/^https:/.test(full)) return;
    const draw = src => new Promise((res, rej) => { const im = new Image(); if (!/^data:|^blob:/.test(src)) im.crossOrigin = "anonymous";
      im.onload = () => { try { const k = 160, c = document.createElement("canvas"), sc = Math.min(1, k / Math.min(im.naturalWidth, im.naturalHeight)); c.width = Math.round(im.naturalWidth * sc); c.height = Math.round(im.naturalHeight * sc); c.getContext("2d").drawImage(im, 0, 0, c.width, c.height); res(c.toDataURL("image/jpeg", 0.85)); } catch (e) { rej(e); } };
      im.onerror = rej; im.src = src; });
    let data = null;
    try { data = await draw(full); } catch (e) {}
    if (!data) { const gm = typeof GM_xmlhttpRequest === "function" ? GM_xmlhttpRequest : (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) || null;
      if (gm) try { const buf = await new Promise((res, rej) => gm({ method: "GET", url: full, responseType: "arraybuffer", timeout: 15000, onload: r => r.status === 200 && r.response ? res(r.response) : rej(), onerror: rej, ontimeout: rej }));
        const u8 = new Uint8Array(buf); let b = ""; for (let i = 0; i < u8.length; i += 8192) b += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
        data = await draw("data:image/jpeg;base64," + btoa(b)); } catch (e) {} }
    if (!data || data.length > 120000 || String(M.user.id) !== id || M.user.photo !== url) return;
    avaMem = { id, url, data }; LS.set("ava", avaMem);
  }
  const imgBad = {};
  const photo = (cls = "", url = M.user.photo, name = M.user.name) => { const c = avaSrc(url), src = c || photoUrl(url), ok = !!src && (!!c || imgPre[url] === 2), bad = imgBad[url] && Date.now() - imgBad[url] < 60000;
    return `<div class="photo ${cls}${ok ? " cached" : ""}" role="img" aria-label="Фото"><span class="ini">${esc(initials(name))}</span>${src && !bad ? `<img class="pimg${ok ? " ok" : ""}" src="${esc(src)}" alt="" decoding="async" draggable="false" data-pu="${esc(url)}">` : ""}</div>`; };
  // ближайшая ещё не полученная награда за серию без пропусков
  const nextGoal = s => [5, 10, 20].find(g => !(s.pBest >= g || achFeed(g, "streak"))) || null;
  const isRead = n => n.read || readSet.has(n.id);
  const unreadList = () => (M.news || []).filter(n => !isRead(n));
  const dayPart = (h = new Date().getHours()) => h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "day" : h >= 17 && h < 22 ? "evening" : "night";
  /* ---------- новый стиль (тест): шрифты и сцена приветствия ---------- */
  const NEO_FONTS = /*NEOFONTS*/;
  let neoFontsState = 0;
  function loadNeoFonts() {
    if (neoFontsState || typeof FontFace !== "function" || !document.fonts) return; neoFontsState = 1;
    const LAT = "U+0020-007E,U+00A0,U+00AB,U+00B0,U+00B7,U+00BB,U+00D7,U+2010-2014,U+2019,U+201C,U+201D,U+2022,U+2026,U+20BD,U+2212", CYR = "U+0401,U+0410-044F,U+0451,U+2116";
    const buf = b => { const s = atob(b), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return u.buffer; };
    Object.entries(NEO_FONTS).forEach(([k, b]) => { try { const [fam, sub] = k.split("-"); const f = new FontFace(fam === "u" ? "DnHead" : "DnBody", buf(b), { weight: fam === "u" ? "300 700" : "400 700", unicodeRange: sub === "lat" ? LAT : CYR, display: "swap" }); f.load().then(x => document.fonts.add(x)).catch(() => {}); } catch (e) {} });
  }
  const neoOn = () => true;
  // сцена за приветствием: картина справа (светило, облака, сияние) + пейзаж по низу во всю ширину.
  // Картина вписывается по высоте и прижата вправо, поэтому на любой ширине луна и солнце видны целиком
  function heroScene(dp) {
    const rnd = (i => () => (i = (i * 16807) % 2147483647) / 2147483647)(11);
    const f = n => n.toFixed(1);
    const L = {
      morning: ["#c86c9a", "#7e3c86", "#3d1d5c", "#1c0f30"],
      day: ["#6f9fe0", "#3b6cc4", "#22449a", "#0f2358"],
      evening: ["#8a2f86", "#561d6e", "#2c1044", "#12071f"],
      night: ["#2c2c6e", "#1b1b4a", "#0f0f2c", "#05050f"]
    }[dp];
    // пейзаж: дальние горы, холмы, ближний холм с ёлками
    let land = "";
    { let d = "M0 110"; for (let x = 0; x < 2400; x += 170) { const up = 26 + rnd() * 46, w = 60 + rnd() * 50; d += ` L${f(x + w)} ${f(up)} L${f(x + w + 30)} ${f(up + 12 + rnd() * 10)} L${x + 170} ${f(84 + rnd() * 20)}`; } land += `<path d="${d} L2400 160 L0 160Z" fill="${L[0]}"/>`; }
    [[1, 96, 16, 210], [2, 118, 12, 140]].forEach(([k, y0, a, p]) => { let d = `M0 ${y0}`; for (let x = 0; x <= 2400; x += 40) d += ` L${x} ${f(y0 + a * Math.sin(x / p + k * 2.1) + a * .45 * Math.sin(x / (p * .37) + k))}`; land += `<path d="${d} L2400 160 L0 160Z" fill="${L[k]}"/>`; });
    { let d = "M0 142", tr = ""; for (let x = 0; x <= 2400; x += 40) { const y = 142 + 6 * Math.sin(x / 120) ; d += ` L${x} ${f(y)}`; if (x > 1100 && rnd() < .42) { const h = 16 + rnd() * 20, w = h * .42; tr += `<path d="M${f(x)} ${f(y - h)} L${f(x + w)} ${f(y + 2)} L${f(x - w)} ${f(y + 2)}Z"/>`; } } land += `<path d="${d} L2400 160 L0 160Z" fill="${L[3]}"/><g fill="${L[3]}">${tr}</g>`; }
    const cloud = (x, y, s, c1, c2, cls = "") => `<g class="nh-cl ${cls}" transform="translate(${x} ${y}) scale(${s})"><g fill="${c1}"><ellipse cx="0" cy="8" rx="70" ry="22"/><circle cx="-26" cy="-6" r="26"/><circle cx="12" cy="-18" r="34"/><circle cx="46" cy="-2" r="22"/></g><ellipse cx="4" cy="16" rx="62" ry="10" fill="${c2}"/></g>`;
    const birds = (x, y, c) => `<g class="nh-birds" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M${x} ${y}q8-8 16 0q8-8 16 0"/><path d="M${x + 44} ${y + 20}q6-6 12 0q6-6 12 0"/><path d="M${x - 30} ${y + 30}q5-5 10 0q5-5 10 0"/></g>`;
    let defs = `<filter id="nhb" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="10"/></filter><filter id="nhs" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="3"/></filter>`, art = "";
    if (dp === "night") {
      defs += `<radialGradient id="nhmg"><stop offset="0" stop-color="#fff6d6" stop-opacity=".55"/><stop offset=".45" stop-color="#b9a8ff" stop-opacity=".16"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
        <radialGradient id="nhm" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#fffdf1"/><stop offset=".6" stop-color="#f1e7c8"/><stop offset="1" stop-color="#c9b98f"/></radialGradient>
        <linearGradient id="nhau1" x1="0" x2="1"><stop offset="0" stop-color="#4be35a" stop-opacity="0"/><stop offset=".35" stop-color="#4be35a" stop-opacity=".7"/><stop offset=".65" stop-color="#2cc6f7" stop-opacity=".55"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></linearGradient>
        <linearGradient id="nhau2" x1="0" x2="1"><stop offset="0" stop-color="#7c5cff" stop-opacity="0"/><stop offset=".5" stop-color="#b06bff" stop-opacity=".6"/><stop offset="1" stop-color="#ff5c8a" stop-opacity="0"/></linearGradient>
        <linearGradient id="nhsh" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
      const st = Array.from({ length: 34 }, (_, i) => `<circle ${i % 3 ? "" : `class="nh-tw" style="animation-delay:${f(rnd() * 3)}s"`} cx="${f(40 + rnd() * 600)}" cy="${f(8 + rnd() * 200)}" r="${f(.7 + rnd() * 1.5)}" fill="#fff" opacity="${f(.5 + rnd() * .5)}"/>`).join("");
      art = `<path class="nh-au" d="M-20 150 C120 60 230 170 360 96 S560 40 680 110" stroke="url(#nhau1)" stroke-width="54" fill="none" filter="url(#nhb)"/>
        <path class="nh-au" style="animation-delay:-5s" d="M40 190 C170 120 300 200 420 140 S600 110 680 150" stroke="url(#nhau2)" stroke-width="30" fill="none" filter="url(#nhb)"/>${st}
        <path class="nh-shoot" d="M560 34 L640 -4" stroke="url(#nhsh)" stroke-width="2.4" stroke-linecap="round"/>
        <circle class="nh-glow" cx="470" cy="118" r="170" fill="url(#nhmg)"/>
        <circle cx="470" cy="118" r="60" fill="url(#nhm)"/>
        <g fill="#b8a77e" opacity=".42"><circle cx="452" cy="100" r="11"/><circle cx="492" cy="132" r="15"/><circle cx="480" cy="92" r="6"/><circle cx="446" cy="140" r="7"/><circle cx="505" cy="104" r="5"/><circle cx="462" cy="160" r="5"/></g>
        <circle cx="470" cy="118" r="60" fill="none" stroke="#fff" stroke-opacity=".35" stroke-width="1.5"/>
        <g class="nh-cl" fill="#3a2f7a" opacity=".5" filter="url(#nhs)"><ellipse cx="440" cy="168" rx="90" ry="7"/><ellipse cx="530" cy="182" rx="70" ry="5"/></g>`;
    } else if (dp === "evening") {
      defs += `<radialGradient id="nhg"><stop offset="0" stop-color="#ffd48a" stop-opacity=".85"/><stop offset=".4" stop-color="#ff5c8a" stop-opacity=".35"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
        <linearGradient id="nhsun" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffe14a"/><stop offset=".55" stop-color="#ff9d3c"/><stop offset="1" stop-color="#ff3d7f"/></linearGradient>
        <mask id="nhcut"><rect x="300" y="100" width="320" height="220" fill="#fff"/>${[0, 1, 2, 3, 4, 5].map(i => `<rect x="300" y="${216 + i * 13}" width="320" height="${2.5 + i * 1.6}" fill="#000"/>`).join("")}</mask>`;
      art = `<circle class="nh-glow" cx="450" cy="250" r="260" fill="url(#nhg)"/><circle cx="450" cy="250" r="96" fill="url(#nhsun)" mask="url(#nhcut)"/>
        <g fill="#ff8fb0" opacity=".55" filter="url(#nhs)"><rect class="nh-cl" x="210" y="150" width="190" height="10" rx="5"/><rect class="nh-cl b" x="470" y="176" width="170" height="8" rx="4"/><rect class="nh-cl" x="300" y="200" width="120" height="6" rx="3"/></g>
        <g fill="#5a1c6a" opacity=".45" filter="url(#nhs)"><ellipse class="nh-cl b" cx="470" cy="232" rx="110" ry="5"/></g>${birds(240, 90, "#2a0f3e")}`;
    } else if (dp === "morning") {
      defs += `<radialGradient id="nhg"><stop offset="0" stop-color="#fff4cf" stop-opacity=".95"/><stop offset=".35" stop-color="#ffc58a" stop-opacity=".45"/><stop offset="1" stop-color="#ff7a8f" stop-opacity="0"/></radialGradient>
        <linearGradient id="nhc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1f4"/><stop offset="1" stop-color="#ffb3c6"/></linearGradient>`;
      art = `<circle class="nh-glow" cx="440" cy="236" r="200" fill="url(#nhg)"/><circle cx="440" cy="236" r="54" fill="#fff3cf"/>
        ${cloud(250, 120, .8, "url(#nhc)", "#f28cab")}${cloud(560, 90, .6, "url(#nhc)", "#f28cab", "b")}${cloud(430, 170, .55, "url(#nhc)", "#f28cab")}${birds(300, 60, "#3b1d5c")}`;
    } else {
      // день: высокое солнце с мягкими лучами, объёмные облака, птицы - в той же манере, что утро
      defs += `<radialGradient id="nhg"><stop offset="0" stop-color="#fffdf0" stop-opacity=".95"/><stop offset=".3" stop-color="#fff4c4" stop-opacity=".45"/><stop offset="1" stop-color="#bfe0ff" stop-opacity="0"/></radialGradient>
        <linearGradient id="nhc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e7ff"/></linearGradient>`;
      art = `<circle class="nh-glow" cx="500" cy="84" r="190" fill="url(#nhg)"/><circle cx="500" cy="84" r="46" fill="#fffcee"/><circle cx="500" cy="84" r="58" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
        <g opacity=".35" filter="url(#nhs)" fill="#fff"><ellipse class="nh-cl b" cx="330" cy="206" rx="170" ry="7"/><ellipse class="nh-cl" cx="560" cy="226" rx="120" ry="5"/></g>
        ${cloud(270, 130, .9, "url(#nhc)", "#a9c6ee")}${cloud(600, 168, .62, "url(#nhc)", "#a9c6ee", "b")}${cloud(400, 196, .5, "url(#nhc)", "#a9c6ee")}${birds(190, 70, "#1b2f6e")}`;
    }
    return `${dp === "night" ? `<div class="nh-stars"></div>` : ""}<svg class="nh-art" viewBox="0 0 640 320" preserveAspectRatio="xMaxYMin meet" aria-hidden="true"><defs>${defs}</defs>${art}</svg>
      <svg class="nh-land" viewBox="0 0 2400 160" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">${land}</svg><div class="nh-scrim"></div>`;
  }
  const HELLO = { morning: "Доброе утро", day: "Добрый день", evening: "Добрый вечер", night: "Доброй ночи" };
  // оценка ниже максимальной - свой цвет (5-балльная и 12-балльная шкала)
  let SCALE = 5;
  const vClass = m => { if (m == null) return ""; const x = SCALE > 5 ? (m >= 10 ? 5 : m >= 7 ? 4 : m >= 4 ? 3 : 2) : m; return x >= 5 ? "" : x === 4 ? "v4" : x === 3 ? "v3" : "v2"; };

  /* ---- «новое»: что появилось с прошлого просмотра раздела ---- */
  const MK = ["hw", "cw", "lab", "ctrl", "prac", "fin"];
  const MK_N = { hw: "Домашнее задание", cw: "Классная работа", lab: "Лабораторная", ctrl: "Контрольная", prac: "Практическая", fin: "Итоговая" };
  const vKey = v => v.date + "|" + v.ln + "|" + MK.map(k => v[k] ?? "").join(",");
  const hKey = h => [h.subj, h.theme, h.due, h.status, h.mark ?? ""].join("|");
  const rKey = r => (r.date || "") + "|" + r.teacher + "|" + r.text.slice(0, 40);
  function feedKeys() { const c = {}; return (M.feed || []).map(f => { const b = f.date + "|" + f.label + "|" + f.amt; c[b] = (c[b] || 0) + 1; return b + "|" + c[b]; }); }
  const dupKeys = ks => { const c = {}; return ks.map(k => { c[k] = (c[k] || 0) + 1; return c[k] > 1 ? k + "#" + c[k] : k; }); };
  // «на проверке» - это то, что сдал сам, не уведомляем
  const hwKeyed = () => { const L = (M.hw || []).filter(h => h.status !== "wait"), K = dupKeys(L.map(hKey)); return new Map(L.map((h, i) => [h, K[i]])); };
  const revKeys = () => dupKeys((M.reviews || []).map(rKey));
  const KEYS = { grades: () => (M.visits || []).filter(v => MK.some(k => v[k] != null)).map(vKey), homework: () => [...hwKeyed().values()], reviews: revKeys, awards: feedKeys };
  let seen = LS.get("seen", null), fresh = {};
  function computeFresh() {
    if (!M.live) { fresh = {}; return; }
    // первый раз, когда данные раздела появились, считаем их просмотренными - «новым» будет только то, что придёт потом
    seen = seen || {}; let ch = false;
    Object.keys(KEYS).forEach(k => { if (!Array.isArray(seen[k])) { const cur = KEYS[k](); if (cur.length) { seen[k] = cur; ch = true; } } });
    if (ch) LS.set("seen", seen);
    fresh = {}; Object.keys(KEYS).forEach(k => { const o = new Set(seen[k] || []); fresh[k] = new Set(Array.isArray(seen[k]) ? KEYS[k]().filter(x => !o.has(x)) : []); });
  }
  function commitSeen(pg) { if (!seen || !KEYS[pg] || !fresh[pg] || !fresh[pg].size) return; seen[pg] = KEYS[pg](); LS.set("seen", seen); fresh[pg] = new Set(); }
  const isNew = (pg, key) => !!(fresh[pg] && fresh[pg].has(key));

  function dropVeil() { const v = document.getElementById("dn-veil"); if (v) { v.style.opacity = "0"; setTimeout(() => v.remove(), 260); } }
  // графика: «полная» - стекло и анимации, «лёгкая» - без размытия и фоновых анимаций; «авто» включает лёгкую, если при прокрутке кадры заметно проседают
  const gfxLite = () => cfg.gfx === "lite" || (cfg.gfx !== "full" && LS.get("gfxauto", 0) === 1);
  function applyGfx() { if (host) { if (gfxLite()) host.setAttribute("data-lite", ""); else host.removeAttribute("data-lite"); } }
  let fpsBad = 0, fpsRun = false, fpsN = 0;
  function fpsProbe() {
    if (fpsRun || cfg.gfx !== "auto" || LS.get("gfxauto", 0) === 1 || fpsN >= 6 || document.hidden) return; fpsRun = true; fpsN++;
    const T = []; let last = 0, k = 0; const tick = t => { if (last) T.push(t - last); last = t; if (++k < 45) requestAnimationFrame(tick); else done(); };
    const done = () => { fpsRun = false; T.sort((a, b) => a - b); const med = T[T.length >> 1] || 16; if (med > 30) fpsBad++; else fpsBad = Math.max(0, fpsBad - 1);
      if (fpsBad >= 2) { LS.set("gfxauto", 1); applyGfx(); } };
    requestAnimationFrame(tick);
  }
  // идёт набор текста (открыта клавиатура): поле в Дневнике или в окне журнала
  const typing = () => { const isEd = a => a && (/^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && !/^(checkbox|radio|button|submit|file|range)$/i.test(a.type || "") || a.isContentEditable);
    return isEd(R && R.activeElement) || isEd(document.activeElement); };
  // высота клавиатуры: окно Дневника поднимается над ней (iPad, iPhone)
  function kbFit() { if (!host || !W.visualViewport) return; const vv = W.visualViewport, kb = Math.max(0, Math.round(W.innerHeight - vv.height - vv.offsetTop));
    if (kb > 80 && typing()) { host.setAttribute("data-kb", ""); host.style.setProperty("--kb", kb + "px"); } else { host.removeAttribute("data-kb"); host.style.removeProperty("--kb"); } }
  if (W.visualViewport) { W.visualViewport.addEventListener("resize", kbFit); W.visualViewport.addEventListener("scroll", kbFit); }
  document.addEventListener("focusin", () => setTimeout(kbFit, 300)); document.addEventListener("focusout", () => setTimeout(kbFit, 300));
  function mount() {
    dropVeil();
    if (host) return;
    if (!W.__dnScrollLock) { W.__dnScrollLock = 1; const fix = () => { if (host && document.documentElement.classList.contains("dn-on") && !typing() && (W.scrollY || W.scrollX)) W.scrollTo(0, 0); };
      W.addEventListener("scroll", fix, { passive: true }); if (W.visualViewport) W.visualViewport.addEventListener("resize", () => setTimeout(fix, 60)); document.addEventListener("focusout", () => setTimeout(fix, 60)); }
    host = document.createElement("div"); host.id = "dn-app"; applyGfx();
    host.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:auto;overscroll-behavior:contain;background:#0a0c10";
    R = host.attachShadow({ mode: "open" }); host.addEventListener("scroll", () => { if (!fpsRun) setTimeout(fpsProbe, 0); }, { passive: true });
    R.innerHTML = `<style>${DN_CSS}</style><div class="dn" data-theme="${resolveTheme()}"><div class="app">
      <aside class="side"><div class="brand"><div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></div><div><b>Дневник</b><span id="grp"></span></div></div><nav class="nav" id="nav"></nav>
        <button class="classic" data-act="classic">${ic("ext")}<span>Классический журнал</span></button>
        <div class="me" id="me"></div></aside>
      <div class="main"><header class="top"><div><div class="cap" id="eyebrow"></div><h1 id="title"></h1></div>
        <div class="tools"><button class="nowpill" id="nowpill" data-page="schedule" hidden></button><span class="sync" id="sync"></span><button class="iconbtn" data-act="sync" aria-label="Обновить данные" title="Обновить данные">${ic("refresh")}</button><span id="topAva"></span><button class="iconbtn out" data-act="logout" aria-label="Выйти из аккаунта" title="Выйти из аккаунта"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg></button></div></header>
        <div class="page" id="page"></div></div></div><dialog id="dlg"></dialog><div class="toast" id="toast" hidden></div></div>`;
    (document.documentElement).appendChild(host);
    const keepTitle = () => { if (host && /^\s*(journal|журнал)/i.test(document.title || "")) document.title = "Дневник"; };
    keepTitle(); new MutationObserver(keepTitle).observe(document.documentElement, { childList: true, subtree: true, characterData: true });
    new MutationObserver(list => { if (!cfg.mc) return; for (const m of list) m.addedNodes.forEach(nd => mcify(nd.nodeType === 1 ? nd : nd.parentNode)); }).observe(R, { childList: true, subtree: true });
    if (CRYPTO && cfg.mkt) mkBind(R);
    R.addEventListener("click", onClick); R.addEventListener("change", onChange); R.addEventListener("input", onInput);
    R.addEventListener("load", e => { const im = e.target; if (!im.classList || !im.classList.contains("pimg")) return; im.classList.add("ok"); im.parentElement && im.parentElement.classList.add("cached"); if (im.dataset.pu) imgPre[im.dataset.pu] = 2; }, true);
    R.addEventListener("error", e => { const im = e.target; if (!im.classList || !im.classList.contains("pimg")) return; if (im.dataset.pu) imgBad[im.dataset.pu] = Date.now(); im.parentElement && im.parentElement.classList.remove("cached"); im.remove(); }, true);
    R.getElementById("dlg").addEventListener("click", e => { if (e.target.id === "dlg") e.target.close(); });
    R.getElementById("dlg").addEventListener("close", e => { e.target.classList.remove("wide", "sumd"); if (e.target.dataset.rate && rate.root) rateDismiss(); if (pendingNotice) { const l = pendingNotice; pendingNotice = null; setTimeout(() => newsNotice(l), 400); } });
    document.addEventListener("keydown", onKey);
    render();
    clearInterval(tickT); tickT = setInterval(tick, 1000);
    watchPopups();
  }
  let tickT = 0;
  function unmount() { if (!host) return; clearInterval(tickT); tickT = 0; if (avgRO) { avgRO.disconnect(); avgRO = null; } if (raiseWatch) { raiseWatch.disconnect(); raiseWatch = null; } host.remove(); host = null; R = null; document.documentElement.classList.remove("dn-on"); }
  const resolveTheme = () => "dark";
  const $ = s => R.querySelector(s);

  function setSync(s) { syncState = s; paintSync(); if (!M.live && R && DATA_PAGES.has(page)) render(); }
  const DATA_PAGES = new Set(["home", "schedule", "grades", "homework", "awards", "news", "reviews", "payment", "profile", "requests", "market", "materials"]);
  function bootHTML() {
    if (syncState === "auth") { const codes = [...new Set(Object.values(NET.status).filter(x => typeof x === "number" && x >= 400))].join(", ");
      const why = !NET.token ? "Дневник не нашёл вход журнала" + (NET.hook === "page" ? ` (перехват: ${NET.hookEvents ? "работает" : "не сработал"})` : "") : `журнал ответил ${codes || "ошибкой"} · вход найден: ${NET.tokenSrc || "да"}`;
      return `<div class="card boot">${ic("profile", "i big")}<b>Нужно войти в журнал</b><span>Если ты уже вошёл, обнови страницу. Если не помогло - скопируй диагностику и пришли её</span><small class="soft">${esc(why)}</small><div class="btns"><button class="m-btn pri" data-act="sync">${ic("refresh")}Повторить</button><button class="m-btn" data-act="diag">${ic("bug")}Скопировать диагностику</button><button class="m-btn" data-act="classic">${ic("ext")}Открыть журнал</button></div></div>`; }
    if (syncState === "error") return `<div class="card boot">${ic("alert", "i big")}<b>${NET.ddos ? "Журнал проверяет браузер" : "Нет связи с журналом"}</b><span>${NET.ddos ? "Защита DDoS-Guard не пропускает запросы. Перезагрузи страницу - проверка пройдёт сама" : "Проверь интернет и попробуй ещё раз. Если журнал завис - перезагрузи страницу"}</span><div class="btns"><button class="m-btn pri" data-act="sync">${ic("refresh")}Повторить</button><button class="m-btn" data-act="reload">Перезагрузить страницу</button><button class="m-btn" data-act="classic">${ic("ext")}Классический журнал</button></div></div>`;
    return `<div class="card boot"><span class="spin"></span><b>Загружаю твои данные из журнала</b><span>Расписание, оценки, задания и рейтинг появятся через пару секунд</span></div>`;
  }
  function paintSync() {
    if (!R) return; const el = $("#sync"); if (!el) return;
    const t = M.updatedAt ? new Date(M.updatedAt) : null;
    const when = t ? (sameDay(t, new Date()) ? "в " + t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : dm(t)) : "";
    const map = { loading: ["busy", "Обновляю…"], ok: ["ok", "Обновлено " + when + (NET.okCount && NET.okCount < (NET.totalCount || 0) ? ` · ${NET.okCount} из ${NET.totalCount} разделов` : "")], cache: ["", "Данные " + when], seed: ["busy", "Загружаю данные…"], error: ["bad", "Нет связи с журналом"], auth: ["bad", "Нужно войти в журнал"] };
    const [c, txt] = map[syncState] || ["", ""]; el.className = "sync " + c; el.textContent = txt;
  }

  function render() {
    if (!R) return;
    const p = visiblePages().find(x => x.id === page) || PAGES[0]; page = p.id;
    $(".dn").dataset.theme = resolveTheme(); $(".dn").dataset.accent = cfg.accent || "gold"; $(".dn").dataset.mc = String(!!cfg.mc);
    { const on = neoOn(); $(".dn").classList.toggle("neo", on); if (on) loadNeoFonts(); host.style.background = on ? "#000" : resolveTheme() === "dark" ? "#0a0c10" : "#eff0f3"; }
    $("#grp").textContent = M.user.group ? "Группа " + M.user.group : "Электронный журнал";
    const fr = id => fresh[id] ? fresh[id].size : 0;
    const link = x => `<a href="#" data-page="${x.id}" ${x.id === page ? 'aria-current="page"' : ""}>${ic(x.ic)}<span>${x.n}</span>${x.id === "home" && (M.evalList || []).length ? `<span class="bd num" title="Пары ждут оценки">${M.evalList.length}</span>` : x.id === "news" && unread() ? `<span class="bd num">${unread()}</span>` : fr(x.id) ? `<span class="nd c num" title="Новое">${fr(x.id)}</span>` : ""}</a>`;
    const vis = visiblePages();
    $("#nav").innerHTML = ["Учёба", "Активность", "Сервис"].map(g => { const it = vis.filter(x => x.g === g); return it.length ? `<div class="ngrp">${g}</div>` + it.map(link).join("") : ""; }).join("")  + `<div class="ngrp"></div>` + link(PAGES.find(x => x.id === "settings"));
    const nm = (M.user.name || "").split(" ");
    const profOk = vis.some(x => x.id === "profile");
    $("#me").innerHTML = `<div class="who ${profOk ? "go" : ""}" ${profOk ? 'data-page="profile" title="Личный кабинет"' : ""}>${photo()}<div><b>${esc(nm.slice(0, 2).join(" ") || "Загрузка…")}</b><span>${esc(M.user.group)}${M.groupPlace ? " · " + M.groupPlace + " место в группе" : ""}</span></div>${profOk ? ic("chev", "i chv") : ""}</div>
      <div class="wallet"><div title="Топкоины"><span class="coin"></span><span class="num">${M.user.coins ?? "-"}</span><small>ТК</small></div><div title="Топгемы"><span class="gem"></span><span class="num">${M.user.gems ?? "-"}</span><small>ТГ</small></div></div>`;
    { const h = photo("top-ava"), ta = $("#topAva"); if (ta.__h !== h) { ta.__h = h; ta.innerHTML = h; } }
    $("#title").textContent = p.n;
    const s = stats(); SCALE = s.scale;
    $("#eyebrow").textContent = { settings: "Дневник " + VERSION, materials: "Учёба", market: "Топкоины и топгемы", payment: "Договор и платежи", profile: "Мои данные", requests: "Учебная часть", complaints: "Генеральному директору", faq: "Справка", contacts: "Связь с университетом", home: [M.user.name, M.user.group].filter(Boolean).join(" · "), schedule: "Неделя", grades: `${s.total} ${plural(s.total, "пара", "пары", "пар")} · ${s.marks} оценок`, homework: `${M.hwStat.total || M.hwStat.all} заданий`, awards: "Монеты, гемы и достижения", news: `${unread()} непрочитанных`, reviews: "О студенте" }[page];
    try { $("#page").innerHTML = !M.live && DATA_PAGES.has(page) ? bootHTML() : VIEWS[page](s); NET.viewErr = null; }
    catch (e) { NET.viewErr = page + ": " + String(e && e.message || e).slice(0, 160); $("#page").innerHTML = `<section class="card"><div class="hd"><h2>Раздел не открылся</h2></div><p class="note">Похоже, журнал прислал данные в неожиданном виде. Нажми «Обновить» вверху или открой другой раздел. Ошибка: ${esc(NET.viewErr)}</p></section>`; }
    if (page === "grades") { applyGF(); fitAvg(); bindPairs(); }
    if (page === "home") { requestAnimationFrame(fitFeed); setTimeout(fitFeed, 400); try { document.fonts && document.fonts.ready.then(() => R && page === "home" && fitFeed()); } catch (e) {} }
    enhanceSelects($("#page"));
    paintSync(); tick();
  }

  // скрываем строки начислений, которые не влезают по высоте (карточка тянется до соседней)
  function fitFeed() { if (!W.__dnFF) { W.__dnFF = 1; let t = 0; W.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(() => { if (R && page === "home") fitFeed(); }, 150); }); }
    const box = R && R.querySelector(".feedfit"); if (!box) return; const L = [...box.querySelectorAll(".li")]; L.forEach(x => x.hidden = false);
    if (matchMedia("(max-width:760px)").matches) { L.forEach((x, i) => x.hidden = i >= 6); return; }
    const lim = box.getBoundingClientRect().bottom; L.forEach((x, i) => { if (i >= 4 && x.getBoundingClientRect().bottom > lim + 1) x.hidden = true; }); }
  let calYm = null;
  const VIEWS = {};
  function attRing(s, size = 88) {
    const c = size / 2, r = c - 9, L = 2 * Math.PI * r, tot = Math.max(1, s.total), gap = s.total > 1 ? 2.2 : 0;
    const parts = [[s.present - s.late, "var(--good)"], [s.late, "var(--warn)"], [s.miss, "var(--bad)"]].filter(x => x[0] > 0);
    let off = 0; const seg = parts.map(([n, col]) => { const len = n / tot * L, d = Math.max(0.6, len - gap); const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-dasharray="${d} ${L - d}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"/>`; off += len; return el; }).join("");
    const ticks = Array.from({ length: 40 }, (_, i) => { const a = i / 40 * 2 * Math.PI - Math.PI / 2, r1 = c - 2, r2 = c - (i % 5 ? 3.5 : 5); return `<line x1="${c + r1 * Math.cos(a)}" y1="${c + r1 * Math.sin(a)}" x2="${c + r2 * Math.cos(a)}" y2="${c + r2 * Math.sin(a)}"/>`; }).join("");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring2" aria-hidden="true"><g class="tk">${ticks}</g><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>${seg}<text x="${c}" y="${c - 1}" text-anchor="middle" class="r-v">${s.present}</text><text x="${c}" y="${c + 12}" text-anchor="middle" class="r-s">из ${s.total}</text></svg>`;
  }
  function lessonHTML(l, day, pidx) {
    const s = l.start ? atTime(day, l.start).getTime() : 0, e = l.end ? atTime(day, l.end).getTime() : 0;
    return `<button class="lesson s-${subjKey(l.subj)}" data-les="${day}|${l.start}" data-s="${s}" data-e="${e}">
      <span class="t" title="${esc(l.subj)}">${esc(l.subj)}</span><span class="tt num">${esc(l.start)}<i></i><b>${esc(l.end)}</b></span>
      <span class="r"><span class="room">${esc(roomTxt(l.room))}</span><span>${esc(shortT(l.teacher))}</span></span><i class="p"></i></button>`;
  }
  const timeCol = (l, cap, pidx) => `<div class="tmc num">${cap && pidx >= 0 ? `<span class="cap">${pidx + 1} пара</span>` : ""}<b>${esc(l.start)}</b><span class="ln"></span><span class="end">${esc(l.end)}</span></div>`;
  function gapTxt(day, a, b) { const m = Math.round((atTime(day, b.start) - atTime(day, a.end)) / 6e4); if (!(m > 0)) return ""; return m >= 60 ? `Окно ${Math.floor(m / 60)} ч${m % 60 ? " " + m % 60 + " мин" : ""}` : `Перерыв ${m} мин`; }
  function dayTimeline(day) {
    const ls = lessonsOn(fromIso(day)), pi = pairIndex();
    return `<div class="tl">${ls.map((l, i) => (i ? `<div class="gap">${gapTxt(day, ls[i - 1], l)}</div>` : "") + timeCol(l, true, pi(l.start)) + lessonHTML(l, day)).join("")}</div>`;
  }

  VIEWS.home = s => {
    const now = new Date(), dp = dayPart(now.getHours()), hi = isBday() ? "С днём рождения" : HELLO[dp];
    const first = (M.user.name || "").split(" ")[1] || "";
    const L = M.leaders || [], meI = L.findIndex(x => x.me), me = L[meI];
    const LL = lbMode === "stream" && (M.streamLeaders || []).length ? M.streamLeaders : L, maxL = LL.length ? LL[0].pts || 1 : 1;
    const LS2 = LL.slice(0, 10); const meL = LL.find(x => x.me); if (meL && !LS2.includes(meL)) LS2.push(meL);
    const toNext = me && meI > 0 ? L[meI - 1].pts - me.pts : null, lead = me && L[meI + 1] ? me.pts - L[meI + 1].pts : null;
    const weekPairs = [0, 1, 2, 3, 4, 5, 6].reduce((a, d) => a + lessonsOn(dayDate(mondayOf(now), d)).length, 0);
    const occ = occurrences(now); const todayLeft = occ.some(x => sameDay(x.s, now) && x.e > now);
    const nx = occ.find(x => x.e > now);
    const showDay = todayLeft ? iso(now) : nx ? nx.day : null;
    const isToday = showDay === iso(now);
    const goal = nextGoal(s);
    // оценки, поставленные сегодня (видны до 23:59): вместо строки про награду
    const MKS = { hw: "ДЗ", cw: "классная", lab: "лабораторная", ctrl: "контрольная", prac: "практическая", fin: "итоговая" };
    const todayMarks = []; (M.visits || []).filter(v => v.date === iso(now)).forEach(v => { const m = MK.filter(k => v[k] != null).map(k => ({ k, v: v[k] })); if (!m.length) return; const o = todayMarks.find(x => x.subj === v.subj); if (o) o.m.push(...m); else todayMarks.push({ subj: v.subj, m }); });
    const evl = (M.evalList || []).length, now0 = new Date();
    const dueToday = (M.hw || []).map((h, i) => ({ h, i })).filter(x => x.h.status === "cur" && x.h.due && dayDiff(now0, fromIso(x.h.due)) === 0);
    // оплата. Красная - долг (просроченные неоплаченные платежи или долг по данным журнала), жёлтая - платёж в ближайшие 3 дня.
    // Одновременно показывается только одна карточка: при долге ближайший платёж упоминается в ней же
    const pay = M.pay || {}, today0 = iso(now0), unpaid = (pay.plan || []).filter(x => !x[3]).sort((a, b) => a[0].localeCompare(b[0]));
    // долг - только реально просроченные неоплаченные платежи из графика (amount_debt журнала - это сумма к оплате за период, а не долг)
    const overdueP = unpaid.filter(x => x[0] < today0), debtSum = overdueP.reduce((a, x) => a + (x[2] || 0), 0);
    const planNext = unpaid.find(x => x[0] >= today0), payDays = planNext ? dayDiff(now0, fromIso(planNext[0])) : null;
    const payKind = payDays != null && payDays <= 3 ? "soon" : null;
    const payKey = "soon|" + (planNext ? planNext[0] : "");
    const payDis = LS.get("paydis", {}); const payShow = !!payKind && payDis.k !== payKey;
    // опрос журнала: только открытый (который можно пройти); скрыть можно до завтра
    const quizKey = M.quiz && M.quiz.n ? (M.quiz.title || "") + "|" + M.quiz.n : "";
    const quizDis = LS.get("quizdis", {}); const quizShow = !!quizKey && !(quizDis.k === quizKey && Date.now() - quizDis.t < 864e5);
    // не больше 3 карточек: оценка пары и оплата - всегда, потом сроки на сегодня, итоги - если есть место и нет горящих сроков
    const slots = Math.max(1, 3 - (evl ? 1 : 0) - (payShow ? 1 : 0) - (quizShow ? 1 : 0)); let dueShow = dueToday, dueMore = 0;
    if (dueToday.length > slots) { dueShow = dueToday.slice(0, Math.max(0, slots - 1)); dueMore = dueToday.length - dueShow.length; }
    const sumYm = !dueToday.length && !payShow ? summaryDue() : null;
    const upd = LS.get("upd", null), updShow = upd && upd.v && verNewer(upd.v, VERSION) && LS.get("upddis", "") !== upd.v;
    const hasNotes = dueToday.length || sumYm || evl || payShow || quizShow || updShow;
    const bdayShow = isBday() && LS.get("bdaydis", 0) !== now.getFullYear();
    return `${bdayShow ? bdayHTML() : ""}${hasNotes ? `<div class="notes">` : ""}${updShow ? `<div class="card updban"><div class="ic">${ic("download")}</div><div class="grow"><b>Вышла новая версия ${esc(upd.v)}</b><span>У тебя ${VERSION} · обновление займёт пару секунд</span></div><a class="m-btn pri" href="${UPD_URL}" target="_blank" rel="noopener" data-act="updgo">Обновить</a><button class="x" data-act="upddis" data-v="${esc(upd.v)}" aria-label="Скрыть">×</button></div>` : ""}${payShow ? `<div class="card payban ${payKind}"><div class="ic">${ic("card")}</div><div class="grow">${payKind === "debt"
      ? `<b>Задолженность по оплате${debtSum > 0 ? ": " + rub(debtSum) : ""}</b><span>${overdueP.length ? `срок был ${dm(fromIso(overdueP[0][0]))}${overdueP[0][1] ? " · " + esc(overdueP[0][1]) : ""}` : "журнал отмечает задолженность"}${planNext && payDays <= 3 ? ` · следующий ${rub(planNext[2])} до ${dm(fromIso(planNext[0]))}` : ""}</span>`
      : `<b>Скоро оплата${planNext[2] ? ": " + rub(planNext[2]) : ""}</b><span>${payDays === 0 ? "сегодня последний день" : `до ${dm(fromIso(planNext[0]))} · ${payDays === 1 ? "завтра" : "через " + payDays + " " + plural(payDays, "день", "дня", "дней")}`}${planNext[1] ? " · " + esc(planNext[1]) : ""}</span>`}
      </div><button class="m-btn" data-page="payment">Оплата</button><button class="x" data-act="paydis" data-k="${esc(payKey)}" aria-label="Скрыть до следующего платежа" title="Скрыть до следующего платежа">×</button></div>` : ""}${quizShow ? `<div class="card quizban"><div class="ic">${ic("poll")}</div><div class="grow"><b>Опрос от академии · +20 <span class="coin"></span></b><span>${esc((M.quiz && M.quiz.title) || "Можно пройти в журнале")}</span></div><button class="m-btn pri" data-act="classic">Пройти</button><button class="x" data-act="quizdis" data-k="${esc(quizKey)}" aria-label="Скрыть до завтра" title="Скрыть до завтра">×</button></div>` : ""}${dueShow.map(({ h, i }) => `<div class="card dueban"><div class="ic">${ic("clock")}</div><div class="grow"><b>Сегодня срок: ${esc(h.subj)}</b><span>${esc(h.theme || "Домашнее задание")} · до 23:59</span></div><button class="m-btn" data-hwf="${esc(hwRef(h))}">${ic("upload")}Сдать</button></div>`).join("")}${dueMore ? `<div class="card dueban"><div class="ic">${ic("clock")}</div><div class="grow"><b>Ещё ${dueMore} ${plural(dueMore, "задание", "задания", "заданий")} со сроком сегодня</b><span>до 23:59</span></div><button class="m-btn" data-page="homework">Все</button></div>` : ""}
    ${sumYm ? `<div class="card sumcard"><div class="ic">${ic("star")}</div><div class="grow"><b>Итоги: ${MONTHS_N[+sumYm.slice(5) - 1]}</b><span>${(() => { const st = monthStats(sumYm); return `${st.marks} ${plural(st.marks, "оценка", "оценки", "оценок")} · посещаемость ${st.att}%`; })()}</span></div><button class="m-btn pri" data-act="month" data-ym="${sumYm}">Смотреть</button><button class="x" data-act="mdis" data-ym="${sumYm}" aria-label="Скрыть">×</button></div>` : ""}${evl ? `<div class="card evl"><div class="ic">${ic("star")}</div><div class="grow"><b>Оцените ${evl} ${plural(evl, "занятие", "занятия", "занятий")} · +${evl} <span class="coin"></span></b><span>Оценки анонимны</span></div><button class="m-btn pri" data-form="lesson">Оценить</button></div>` : ""}${hasNotes ? `</div>` : ""}
    <section class="hero nh nh-${dp}" data-dp="${dp}">${heroScene(dp)}
      <div class="hero-id">${photo("lg")}<div><div class="cap">${DAYS[(now.getDay() + 6) % 7]}, ${longDate(now)}</div><h2>${hi}${first ? ", " + esc(first) : ""}</h2></div></div>
      <p><span>${s.marks ? (s.allTop ? `Все ${s.marks} ${plural(s.marks, "оценка", "оценки", "оценок")} - «${s.maxMark}».` : `Средний балл ${f2(s.avg)} по ${s.marks} ${plural(s.marks, "оценке", "оценкам", "оценкам")}.`) : "Оценок пока нет."} Без пропусков ${s.pStreak} ${plural(s.pStreak, "пара", "пары", "пар")} подряд.</span>${!todayMarks.length && goal ? `<span>До награды «${goal} посещений подряд» осталось ${Math.max(1, goal - s.pStreak)} ${plural(Math.max(1, goal - s.pStreak), "пара", "пары", "пар")}.</span>` : ""}</p>
      ${todayMarks.length ? `<div class="tmarks"><b>Сегодня уже:</b>${todayMarks.slice(0, 3).map(x => `<button class="tmk" data-page="grades" title="${esc(x.subj)}: ${x.m.map(y => `${y.v} (${MKS[y.k]})`).join(", ")}">${x.m.map(y => `<span class="mark5 ${y.k}">${y.v}</span>`).join("")}<span class="tsj">${esc(subjShort(x.subj))}</span></button>`).join("")}${todayMarks.length > 3 ? `<button class="tmk more" data-page="grades">+${todayMarks.length - 3}</button>` : ""}</div>` : ""}
      <div class="facts"><span>Средний балл <b class="num">${s.marks ? f2(s.avg) : "-"}</b></span><span>Посещаемость <b class="num">${s.att}%</b></span>
        ${M.groupPlace ? `<span>Место в группе <b class="num">${M.groupPlace}</b>${M.streamPlace ? ` · на потоке <b class="num">${M.streamPlace}</b>` : ""}</span>` : ""}<span>На этой неделе <b class="num">${pairsW(weekPairs)}</b></span></div></section>
    ${CRYPTO && cfg.mkt ? marketHTML() : ""}
    <div class="row r4">
      <div class="card kpi"><div class="lab">${ic("star")}Средний балл</div><div class="val num">${s.marks ? (Math.abs(s.avg - Math.round(s.avg)) < 0.005 ? f1(s.avg) : f2(s.avg)) : "-"}<small>/ ${s.scale}</small></div><div class="sub"><b class="num">${s.marks}</b> оценок: ${s.hwN} за ДЗ, ${s.cwN} за работу на паре${s.otherN ? `, ${s.otherN} другие` : ""}</div></div>
      <div class="card kpi att">${attRing(s)}<div class="lab">${ic("check")}Посещаемость</div><div class="val num">${s.att}<small>%</small></div><div class="sub att-l"><span><span class="ld g"></span>был <b class="num">${s.present - s.late}</b></span>${s.late ? `<span><span class="ld o"></span>опоздал <b class="num">${s.late}</b></span>` : ""}<span><span class="ld r"></span>пропуск <b class="num">${s.miss}</b></span></div></div>
      <div class="card kpi"><div class="lab">${ic("flame")}Серия без пропусков</div><div class="val num">${s.pStreak}<small>${goal ? "/ " + goal + " " : ""}${plural(goal || s.pStreak, "пара", "пары", "пар")}</small></div><div class="meter"><i style="width:${goal ? Math.min(100, s.pStreak / goal * 100) : 100}%"></i></div><div class="sub">${!goal ? "Все награды за серию получены" : `До награды «${goal} посещений подряд» <b class="num">${Math.max(1, goal - s.pStreak)}</b> ${plural(Math.max(1, goal - s.pStreak), "пара", "пары", "пар")}`}</div></div>
      <div class="card kpi rank"><div class="lab">${ic("trophy")}Рейтинг группы</div><div class="val num">${me ? me.pos : M.groupPlace || "-"}<small>место</small></div><div class="sub">${me ? `<b class="num">${me.pts}</b> баллов${toNext != null ? ` · до ${me.pos - 1} места <b class="num">${toNext}</b>` : ""}${lead != null ? `, отрыв от ${me.pos + 1}-го <b class="num">${lead}</b>` : ""}` : ""}</div></div>
    </div>
    <div class="row r-7-5">
      <div class="card"><div class="hd"><h2>${showDay ? (isToday ? "Сегодня" : DAYS[(fromIso(showDay).getDay() + 6) % 7] + ", " + longDate(fromIso(showDay))) : "Расписание"}</h2><a href="#" data-page="schedule">Всё расписание</a></div>
        ${showDay ? (isToday ? "" : `<p class="note" style="margin:-4px 0 12px">Сегодня пар больше нет. Ближайший учебный день:</p>`) + dayTimeline(showDay) + dayFoot(showDay) : `<div class="restday"><b>Пар не найдено</b>Расписание на ближайшие две недели пустое</div>`}</div>
      <div class="card"><div class="hd"><h2>Домашние задания</h2><a href="#" data-page="homework">Подробнее</a></div>
        ${hwSummary()}
        ${hwTodo(s)}</div>
    </div>
    <div class="row r2">
      <div class="card lb"><div class="hd"><h2>Таблица лидеров</h2><div class="pill" role="group"><button data-lb="group" aria-pressed="${lbMode !== "stream"}">Группа</button><button data-lb="stream" aria-pressed="${lbMode === "stream"}">Поток</button></div></div>
        <p class="note" style="margin:-4px 0 8px">${lbMode === "stream" ? `${esc(M.user.stream_name || "Поток")}${M.streamPlace ? ` · ты на <b class="num">${M.streamPlace}</b> месте` : ""}` : `Группа ${esc(M.user.group)}${me ? ` · ты на <b class="num">${me.pos}</b> месте из ${L.length}` : ""}`}</p>
        <div class="list">${LS2.map(x => `<div class="li ${x.me ? "me-row" : ""}"><span class="pos num">${x.pos}</span>${photo("sm", x.me ? M.user.photo || x.photo : x.photo, x.name)}<div class="grow"><b>${esc(x.name)}</b></div><span class="track"><i style="width:${x.pts / maxL * 100}%"></i></span><span class="pts num">${x.pts}</span></div>`).join("") || `<p class="note">${lbMode === "stream" ? "Журнал не прислал рейтинг потока" : "Нет данных"}</p>`}</div></div>
      <div class="card"><div class="hd"><h2>Последние начисления</h2><a href="#" data-page="awards">Награды</a></div><div class="feedfit">${feedList(20)}</div>
        <div class="legend" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--hair)"><span><span class="coin"></span>Топкоины <b class="num">${M.user.coins ?? "-"}</b></span><span><span class="gem"></span>Топгемы <b class="num">${M.user.gems ?? "-"}</b></span></div></div>
    </div>`;
  };
  // низ карточки «Сегодня»: сколько пар и до скольки, и что дальше - всё из расписания журнала
  function dayFoot(day) {
    const today = iso(new Date()), isT = day === today;
    const sum = d => { const ls = lessonsOn(fromIso(d)), mins = ls.reduce((a, l) => { const [h1, m1] = l.start.split(":").map(Number), [h2, m2] = l.end.split(":").map(Number); return a + Math.max(0, h2 * 60 + m2 - h1 * 60 - m1); }, 0); return { ls, mins }; };
    const box = (icon, title, sub, btn) => `<${btn ? 'button data-page="schedule"' : "div"}><span>${ic(icon)}</span><div><b class="num">${title}</b><small class="num">${sub}</small></div></${btn ? "button" : "div"}>`;
    const subjs = ls => ls.slice(0, 3).map(l => esc(subjShort(l.subj))).join(", ") + (ls.length > 3 ? "…" : "");
    const a = sum(day); if (!a.ls.length) return "";
    if (!isT) { // сегодня пары уже закончились (или их не было), карточка показывает ближайший учебный день
      const t = sum(today);
      return `<div class="dfoot">${t.ls.length ? box("check", `Сегодня ${pairsW(t.ls.length)} прошли`, `${esc(t.ls[0].start)} - ${esc(t.ls[t.ls.length - 1].end)} · ${f1(t.mins / 60).replace(",0", "")} ч занятий`) : box("check", "Сегодня пар не было", "выходной или свободный день")}
        ${(() => { let n2 = null; for (let k = 1; k <= 14 && !n2; k++) { const d = dayDate(fromIso(day), k); if (lessonsOn(d).length) n2 = d; } if (!n2) return ""; const b = sum(iso(n2)), w2 = dayDiff(new Date(), n2) === 1 ? "Завтра" : DAYS[(n2.getDay() + 6) % 7] + ", " + longDate(n2);
          return box("cal", `${w2} · ${pairsW(b.ls.length)}`, `с ${esc(b.ls[0].start)} до ${esc(b.ls[b.ls.length - 1].end)} · ${subjs(b.ls)}`, true); })()}</div>`; }
    let nd = null; for (let k = 1; k <= 14 && !nd; k++) { const d = dayDate(fromIso(day), k); if (lessonsOn(d).length) nd = d; }
    const nl = nd ? lessonsOn(nd) : [], whenN = !nd ? "" : dayDiff(fromIso(day), nd) === 1 ? "Завтра" : DAYS[(nd.getDay() + 6) % 7] + ", " + longDate(nd);
    return `<div class="dfoot">${box("clock", `${pairsW(a.ls.length)} · ${esc(a.ls[0].start)} - ${esc(a.ls[a.ls.length - 1].end)}`, `${f1(a.mins / 60).replace(",0", "")} ч занятий`)}
      ${nd ? box("cal", whenN, `${pairsW(nl.length)} с ${esc(nl[0].start)} · ${subjs(nl)}`, true) : ""}</div>`;
  }
  // список «как To do» в новом стиле: просроченные, текущие по сроку, на проверке, проверенные (зачёркнуты, с оценкой)
  function hwTodo(s) {
    const now = new Date(), ord = { late: 0, cur: 1, wait: 2, done: 3 };
    const L = (M.hw || []).slice().sort((a, b) => (ord[a.status] - ord[b.status]) || (a.status === "done" ? (b.due || "").localeCompare(a.due || "") : (a.due || "").localeCompare(b.due || ""))).slice(0, 4);
    const tag = h => { const d = h.due ? dayDiff(now, fromIso(h.due)) : null;
      return h.status === "done" ? `<span class="td-tag g">оценка ${esc(String(h.mark))}</span>` : h.status === "wait" ? `<span class="td-tag y">на проверке</span>` : h.status === "late" || (d != null && d < 0) ? `<span class="td-tag p">${h.removed ? "удалено" : "просрочено"}</span>` : d === 0 ? `<span class="td-tag p">сегодня до 23:59</span>` : `<span class="td-tag c">до ${h.due ? dm(fromIso(h.due)) : "-"}</span>`; };
    const row = h => `<button class="td-row ${h.status}" data-page="homework"><span class="td-ck">${h.status === "done" ? ic("check") : h.status === "wait" ? ic("clock") : h.status === "late" ? '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 6.5v7M12 17.6v.01"/></svg>' : '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/></svg>'}</span><span class="td-tx"><b>${esc(h.theme || "Домашнее задание")}</b><span>${esc(subjShort(h.subj))}${tag(h)}</span></span></button>`;
    const ex = (M.exams || []);
    return `<div class="td-list">${L.map(row).join("") || `<p class="note">Заданий пока нет</p>`}</div>
      <div class="td-foot"><span>${ic("check")}Формы контроля: <b>${ex.length ? ex.map(x => esc(x.subj) + (x.date ? " · " + dm(fromIso(x.date)) : "")).join(", ") : "предстоящих нет"}</b></span>${s.hwCount ? `<span>${ic("timer")}Сдаёшь заранее: <b class="num">${f1(s.earlyAvg)} дн.</b></span>` : ""}</div>`;
  }
  function hwSummary() {
    const c = M.hwStat, all = c.total || c.all;
    return `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px"><span style="font-size:40px;font-weight:700;line-height:1" class="num">${all}</span><span class="muted">заданий</span></div>
      <div class="seg-bar" style="margin-bottom:12px"><i style="flex:${c.done};background:var(--good)"></i><i style="flex:${c.wait};background:var(--warn)"></i><i style="flex:${c.cur};background:var(--line)"></i><i style="flex:${c.late};background:var(--bad)"></i></div>
      <div class="legend"><span><i style="background:var(--good)"></i>Проверено <b class="num">${c.done}</b></span><span><i style="background:var(--warn)"></i>На проверке <b class="num">${c.wait}</b></span><span><i style="background:var(--line)"></i>Новые <b class="num">${c.cur}</b></span><span><i style="background:var(--bad)"></i>Просрочено <b class="num">${c.late}</b></span></div>`;
  }
  const feedList = n => { const K = feedKeys(); return `<div class="list">${(M.feed || []).slice(0, n).map((f, i) => `<div class="li ${isNew("awards", K[i]) ? "isnew" : ""}"><div class="grow"><b>${esc(actName(f.label))}</b><span class="num">${f.date ? dm(fromIso(f.date)) + "." + f.date.slice(0, 4) : ""}</span></div><span class="amt num">+${f.amt} <span class="${f.kind}"></span></span></div>`).join("") || `<p class="note">Начислений пока нет</p>`}</div>`; };

  function schedGoCurrent() {
    const now = new Date(), { cur, next } = focus(now), o = cur || next;
    sc.mon = mondayOf(o ? o.s : now); sc.day = o ? (o.s.getDay() + 6) % 7 : (now.getDay() + 6) % 7;
    if (sameDay(mondayOf(now), sc.mon)) sc.day = (now.getDay() + 6) % 7;
  }
  VIEWS.schedule = () => {
    if (!sc.mon) schedGoCurrent();
    ensureWeek(sc.mon);
    const a = sc.mon, b = dayDate(sc.mon, 6);
    const lbl = a.getMonth() === b.getMonth() ? `${a.getDate()} - ${b.getDate()} ${MON[b.getMonth()]}` : `${a.getDate()} ${MON[a.getMonth()]} - ${b.getDate()} ${MON[b.getMonth()]}`;
    const n = [0, 1, 2, 3, 4, 5, 6].reduce((s, d) => s + lessonsOn(dayDate(sc.mon, d)).length, 0);
    const loaded = M.schedule[iso(sc.mon)] !== undefined && (!M.live || (M.schedLive && M.schedLive[iso(sc.mon)]));
    return `<section class="now" id="now" hidden></section>
    <div class="bar-tools"><div class="grp"><div class="pill"><button class="ar" data-act="prev" aria-label="Предыдущая неделя">‹</button><span class="lbl num">${lbl}</span><button class="ar" data-act="next" aria-label="Следующая неделя">›</button></div>
      <div class="pill"><button data-act="cur">Сегодня</button></div></div>
      <div class="pill" role="group"><button data-act="week" aria-pressed="${sc.view === "week"}">Неделя</button><button data-act="day" aria-pressed="${sc.view === "day"}">День</button></div></div>
    ${!loaded ? `<div class="restday"><b>Загружаю неделю…</b>Данные придут из журнала</div>` : sc.view === "week" ? weekHTML() : dayHTML()}
    <div class="legend"><span><b class="num">${pairsW(n)}</b> на неделе</span><span><b class="num">${f1(n * 1.5).replace(",0", "")} ч</b> занятий</span></div>`;
  };
  function weekHTML() {
    const today = new Date(), pi = pairIndex();
    const days = [0, 1, 2, 3, 4, 5, 6].map(d => ({ d, dt: dayDate(sc.mon, d), ls: lessonsOn(dayDate(sc.mon, d)) }));
    const weekend = days.slice(5).some(x => x.ls.length);
    const cols = weekend ? days : days.slice(0, 5);
    const rowsIdx = [...new Set(days.flatMap(x => x.ls.map(l => pi(l.start))))].filter(i => i >= 0).sort((a, b) => a - b);
    const ROWS = Math.max(rowsIdx.length, 1);
    const starts = rowsIdx.map(i => { for (const x of days) { const l = x.ls.find(l => pi(l.start) === i); if (l) return l; } return null; });
    let g = `<div class="gridwrap"><div class="grid" style="grid-template-columns:92px repeat(${cols.length},minmax(0,1fr))${weekend ? "" : " 72px"}"><div></div>`;
    cols.forEach(x => g += `<div class="dh ${sameDay(x.dt, today) ? "today" : ""}"><div class="n">${DAYS[x.d]}</div><div class="d num">${dm(x.dt)} · ${x.ls.length ? pairsW(x.ls.length) : "свободно"}</div></div>`);
    if (!weekend) g += `<div class="dh" style="padding-inline:10px"><div class="n" style="white-space:nowrap;font-size:14px">Сб, Вс</div></div>`;
    cols.forEach((x, ci) => { if (!x.ls.length) g += `<div class="hatch" style="grid-column:${ci + 2};grid-row:2 / span ${ROWS}"><span>${x.d >= 5 ? "Выходной" : "Свободный день"}</span></div>`; });
    if (!weekend) g += `<div class="hatch wk" style="grid-column:${cols.length + 2};grid-row:2 / span ${ROWS}"><span>Выходные</span></div>`;
    rowsIdx.forEach((ri, k) => {
      const l0 = starts[k];
      g += `<div class="th num"><span class="cap">${ri + 1} пара</span><b>${esc(l0.start)}</b><span class="ln"></span><span class="end">${esc(l0.end)}</span></div>`;
      cols.forEach(x => { if (!x.ls.length) return; const l = x.ls.find(l => pi(l.start) === ri); g += `<div class="cell ${sameDay(x.dt, today) ? "today" : ""}${k === rowsIdx.length - 1 ? " lr" : ""}">${l ? lessonHTML(l, iso(x.dt)) : ""}</div>`; });
    });
    g += `</div></div><div class="agenda">`;
    days.forEach(x => {
      if (x.d >= 5 && !x.ls.length) return;
      g += `<section class="aday ${sameDay(x.dt, today) ? "today" : ""}"><h3>${DAYS[x.d]}, ${longDate(x.dt)}<small class="num">${x.ls.length ? pairsW(x.ls.length) + ` · ${x.ls[0].start} - ${x.ls[x.ls.length - 1].end}` : "свободный день"}</small></h3>`;
      g += x.ls.map(l => `<div class="arow">${timeCol(l, false)}${lessonHTML(l, iso(x.dt))}</div>`).join("") || `<div class="free">Пар нет</div>`;
      g += `</section>`;
    });
    return g + `</div>`;
  }
  function dayHTML() {
    const today = new Date();
    let h = `<div class="days">`;
    for (let d = 0; d < 7; d++) { const dt = dayDate(sc.mon, d); h += `<button data-day="${d}" aria-pressed="${sc.day === d}" class="${sameDay(dt, today) ? "today" : ""}"><span class="w">${DSH[d]}</span><span class="dd num">${dm(dt)}</span><span class="dots">${"<i></i>".repeat(lessonsOn(dt).length)}</span></button>`; }
    const dt = dayDate(sc.mon, sc.day), ls = lessonsOn(dt);
    h += `</div><section class="card"><div class="hd"><h2>${DAYS[sc.day]}, ${longDate(dt)}</h2><small class="num">${ls.length ? pairsW(ls.length) + " · " + ls[0].start + " - " + ls[ls.length - 1].end : ""}</small></div>`;
    h += ls.length ? dayTimeline(iso(dt)) : `<div class="restday"><b>Пар нет</b>${sc.day >= 5 ? "Выходной день" : "Свободный день"}</div>`;
    return h + `</section>`;
  }

  /* ---------- цель по баллу ---------- */
  function markList(subj, from) { const L = []; (M.visits || []).forEach(v => { if (subj && v.subj !== subj) return; if (from && !(v.date >= from)) return; MK.forEach(k => v[k] != null && L.push(v[k])); }); return L; }
  // период цели: текущая неделя, текущий месяц или всё время
  const GPER = [["week", "Неделя"], ["month", "Месяц"], ["all", "Всё время"]];
  const perOf = g => GPER.some(x => x[0] === g.per) ? g.per : "all";
  function perFrom(per) { const n = new Date(); return per === "week" ? iso(mondayOf(n)) : per === "month" ? iso(new Date(n.getFullYear(), n.getMonth(), 1)) : ""; }
  const perName = per => per === "week" ? "за эту неделю" : per === "month" ? "за этот месяц" : "за всё время";
  const perPill = (k, per) => `<div class="pill gper" role="group">${GPER.map(([v, n]) => `<button data-gper="${k}|${v}" aria-pressed="${per === v}">${n}</button>`).join("")}</div>`;
  function goalOptions(a, top) {
    const r = x => Math.round(x * 100) / 100, step = top > 5 ? 0.5 : 0.1, o = [];
    if (a >= top - 0.1 * (top / 5)) { [top - 0.05 * (top / 5), top - 0.02 * (top / 5)].forEach(x => x > a && o.push(r(x))); }
    else { const c = Math.floor(a / step + 1e-9) * step + step; o.push(r(c), r(Math.min(top - step, c + 2 * step)));
      const mil = (top > 5 ? [6, 7, 8, 9, 10, 11] : [3.5, 4, 4.5, 4.8]).find(x => x > c + 2 * step); if (mil) o.push(mil); }
    return [...new Set(o)].filter(x => x > a && x < top + 0.001).slice(0, 3);
  }
  const T2 = x => String(+(+x).toFixed(2)).replace(".", ",");
  function subjOptions(sel, id, withMarks) {
    const cnt = {}; (M.visits || []).forEach(v => { if (!withMarks || MK.some(k => v[k] != null)) cnt[v.subj] = (cnt[v.subj] || 0) + 1; });
    const subs = Object.keys(cnt).sort((a, b) => a.localeCompare(b, "ru"));
    return { subs, html: `<select class="sel gsel2" id="${id}"><option value="">Все предметы</option>${subs.map(x => `<option value="${esc(x)}" ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>` };
  }
  function goalHTML() {
    const g = LS.get("goal", {}); const so = subjOptions(g.subj, "goalsel", true), subj = so.subs.includes(g.subj) ? g.subj : "";
    if (!markList(subj).length) return "";
    const per = perOf(g), L = markList(subj, perFrom(per));
    const head = `<section class="card goal"><div class="hd"><h2>${ic("star")}Цель по баллу</h2>${so.html}</div>${perPill("goal", per)}`;
    if (!L.length) return head + `<p class="ghint">${perName(per)[0].toUpperCase() + perName(per).slice(1)} оценок пока нет - цель начнёт считаться с первой оценки.</p></section>`;
    const top = SCALE > 5 ? 12 : 5, n = L.length, S = L.reduce((x, y) => x + y, 0), a = S / n;
    const opts = goalOptions(a, top), T = +g.t > a && +g.t <= top ? +g.t : opts[0];
    // (S + k·m) / (n + k) >= T  =>  k = (T·n - S) / (m - T)
    const need = m => m <= T ? Infinity : Math.max(0, Math.ceil((T * n - S) / (m - T) - 1e-9));
    const k5 = T ? need(top) : 0, k4 = T ? need(top - 1) : 0, done = !T || a >= T;
    const chips = (k, c) => k === Infinity ? "" : Array.from({ length: Math.min(k, 8) }, () => `<span class="${c}">${c === "k5" ? top : top - 1}</span>`).join("") + (k > 8 ? `<span class="${c}">…×${k}</span>` : "");
    const lo = 2, pct = x => Math.max(0, Math.min(100, (x - lo) / (top - lo) * 100));
    return head + `<div class="gtop"><div><span class="gn num">${f2(a)}</span><small>${perName(per)} · ${n} ${plural(n, "оценка", "оценки", "оценок")}</small></div>${T ? `<div class="gto"><span class="gn num">${T2(T)}</span><small>цель</small></div>` : ""}</div>
      ${T ? `<div class="gbar"><i style="width:${pct(a)}%"></i><em style="left:${pct(T)}%"></em></div>` : ""}
      <div class="gopt">${opts.map(x => `<button data-gt="${x}" aria-pressed="${x === T}">${T2(x)}</button>`).join("")}<label class="gown"><span>своя</span><span class="gin"><input id="goalin" type="number" inputmode="decimal" step="0.01" min="${lo}" max="${top}" value="${T && !opts.includes(T) ? T : ""}" placeholder="${T2(Math.min(top, (opts[opts.length - 1] || a) + 0.1))}"></span></label></div>
      <p class="ghint">${!T ? `Выше уже некуда - держи все оценки на «${top}».` : done ? "Цель достигнута" : k5 === Infinity ? `Цель ${T2(T)} недостижима: даже «${top}» подряд её не дадут` :
        `Чтобы выйти на <b>${T2(T)}</b>, нужно ещё <b>${k5} × «${top}»</b>${k4 !== Infinity ? ` или <b>${k4} × «${top - 1}»</b>` : ""}.${per === "all" && k5 > 12 ? ` За всё время оценок много, поэтому средний меняется медленно - за месяц цель ближе.` : ""}`}</p>
      ${T && !done && k5 !== Infinity ? `<div class="gplan">${chips(k5, "k5")}${k4 !== Infinity && k4 <= 30 ? `<em>или</em>${chips(k4, "k4")}` : ""}</div>` : ""}</section>`;
  }
  // цель по посещаемости: (P + k) / (T0 + k) >= T  =>  k = (T·T0 - P) / (1 - T) пар подряд без пропусков
  function attGoalHTML() {
    const g = LS.get("agoal", {}); const so = subjOptions(g.subj, "agsel", false), subj = so.subs.includes(g.subj) ? g.subj : "";
    const per = perOf(g), from = perFrom(per), all = (M.visits || []).filter(v => !subj || v.subj === subj); if (!all.length) return "";
    const V = all.filter(v => !from || v.date >= from);
    const head = `<section class="card goal"><div class="hd"><h2>${ic("check")}Цель по посещаемости</h2>${so.html}</div>${perPill("agoal", per)}`;
    if (!V.length) return head + `<p class="ghint">${perName(per)[0].toUpperCase() + perName(per).slice(1)} пар пока не было.</p></section>`;
    const T0 = V.length, P = V.filter(v => !v.miss).length, a = P / T0 * 100;
    const ppd = T0 / new Set(V.map(v => v.date)).size || 3;
    const opts = [70, 75, 80, 85, 90, 95, 97, 98, 99].filter(x => x > a + 0.01).slice(0, 3);
    const T = +g.t > 0 && +g.t < 100 ? +g.t : (opts[0] || (a >= 99.9 ? null : 99));
    const need = T ? Math.max(0, Math.ceil((T / 100 * T0 - P) / (1 - T / 100) - 1e-9)) : 0;
    const spare = T && a >= T ? Math.floor((P - T / 100 * T0) / (T / 100) + 1e-9) : 0, days = Math.ceil(need / ppd);
    return head + `<div class="gtop"><div><span class="gn num">${Math.round(a)}%</span><small>${perName(per)} · ${P} из ${T0} ${plural(T0, "пары", "пар", "пар")}</small></div>${T ? `<div class="gto"><span class="gn num">${T}%</span><small>цель</small></div>` : ""}</div>
      ${T ? `<div class="gbar"><i style="width:${a}%"></i><em style="left:${T}%"></em></div>` : ""}
      <div class="gopt">${opts.map(x => `<button data-agt="${x}" aria-pressed="${x === T}">${x}%</button>`).join("")}<label class="gown"><span>своя</span><span class="gin"><input id="agoalin" type="number" inputmode="numeric" step="1" min="50" max="99" value="${T && !opts.includes(T) ? T : ""}" placeholder="90"><em>%</em></span></label></div>
      <p class="ghint">${!T ? "Ни одного пропуска - так держать." : a >= T ? `Цель достигнута. Запас: можно пропустить ещё <b>${spare} ${plural(spare, "пару", "пары", "пар")}</b> и остаться на ${T}%.` : `Чтобы выйти на <b>${T}%</b>, нужно <b>${need} ${plural(need, "пару", "пары", "пар")} подряд без пропусков</b>${need > 0 ? ` - примерно ${days} ${plural(days, "учебный день", "учебных дня", "учебных дней")}` : ""}.${per === "all" && need > 20 ? " За всё время пар много, поэтому процент меняется медленно - за месяц цель ближе." : ""}`}</p></section>`;
  }
  /* ---------- итоги месяца ---------- */
  const MONTHS_N = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
  const MONTHS_P = ["январе", "феврале", "марте", "апреле", "мае", "июне", "июле", "августе", "сентябре", "октябре", "ноябре", "декабре"];
  const MONTHS_R = MON;
  function monthStats(ym) {
    const V = (M.visits || []).filter(v => v.date && v.date.startsWith(ym)); if (!V.length) return null;
    const marks = []; V.forEach(v => MK.forEach(k => v[k] != null && marks.push(v[k])));
    const top = SCALE > 5 ? 12 : 5, days = {};
    V.forEach(v => { const d = days[v.date] = days[v.date] || { n: 0, miss: 0, late: 0 }; d.n++; if (v.miss) d.miss++; if (v.late) d.late++; });
    let run = 0, best = 0; Object.keys(days).sort().forEach(d => { if (days[d].miss) run = 0; else { run++; best = Math.max(best, run); } });
    const subj = {}; V.forEach(v => { const o = subj[v.subj] = subj[v.subj] || { n: 0, m: [] }; o.n++; MK.forEach(k => v[k] != null && o.m.push(v[k])); });
    const often = Object.keys(subj).sort((a, b) => subj[b].n - subj[a].n)[0];
    const bestS = Object.keys(subj).filter(k => subj[k].m.length >= 3).sort((a, b) => subj[b].m.reduce((x, y) => x + y, 0) / subj[b].m.length - subj[a].m.reduce((x, y) => x + y, 0) / subj[a].m.length || subj[b].m.length - subj[a].m.length)[0];
    const hw = (M.hw || []).filter(h => h.sub && h.sub.startsWith(ym)), early = hw.filter(h => h.due).map(h => dayDiff(fromIso(h.sub), fromIso(h.due)));
    const feed = (M.feedAll || M.feed || []).filter(f => f.date.startsWith(ym) && f.plus), coins = feed.filter(f => f.kind === "coin").reduce((x, f) => x + f.amt, 0), gems = feed.filter(f => f.kind === "gem").reduce((x, f) => x + f.amt, 0);
    const miss = V.filter(v => v.miss).length, rank = LS.get("rankHist", {})[ym];
    return { ym, pairs: V.length, miss, late: V.filter(v => v.late).length, att: Math.round((V.length - miss) / V.length * 100), marks: marks.length, tops: marks.filter(x => x >= top).length, top,
      avg: marks.length ? marks.reduce((x, y) => x + y, 0) / marks.length : null, best, days, often, oftenN: often ? subj[often].n : 0, bestS, bestSAvg: bestS ? subj[bestS].m.reduce((x, y) => x + y, 0) / subj[bestS].m.length : null,
      hwN: hw.length, hwEarly: early.length ? early.reduce((x, y) => x + y, 0) / early.length : null, coins, gems, rank, dayN: Object.keys(days).length };
  }
  // день рождения: флаг журнала или дата рождения из профиля
  function isBday() { if (M.user.bday) return true; const b = (M.prof && M.prof.birth) || isoOf(M.user.birthday); return !!b && b.slice(5) === iso(new Date()).slice(5); }
  function bdayAge() { const b = (M.prof && M.prof.birth) || isoOf(M.user.birthday); if (!b) return 0; const a = new Date().getFullYear() - +b.slice(0, 4); return a > 5 && a < 100 ? a : 0; }
  function bdayHTML() {
    const first = (M.user.name || "").split(" ")[1] || "";
    const conf = Array.from({ length: 26 }, (_, i) => `<i style="left:${4 + (i * 37) % 90}%;top:${6 + (i * 53) % 84}%;--r:${(i * 47) % 360}deg;--d:${(i % 5) * .35}s" class="c${i % 4}"></i>`).join("");
    return `<section class="card bday"><div class="bd-conf" aria-hidden="true">${conf}</div><button class="x" data-act="bdaydis" aria-label="Скрыть">×</button>
      <div class="bd-cake" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="10" y="30" width="44" height="24" rx="6" fill="var(--gold)"/><path d="M10 38c6 4 10-4 15 0s9 4 14 0 9-4 15 0" stroke="#fff" stroke-opacity=".7" stroke-width="3" fill="none"/><rect x="18" y="20" width="4" height="12" rx="2" fill="#fff"/><rect x="30" y="18" width="4" height="14" rx="2" fill="#fff"/><rect x="42" y="20" width="4" height="12" rx="2" fill="#fff"/><path d="M20 14c2 2 2 4 0 5-2-1-2-3 0-5zM32 11c2 2 2 5 0 6-2-1-2-4 0-6zM44 14c2 2 2 4 0 5-2-1-2-3 0-5z" fill="#ffc861"/></svg></div>
      <div class="bd-tx"><span class="cap">${longDate(new Date())}${bdayAge() ? ` · тебе ${bdayAge()}` : ""}</span><h2>С днём рождения${first ? ", " + esc(first) : ""}!</h2><p>Пусть пары пролетают быстро, оценки радуют, а серия без пропусков не заканчивается. Хорошего дня!</p></div></section>`;
  }
  function monthsWithData() { return [...new Set((M.visits || []).map(v => v.date && v.date.slice(0, 7)).filter(Boolean))].sort(); }
  function summaryMonths() { const now = new Date(), cur = iso(now).slice(0, 7), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(); return monthsWithData().filter(m => m < cur || (m === cur && now.getDate() > dim - 3)); }
  function summaryDue() {
    const now = new Date(), cur = iso(now).slice(0, 7), dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const prev = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7), dis = LS.get("mdis", []);
    const ym = now.getDate() <= 3 ? prev : null;   // итоги прошлого месяца - с 1 по 3 число, потом карточка убирается сама
    return ym && !dis.includes(ym) && monthStats(ym) ? ym : null;
  }
  function openSummary(ym) {
    try { preCur(); } catch (e) {}
    const all = summaryMonths(); if (!all.length) { toast("Итоги появятся, когда закончится первый месяц"); return; } ym = ym && all.includes(ym) ? ym : all[all.length - 1]; const st = monthStats(ym); if (!st) { toast("За этот месяц данных пока нет"); return; }
    const [y, m] = ym.split("-").map(Number), mi = m - 1, i = all.indexOf(ym), first = (M.user.name || "").split(" ")[1] || "";
    const dim = new Date(y, m, 0).getDate(), off = (new Date(y, mi, 1).getDay() + 6) % 7;
    let heat = DSH.map(d => `<b>${d}</b>`).join("") + "<i class=\"e\"></i>".repeat(off);
    for (let d = 1; d <= dim; d++) { const k = `${ym}-${String(d).padStart(2, "0")}`, x = st.days[k]; heat += `<i class="${x ? x.miss ? (x.miss === x.n ? "mx" : "p") : x.late ? "l" : "g" : ""}" title="${d} ${MONTHS_R[mi]}${x ? " · " + pairsW(x.n) + (x.miss ? ", пропусков: " + x.miss : "") : ""}"></i>`; }
    const title = st.avg != null && st.avg >= st.top - 0.05 * (st.top / 5) ? `${MONTHS_N[mi]}<br><span class="grad">на отлично</span>` : !st.miss ? `${MONTHS_N[mi]}<br><span class="grad">без пропусков</span>` : `${MONTHS_N[mi]}<br><span class="grad">в цифрах</span>`;
    const hue = [0, 20, 40, -20, -40, 60, 30, -10, 0, 25, -30, 50][mi];
    const d = $("#dlg"); d.classList.remove("wide"); d.classList.add("sumd"); delete d.dataset.rate;
    d.innerHTML = `<div class="dlg sumdlg"><div class="sum" style="--hue:${hue}deg">
      <svg class="orn" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="sg1" cx="85%" cy="8%" r="65%"><stop offset="0" stop-color="var(--gold-hi)" stop-opacity=".5"/><stop offset="1" stop-color="var(--gold-hi)" stop-opacity="0"/></radialGradient></defs>
        <rect width="400" height="800" fill="url(#sg1)"/><g fill="none" stroke="var(--gold-hi)" stroke-opacity=".2">${[60, 100, 140, 180, 220, 260].map(r => `<circle cx="370" cy="30" r="${r}"/>`).join("")}</g>
        <g fill="#fff">${Array.from({ length: 22 }, (_, k) => `<circle cx="${(k * 97) % 400}" cy="${(k * 61) % 420 + 20}" r="${(k % 3) * .5 + .6}" opacity="${.3 + (k % 4) * .15}"/>`).join("")}</g>
        <path d="M0 700 C90 650 170 760 260 700 S370 650 400 690 L400 800 L0 800Z" fill="var(--good)" fill-opacity=".12"/><path d="M0 740 C100 700 180 790 280 740 S380 710 400 730 L400 800 L0 800Z" fill="var(--gold)" fill-opacity=".16"/></svg>
      <button class="x" data-act="close" aria-label="Закрыть">×</button>
      <div class="sum-nav">${i > 0 ? `<button data-sum="${all[i - 1]}">‹ ${MONTHS_N[+all[i - 1].slice(5) - 1]}</button>` : "<span></span>"}${i < all.length - 1 ? `<button data-sum="${all[i + 1]}">${MONTHS_N[+all[i + 1].slice(5) - 1]} ›</button>` : "<span></span>"}</div>
      <div class="cap">Дневник · итоги · ${y}</div>
      <h3>${title}</h3><p class="sub">${first ? esc(first) + ", в" : "В"} ${MONTHS_P[mi]} у тебя было ${pairsW(st.pairs)} за ${st.dayN} ${plural(st.dayN, "учебный день", "учебных дня", "учебных дней")}</p>
      ${st.avg != null ? `<div class="hero-n"><b class="num">${f2(st.avg)}</b><span>средний балл за месяц<br><em>${st.tops} из ${st.marks} ${plural(st.marks, "оценки", "оценок", "оценок")} - «${st.top}»</em></span></div>` : ""}
      <div class="stat">
        <div class="st"><b class="num">${st.att}%</b><span>посещаемость · ${st.pairs - st.miss} из ${st.pairs}</span></div>
        <div class="st"><b class="num">${st.best}</b><span>${plural(st.best, "учебный день", "учебных дня", "учебных дней")} подряд без пропусков - лучшая серия</span></div>
        <div class="st w"><div style="flex:1"><span>Календарь месяца</span><div class="heat">${heat}</div><div class="hl"><span><i class="g"></i>все пары</span><span><i class="l"></i>опоздание</span><span><i class="p"></i>частично</span><span><i class="mx"></i>пропуск</span></div></div></div>
        ${st.often ? `<div class="st"><b class="sm">${esc(st.often)}</b><span>чаще всего в расписании - ${pairsW(st.oftenN)}</span></div>` : ""}
        ${st.bestS ? `<div class="st"><b class="sm">${esc(st.bestS)}</b><span>лучший средний - ${f2(st.bestSAvg)}</span></div>` : ""}
        ${st.hwN ? `<div class="st"><b class="num">${st.hwN}</b><span>${plural(st.hwN, "задание сдано", "задания сдано", "заданий сдано")}${st.hwEarly != null ? (st.hwEarly < 0 ? `, в среднем через ${f1(-st.hwEarly)} дн. после срока` : `, в среднем за ${f1(st.hwEarly)} дн. до срока`) : ""}</span></div>` : ""}
        ${st.coins || st.gems ? `<div class="st"><b class="num">+${st.coins}<span class="coin"></span> +${st.gems}<span class="gem"></span></b><span>начислено за месяц</span></div>` : ""}
        ${M.groupPlace ? `<div class="st w place"><span class="em">${ic("trophy", "i big")}</span><div class="col"><b style="font-size:20px">${st.rank && st.rank.last ? st.rank.last : M.groupPlace} место в группе</b><span>(по коинам и гемам)</span></div></div>` : ""}
      </div>
      <button class="sum-dl" data-act="sumpng" data-ym="${ym}">${ic("download")}Сохранить картинкой</button>
      <p class="sum-foot">Всё посчитано по данным журнала</p></div></div>`;
    if (!d.open) d.showModal();
  }
  // итоги месяца картинкой 1080×1350 (для сторис и сообщений)
  // значки валюты для картинки: пиксельные (из стилей Дневника) или обычные монета и кристалл
  const curImg = {};
  function preCur() { if (curImg.coin) return; ["coin", "gem"].forEach(k => { const m = DN_CSS.match(k === "coin" ? /\.dn\[data-mc=true\] \.coin,[^{]*\{[^}]*url\((data:image\/png;base64,[^)]+)\)/ : /\.dn\[data-mc=true\] \.gem\{background-image:url\((data:image\/png;base64,[^)]+)\)/); if (m) { const im = new Image(); im.src = m[1]; curImg[k] = im; }
    const j = DN_CSS.match(k === "coin" ? /\.dn:not\(\[data-mc=true\]\) \.coin,[^{]*\{[^}]*url\((data:image\/svg\+xml;base64,[^)]+)\)/ : /\.dn:not\(\[data-mc=true\]\) \.gem\{background-image:url\((data:image\/svg\+xml;base64,[^)]+)\)/); if (j) { const im = new Image(); im.src = j[1]; curImg["j" + k] = im; } }); }
  function curIcon(g, k, x, y, sz) {
    const im = curImg[k]; if (cfg.mc && im && im.complete && im.naturalWidth) { g.imageSmoothingEnabled = false; g.drawImage(im, x, y, sz, sz); g.imageSmoothingEnabled = true; return; }
    const jm = curImg["j" + k]; if (!cfg.mc && jm && jm.complete && jm.naturalWidth) { g.drawImage(jm, x, y, sz, sz); return; }
    if (k === "coin") { const gr = g.createRadialGradient(x + sz * .35, y + sz * .35, 1, x + sz / 2, y + sz / 2, sz / 2); gr.addColorStop(0, "#f3d48f"); gr.addColorStop(1, "#b7862e"); g.fillStyle = gr; g.beginPath(); g.arc(x + sz / 2, y + sz / 2, sz / 2, 0, Math.PI * 2); g.fill(); return; }
    const gr = g.createLinearGradient(x, y, x + sz, y + sz); gr.addColorStop(0, "#8fe0b8"); gr.addColorStop(1, "#2a9a70"); g.fillStyle = gr; g.beginPath(); g.moveTo(x + sz / 2, y); g.lineTo(x + sz, y + sz * .38); g.lineTo(x + sz / 2, y + sz); g.lineTo(x, y + sz * .38); g.closePath(); g.fill();
  }
  function sumPNG(ym) {
    const st = monthStats(ym); if (!st) return;
    const [y, m] = ym.split("-").map(Number), mi = m - 1, W0 = 1080, X = 80;
    const acc = (ACC_HEX[cfg.accent] || ACC_HEX.gold)[0], good = "#56c596", bad = "#e0679e", warn = "#e9cf7a", ink = "#f2f2f2", mut = "#9a9aa2";
    const F = (w, px) => `${w} ${px}px DnBody, Calibri, Carlito, "Segoe UI", -apple-system, Arial, sans-serif`;
    // [значение, подпись, цвет, текстовое значение (название предмета)]
    const tiles = [[st.att + "%", `посещаемость · ${st.pairs - st.miss} из ${st.pairs}`, good], [String(st.best), plural(st.best, "день", "дня", "дней") + " подряд без пропусков"]];
    if (st.avg == null) tiles.push([String(st.marks), plural(st.marks, "оценка", "оценки", "оценок")]);
    if (st.hwN) tiles.push([String(st.hwN), plural(st.hwN, "задание сдано", "задания сдано", "заданий сдано") + (st.hwEarly != null ? (st.hwEarly < 0 ? ` · через ${f1(-st.hwEarly)} дн. после срока` : ` · за ${f1(st.hwEarly)} дн. до срока`) : "")]);
    if (st.coins || st.gems) { const t = ["", "начислено за месяц"]; t.cur = 1; tiles.push(t); }
    if (M.groupPlace) { const r = st.rank || {}, t = [String(r.last || M.groupPlace), "место в группе (по коинам и гемам)", null]; t.center = 1; tiles.push(t); }
    if (st.often) tiles.push([st.often, `чаще всего в расписании · ${pairsW(st.oftenN)}`, null, 1]);
    if (st.bestS) tiles.push([st.bestS, `лучший средний · ${f2(st.bestSAvg)}`, null, 1]);
    // числа - по две в ряд (нечётное последнее - во всю ширину), названия предметов - всегда во всю ширину
    { const nums = tiles.filter(t => !t[3]); if (nums.length % 2) nums[nums.length - 1].wide = 1; tiles.forEach(t => { if (t[3]) t.wide = 1; }); }
    const dim = new Date(y, m, 0).getDate(), off = (new Date(y, mi, 1).getDay() + 6) % 7, rows = Math.ceil((off + dim) / 7), gap = 12, cw = (W0 - 2 * X - 6 * gap) / 7, ch = 58, th = 150;
    let tRows = 0; { let col = 0; tiles.forEach(t => { if (t.wide) { if (col) tRows++; tRows++; col = 0; } else { col++; if (col === 2) { tRows++; col = 0; } } }); if (col) tRows++; }
    const H0 = 120 + 96 + 58 + (st.avg != null ? 170 : 0) + 56 + tRows * (th + 24) - 24 + 66 + 22 + rows * (ch + gap) - gap + 110;
    const c = document.createElement("canvas"); c.width = W0; c.height = H0; const g = c.getContext("2d");
    const box = (x, yy, w, h, r) => { g.beginPath(); if (g.roundRect) g.roundRect(x, yy, w, h, r); else g.rect(x, yy, w, h); };
    const fit = (t, w, px, wt) => { let f = px; g.font = F(wt, f); while (g.measureText(t).width > w && f > 30) { f -= 2; g.font = F(wt, f); } if (g.measureText(t).width > w) { while (t.length > 3 && g.measureText(t + "…").width > w) t = t.slice(0, -1); t += "…"; } return t; };
    let gr = g.createLinearGradient(0, 0, W0, H0); gr.addColorStop(0, "#050505"); gr.addColorStop(1, "#111111"); g.fillStyle = gr; g.fillRect(0, 0, W0, H0);
    const rg = g.createRadialGradient(W0 - 90, 70, 10, W0 - 90, 70, 760); rg.addColorStop(0, acc + "70"); rg.addColorStop(1, acc + "00"); g.fillStyle = rg; g.fillRect(0, 0, W0, H0);
    // второй свет снизу, кольца, звёзды и волны внизу - как в окне итогов
    { const a2 = { gold: "#e66e32", sapphire: "#14bee6", emerald: "#3cc85a", amethyst: "#ec488c", rose: "#7c5cff", graphite: "#6e7382" }[cfg.accent] || "#ec488c";
      const r2 = g.createRadialGradient(80, H0 - 80, 10, 80, H0 - 80, 820); r2.addColorStop(0, a2 + "40"); r2.addColorStop(1, a2 + "00"); g.fillStyle = r2; g.fillRect(0, 0, W0, H0);
      g.strokeStyle = acc + "26"; g.lineWidth = 2; for (let r = 140; r <= 740; r += 100) { g.beginPath(); g.arc(W0 - 70, 50, r, 0, Math.PI * 2); g.stroke(); }
      g.fillStyle = "#fff"; for (let k = 0; k < 60; k++) { g.globalAlpha = .15 + (k % 5) * .1; g.beginPath(); g.arc((k * 977) % W0, (k * 613) % (H0 * .55), (k % 3) * .6 + .8, 0, Math.PI * 2); g.fill(); } g.globalAlpha = 1;
      [[acc, .16, 0], [a2, .14, 40]].forEach(([c, o, d]) => { g.globalAlpha = o; g.fillStyle = c; g.beginPath(); g.moveTo(0, H0 - 60 + d / 2); g.bezierCurveTo(W0 * .3, H0 - 120 + d / 2, W0 * .6, H0 - 10, W0, H0 - 80 + d / 2); g.lineTo(W0, H0); g.lineTo(0, H0); g.closePath(); g.fill(); }); g.globalAlpha = 1;
      g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 3; box(14, 14, W0 - 28, H0 - 28, 56); g.stroke(); }
    const first = (M.user.name || "").split(" ")[1] || "";
    let Y = 120; g.textBaseline = "alphabetic";
    g.fillStyle = acc; g.font = F(700, 28); g.fillText(`ДНЕВНИК · ИТОГИ ${y}`, X, Y);
    Y += 96; g.fillStyle = ink; g.font = F(700, 96); g.fillText(MONTHS_N[mi][0].toUpperCase() + MONTHS_N[mi].slice(1), X, Y);
    Y += 58; g.fillStyle = mut; g.fillText(fit(`${first ? first + ", в" : "В"} ${MONTHS_P[mi]} - ${pairsW(st.pairs)} за ${st.dayN} ${plural(st.dayN, "учебный день", "учебных дня", "учебных дней")}`, W0 - 2 * X, 34, 400), X, Y);
    if (st.avg != null) { Y += 170; const t = f2(st.avg); g.fillStyle = ink; g.font = F(700, 160); g.fillText(t, X - 6, Y); const w = g.measureText(t).width;
      g.fillStyle = mut; g.font = F(400, 32); g.fillText("средний балл за месяц", X + w + 34, Y - 62); g.fillStyle = good; g.font = F(700, 32); g.fillText(`${st.tops} из ${st.marks} - «${st.top}»`, X + w + 34, Y - 16); }
    Y += 56; const tw = (W0 - 2 * X - 24) / 2; let col = 0;
    tiles.forEach(t => { const w = t.wide ? W0 - 2 * X : tw; if (t.wide && col) { Y += th + 24; col = 0; }
      const tx = X + col * (tw + 24);
      { const tg = g.createLinearGradient(0, Y, 0, Y + th); tg.addColorStop(0, "rgba(255,255,255,.075)"); tg.addColorStop(1, "rgba(255,255,255,.025)"); g.fillStyle = tg; } box(tx, Y, w, th, 32); g.fill(); g.strokeStyle = "rgba(255,255,255,.12)"; g.lineWidth = 2; g.stroke();
      if (t.cur) { let x0 = tx + 30; g.font = F(700, 56); [[st.coins || 0, "coin"], [st.gems || 0, "gem"]].forEach(([n, k]) => { const v = "+" + n; g.fillStyle = ink; g.fillText(v, x0, Y + 80); x0 += g.measureText(v).width + 10; curIcon(g, k, x0, Y + 38, 42); x0 += 42 + 30; }); }
      else { g.fillStyle = t[2] || ink; const v = fit(t[0], w - 60, t[3] ? 46 : 62, 700); if (t.center) { const vw = g.measureText(v).width, iw = 46, x0 = tx + w / 2 - (iw + 16 + vw) / 2;
          g.save(); g.translate(x0, Y + 32); g.scale(iw / 24, iw / 24); g.strokeStyle = acc; g.lineWidth = 2; g.lineCap = "round"; g.lineJoin = "round"; g.stroke(new Path2D("M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3")); g.restore();
          g.fillText(v, x0 + iw + 16, Y + 82); } else g.fillText(v, tx + 30, Y + (t[3] ? 76 : 82)); }
      g.fillStyle = mut; { const l = fit(t[1], w - 60, 26, 400); if (t.center) { g.textAlign = "center"; g.fillText(l, tx + w / 2, Y + 124); g.textAlign = "left"; } else g.fillText(l, tx + 30, Y + 124); }
      if (t.wide) { Y += th + 24; col = 0; } else if (++col === 2) { Y += th + 24; col = 0; } });
    if (col) Y += th + 24;
    Y += 42; g.fillStyle = mut; g.font = F(700, 24); g.fillText("КАЛЕНДАРЬ МЕСЯЦА", X, Y);
    { let lx = W0 - X; g.font = F(400, 22); [["пропуск", bad], ["частично", bad + "88"], ["опоздание", warn], ["все пары", good]].forEach(([t, cl]) => { const w = g.measureText(t).width; lx -= w; g.fillStyle = mut; g.fillText(t, lx, Y); lx -= 26; g.fillStyle = cl; box(lx, Y - 17, 16, 16, 5); g.fill(); lx -= 22; }); }
    Y += 22;
    for (let d = 1; d <= dim; d++) { const k = off + d - 1, cx = X + (k % 7) * (cw + gap), cy = Y + Math.floor(k / 7) * (ch + gap), x = st.days[`${ym}-${String(d).padStart(2, "0")}`];
      g.fillStyle = !x ? "rgba(255,255,255,.04)" : x.miss ? (x.miss === x.n ? bad : bad + "88") : x.late ? warn : good; box(cx, cy, cw, ch, 14); g.fill();
      g.fillStyle = x && !(x.miss && x.miss < x.n) ? "#0b0b0b" : mut; g.font = F(700, 24); g.fillText(String(d), cx + 16, cy + ch / 2 + 9); }
    g.fillStyle = mut; g.font = F(400, 24); g.fillText("Всё посчитано по данным журнала · Дневник", X, H0 - 50);
    const url = c.toDataURL("image/png"), name = `itogi-${ym}.png`;
    // на телефоне и планшете - меню «Поделиться» (можно сохранить в Фото), на компьютере - обычная загрузка
    try { const bin = atob(url.split(",")[1]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], name, { type: "image/png" });
      const touch = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
      if (touch && navigator.canShare && navigator.canShare({ files: [file] })) { navigator.share({ files: [file] }).catch(() => {}); return; } } catch (e) {}
    const a = document.createElement("a"); a.href = url; a.download = name; (document.body || document.documentElement).appendChild(a); a.click(); setTimeout(() => a.remove(), 1500); toast("Картинка сохранена");
  }
  VIEWS.grades = s => {
    const V = M.visits || [];
    const subjStats = {}; V.forEach(v => { const o = subjStats[v.subj] = subjStats[v.subj] || { n: 0, miss: 0, m: [] }; o.n++; if (v.miss) o.miss++; ["hw", "cw", "lab", "ctrl", "prac"].forEach(k => v[k] != null && o.m.push(v[k])); });
    const keys = Object.keys(subjStats).sort((a, b) => subjStats[b].n - subjStats[a].n);
    const weeks = {}; V.forEach(v => { const k = iso(mondayOf(fromIso(v.date))); (weeks[k] = weeks[k] || { p: 0, x: 0 }); v.miss ? weeks[k].x++ : weeks[k].p++; });
    const wk = Object.keys(weeks).sort().slice(-6).map(k => ({ mon: fromIso(k), ...weeks[k] })); const wmax = Math.max(1, ...wk.map(w => w.p + w.x));
    const calYms = [...new Set(V.map(v => v.date.slice(0, 7)))].sort(); if (!calYm || !calYms.includes(calYm)) calYm = calYms[calYms.length - 1] || iso(new Date()).slice(0, 7);
    const ci = calYms.indexOf(calYm), y = +calYm.slice(0, 4), mo = +calYm.slice(5, 7) - 1, first = new Date(y, mo, 1), off = (first.getDay() + 6) % 7, dim = new Date(y, mo + 1, 0).getDate(), now = new Date();
    const byDay = {}; V.forEach(v => { const d = fromIso(v.date); if (d.getMonth() === mo && d.getFullYear() === y) (byDay[d.getDate()] = byDay[d.getDate()] || []).push(v); });
    let cal = DSH.map(d => `<div class="wd">${d}</div>`).join("") + `<div class="c blank"></div>`.repeat(off);
    for (let w = mondayOf(first); w <= new Date(y, mo, dim); w = dayDate(w, 7)) if (!M.schedule[iso(w)] || !(M.schedLive && M.schedLive[iso(w)])) ensureWeek(w);
    for (let d = 1; d <= dim; d++) { const ls = byDay[d] || [], any = ls.some(x => x.miss), dt = new Date(y, mo, d), plan = (M.schedule[iso(dt)] || []).length, n = Math.max(ls.length, plan), fut = dt > now && !sameDay(dt, now);
      // отметки посещений + пары по расписанию, которые ещё не отмечены (серые) или впереди (пунктир)
      const lateD = !any && ls.some(x => x.late);
      const bars = ls.map(x => `<i class="${x.miss ? "x" : x.late ? "l" : ""}"></i>`).join("") + `<i class="${fut ? "p" : "u"}"></i>`.repeat(n - ls.length);
      cal += `<div class="c ${ls.length ? "has" : ""} ${any ? "part" : ""} ${lateD ? "lt" : ""} ${!ls.length && dt > now ? "fut" : ""}" title="${n ? pairsW(n) + (ls.length < n ? ` · отмечено ${ls.length}` : "") + (any ? ", есть пропуски" : "") + (lateD ? ", опоздание" : "") : ""}"><span class="num">${d}</span><span class="bars">${bars}</span></div>`; }
    return `
    ${summaryMonths().length ? `<div class="card hint">${ic("star")}<div><b>Итоги месяца</b><span>Оценки, посещаемость, серии и календарь - за каждый месяц</span></div><button class="m-btn pri" data-act="month">Открыть</button></div>` : ""}
    <div class="row r4">
      <div class="card kpi"><div class="lab">${ic("star")}Средний балл</div><div class="val num">${s.marks ? f2(s.avg) : "-"}</div><div class="sub">${s.allTop ? `все <b class="num">${s.marks}</b> оценок - «${s.maxMark}»` : `за всё время · <b class="num">${s.marks}</b> ${plural(s.marks, "оценка", "оценки", "оценок")}`}</div></div>
      <div class="card kpi"><div class="lab">${ic("hw")}За домашние</div><div class="val num">${s.hwN}</div><div class="sub">оценок за ДЗ</div></div>
      <div class="card kpi"><div class="lab">${ic("users")}За работу на паре</div><div class="val num">${s.cwN}</div><div class="sub">оценок за классную работу${s.otherN ? `<span class="oth">${["lab", "ctrl", "prac", "fin"].map(k => [k, (M.visits || []).filter(v => v[k] != null).length]).filter(x => x[1]).map(([k, n]) => `<span><i class="mark5 ${k} sw"></i>${MK_N[k]}: <b class="num">${n}</b></span>`).join("")}</span>` : ""}</div></div>
      <div class="card kpi"><div class="lab">${ic("check")}Пропуски</div><div class="val num">${s.miss}<small>из ${s.total}</small></div><div class="sub">${s.late ? `опозданий <b class="num">${s.late}</b>` : "опозданий нет"}</div></div>
    </div>
    ${cfg.goals === false ? "" : `<div class="row r2 goals">${goalHTML()}${attGoalHTML()}</div>`}
    ${pairsHTML(V, keys)}
    <div class="row r2 calrow">
      <div class="card calc"><div class="hd"><h2>${MONN[mo]} по дням</h2>${calYms.length > 1 ? `<div class="calnav"><button class="hc-ar" data-calm="-1" ${ci <= 0 ? "disabled" : ""} aria-label="Предыдущий месяц">‹</button><button class="hc-ar" data-calm="1" ${ci >= calYms.length - 1 ? "disabled" : ""} aria-label="Следующий месяц">›</button></div>` : ""}</div><div class="cal">${cal}</div><div class="legend"><span><i style="background:var(--good)"></i>Все пары</span><span><i style="background:var(--late)"></i>Опоздание</span><span><i style="background:var(--bad)"></i>Пропуск</span><span><i style="background:#4a4a52"></i>Нет отметки / впереди</span></div></div>
      <div class="card wkc"><div class="hd"><h2>Посещаемость по неделям</h2><small>доля посещённых пар</small></div>
        <div class="wkchart2">${wk.map(w => { const t = w.p + w.x, pc = t ? Math.round(w.p / t * 100) : 0; return `<div class="col" title="Был на ${w.p}, пропустил ${w.x}"><b class="num wk-pc ${attCls(pc)}">${pc}%</b><small class="num wk-n">${w.p} из ${t}</small><div class="tr"><i style="height:${pc}%;--z:var(--${pc < 70 ? "bad" : pc < 90 ? "warn" : "good"})"></i></div><span class="num dt">${dm(w.mon)} - ${dm(dayDate(w.mon, 6))}</span></div>`; }).join("")}</div>
        <div class="legend"><span><i style="background:var(--good)"></i>от 90%</span><span><i style="background:var(--warn)"></i>70-89%</span><span><i style="background:var(--bad)"></i>ниже 70%</span></div></div>
    </div>
    ${avgChartHTML(s)}
    <div class="card"><div class="hd"><h2>По предметам</h2><small>по данным журнала</small></div>
      <div class="tscroll"><table class="t"><thead><tr><th>Предмет</th><th class="r">Пар</th><th class="r">Оценок</th><th class="r"><span class="lg">Средний</span><span class="sh">Ср.</span></th><th class="r"><span class="lg">Посещаемость</span><span class="sh">Посещ.</span></th></tr></thead><tbody>
      ${keys.map(k => { const o = subjStats[k], a = Math.round((o.n - o.miss) / o.n * 100), av = o.m.length ? o.m.reduce((x, y) => x + y, 0) / o.m.length : null; return `<tr><td><span class="tag s-${subjKey(k)}">${esc(k)}</span></td><td class="r num">${o.n}</td><td class="r num">${o.m.length}</td><td class="r num">${av != null ? f1(av) : "-"}</td><td class="r num ${attCls(a)}">${a}%</td></tr>`; }).join("")}
      </tbody></table></div></div>`;
  };
  const MSH = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  let avgMode = null, avgW = 900, avgFocus = "both", lbMode = LS.get("lb", "group");
  // график рисуется точно под ширину карточки, чтобы текст не сжимался
  let avgRO = null;
  function fitAvg() { const c = R && R.querySelector(".avgc"); if (!c) return; const w = Math.round(c.clientWidth - 36);
    if (w > 120 && Math.abs(w - avgW) > 6) { avgW = w; c.outerHTML = avgChartHTML(stats()); }
    const pg = R.querySelector("#page"); if (typeof ResizeObserver === "function" && pg && !avgRO) { let t; avgRO = new ResizeObserver(() => { clearTimeout(t); t = setTimeout(fitAvg, 150); }); avgRO.observe(pg); } }
  // два графика в одном: средний балл (левая шкала) и посещаемость в % (правая шкала)
  function avgChartHTML(s) {
    const V = M.visits || [];
    const mean = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
    const bucket = keyOf => { const b = {}; V.forEach(v => { const k = keyOf(v); const o = b[k] = b[k] || { m: [], n: 0, x: 0 }; o.n++; if (v.miss) o.x++; MK.forEach(m => v[m] != null && o.m.push(v[m])); }); return b; };
    const byM = bucket(v => v.date.slice(0, 7)), byW = bucket(v => iso(mondayOf(fromIso(v.date))));
    const apiM = {}; (M.avg || []).forEach(x => { if (x.v > 0 && x.v <= 12) apiM[x.date.slice(0, 7)] = x.v; });
    const apiA = {}; (M.attChart || []).forEach(x => { if (x.v > 0) apiA[x.date.slice(0, 7)] = x.v; });
    const months = Object.keys(byM).sort().slice(-8);
    const mode = avgMode || (months.length >= 3 ? "month" : "week");
    const keys = mode === "month" ? months : Object.keys(byW).sort().slice(-6), B = mode === "month" ? byM : byW;
    const pts = keys.map(k => { const o = B[k];
      return { lab: mode === "month" ? MSH[+k.slice(5, 7) - 1] : dm(fromIso(k)), g: mode === "month" && apiM[k] != null ? apiM[k] : mean(o.m), a: mode === "month" && apiA[k] != null ? apiA[k] : o.n ? (o.n - o.x) / o.n * 100 : null }; });
    const head = `<div class="hd"><h2>Средние показатели</h2><div class="pill" role="group"><button data-am="week" aria-pressed="${mode === "week"}">Недели</button><button data-am="month" aria-pressed="${mode === "month"}">Месяцы</button></div></div>`;
    if (!pts.length) return `<section class="card avgc">${head}<p class="note">Данных пока нет - график появится после первых пар.</p></section>`;
    const gv = pts.map(p => p.g).filter(x => x != null), av = pts.map(p => p.a).filter(x => x != null);
    // шкалы подобраны так, что у обеих ровно 6 делений и сетка общая: балл 2,5-5 (или 2-12), посещаемость 0-100%
    const big = s.scale > 5, gLo = big ? 2 : 2.5, gTop = big ? 12 : 5;
    const Wd = Math.max(240, avgW), H = avgW < 420 ? 200 : 240, L = 34, Rr = 44, T = 14, Bt = 28, ih = H - T - Bt;
    const X = i => pts.length === 1 ? (L + Wd - Rr) / 2 : L + 14 + i * (Wd - L - Rr - 28) / (pts.length - 1);
    const Yg = v => T + (gTop - Math.max(gLo, Math.min(gTop, v))) / (gTop - gLo) * ih, Ya = v => T + (100 - Math.max(0, Math.min(100, v))) / 100 * ih;
    let grid = ""; for (let i = 0; i <= 5; i++) { const y = T + i * ih / 5, g = gTop - i * (gTop - gLo) / 5;
      grid += `<line class="gl" x1="${L}" x2="${Wd - Rr}" y1="${y}" y2="${y}"/><text class="ax g" x="${L - 8}" y="${y + 4}" text-anchor="end">${big ? g : String(g).replace(".", ",")}</text><text class="ax a" x="${Wd - Rr + 8}" y="${y + 4}">${100 - i * 20}%</text>`; }
    const qa = pts.map((p, i) => p.a != null ? [X(i), Ya(p.a), p.a] : null).filter(Boolean), qg = pts.map((p, i) => p.g != null ? [X(i), Yg(p.g), p.g] : null).filter(Boolean);
    // плавная линия через точки (кривые Безье по соседям), без заливки под ней
    const cy = y => Math.min(T + ih, Math.max(T, y)).toFixed(1);   // кривая не выходит за шкалу
    const line = q => q.map((p, i) => { if (!i) return `M${p[0]},${p[1]}`; const a = q[i - 2] || q[i - 1], b = q[i - 1], c = p, d = q[i + 1] || p, k = .18;
      const y1 = cy(b[1] + (c[1] - a[1]) * k), y2 = cy(c[1] - (d[1] - b[1]) * k);
      return `C${(b[0] + (c[0] - a[0]) * k).toFixed(1)},${Math.abs(b[1] - c[1]) < .5 ? b[1] : y1} ${(c[0] - (d[0] - b[0]) * k).toFixed(1)},${Math.abs(b[1] - c[1]) < .5 ? c[1] : y2} ${c[0]},${c[1]}`; }).join("");
    let body = "";
    if (qa.length > 1) body += `<path class="ln" stroke="var(--att)" style="color:var(--att)" d="${line(qa)}"/>`;
    if (qg.length > 1) body += `<path class="ln" stroke="var(--gcol)" style="color:var(--gcol)" d="${line(qg)}"/>`;
    const la = qa[qa.length - 1], lg = qg[qg.length - 1];
    // подписи последних значений: верхняя - над точкой, нижняя - под точкой
    const aTop = la && lg ? la[1] <= lg[1] : true;
    if (la) body += `<circle cx="${la[0]}" cy="${la[1]}" r="4.5" fill="var(--att)" stroke="var(--surface)" stroke-width="2"/><text class="vl" x="${la[0] - 6}" y="${aTop ? la[1] - 10 : la[1] + 19}" text-anchor="end">${Math.round(la[2])}%</text>`;
    if (lg) body += `<circle cx="${lg[0]}" cy="${lg[1]}" r="4.5" fill="var(--gcol)" stroke="var(--surface)" stroke-width="2"/><text class="vl" x="${lg[0] - 6}" y="${aTop ? lg[1] + 19 : lg[1] - 10}" text-anchor="end">${f2(lg[2])}</text>`;
    const xl = pts.map((p, i) => `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${p.lab}</text>`).join("");
    const lastG = gv.length ? gv[gv.length - 1] : null, lastA = av.length ? av[av.length - 1] : null;
    const dG = gv.length > 1 ? lastG - gv[gv.length - 2] : null, dA = av.length > 1 ? lastA - av[av.length - 2] : null;
    // изменение - нейтральное: рост при низкой посещаемости не должен выглядеть «хорошо»
    const tr = (d, f) => d == null ? "" : ` <small class="dlt">${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${f(Math.abs(d))} за ${mode === "month" ? "месяц" : "неделю"}</small>`;
    return `<section class="card avgc">${head}
      <div class="avg-kpis"><span><i style="background:var(--gcol)"></i>Средний балл за ${mode === "month" ? "месяц" : "неделю"}<b class="num">${lastG != null ? f2(lastG) : "-"}</b>${tr(dG, f2)}</span><span><i style="background:var(--att)"></i>Посещаемость за ${mode === "month" ? "месяц" : "неделю"}<b class="num ${attCls(lastA)}">${lastA != null ? Math.round(lastA) + "%" : "-"}</b>${tr(dA, x => Math.round(x) + "%")}</span></div>
      <svg viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="xMidYMid meet" style="height:${H}px" role="img" aria-label="Средний балл и посещаемость">${grid}${body}${xl}</svg>
      <div class="legend"><span><i style="background:var(--gcol)"></i>средний балл - левая шкала</span><span><i style="background:var(--att)"></i>посещаемость - правая шкала</span></div></section>`;
  }
  // «Все пары»: выбранный месяц и неделя; показывается одна неделя, недели листаются пальцем (прокрутка со «щелчком»)
  let gp = { ym: null, wk: null };
  function pairsHTML(V, keys) {
    if (!V.length) return `<div class="card"><div class="hd"><h2>Все пары</h2></div><p class="note">Пока нет данных о парах</p></div>`;
    const yms = [...new Set(V.map(v => v.date.slice(0, 7)))].sort().reverse();
    if (!gp.ym || !yms.includes(gp.ym)) gp.ym = yms[0];
    const inM = V.filter(v => v.date.slice(0, 7) === gp.ym);
    const wks = [...new Set(inM.map(v => iso(mondayOf(fromIso(v.date)))))].sort();
    if (!gp.wk || !wks.includes(gp.wk)) gp.wk = wks[wks.length - 1];
    wks.forEach(w => { if (M.schedule[w] === undefined) ensureWeek(fromIso(w)); });
    const slots = Math.min(7, Math.max(3, ...V.filter(v => wks.includes(iso(mondayOf(fromIso(v.date))))).map(v => v.ln + 1), ...inM.map(v => lessonsOn(fromIso(v.date)).length)));
    const mk = v => MK.filter(k => v[k] != null).map(k => `<span class="mark5 ${k} ${vClass(v[k])}" title="${MK_N[k]}">${v[k]}</span>`).join("");
    const card = v => `<button class="pc2 ${v.miss ? "x" : v.late ? "l" : ""} ${isNew("grades", vKey(v)) ? "isnew" : ""}" style="--col:${Math.min(slots, v.ln + 1)}" data-g="${v.n}" data-subj="${esc(v.subj)}" data-m="${MK.some(k => v[k] != null) ? 1 : 0}" data-x="${v.miss ? 1 : 0}" title="${esc(v.subj)}${v.miss ? " · пропуск" : v.late ? " · опоздание" : ""}">
      <span class="pb"><span class="pn num">${v.ln + 1} пара<i></i>№${v.n}</span><span class="ps">${esc(v.subj)}</span></span><span class="pm">${mk(v)}</span></button>`;
    const weekStat = w => { const L = V.filter(v => iso(mondayOf(fromIso(v.date))) === w); return { n: L.length, x: L.filter(v => v.miss).length, m: L.reduce((a, v) => a + MK.filter(k => v[k] != null).length, 0) }; };
    const mv = cfg.gpv === "month";
    const page = w => { const L = (mv ? inM : V).filter(v => iso(mondayOf(fromIso(v.date))) === w), days = [...new Set(L.map(v => v.date))].sort();
      return `<div class="gpage" data-w="${w}">${days.map(d => { const dt = fromIso(d); return `<div class="gday${d === iso(new Date()) ? " td" : ""}"><h4 class="num">${dm(dt)}<span>${DSH[(dt.getDay() + 6) % 7].toLowerCase()}</span></h4><div class="grow2" style="--slots:${slots}">${(() => { const dl = L.filter(v => v.date === d).sort((a, b) => a.ln - b.ln), um = unmarked(d, dl), mx = Math.min(slots - 1, Math.max(...dl.map(v => v.ln), ...um.map(u => u.ln)));
        let h = ""; for (let ln = 0; ln <= mx; ln++) { const here = dl.filter(v => Math.min(slots, v.ln + 1) === ln + 1), u = um.find(x => x.ln === ln);
          h += here.length ? here.map(card).join("") : u ? `<div class="pc0 u s-${subjKey(u.subj)}" style="--col:${ln + 1}"><span>${ln + 1} пара · ${esc(u.start)}</span><b>${esc(subjShort(u.subj))}</b> · нет отметки в журнале</div>` : `<div class="pc0" style="--col:${ln + 1}"><span>${ln + 1} пара</span>пары не было</div>`; } return h; })()}</div></div>`; }).join("")}</div>`; };
    const st = weekStat(gp.wk), wEnd = w => dm(dayDate(fromIso(w), 6));
    const legend = MK.filter(k => k === "hw" || k === "cw" || inM.some(v => v[k] != null)).map(k => `<span><span class="mark5 ${k} sw"></span>${MK_N[k]}</span>`).join("") + `<span class="stl"><b style="background:var(--bad)"></b>Пропуск</span><span class="stl"><b style="background:var(--late)"></b>Опоздание</span>`;
    return `<div class="card gpairs"><div class="hd"><h2>Все пары</h2><select class="sel" id="gym">${yms.map(m => `<option value="${m}" ${m === gp.ym ? "selected" : ""}>${MONN[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`).join("")}</select></div>
      ${mv ? "" : `<div class="gtabs" role="tablist">${wks.map((w, i) => `<button role="tab" data-gw="${w}" aria-pressed="${w === gp.wk}"><b>Неделя ${i + 1}</b><small class="num">${dm(fromIso(w))} - ${wEnd(w)}</small></button>`).join("")}</div>`}
      <div class="gfbar"><div class="legend gleg">${legend}</div>
        <span class="gflt"><span class="pill" role="group">${[["all", "Все"], ["marks", "С оценками"], ["miss", "Пропуски"]].map(([k, n]) => `<button data-gm="${k}" aria-pressed="${gf.mode === k}">${n}</button>`).join("")}</span>
        <select class="sel" id="gsubj"><option value="">Все предметы</option>${keys.map(k => `<option value="${esc(k)}" ${gf.subj === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></span></div>
      ${mv ? "" : `<div class="gsum"><span id="gsum"><b class="num">${dm(fromIso(gp.wk))} - ${wEnd(gp.wk)}</b> · ${pairsW(st.n)} · пропусков <b class="num ${st.x ? "stat-bad" : ""}">${st.x}</b> · оценок <b class="num">${st.m}</b></span></div>`}
      ${mv ? monthTiles(inM)       : `<div class="gpager" id="gpager">${wks.map(page).join("")}</div>
      ${wks.length > 1 ? `<div class="gdots">${wks.map(w => `<i class="${w === gp.wk ? "on" : ""}"></i>`).join("")}</div><div class="gswipe">смахни, чтобы перейти к другой неделе</div>` : ""}`}</div>`;
  }
  function unmarked(d, dl) {
    const now = Date.now(), sch = lessonsOn(fromIso(d)).filter(l => l.end && atTime(d, l.end).getTime() < now), extra = sch.length - dl.length; if (extra <= 0) return [];   // только уже прошедшие пары
    const pi = pairIndex(), lns = new Set(dl.map(v => v.ln));
    let L = sch.map(l => ({ ln: pi(l.start), subj: l.subj, start: l.start })).filter(x => x.ln >= 0 && !lns.has(x.ln));
    if (L.length !== extra) L = sch.slice(-extra).map(l => ({ ln: pi(l.start), subj: l.subj, start: l.start }));
    return L;
  }
  // все пары за месяц плиткой, как в дневнике журнала: свежие дни сверху, каждый день - своя рамка с датой, пары внутри по порядку.
  // Оценки - кружками, пропуск/опоздание - отдельной меткой в углу, чтобы не путались с оценками
  function monthTiles(L) {
    const days = [...new Set(L.map(v => v.date))].sort().reverse(), td = iso(new Date());
    const mk = v => MK.filter(k => v[k] != null).map(k => `<span class="mark5 ${k} ${vClass(v[k])}" title="${MK_N[k]}">${v[k]}</span>`).join("");
    // Н/О - отдельная метка; если за пару с пропуском всё же стоит оценка, остаётся только цветная рамка
    const tile = v => { const has = MK.some(k => v[k] != null), lab = "";
      return `<button class="mt s-${subjKey(v.subj)} ${v.miss ? "x" : v.late ? "l" : ""} ${isNew("grades", vKey(v)) ? "isnew" : ""}" data-g="${v.n}" data-subj="${esc(v.subj)}" data-m="${has ? 1 : 0}" data-x="${v.miss ? 1 : 0}" title="${esc(v.subj)} · ${v.ln + 1} пара${v.miss ? " · пропуск" : v.late ? " · опоздание" : ""}">
      ${lab ? `<em class="st ${v.miss ? "x" : "l"}">${lab}</em>` : ""}<span class="mt-t num">${v.ln + 1} пара</span><b class="num">${v.n}</b><span class="mt-s"><i></i><span>${esc(subjShort(v.subj))}</span></span><span class="mt-m">${mk(v)}${lab ? `<span class="st2 ${v.miss ? "x" : "l"}">${lab}</span>` : ""}${!has && !lab ? '<span class="mt-0"></span>' : ""}</span></button>`; };
    const tile0 = u => `<div class="mt u s-${subjKey(u.subj)}" title="${esc(u.subj)} · пара есть в расписании, но в журнале нет отметки"><span class="mt-t num">${u.ln + 1} пара</span><b>-</b><span class="mt-s"><i></i><span>${esc(subjShort(u.subj))}</span></span><span class="mt-m"><span class="mt-nm">нет отметки</span></span></div>`;
    let prevW = "";
    return `<div class="mtiles">${days.map(d => { const dt = fromIso(d), w = iso(mondayOf(dt)), nw = w !== prevW; prevW = w;
      const dl = L.filter(v => v.date === d).sort((a, b) => a.ln - b.ln), x = dl.filter(v => v.miss).length, um = unmarked(d, dl);
      const items = [...dl.map(v => [v.ln, tile(v)]), ...um.map(u => [u.ln, tile0(u)])].sort((a, b) => b[0] - a[0]);
      return `${nw ? `<div class="mt-wk"><b>${dm(fromIso(w))} - ${dm(dayDate(fromIso(w), 6))}</b></div>` : ""}<section class="mday ${d === td ? "td" : ""}"><header class="mday-h"><b class="num">${dm(dt)}</b><span>${DAYS[(dt.getDay() + 6) % 7].toLowerCase()}</span><small class="num">${pairsW(dl.length + um.length)}${x ? ` · <span class="stat-bad">пропусков ${x}</span>` : ""}</small></header><div class="mday-l">${items.map(z => z[1]).join("")}</div></section>`; }).join("")}</div>`;
  }
  // после отрисовки: встаём на выбранную неделю, при листании - переключаем кнопку недели, точки и итог
  function bindPairs() {
    const pg = R && R.querySelector("#gpager"); if (!pg) return;
    const pages = [...pg.querySelectorAll(".gpage")], tabs = [...R.querySelectorAll(".gtabs [data-gw]")], dots = [...R.querySelectorAll(".gdots i")];
    let cur = Math.max(0, pages.findIndex(p => p.dataset.w === gp.wk));
    // высота - по текущей неделе; меняется только когда лист встал, во время листания не дёргается
    const fit = i => { if (pages[i]) pg.style.height = pages[i].offsetHeight + "px"; };
    const sumOf = i => { const w = pages[i] && pages[i].dataset.w; if (!w) return; const L = (M.visits || []).filter(v => iso(mondayOf(fromIso(v.date))) === w), x = L.filter(v => v.miss).length, m = L.reduce((a, v) => a + MK.filter(k => v[k] != null).length, 0);
      const sm = R && R.querySelector("#gsum"); if (sm) sm.innerHTML = `<b class="num">${dm(fromIso(w))} - ${dm(dayDate(fromIso(w), 6))}</b> · ${pairsW(L.length)} · пропусков <b class="num ${x ? "stat-bad" : ""}">${x}</b> · оценок <b class="num">${m}</b>`; };
    const light = i => { tabs.forEach((b, j) => b.setAttribute("aria-pressed", j === i)); dots.forEach((d, j) => d.classList.toggle("on", j === i)); sumOf(i); };
    const center = i => { const b = tabs[i]; if (!b) return; const tb = b.parentElement; tb.scrollLeft = b.offsetLeft - tb.offsetLeft - (tb.clientWidth - b.offsetWidth) / 2; };
    const settle = i => { const w = pages[i] && pages[i].dataset.w; if (!w || !R) return; gp.wk = w; fit(i); center(i); };
    let ready = false; const go0 = () => { pg.scrollLeft = cur * pg.clientWidth; };
    fit(cur); go0(); light(cur); center(cur); requestAnimationFrame(() => { go0(); setTimeout(() => { go0(); ready = true; }, 250); });
    pg._go = i => { cur = i; light(i); pg.scrollLeft = i * pg.clientWidth; settle(i); };
    // при листании пальцем вкладка недели переключается в тот же кадр, итог и высота - когда лист встал
    let raf = 0, t = 0;
    pg.addEventListener("scroll", () => { if (!ready || raf) return; raf = requestAnimationFrame(() => { raf = 0; const i = Math.round(pg.scrollLeft / Math.max(1, pg.clientWidth)); if (i !== cur) { cur = i; light(i); }
      clearTimeout(t); t = setTimeout(() => settle(cur), 120); }); }, { passive: true });
  }
  function applyGF() { R.querySelectorAll(".pc2,.mt").forEach(el => { let ok = true; if (gf.mode === "marks") ok = el.dataset.m === "1"; if (gf.mode === "miss") ok = el.dataset.x === "1"; if (gf.subj && el.dataset.subj !== gf.subj) ok = false; el.classList.toggle("dim", !ok); }); }

  VIEWS.homework = s => {
    const c = M.hwStat, all = c.total || c.all;
    const subs = [...new Set((M.hw || []).map(h => h.subj))];
    const HK = hwKeyed();
    const card = h => {
      const early = h.sub && h.due ? dayDiff(fromIso(h.sub), fromIso(h.due)) : null, left = h.due ? dayDiff(new Date(), fromIso(h.due)) : null;
      const badge = h.status === "done" ? `<span class="grade num ${vClass(h.mark)}" ${h.auto ? 'title="Оценка выставлена автоматически"' : ""}>${h.mark}</span>` : h.status === "wait" ? `<span class="wait" title="На проверке">${ic("clock")}</span>` : `<span class="wait ${h.status === "late" ? "bad" : ""}">${ic("hw")}</span>`;
      const foot = h.status === "cur" || h.status === "late" ? `<span>${h.status === "late" ? '<span class="late">Просрочено</span>' : left != null ? (left < 0 ? '<span class="late">Просрочено</span>' : left === 0 ? '<span class="late">Сегодня до 23:59</span>' : left === 1 ? '<b>Завтра</b> до 23:59' : `Осталось <b class="num">${left}</b> ${plural(left, "день", "дня", "дней")}`) : ""}</span>`
        : `<span>${early == null ? "" : early > 0 ? `За <b class="num">${early}</b> ${plural(early, "день", "дня", "дней")} до срока` : early === 0 ? "<b>В день срока</b>" : '<span class="late">Позже срока</span>'}</span>`;
      const nw = HK.has(h) && isNew("homework", HK.get(h));
      return `<article class="hw s-${subjKey(h.subj)} ${nw ? "isnew" : ""} ${h.status === "cur" && left != null && left <= 0 ? "dueday" : ""}"><div class="top2"><div><b>${esc(h.subj)}</b>${h.lab ? '<span class="labtag">лабораторная</span>' : ""}${h.removed ? '<span class="labtag rm">удалено преподавателем</span>' : ""}${nw ? `<span class="newtag">${h.status === "done" ? "оценка" : "новое"}</span>` : ""}${h.theme ? `<div class="th2">${esc(h.theme)}</div>` : ""}</div>${badge}</div>
        <div class="foot"><div>Срок<b class="num">${h.due ? dm(fromIso(h.due)) : "-"}</b></div><div>Сдано<b class="num">${h.sub ? dm(fromIso(h.sub)) : "-"}</b></div></div>
        <div class="hwb">${h.task ? `<div class="hwx ${h.task.length > 160 ? "clamp" : ""}" ${h.task.length > 160 ? 'data-hwx="1"' : ""}><span>Задание</span><p>${esc(h.task)}</p></div>` : ""}${h.answer ? `<div class="hwx ans"><span>Мой ответ</span><p>${/^https?:/.test(h.answer) ? `<a href="${esc(h.answer)}" target="_blank" rel="noopener">${esc(h.answer.replace(/^https?:\/\//, "").slice(0, 40))}…</a>` : esc(h.answer)}</p></div>` : ""}${h.teacherComment ? `<div class="hwx tc"><span>Комментарий преподавателя${h.checked ? ` · ${dm(fromIso(h.checked))}` : ""}</span><p>${esc(h.teacherComment)}</p></div>` : ""}</div>
        <div class="hwft"><div class="early">${foot}${h.teacher ? `<span class="soft">${esc(shortT(h.teacher))}</span>` : ""}</div>
        ${(() => { const files = (h.taskFile ? `<a href="${esc(h.taskFile)}" target="_blank" rel="noopener">${ic("hw")}<span>Файл задания</span></a>` : "") + (h.myFile ? `<a href="${esc(h.myFile)}" target="_blank" rel="noopener">${ic("upload")}<span>Мой файл</span></a>` : ""),
          sub = (h.status === "cur" || h.status === "late") && !h.removed ? `<button class="submit" data-hwf="${esc(hwRef(h))}">${ic("upload")}<span>Сдать задание</span></button>` : "";
          return files || sub ? `<div class="hwact">${files ? `<div class="hwfiles ${h.taskFile && h.myFile ? "two" : ""}">${files}</div>` : ""}${sub}</div>` : ""; })()}</div></article>`;
    };
    // новое - первым в своей группе, а группы с новым - выше остальных (не надо листать)
    const isNw = h => HK.has(h) && isNew("homework", HK.get(h));
    const grp = (st, title) => { const l = (M.hw || []).filter(h => h.status === st && (!hwq || norm(h.subj + " " + h.theme).includes(hwq))).map((h, i) => ({ h, i, n: isNw(h) })).sort((a, b) => b.n - a.n || a.i - b.i).map(x => x.h);
      const nn = l.filter(isNw).length; return l.length ? `<section class="card"><div class="hd"><h2>${title}</h2><small class="num">${nn ? `<b class="newc">+${nn} ${nn === 1 ? "новое" : "новых"}</b> · ` : ""}${l.length}</small></div><div class="hwgrid">${l.map(card).join("")}</div></section>` : ""; };
    const groups = [["cur", "Новые"], ["late", "Просроченные"], ["wait", "На проверке"], ["done", "Проверено"]].map(([st, t], i) => ({ i, html: grp(st, t), n: (M.hw || []).some(h => h.status === st && isNw(h)) })).sort((a, b) => b.n - a.n || a.i - b.i).map(x => x.html).join("");
    return `<div class="row r4">
      <div class="card kpi"><div class="lab">${ic("hw")}Всего заданий</div><div class="val num">${all}</div><div class="sub">новых <b class="num">${c.cur}</b>, просрочено <b class="num">${c.late}</b></div></div>
      <div class="card kpi"><div class="lab">${ic("check")}Проверено</div><div class="val num">${c.done}</div><div class="meter"><i style="width:${all ? c.done / all * 100 : 0}%"></i></div><div class="sub"><b class="num">${all ? Math.round(c.done / all * 100) : 0}%</b> от всех заданий</div></div>
      <div class="card kpi"><div class="lab">${ic("clock")}На проверке</div><div class="val num">${c.wait}</div><div class="sub">у преподавателей</div></div>
      <div class="card kpi"><div class="lab">${ic("timer")}Сдаёшь заранее</div><div class="val num">${s.hwCount ? f1(s.earlyAvg) : "-"}<small>дн.</small></div><div class="sub">${s.hwCount ? `<b class="num">${s.onTime}</b> из ${s.hwCount} сданы вовремя` : ""}</div></div></div>
      <div class="card hint">${ic("upload")}<div><b>Сдать задание</b><span>Кнопка «Сдать задание» на карточке: выбери файл или напиши ответ, Дневник сам отправит его в журнал</span></div></div>
      <div class="bar-tools"><div class="grp"><select class="sel" id="hwsubj"><option value="">Все предметы</option>${subs.map(x => `<option ${hwq === norm(x) ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div><span class="note">Показано ${(M.hw || []).length} из ${all}</span></div>
      ${groups}`;
  };

  VIEWS.awards = s => `<div class="row r4">
      <div class="card kpi"><div class="lab"><span class="coin"></span>Топкоины${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.coins ?? "-"}</div><div class="sub">за посещения, оценки занятий и сданные вовремя ДЗ</div></div>
      <div class="card kpi"><div class="lab"><span class="gem"></span>Топгемы${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.gems ?? "-"}</div><div class="sub">начисляются за оценки, тратятся в Маркете</div></div>
      <div class="card kpi"><div class="lab">${ic("trophy")}Достижения</div><div class="val num">${achList(s).filter(a => a.got).length}<small>из ${achList(s).length}</small></div><div class="meter"><i style="width:${achList(s).filter(a => a.got).length / achList(s).length * 100}%"></i></div><div class="sub">${M.user.achieves_count != null ? `в журнале засчитано <b class="num">${M.user.achieves_count}</b>` : "по данным журнала и посещений"}</div></div>
      <div class="card kpi"><div class="lab">${ic("flame")}Серия без пропусков</div><div class="val num">${s.pStreak}<small>${plural(s.pStreak, "пара", "пары", "пар")}</small></div><div class="sub">лучшая серия <b class="num">${s.pBest}</b> · без опозданий <b class="num">${s.pLate}</b> ${plural(s.pLate, "пара", "пары", "пар")}</div></div></div>
    <section class="card"><div class="hd"><h2>Достижения</h2><small>серии считаются по парам, как в журнале</small></div>${(() => { const L = achList(s), got = L.filter(a => a.got), no = L.filter(a => !a.got);
      const card = a => `<div class="a ${a.got ? "got" : ""}"><div class="ic">${ic(a.ic, "i big")}</div><b>${esc(a.t)}</b>
      ${(a.kind === "streak" || a.kind === "late") && !a.got ? (x => `<div class="meter"><i style="width:${Math.min(100, x / a.goal * 100)}%"></i></div><span class="note num">${Math.min(x, a.goal)} из ${a.goal} ${plural(a.goal, "пары", "пар", "пар")} подряд</span>`)(a.kind === "streak" ? s.pStreak : s.pLate) : ""}
      <div class="ft"><span class="st">${a.got ? "Получено" : "Не получено"}</span><span class="rw num">+${a.r} <span class="coin"></span></span></div></div>`;
      return `${got.length ? `<div class="ach-sep"><span>Получено · ${got.length}</span></div><div class="ach">${got.map(card).join("")}</div>` : ""}${no.length ? `<div class="ach-sep"><span>Ещё впереди · ${no.length}</span></div><div class="ach">${no.map(card).join("")}</div>` : ""}`; })()}</section>
    <section class="card"><div class="hd"><h2>Последние начисления</h2></div>${feedList(30)}</section>`;
  const achFeed = (goal, kind) => (M.feedAll || M.feed || []).some(f => { const m = String(f.code || f.label).match(/(\d+)_?VISITS?_WITHOUT_(GAP|DELAY|LATE|MISS)/); return m && +m[1] === goal && (kind === "streak") === /GAP|MISS/.test(m[2]); });
  // начисления, которые не относятся к обычным (пары, оценки, ДЗ) и которых нет в списке наград - новая награда журнала
  const REGULAR_ACT = /^(Посещение пары|Оценка|Оценка занятия|Домашнее задание|Своевременное выполнение домашнего задания|Поощрение преподавателя|Лабораторная работа|Экзамен или курсовая|Работа в портфолио|Начисление)$/i;
  const achExtra = () => { const seen = new Set(), out = [];
    (M.feedAll || M.feed || []).forEach(f => { const l = String(actName(f.label)); if (!f.plus && f.plus !== undefined) return; if (REGULAR_ACT.test(l) || /посещений подряд/i.test(l) || seen.has(l)) return;
      if (ACH.some(a => a.t.toLowerCase() === l.toLowerCase() || (a.rx && a.rx.test(l)) || (a.kind === "mail" && /почт/i.test(l)) || (a.kind === "profile" && /профил/i.test(l)))) return; seen.add(l); out.push({ t: l === "Начисление" ? "Новая награда журнала" : l, r: f.amt, ic: "medal", got: true, extra: true }); });
    return out; };
  const achList = s => ACH.map(a => ({ ...a, got: a.kind === "streak" ? s.pBest >= a.goal || achFeed(a.goal, "streak") : a.kind === "late" ? s.pLateBest >= a.goal || achFeed(a.goal, "late") : a.kind === "profile" ? !!(M.prof && M.prof.fill >= 100) : a.kind === "mail" ? M.user.emailOk === true : !!(a.rx && (M.feedAll || M.feed || []).some(f => a.rx.test(actName(f.label)))) })).concat(achExtra());

  VIEWS.news = () => {
    const list = (M.news || []).filter(n => nf === "all" || !(n.read || readSet.has(n.id))); let last = "", h = "";
    list.forEach(n => { const d = n.date ? fromIso(n.date) : null; const m = d ? MONN[d.getMonth()] + " " + d.getFullYear() : "Без даты"; if (m !== last) { h += `<div class="mgrp">${m}</div>`; last = m; }
      h += `<button class="nw ${n.read || readSet.has(n.id) ? "read" : ""}" data-nw="${esc(n.id)}"><span class="u"></span><span class="tx">${esc(n.title)}${isRead(n) ? "" : '<span class="newtag">новое</span>'}</span><span class="dt num">${d ? longDate(d) : ""}</span></button>`; });
    return `<div class="bar-tools"><div class="pill" role="group">${[["all", "Все"], ["unread", "Непрочитанные"]].map(([k, n]) => `<button data-nf="${k}" aria-pressed="${nf === k}">${n}${k === "unread" ? ` <span class="num">${unread()}</span>` : ""}</button>`).join("")}</div>
      ${unread() ? `<button class="link" data-act="readall">Отметить все прочитанными</button>` : ""}</div>
      <section class="card"><div class="news">${h || `<div class="restday"><b>Всё прочитано</b>Новых объявлений нет</div>`}</div></section>
      <p class="note">Нажми на объявление, чтобы прочитать его полностью.</p>`;
  };
  VIEWS.reviews = () => { const RK = revKeys(); return `<div class="row r2">${(M.reviews || []).map((r, ri) => ({ r, nw: isNew("reviews", RK[ri]) })).sort((a, b) => b.nw - a.nw).map(({ r, nw }) => { const ini = r.teacher.split(" ").slice(0, 2).map(x => x[0] || "").join("");
      return `<article class="card rv s-${subjKey(r.subj)} ${nw ? "isnew" : ""}">${r.subj ? `<span class="tag">${esc(r.subj)}</span>` : ""}${nw ? '<span class="newtag">новое</span>' : ""}<blockquote>${esc(r.text)}</blockquote><div class="by"><div class="ava">${esc(ini)}</div><div><b>${esc(r.teacher)}</b><span class="num">${r.date ? dm(fromIso(r.date)) + "." + r.date.slice(0, 4) : ""}</span></div></div></article>`; }).join("") || `<div class="card"><p class="note">Отзывов пока нет</p></div>`}</div>`; };

  /* ======================= разделы журнала в новом дизайне ======================= */
  const norm = x => String(x || "").replace(/\s+/g, " ").trim().toLowerCase();
  const inHost = el => (host && (el === host || host.contains(el))) || (fab && (el === fab || fab.contains(el)));
  function findNav(label) {
    const L = norm(label); let best = null;
    for (const el of document.body.querySelectorAll("a,button,li,span,div,p,[routerlink],[title]")) {
      if (inHost(el)) continue;
      const t = norm(el.textContent), ti = norm(el.getAttribute("title") || el.getAttribute("aria-label") || "");
      if (!(t === L || ti === L)) continue;
      const c = el.closest("a,button,li,[routerlink]") || el, r = c.getBoundingClientRect();
      const sc2 = (r.left < 340 ? 3 : 0) + (c.tagName === "A" ? 2 : 0) + (c.querySelector("svg,i,img") ? 1 : 0);
      if (!best || sc2 > best.s) best = { el: c, s: sc2 };
    }
    return best && best.el;
  }
  function settle(maxMs = 5000, quiet = 450) {
    return new Promise(res => {
      let t, done = false; const fin = () => { if (done) return; done = true; o.disconnect(); res(); };
      const o = new MutationObserver(() => { clearTimeout(t); t = setTimeout(fin, quiet); });
      o.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      t = setTimeout(fin, quiet); setTimeout(fin, maxMs);
    });
  }
  let navAt = 0, lastClassic = "";
  async function classicGo(label) {
    navAt = Date.now(); lastClassic = "";
    let a = null; for (let i = 0; i < 20 && !(a = findNav(label)); i++) await new Promise(r => setTimeout(r, 400));
    if (!a) throw new Error(`в журнале не найден пункт меню «${label}»`);
    a.click(); await settle(); lastClassic = label;
  }
  function locateContent() {
    const navEl = findNav("Расписание") || findNav("Главная");
    const navBox = navEl && (navEl.closest("nav,aside,[class*=side],[class*=menu]") || navEl.parentElement);
    const hdr = [...document.body.querySelectorAll("div,span,p")].find(e => !inHost(e) && /Группа:/.test(e.textContent || "") && e.children.length < 3);
    let title = null;
    for (const el of document.body.querySelectorAll("h1,h2,h3,h4,div,span,p")) {
      if (inHost(el) || el.children.length) continue;
      const t = (el.textContent || "").trim(); if (t.length < 4 || t.length > 40 || t !== t.toUpperCase() || !/[А-ЯA-Z]{3}/.test(t)) continue;
      const r = el.getBoundingClientRect(); if (r.top > 40 && r.top < 260 && r.left > 30) { title = el; break; }
    }
    let root = title;
    if (!root) root = document.elementsFromPoint(innerWidth * 0.6, innerHeight * 0.45).find(e => !inHost(e) && e !== document.body && e !== document.documentElement);
    if (!root) throw new Error("не нашёл содержимое раздела");
    while (root.parentElement && root.parentElement !== document.body && !(navBox && root.parentElement.contains(navBox)) && !(hdr && root.parentElement.contains(hdr))) root = root.parentElement;
    return { root, title };
  }
  function setNative(el, v) {
    const proto = el.tagName === "TEXTAREA" ? W.HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? W.HTMLSelectElement.prototype : W.HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value"); d && d.set ? d.set.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function onInput(e) {
    const t = e.target; if (rateInput(t)) return;
    if (t.id === "faqq") { faqq = norm(t.value); const pos = t.selectionStart; render(); const i = $("#faqq"); if (i) { i.focus(); i.setSelectionRange(pos, pos); } return; } if (!t.dataset || t.dataset.ref === undefined) return;
  }
  let toastT;
  function toast(msg, raw) { const t = $("#toast"); if (!t) return; t.classList.toggle("nomc", !!raw); t.textContent = msg; t.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => t.hidden = true, 3800); }
  const CLASSIC_NAV = { home: ["Главная"], schedule: ["Расписание"], grades: ["Успеваемость", "Посещаемость", "Оценки", "Моя статистика"], homework: ["Домашние задания", "ДЗ"],
    materials: ["Учебные материалы", "Библиотека"], awards: ["Награды", "Достижения"], news: ["Объявления", "Новости"], reviews: ["Отзывы о студенте", "Отзывы"], market: ["Маркет"],
    payment: ["Оплата"], profile: ["Личный кабинет", "Профиль"], requests: ["Обращения"], complaints: ["Жалобы"], faq: ["F.A.Q.", "Вопросы и ответы"], contacts: ["Контакты"] };
  // раздел классического журнала -> раздел Дневника: по адресу страницы, иначе по активному пункту меню
  const CLASSIC_PATH = [[/dashboard|\/main\/?$/, "home"], [/schedule/, "schedule"], [/progress|statistic|attendance/, "grades"], [/homework/, "homework"], [/material|library/, "materials"],
    [/achiev|award|reward/, "awards"], [/news/, "news"], [/review|feedback-student/, "reviews"], [/market/, "market"], [/payment|pay/, "payment"], [/profile|settings\/user/, "profile"],
    [/signal/, "requests"], [/complain/, "complaints"], [/faq/, "faq"], [/contact/, "contacts"]];
  function classicPage() {
    const p = location.pathname.toLowerCase(), hit = CLASSIC_PATH.find(([rx]) => rx.test(p)); if (hit) return hit[1];
    try { const act = [...document.querySelectorAll("a.active, li.active a, a[aria-current], .active > a")].map(a => (a.textContent || "").trim()).find(Boolean);
      if (act) for (const [pg, ls] of Object.entries(CLASSIC_NAV)) if (ls.some(l => act.toLowerCase().startsWith(l.toLowerCase()))) return pg; } catch (e) {}
    return null;
  }
  function goClassic() {
    const pg = page; dropVeil(); unmount(); showFab();
    const labels = CLASSIC_NAV[pg]; if (!labels) return; navAt = Date.now();
    (async () => { for (let i = 0; i < 16; i++) { for (const l of labels) { const a = findNav(l); if (a) { a.click(); lastClassic = l; return; } } await sleep(250); } })();
  }
  function closeDD(except) { if (R) R.querySelectorAll(".dd.open").forEach(w => { if (w === except) return; w.classList.remove("open"); w.querySelector(".dd-list").hidden = true; }); }
  function enhanceSelects(root) {
    if (!root) return;
    root.querySelectorAll("select.sel,select.m-in").forEach(sel => {
      if (sel.dataset.dd) return; sel.dataset.dd = "1";
      const w = document.createElement("div"); w.className = "dd" + (sel.classList.contains("m-in") ? " dd-in" : "");
      sel.parentNode.insertBefore(w, sel); w.appendChild(sel);
      const btn = document.createElement("button"); btn.type = "button"; btn.className = "dd-btn"; btn.setAttribute("aria-haspopup", "listbox");
      const list = document.createElement("div"); list.className = "dd-list"; list.setAttribute("role", "listbox"); list.hidden = true;
      w.append(btn, list);
      const paint = () => { const o = sel.options[sel.selectedIndex]; btn.innerHTML = `<span>${esc(o ? o.text : "")}</span>${ic("chev")}`;
        list.innerHTML = [...sel.options].map((o, i) => `<button type="button" class="dd-o" role="option" data-i="${i}" aria-selected="${i === sel.selectedIndex}"><span>${esc(o.text)}</span>${i === sel.selectedIndex ? ic("check") : ""}</button>`).join(""); };
      paint();
      btn.addEventListener("click", e => { e.stopPropagation(); const open = list.hidden; closeDD(w); list.hidden = !open; w.classList.toggle("open", open); if (open) { list.classList.remove("flip"); list.style.left = "0px"; list.style.right = "auto";
        const vw = document.documentElement.clientWidth || innerWidth, r = list.getBoundingClientRect(); let dx = 0;
        if (r.right > vw - 8) dx = r.right - (vw - 8); if (r.left - dx < 8) dx = r.left - 8; if (dx) list.style.left = -Math.round(dx) + "px"; const c = list.querySelector('[aria-selected="true"]'); if (c) list.scrollTop = Math.max(0, c.offsetTop - list.clientHeight / 2); } });
      list.addEventListener("click", e => { const o = e.target.closest(".dd-o"); if (!o) return; e.stopPropagation(); sel.selectedIndex = +o.dataset.i; paint(); closeDD(); sel.dispatchEvent(new Event("change", { bubbles: true })); });
    });
  }

  // «Золото и изумруды»: меняем названия валют во всём тексте Дневника (окна, подсказки, заголовки)
  const MC_W = [[/Топкоин(ы|ов)/g, "Золото"], [/Топгем(ы|ов)/g, "Изумруды"], [/топкоинами/g, "слитками золота"], [/топкоинов/g, "слитков золота"], [/топкоина/g, "слитка золота"], [/топкоины/g, "слитки золота"], [/топкоин/g, "слиток золота"],
    [/топгемами/g, "изумрудами"], [/топгемов/g, "изумрудов"], [/топгема/g, "изумруда"], [/топгемы/g, "изумруды"], [/топгем/g, "изумруд"], [/^ТК$/, "ЗЛ"], [/^ТГ$/, "ИЗ"], [/Монеты, гемы/g, "Золото, изумруды"], [/монеты и гемы/g, "золото и изумруды"]];
  const mcStr = t => { MC_W.forEach(([r, v]) => { t = t.replace(r, v); }); return t; };
  function mcify(root) {
    if (!cfg.mc || !root) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
    while ((n = tw.nextNode())) { const v = n.nodeValue; if (n.parentElement && n.parentElement.closest(".nomc")) continue; if (v && /топ(коин|гем)|монеты,? (и )?гемы|^Т[КГ]$/i.test(v.trim())) { const w = /^Т[КГ]$/.test(v.trim()) ? mcStr(v.trim()) : mcStr(v); if (w !== v) n.nodeValue = w; } }
    if (root.querySelectorAll) root.querySelectorAll("[title]").forEach(el => { const t = el.getAttribute("title"); if (/топ(коин|гем)/i.test(t)) el.setAttribute("title", mcStr(t)); });
  }
  const ACCENTS = [["gold", "Янтарь", "#e8bf6a"], ["sapphire", "Сапфир", "#6f98ff"], ["emerald", "Малахит", "#4fd6a6"], ["amethyst", "Аметист", "#8f7dff"], ["rose", "Роза", "#ff79b0"], ["graphite", "Графит", "#c9ccd4"]];
  VIEWS.settings = () => {
    const opt = (k, v, l) => `<button data-set="${k}" data-v="${v}" aria-pressed="${String(cfg[k]) === String(v)}">${l}</button>`;
    const st = Object.keys(NET.status); const ok = st.filter(k => NET.status[k] === 200).length;
    const upd = LS.get("upd", null), newer = upd && upd.v && verNewer(upd.v, VERSION), chkAt = LS.get("updAt", 0);
    if (Date.now() - chkAt > 10 * 60000) setTimeout(() => checkUpdate(true).then(() => { if (page === "settings") render(); }), 300);
    return `<section class="card ver"><div class="ver-top"><div class="ver-ic">${ic("book", "i big")}</div><div class="grow"><span class="cap">Дневник</span><b class="num">Версия ${VERSION}</b>
        <span class="soft">${newer ? `доступна ${esc(upd.v)}` : upd && upd.v ? "у тебя последняя версия" : "проверка обновлений ещё не проходила"}${chkAt ? ` · проверено ${sameDay(new Date(chkAt), new Date()) ? "сегодня в " + new Date(chkAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : dm(new Date(chkAt))}` : ""}</span></div>
        ${newer ? `<a class="m-btn pri" href="${UPD_URL}" target="_blank" rel="noopener" data-act="updgo">${ic("download")}Обновить до ${esc(upd.v)}</a>` : `<button class="m-btn" data-act="updcheck">${ic("refresh")}Проверить обновления</button>`}</div>
      <div class="ver-new"><span>Что нового</span><ul>${CHANGES.map(c => `<li>${esc(c)}</li>`).join("")}</ul></div></section>
    <section class="card"><div class="hd"><h2>Разделы в меню</h2><small>Выключенный раздел пропадает из меню</small></div>
      <div class="set-grid">${PAGES.filter(p => !["home", "settings"].includes(p.id)).map(p => `<label class="sw"><input type="checkbox" data-hide="${p.id}" ${cfg.hidden.includes(p.id) ? "" : "checked"}><span class="tr"></span>${ic(p.ic)}<span>${esc(p.n)}</span></label>`).join("")}</div></section>
    <div class="row r2">
      <section class="card"><div class="hd"><h2>Внешний вид</h2></div>
        <div class="set-row"><span>Графика<button class="tipb" data-tip="Полная - стекло, размытие и анимации.&#10;Лёгкая - без размытия и фоновых анимаций, для слабых телефонов и ноутбуков.&#10;Авто - сама включает лёгкую, если прокрутка начинает тормозить${cfg.gfx === "auto" && LS.get("gfxauto", 0) === 1 ? " (сейчас включена лёгкая)" : ""}" aria-label="Что это">i</button></span><div class="pill">${opt("gfx", "auto", "Авто")}${opt("gfx", "full", "Полная")}${opt("gfx", "lite", "Лёгкая")}</div></div>
        <div class="set-row"><span>Цели в «Оценках»<button class="tipb" data-tip="Карточки «Цель по баллу» и «Цель по посещаемости» в разделе «Оценки».&#10;Выключены - карточки скрыты, сами цели сохраняются" aria-label="Что это">i</button></span><div class="pill">${opt("goals", true, "Показывать")}${opt("goals", false, "Скрыть")}</div></div>
        <div class="set-row"><span>Все пары в «Оценках»</span><div class="pill">${opt("gpv", "week", "По неделям")}${opt("gpv", "month", "Весь месяц")}</div></div>
        <div class="set-row"><span>Цвет акцента</span><div class="acc-row">${ACCENTS.map(([k, n, c]) => `<button class="acc" data-set="accent" data-v="${k}" aria-pressed="${(cfg.accent || "gold") === k}" title="${n}" style="--c:${c}"><i></i><span>${n}</span></button>`).join("")}</div></div>
        <div class="set-row"><span>Валюта<button class="tipb" data-tip="«Пиксельная» валюта: топкоины показываются как слитки золота, топгемы - как изумруды.&#10;На сам журнал это не влияет" aria-label="Что это">i</button></span><div class="pill">${opt("mc", false, "Как в журнале")}${opt("mc", true, "Пиксельная")}</div></div>
        ${CRYPTO ? `<div class="set-row"><span>Крипта на главной<button class="tipb" data-tip="Курс доллара, Bitcoin, Toncoin, Solana, Ethereum и индекс страха и жадности.&#10;Выключена - ничего не загружает и не тратит заряд" aria-label="Что это">i</button></span><div class="pill">${opt("mkt", true, "Вкл")}${opt("mkt", false, "Выкл")}</div></div>` : ""}
      <section class="card"><div class="hd"><h2>Данные</h2><small>${M.updatedAt ? "обновлено " + new Date(M.updatedAt).toLocaleString("ru-RU") : "ещё не обновлялись"}</small></div>
        <div class="set-row"><span>Связь с журналом</span><b class="${ok ? "stat-good" : "stat-bad"}">${st.length ? `${ok} из ${st.length} запросов` : "нет запросов"}</b></div>
        <div class="set-row"><span>Способ запросов</span><b>${NET.mode === "page" ? "через страницу журнала" : /gm/.test(NET.mode) ? (HAS_UW ? "через Tampermonkey" : "через расширение (Safari)") : NET.mode === "fetch" ? "через браузер" : "-"}</b></div>
        <div class="btns"><button class="m-btn pri" data-act="sync">${ic("refresh")}Обновить</button><button class="m-btn" data-act="diag">${ic("bug")}Скопировать диагностику</button><button class="m-btn" data-act="reset">Сбросить кэш</button></div></section>
    </div>
    <section class="card"><div class="hd"><h2>Классический журнал</h2></div>
      <div class="btns"><button class="m-btn" data-act="classic">${ic("ext")}Открыть классический журнал</button><button class="m-btn" data-act="logout">Выйти из аккаунта</button></div>
      <p class="note">Вернуться: кнопка «Вернуться в Дневник» внизу справа в журнале - откроется тот же раздел, где ты был.</p></section>`;
  };

  /* ======================= объявления: полный текст ======================= */
  // текст объявления: только разрешённые теги и http(s)-ссылки; всё остальное разворачиваем в текст
  function cleanHTML(html) {
    const d = new W.DOMParser().parseFromString(String(html || ""), "text/html"), out = d.createElement("div");
    const OK = /^(P|BR|B|STRONG|I|EM|U|S|UL|OL|LI|A|H[1-6]|BLOCKQUOTE|SPAN|DIV|TABLE|THEAD|TBODY|TR|TD|TH|HR|IMG|SMALL|SUB|SUP|PRE|CODE)$/, DROP = /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|MATH|IFRAME|FRAME|OBJECT|EMBED|LINK|META|BASE|FORM|INPUT|BUTTON|SELECT|TEXTAREA|TITLE|AUDIO|VIDEO)$/;
    const cp = (src, dst, depth) => { if (depth > 40) return; src.childNodes.forEach(n => {
      if (n.nodeType === 3) { dst.appendChild(d.createTextNode(n.data)); return; } if (n.nodeType !== 1) return;
      const t = String(n.tagName).toUpperCase(); if (DROP.test(t)) return; if (!OK.test(t)) { cp(n, dst, depth + 1); return; }
      const e = d.createElement(t.toLowerCase());
      if (t === "A") { const h = safeUrl(n.getAttribute("href")); if (h) { e.setAttribute("href", h); e.setAttribute("target", "_blank"); e.setAttribute("rel", "noopener noreferrer"); } }
      if (t === "IMG") { const u = safeUrl(n.getAttribute("src")); if (!u) return; e.setAttribute("src", u); e.setAttribute("alt", ""); e.setAttribute("loading", "lazy"); }
      if (t === "TD" || t === "TH") ["colspan", "rowspan"].forEach(k => { const v = parseInt(n.getAttribute(k), 10); if (v > 1 && v < 50) e.setAttribute(k, String(v)); });
      cp(n, e, depth + 1); dst.appendChild(e); }); };
    cp(d.body, out, 0); return out.innerHTML;
  }
  const newsCache = {};
  function markReadUI(id) {
    R.querySelectorAll(`[data-nw="${CSS.escape(String(id))}"]`).forEach(el => { el.classList.add("read"); const t = el.querySelector(".newtag"); t && t.remove(); });
    const u = unread();
    R.querySelectorAll('[data-page="news"] .bd').forEach(b => { if (u) b.textContent = u; else b.remove(); });
    const pill = R.querySelector('[data-nf="unread"] .num'); if (pill) pill.textContent = u;
    if (page === "news") { $("#eyebrow").textContent = `${u} непрочитанных`; if (!u) { const ra = R.querySelector('[data-act="readall"]'); ra && ra.remove(); } }
  }
  async function openNews(id) {
    const n = (M.news || []).find(x => x.id === id) || { title: "Объявление" }, d = $("#dlg"), dt = n.date ? fromIso(n.date) : null;
    const show = body => { d.classList.add("wide"); d.innerHTML = `<div class="dlg"><div class="dh2"><div><h3>${esc(n.title)}</h3><p class="num">${dt ? longDate(dt) + " " + dt.getFullYear() : ""}</p></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div><div class="nbody">${body}</div></div>`; if (!d.open) d.showModal(); };
    if (newsCache[id]) { show(newsCache[id]); markReadUI(id); return; }
    show(`<div class="m-load"><span class="spin"></span>Загружаю текст…</div>`);
    for (const path of [`news/operations/detail-news?news_id=${encodeURIComponent(id)}`, `news/operations/detail?id=${encodeURIComponent(id)}`]) {
      try {
        const r = await api("newsDetail", path); const o = Array.isArray(r) ? r[0] : r && r.data && !Array.isArray(r.data) ? r.data : r;
        const html = pick(o, ["text_bbs", "text", "body", "content", "description", "message"]);
        if (html) { newsCache[id] = cleanHTML(html); if (d.open) show(newsCache[id]); markReadUI(id); const n2 = (M.news || []).find(x => x.id === id); if (n2 && !n2.read) { n2.read = true; LS.set("model", M); } return; }
      } catch (e) {}
    }
    // запасной путь: открыть объявление в журнале, его окно появится поверх Дневника
    d.close(); markReadUI(id); toast("Открываю объявление из журнала…");
    try {
      await classicGo("Объявления");
      const key = norm(n.title).slice(0, 30);
      const card = [...document.body.querySelectorAll("div,li,a,article")].filter(el => !inHost(el) && norm(el.textContent).startsWith(key)).sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!card) throw new Error("не найдено");
      card.click(); await settle(2500, 350);
    } catch (e) { toast("Не получилось открыть текст. Попробуй в классическом журнале"); }
  }

  let pendingNotice = null;
  function newsNotice(list, fromJournal) {
    if (!R) return;
    const d = $("#dlg"); list = (list || []).filter(n => !isRead(n));
    if (d.open) { if (!d.querySelector(".nlist")) pendingNotice = list.length ? list : pendingNotice; return; }
    const n = list.length;
    d.classList.add("wide");
    d.innerHTML = `<div class="dlg"><div class="dh2"><div class="jn-head"><div class="jn-ic">${ic("bell", "i big")}</div><div><h3>${n === 1 && !fromJournal ? "Новое объявление" : "У вас есть непрочитанные объявления"}</h3><p class="num">${n ? n + " " + plural(n, "объявление ждёт", "объявления ждут", "объявлений ждут") + " прочтения" : "Загляни в раздел объявлений"}</p></div></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
      ${n ? `<div class="nlist">${list.slice(0, 5).map(x => `<button class="nw" data-nw="${esc(x.id)}"><span class="u"></span><span class="tx">${esc(x.title)}<span class="newtag">новое</span></span><span class="dt num">${x.date ? longDate(fromIso(x.date)) : ""}</span></button>`).join("")}</div>` : ""}
      <div class="ffoot"><button class="m-btn" data-act="close">Позже</button><button class="m-btn pri" data-page="news">${ic("bell")}Перейти в объявления</button></div></div>`;
    d.showModal();
  }

  /* ======================= отправка из Дневника ======================= */
  function findOrigButton(rx) {
    return [...document.body.querySelectorAll("button,a,[role=button],input[type=button],input[type=submit]")].filter(el => !inHost(el) && vis(el) && rx.test(((el.innerText || el.value || "") + "").trim()))[0];
  }
  // готовим раздел журнала заранее, чтобы клик по кнопке шёл в том же нажатии (скачивание не блокируется)
  const prepareClassic = label => { if (lastClassic !== label && !bridging) classicGo(label).catch(() => {}); };
  async function origClick(label, rx, what) {
    let b = lastClassic === label ? findOrigButton(rx) : null;
    if (b) { b.click(); toast(what); return; }
    toast("Готовлю раздел журнала…");
    try { await classicGo(label); b = findOrigButton(rx); if (!b) throw new Error("x"); b.click(); toast(what); }
    catch (e) { toast("Кнопка не нашлась, открываю журнал"); goClassic(); classicGo(label).catch(() => {}); }
  }
  const sendPassword = (oldp, newp) => direct(async () => {
    const e = apiErr(await postJson("profile/operations/change-password", { password_old: oldp, password: newp, password_repeat: newp }));
    if (e) { if (/парол|password/i.test(e.message)) e.final = true; throw e; }
  }, () => sendPasswordUI(oldp, newp));
  const sendPasswordUI = (oldp, newp) => bridge("Личный кабинет", async () => {
    const root = pageRoot(); clickByText(/смена пароля|сменить пароль|изменить пароль/i, root); await settle(2000, 300);
    const pw = [...document.querySelectorAll("input[type=password]")].filter(el => !inHost(el));
    if (pw.length < 2) throw new Error("не открылось окно смены пароля");
    const [a, b2, c] = pw.length >= 3 ? pw.slice(-3) : [null, ...pw.slice(-2)];
    if (a) setVal(a, oldp); setVal(b2, newp); if (c) setVal(c, newp);
    const rx = /^(сохранить|изменить|сменить|подтвердить|отправить)/i;
    await sleep(200); clickByText(rx, scopeFor(b2, rx));
  }, /password|pass/i);
  const sendPhoto = file => bridge("Личный кабинет", async () => {
    const root = pageRoot(), before = new Set(fileInputs());
    try { clickByText(/загрузить фото/i, root); } catch (e) {}
    await settle(1500, 300);
    const fi = fileInputs().filter(x => !before.has(x)).pop() || fileInputs().pop(); if (!fi) throw new Error("не нашёл загрузку фото в журнале");
    const n0 = NET.writes.length;
    const dt = new W.DataTransfer(); dt.items.add(file); fi.files = dt.files; fi.dispatchEvent(new Event("input", { bubbles: true })); fi.dispatchEvent(new Event("change", { bubbles: true }));
    await settle(3000, 500);
    if (NET.writes.length === n0) { const rx = /^(сохранить|загрузить|применить|ок|готово)$/i; const modal = [...document.querySelectorAll("[role=dialog],.modal,.modal-content,[class*=modal],[class*=crop]")].filter(el => !inHost(el) && vis(el)).pop(); clickByText(rx, modal || scopeFor(fi, rx)); }
  }, /photo|avatar|image|file|profile/i);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let bridging = false;
  const vis = el => { const st = getComputedStyle(el), r = el.getBoundingClientRect(); return st.display !== "none" && st.visibility !== "hidden" && (r.width > 0 || r.height > 0); };
  function setVal(el, v) { try { el.focus(); } catch (e) {} setNative(el, v); el.dispatchEvent(new Event("blur", { bubbles: true })); }
  function clickByText(rx, scope) {
    const c = [...(scope || document.body).querySelectorAll("button,a,[role=button],input[type=submit],div,span")]
      .filter(el => !inHost(el) && vis(el) && rx.test(((el.innerText || el.value || "") + "").trim()) && ((el.innerText || el.value || "") + "").trim().length < 40)
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
    if (!c) throw new Error("в форме журнала не нашлась кнопка отправки");
    (c.closest("button,a,[role=button]") || c).click();
  }
  function scopeFor(el, rx) {
    let c = el;
    while (c && c !== document.body) {
      const st = getComputedStyle(c);
      if ((st.position === "fixed" || c.getAttribute("role") === "dialog" || /modal|dialog|popup/i.test(c.className || "")) && [...c.querySelectorAll("button,a,[role=button],input[type=submit]")].some(b => rx.test(((b.innerText || b.value || "") + "").trim()))) return c;
      c = c.parentElement;
    }
    c = el;
    while (c && c !== document.body) { if ([...c.querySelectorAll("button,[role=button],input[type=submit]")].some(b => vis(b) && rx.test(((b.innerText || b.value || "") + "").trim()))) return c; c = c.parentElement; }
    return document.body;
  }
  function pageRoot() { try { return locateContent().root; } catch (e) { return document.body; } }
  async function bridge(label, fill, expect) {
    bridging = true; document.documentElement.classList.remove("dn-raise");
    try {
      await classicGo(label); await sleep(300);
      const w = waitWrite(15000, expect); w.catch(() => {}); await fill(); const ev = await w;
      if (ev.status >= 200 && ev.status < 300) return ev;
      let msg = ""; try { const j = JSON.parse(ev.text); msg = j.message || j.error || (Array.isArray(j) && j[0] && j[0].message) || ""; } catch (e) {}
      if (/не подтвержд/i.test(msg)) throw new Error("прошлое изменение ещё на проверке у учебной части. Новое можно отправить после её подтверждения");
      if (ev.status === 401 || ev.status === 403) throw new Error("журнал просит войти заново. Обнови страницу журнала");
      throw new Error(`журнал ответил ошибкой ${ev.status}${msg ? ": " + msg : ""}`);
    } finally { bridging = false; setTimeout(applyRaise, 2000); }
  }
  async function chooseOption(root, text) {
    const sel = root.querySelector("select");
    if (sel) { const o = [...sel.options].find(o => norm(o.text) === norm(text)); if (!o) throw new Error("в журнале нет темы «" + text + "»"); setNative(sel, o.value); return; }
    const trig = [...root.querySelectorAll("*")].find(el => !inHost(el) && vis(el) && el.children.length < 4 && /выберите/i.test(el.textContent || ""));
    if (!trig) throw new Error("не нашёл выбор темы в форме журнала");
    trig.click(); await sleep(350);
    const opts = [...document.body.querySelectorAll("li,div,span,a,option")].filter(el => !inHost(el) && vis(el) && norm(el.textContent) === norm(text));
    if (!opts.length) throw new Error("не нашёл тему «" + text + "» в списке журнала");
    opts[opts.length - 1].click(); await sleep(250);
  }
  const sendSignal = (type, theme, text, urgent) => direct(async () => {
    const id = (M.sigIds || {})[type]; if (id == null) throw new Error("нет номера темы");
    const e = apiErr(await postJson("signal/operations/create", { Signal: { id_problem: +id, message: text, quickly: !!urgent, theme } })); if (e) throw e;
  }, () => sendSignalUI(type, theme, text, urgent));
  const sendSignalUI = (type, theme, text, urgent) => bridge("Обращения", async () => {
    const root = pageRoot();
    if (type) await chooseOption(root, type);
    const inp = [...root.querySelectorAll("input:not([type]),input[type=text]")].filter(vis)[0], ta = [...root.querySelectorAll("textarea")].filter(vis)[0];
    if (!inp || !ta) throw new Error("не нашёл поля формы обращения");
    setVal(inp, theme); setVal(ta, text);
    const cb = root.querySelector("input[type=checkbox]"); if (cb && cb.checked !== !!urgent) cb.click();
    await sleep(200); clickByText(/^отправить$/i, scopeFor(ta, /^отправить$/i));
  }, /signal/i);
  const sendComplaint = (theme, text) => direct(async () => {
    const e = apiErr(await postForm("contacts/operations/send-ceo", [["MessageForm", JSON.stringify({ subject: theme, message: text })]])); if (e) throw e;
  }, () => sendComplaintUI(theme, text));
  const sendComplaintUI = (theme, text) => bridge("Жалобы", async () => {
    const root = pageRoot();
    const inp = [...root.querySelectorAll("input:not([type]),input[type=text]")].filter(vis)[0], ta = [...root.querySelectorAll("textarea")].filter(vis)[0];
    if (!inp || !ta) throw new Error("не нашёл поля формы жалобы");
    setVal(inp, theme); setVal(ta, text); await sleep(200); clickByText(/^отправить$/i, scopeFor(ta, /^отправить$/i));
  }, /^(?!.*(personal|password|homework)).*$/i);
  const sendProfile = v => bridge("Личный кабинет", async () => {
    const root = pageRoot(), P0 = M.prof || {}, digits = x => String(x || "").replace(/\D/g, "");
    const inputs = [...root.querySelectorAll("input,textarea")].filter(el => !inHost(el) && el.type !== "file" && el.type !== "checkbox");
    const find = (test) => inputs.find(test);
    const map = [
      ["phone", find(el => P0.phones && P0.phones[0] && digits(el.value) === digits(P0.phones[0]))],
      ["email", find(el => P0.email && el.value.trim() === P0.email)],
      ["address", find(el => P0.address && el.value.trim() === P0.address)],
      ["study", find(el => P0.study && el.value.trim() === P0.study)]
    ];
    let changed = 0;
    for (const [k, el] of map) { if (v[k] == null || !el) continue; if (k === "phone" ? digits(el.value) !== digits(v[k]) : el.value.trim() !== v[k]) { setVal(el, v[k]); changed++; } }
    if (!changed) throw new Error("нет изменений, которые можно сохранить");
    await sleep(250); clickByText(/^сохранить$/i, scopeFor(map.find(x => x[1])[1], /^сохранить$/i));
  }, /personal|profile/i);
  function findHwCard(h) {
    const d = h.due ? fromIso(h.due) : null, mm = d ? String(d.getMonth() + 1).padStart(2, "0") : "";
    const dates = d ? [`${d.getDate()}.${mm}.${d.getFullYear()}`, `${String(d.getDate()).padStart(2, "0")}.${mm}.${d.getFullYear()}`, `${String(d.getDate()).padStart(2, "0")}.${mm}.${String(d.getFullYear()).slice(2)}`] : [];
    const words = t => norm(t).split(/[^а-яёa-z0-9]+/).filter(w => w.length >= 4).map(w => w.slice(0, 5));
    const sw = words(h.subj).slice(0, 3), tw = words(h.theme || "").slice(0, 4);
    const hasDate = t => dates.some(x => new RegExp("(^|[^0-9])" + x.replace(/\./g, "\\.") + "([^0-9]|$)").test(t));
    let best = null;
    for (const el of document.body.querySelectorAll("div,li,article,a,mat-card,[class*=card]")) {
      if (inHost(el) || !el.children.length || !vis(el)) continue;
      const r = el.getBoundingClientRect(); if (r.width < 80 || r.height < 60 || r.width > innerWidth * 0.7 || r.height > innerHeight * 0.9) continue;
      const t = el.textContent || "", nt = norm(t); if (t.length > 600) continue;
      const dOk = !dates.length || hasDate(t), sOk = sw.filter(w => nt.includes(w)).length + (sw[0] && nt.includes(sw[0].slice(0, 4)) ? 0.5 : 0), tOk = tw.filter(w => nt.includes(w)).length;
      if (!dOk && !sOk) continue;
      const score = (dOk ? 10 : 0) + sOk * 3 + tOk * 2 - r.width * r.height / 1e6;
      if (!best || score > best.score) best = { el, score, dOk, sOk: sOk + tOk };
    }
    return best && (best.dOk && (best.sOk || !sw.length) || best.sOk >= 2) ? best.el : null;
  }
  const upModal = () => [...document.querySelectorAll("hw-upload-homework,.text-homework-wrap,[class*=upload-homework]")].filter(el => !inHost(el) && vis(el))[0]
    || (fileInputs().map(fi => fi.closest(".modal-content,[role=dialog],.modal,.cdk-overlay-pane,[id*=modal],[class*=modal],[class*=upload]") || fi.parentElement).filter(el => el && vis(el))[0]);
  // открыть окно загрузки ДЗ: пробуем значок сдачи на карточке, потом саму карточку; чужие окна (информация о задании) закрываем
  async function openUpload(card) {
    const infoRx = /info|comment|chat|message|download-task|description/i;
    const cls = el => String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "");
    const tries = [...card.querySelectorAll("[class*=upload],[class*=load],[class*=hw],[class*=file],[class*=icon],img,svg,button,[role=button]")]
      .filter(el => vis(el) && !infoRx.test(cls(el)) && !(el.closest("[class*=info],[class*=comment]")))
      .sort((a, b) => (/upload|load/i.test(cls(b)) - /upload|load/i.test(cls(a))) || (b.getBoundingClientRect().width * b.getBoundingClientRect().height - a.getBoundingClientRect().width * a.getBoundingClientRect().height));
    const hidden = [...card.querySelectorAll(".upload-file,[class*=upload-file],[class*=upload]")];
    ["pointerover", "mouseover", "mouseenter"].forEach(t => card.dispatchEvent(new MouseEvent(t, { bubbles: true })));
    for (const t of [...hidden, ...tries.slice(0, 5), card]) {
      const before = new Set([...document.querySelectorAll(".modal,[role=dialog]")].filter(vis));
      fire(t); await settle(1800, 300);
      const m = upModal(); if (m) return m;
      const other = [...document.querySelectorAll(".modal,[role=dialog]")].filter(el => vis(el) && !before.has(el) && !inHost(el))[0];
      if (other) { const x = [...other.querySelectorAll("button,[class*=close],[aria-label]")].find(b => /close|закрыть/i.test(cls(b) + " " + (b.getAttribute("aria-label") || "")) || /^(×|✕|закрыть|ок|ok)$/i.test((b.innerText || "").trim())); if (x) fire(x); else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })); await settle(800, 250); }
    }
    return null;
  }
  // Прямая отправка формы на сервер журнала (как это делает сам журнал)
  const b64 = buf => { const u8 = new Uint8Array(buf); let b = ""; for (let i = 0; i < u8.length; i += 8192) b += String.fromCharCode.apply(null, u8.subarray(i, i + 8192)); return btoa(b); };
  async function postForm(path, fields, file) {
    const url = (NET.base || DEFAULT_API) + "/" + path;
    const h = Object.assign({ accept: "application/json, text/plain, */*" }, NET.headers); if (NET.token) h.authorization = "Bearer " + NET.token;
    delete h["content-type"];
    let r;
    if (NET.pageReady && typeof pageRequest === "function") {
      const f = file ? { k: file.k, name: file.v.name, type: file.v.type, b64: b64(await file.v.arrayBuffer()) } : null;
      r = await new Promise((res, rej) => { const id = ++rpcN; const t = setTimeout(() => { delete RPC[id]; rej(new Error("журнал не ответил")); }, 60000);
        RPC[id] = d => { clearTimeout(t); res({ status: d.status, text: d.tx || "" }); };
        document.dispatchEvent(new CustomEvent("dn-post", { detail: JSON.stringify({ id, url, h, f: fields, file: f }) })); });
    } else {
      const fd = new W.FormData(); fields.forEach(([k, v]) => fd.append(k, v)); if (file) fd.append(file.k, file.v, file.v.name);
      const x = await origFetch(url, { method: "POST", headers: h, body: fd, credentials: "omit", mode: "cors" }); r = { status: x.status, text: await x.text() };
    }
    pushW(`POST ${pathOf(url)} (Дневник) · поля: ${fields.map(([k]) => k).join(", ")}${file ? `, ${file.k}=[файл]` : ""}`, `  ↳ ответ ${r.status}`);
    return r;
  }
  // JSON-отправка; в журнал действий пишем только названия полей (пароли и тексты не попадают в диагностику)
  async function postJson(path, obj) {
    const url = (NET.base || DEFAULT_API) + "/" + path, body = JSON.stringify(obj);
    const h = Object.assign({ accept: "application/json, text/plain, */*" }, NET.headers); if (NET.token) h.authorization = "Bearer " + NET.token; delete h["content-type"];
    let r;
    if (NET.pageReady && typeof pageRequest === "function") {
      r = await new Promise((res, rej) => { const id = ++rpcN; const t = setTimeout(() => { delete RPC[id]; rej(new Error("журнал не ответил")); }, 30000);
        RPC[id] = d => { clearTimeout(t); res({ status: d.status, text: d.tx || "" }); };
        document.dispatchEvent(new CustomEvent("dn-post", { detail: JSON.stringify({ id, url, h, json: body }) })); });
    } else { const x = await origFetch(url, { method: "POST", headers: Object.assign({ "content-type": "application/json" }, h), body, credentials: "omit", mode: "cors" }); r = { status: x.status, text: await x.text() }; }
    const keys = o => Object.keys(o).map(k => o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? k + "{" + keys(o[k]) + "}" : k).join(", ");
    pushW(`POST ${pathOf(url)} (Дневник) · поля: ${keys(obj)}`, `  ↳ ответ ${r.status}`);
    return r;
  }
  // ответ журнала -> понятная ошибка; final = не пробовать запасной путь через окна журнала
  function apiErr(r) {
    if (r.status >= 200 && r.status < 300) return null;
    let m = ""; try { const j = JSON.parse(r.text); m = j.message || (Array.isArray(j) && j.map(x => x.message).filter(Boolean).join("; ")) || ""; } catch (e) {}
    if (r.status === 401 || r.status === 403) return Object.assign(new Error("журнал просит войти заново. Обнови страницу"), { final: true });
    return Object.assign(new Error(`журнал ответил ${r.status}${m ? ": " + m : ""}`), { final: r.status === 422 && !!m && !/field|поле|required|обязател/i.test(m) });
  }
  const direct = async (fn, fallback) => { try { return await fn(); } catch (e) { if (e.final || !fallback) throw e; pushW("  ↳ прямая отправка не прошла (" + e.message + "), пробую через окно журнала"); return fallback(); } };
  const HW_TAG_ID = t => HW_TAGS.indexOf(t) + 1;
  async function sendHwDirect(h, v) {
    const two = x => String(Math.min(99, +x || 0)).padStart(2, "0");
    step(v.file ? "Загружаю файл в журнал…" : "Отправляю ответ в журнал…");
    const r = await postForm("homework/operations/create", [["id", String(h.id)], ["answerText", v.answer || ""], ["spentTimeHour", two(v.hh)], ["spentTimeMin", two(v.mm)]], v.file ? { k: "file", v: v.file } : null);
    if (r.status === 401 || r.status === 403) throw Object.assign(new Error("журнал просит войти заново. Обнови страницу"), { final: true });
    if (r.status < 200 || r.status >= 300) { let m = ""; try { const j = JSON.parse(r.text); m = j.message || (Array.isArray(j) && j[0] && j[0].message) || ""; } catch (e) {} throw Object.assign(new Error(`журнал ответил ${r.status}${m ? ": " + m : ""}`), { final: r.status !== 404 && r.status !== 405 }); }
    const tags = (v.tags || "").split("|").filter(Boolean).map(HW_TAG_ID).filter(x => x > 0);
    if (+v.stars || v.ecomment || tags.length) { step("Сохраняю отзыв о задании…");
      try { await postForm("homework/evaluation/operations/save", [["EvaluationHomeworkForm", JSON.stringify({ id: null, idDomZad: +h.id, idStud: null, mark: +v.stars || null, comment: v.ecomment || "", tags })]]); } catch (e) {} }
    h.status = "wait"; h.sub = h.sub || iso(new Date()); LS.set("model", M);
  }
  const fileInputs = () => [...document.querySelectorAll("input[type=file]")].filter(el => !inHost(el));
  const step = t => { const st = R && R.getElementById("fstat"); if (st && st.classList.contains("busy")) st.innerHTML = `<span class="spin"></span>${esc(t)}`; };
  // что Дневник увидел на странице ДЗ - в диагностику (только структура и короткие подписи)
  function hwSnap(card, h) {
    try { if (card) { popSnap(card); NET.pop = "Карточка ДЗ (" + h.subj + ", срок " + h.due + "):\n" + NET.pop; return; }
      const cards = [...document.body.querySelectorAll("div,li,a")].filter(el => !inHost(el) && vis(el) && el.children.length && /\d{1,2}\.\d{2}\.\d{2,4}/.test(el.textContent || "") && (el.textContent || "").length < 200).slice(0, 12);
      NET.pop = "Задание не найдено (" + h.subj + ", срок " + h.due + "). Карточки на странице:\n" + cards.map(c => "- " + String(c.className || c.tagName).slice(0, 50) + ": " + (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80)).join("\n"); } catch (e) {}
  }
  const sendHw = (h, v) => bridge("ДЗ", async () => {
    step("Открываю «Домашние задания» в журнале…");
    let card = null; for (let i = 0; i < 12 && !(card = findHwCard(h)); i++) await sleep(400);
    if (!card) { hwSnap(null, h); throw new Error("не нашёл это задание на странице ДЗ журнала"); }
    step("Нашёл задание, открываю окно сдачи…");
    const modal = await openUpload(card); if (!modal) { hwSnap(card, h); throw new Error("в журнале не открылось окно сдачи"); }
    step(v.file ? "Прикрепляю файл и заполняю ответ…" : "Заполняю ответ…");
    const box = modal.closest(".modal-content,[role=dialog],.modal") || modal;
    const fi = box.querySelector("input[type=file]");
    if (v.file) { if (!fi) throw new Error("в окне журнала нет поля для файла"); const dt = new W.DataTransfer(); dt.items.add(v.file); fi.files = dt.files; fi.dispatchEvent(new Event("input", { bubbles: true })); fi.dispatchEvent(new Event("change", { bubbles: true })); await sleep(600); }
    if (v.answer) { const ta = box.querySelector("textarea") || [...box.querySelectorAll("input[type=text]:not([placeholder*=ч]):not([placeholder*=м])")].filter(vis)[0]; if (ta) setVal(ta, v.answer); else if (!v.file) throw new Error("в окне журнала нет поля для текстового ответа"); }
    const tIn = [...box.querySelectorAll("input")].filter(i => /^(чч|hh)$/i.test(i.placeholder || "") || /^(мм|mm)$/i.test(i.placeholder || ""));
    if (tIn.length >= 2 && (v.hh || v.mm)) { setVal(tIn[0], String(+v.hh || 0).padStart(2, "0")); setVal(tIn[1], String(+v.mm || 0).padStart(2, "0")); }
    if (+v.stars) { const f = readPop(box.querySelector(".emoji-evaluation,[class*=evaluation],rating") || box); const st = f.stars[+v.stars - 1]; if (st) { const inp = st.matches("input") ? st : st.querySelector("input"); fire(inp || st); } }
    if (v.ecomment) { const tg = box.querySelector(".want-review-toggle,[class*=review-toggle]"); if (tg) { fire(tg); await sleep(300); } const tas = [...box.querySelectorAll("textarea")]; if (tas.length > 1) setVal(tas[tas.length - 1], v.ecomment); }
    (v.tags || "").split("|").filter(Boolean).forEach(tg => { const it = [...box.querySelectorAll(".evaluation-tags-item,[class*=tags-item],[class*=tag]")].find(e => norm(e.innerText) === norm(tg)); if (it) fire(it); });
    await sleep(300);
    const send = box.querySelector(".btn-accept") || [...box.querySelectorAll("button")].find(b => /^(отправить|загрузить|сдать)$/i.test((b.innerText || "").trim()));
    if (!send) throw new Error("не нашёл кнопку «Отправить» в окне журнала");
    if (send.disabled) throw new Error("журнал не даёт отправить: " + (((box.querySelector(".text-homework-err-wrap") || {}).innerText || "").trim() || "проверь файл и поля"));
    step("Отправляю, жду ответ журнала…"); fire(send);
    // ошибка журнала в окне (например, неподходящий формат файла) - показываем её, окно журнала закрываем
    setTimeout(() => { const er = ((box.querySelector(".text-homework-err-wrap,[class*=err]") || {}).innerText || "").trim(); if (er && box.isConnected) { hwErr = er; const dcl = box.querySelector(".btn-decline"); if (dcl) fire(dcl); } }, 1500);
  }, /homework|hometask|dz/i).catch(e => { if (hwErr) { const m = hwErr; hwErr = ""; throw new Error("журнал ответил: " + m); } const m0 = upModal(); if (m0) { const dcl = (m0.closest(".modal-content,.modal") || m0).querySelector(".btn-decline"); if (dcl) fire(dcl); } throw e; });
  let hwErr = "";

  // окна-формы Дневника
  let curForm = null;
  function formDlg(title, sub, body, submitText, onSubmit, classicLabel) {
    const d = $("#dlg"); d.classList.add("wide");
    d.innerHTML = `<form class="dlg fdlg" id="fdlg"><div class="dh2"><div><h3>${title}</h3><p>${sub}</p></div><button type="button" class="x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="fbody">${body}</div><div class="fstat" id="fstat" hidden></div>
      <div class="ffoot"><button type="button" class="m-btn" data-classic-go="${esc(classicLabel)}">${ic("ext")}Через журнал</button><button type="submit" class="m-btn pri" id="fsend">${ic("send")}${submitText}</button></div></form>`;
    curForm = onSubmit; if (!d.open) d.showModal(); enhanceSelects(d);
    R.getElementById("fdlg").addEventListener("submit", e => { e.preventDefault(); runForm(); });
  }
  async function runForm() {
    const f = R.getElementById("fdlg"), st = R.getElementById("fstat"), btn = R.getElementById("fsend"); if (!f || !curForm) return;
    const val = {}; f.querySelectorAll("[name]").forEach(el => val[el.name] = el.type === "checkbox" ? el.checked : el.type === "file" ? (el.files && el.files[0]) || null : el.value.trim());
    const bad = curForm.check ? curForm.check(val) : ""; if (bad) { st.hidden = false; st.className = "fstat bad"; st.textContent = bad; return; }
    btn.disabled = true; st.hidden = false; st.className = "fstat busy"; st.innerHTML = `<span class="spin"></span>Отправляю через журнал…`;
    try { await curForm.run(val); st.className = "fstat ok"; st.textContent = "Готово: журнал принял отправку"; toast("Отправлено"); setTimeout(() => { const d = $("#dlg"); d && d.open && d.close(); }, 1300); setTimeout(() => sync("after-send"), 1500); }
    catch (e) { st.className = "fstat bad"; st.textContent = "Не получилось: " + e.message + ". Можно отправить через журнал - кнопка слева."; btn.disabled = false; }
  }
  const fField = (label, html) => `<label class="ff"><span>${label}</span>${html}</label>`;
  function openSignalForm() {
    const types = M.sigTypes && M.sigTypes.length ? M.sigTypes : ["Вопрос к учебной части"];
    formDlg("Обращение в учебную часть", "Ответ придёт в раздел «Обращения»", fField("Тема обращения", `<select class="m-in" name="type">${types.map(t => `<option>${esc(t)}</option>`).join("")}</select>`) + fField("Заголовок", `<input class="m-in" name="theme" maxlength="120" placeholder="Коротко о сути">`) + fField("Сообщение", `<textarea class="m-in" name="text" rows="6" placeholder="Опиши вопрос подробно"></textarea>`) + `<label class="m-check"><input type="checkbox" name="urgent"><span>Срочно</span></label>`,
      "Отправить", { check: v => !v.theme ? "Напиши заголовок" : !v.text ? "Напиши сообщение" : "", run: v => sendSignal(v.type, v.theme, v.text, v.urgent) }, "Обращения");
  }
  function openComplaintForm() {
    formDlg("Жалоба генеральному директору", "Опиши ситуацию: что случилось, когда и с кем", fField("Тема", `<input class="m-in" name="theme" maxlength="120">`) + fField("Сообщение", `<textarea class="m-in" name="text" rows="7"></textarea>`),
      "Отправить жалобу", { check: v => !v.theme ? "Напиши тему" : !v.text ? "Напиши сообщение" : "", run: v => sendComplaint(v.theme, v.text) }, "Жалобы");
  }
  function openProfileForm() {
    const p = M.prof || {}, ph = p.phones && p.phones[0] ? p.phones[0] : "";
    formDlg("Изменить данные", p.pending ? "Прошлое изменение ещё на проверке. Новое журнал примет после её подтверждения" : "Изменения проверяет учебная часть, это занимает время", fField("Телефон", `<input class="m-in" name="phone" value="${esc(ph.replace(/^7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4"))}" inputmode="tel">`) + fField("Почта", `<input class="m-in" name="email" type="email" value="${esc(p.email || "")}">`) + fField("Город / адрес", `<input class="m-in" name="address" value="${esc(p.address || "")}">`) + fField("Место учёбы", `<input class="m-in" name="study" value="${esc(p.study || "")}">`),
      "Сохранить", { check: v => v.email && !/^\S+@\S+\.\S+$/.test(v.email) ? "Проверь адрес почты" : "", run: v => sendProfile(v) }, "Личный кабинет");
  }
  function openPasswordForm() {
    formDlg("Сменить пароль", "Новый пароль придёт на почту", fField("Текущий пароль", `<input class="m-in" name="old" type="password" autocomplete="current-password">`) + fField("Новый пароль", `<input class="m-in" name="new1" type="password" autocomplete="new-password">`) + fField("Повтори новый пароль", `<input class="m-in" name="new2" type="password" autocomplete="new-password">`),
      "Сменить пароль", { check: v => !v.old ? "Введи текущий пароль" : v.new1.length < 6 ? "Новый пароль - минимум 6 символов" : v.new1 !== v.new2 ? "Пароли не совпадают" : "", run: v => sendPassword(v.old, v.new1) }, "Личный кабинет");
  }
  function openPhotoForm() {
    formDlg("Загрузить фото", "Фото появится после проверки учебной частью", `<label class="drop" id="drop">${ic("upload")}<b>Выбери фото</b><span id="dropname">JPG или PNG</span><input type="file" name="file" accept="image/*"></label>`,
      "Загрузить", { check: v => !v.file ? "Выбери фото" : "", run: v => sendPhoto(v.file) }, "Личный кабинет");
    const inp = R.querySelector("#drop input"), nm = R.getElementById("dropname"), dr = R.getElementById("drop");
    inp.addEventListener("change", () => { nm.textContent = inp.files[0] ? inp.files[0].name : "JPG или PNG"; dr.classList.toggle("has", !!inp.files[0]); });
  }
  const HW_TAGS = ["Все круто!", "Все понятно!", "Скучно!(", "Задание слишком сложное", "Мне нравится", "Не понятно, но нужно было сделать", "Задание слишком простое"];
  const LESSON_W = ["", "Очень плохо", "Плохо", "Нормально", "Хорошо", "Отлично"];
  const starRow = (id, label) => `<div class="hs-f"><span>${label}</span><div class="rt-stars hwf-stars" data-sr="${id}">${[1, 2, 3, 4, 5].map(k => `<button type="button" class="rt-s" data-sv="${k}" aria-label="${k}"><svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg></button>`).join("")}</div><small class="hs-w" id="w-${id}">не выбрано</small><input type="hidden" name="${id}" value="0"></div>`;
  // отметки (теги) для оценки берём из ответов журнала: ids + русские подписи из его переводов
  const evTags = type => ((NET.evTags || LS.get("evtags", {}))[type] || []);
  const tagRow = (type, name) => { const T = evTags(type); return T.length ? `<div class="hwf-tags" data-tg="${name}">${T.map(t => `<button type="button" class="hwf-tag" data-tv="${esc(t.id)}" aria-pressed="false">${esc(t.label)}</button>`).join("")}</div><input type="hidden" name="${name}" value="">` : ""; };
  let evalBusy = false, tagsP = null;
  function discoverTags(force) {
    const have = evTags("evaluation_lesson_teach").length && evTags("evaluation_lesson").length;
    if (tagsP || (have && !force) || Date.now() - (LS.get("evtagsAt", 0)) < 6 * 3600e3 && !force && have) return tagsP || Promise.resolve();
    return tagsP = (async () => {
      try {
        if (!NET.tr) { try { NET.tr = await api("tr", "public/translations"); delete NET.raw.tr; } catch (e) {} }
        const srcs = [...document.querySelectorAll("script[src]")].map(x => x.src).filter(u => { try { return new URL(u).origin === location.origin && !/vendor|polyfill|runtime/.test(u); } catch (e) { return false; } }); const paths = new Set();
        for (const src of srcs) { try { const t = await (await origFetch(src)).text(); for (const m of t.matchAll(/apiUrl\(\)\+"\/([\w\/-]*tag[\w\/-]*)"/gi)) if (!/homework/.test(m[1])) paths.add(m[1]); } catch (e) {} }
        NET.tagPaths = [...paths];
        ["feedback/students/get-tags", "feedback/students/tags", "feedback/students/evaluate-lesson-tags"].forEach(x => paths.add(x));
        for (const p of paths) for (const q of ["", "?type=evaluation_lesson", "?type=evaluation_lesson_teach"]) {
          try { const r = await api("tags", p + q); delete NET.raw.tags; delete NET.status.tags; if (Array.isArray(r) && r[0] && r[0].translate_key) { NET.tagRaw = (NET.tagRaw || []).concat(r.map(x => Object.assign({ type: x.type || (q ? q.split("=")[1] : "") }, x))); tagLabels(); } } catch (e) { delete NET.status.tags; }
          if (evTags("evaluation_lesson_teach").length && evTags("evaluation_lesson").length) break;
        }
        LS.set("evtagsAt", Date.now());
      } catch (e) {} finally { tagsP = null; }
    })();
  }
  async function openLessonRate(i = 0) {
    if (!evTags("evaluation_lesson_teach").length) await Promise.race([discoverTags(), sleep(4000)]);
    if (!(M.evalList || []).length) { try { const r = await api("evalLessons", "feedback/students/evaluate-lesson-list"); M.evalList = parseEval(r); } catch (e) {} }
    const L = M.evalList || [], e = L[i]; if (!e) { toast("Все пары уже оценены"); return; }
    const d = e.date ? fromIso(e.date) : null;
    formDlg("Оцените занятие", `${L.length > 1 || true ? `<span class="ev-step"><i></i><b class="num">${i + 1} из ${L.length}</b><i></i></span>` : ""}`,
      `<div class="ev-card">${photo("ev-ph", e.photo, e.teacher)}<b class="ev-name">${esc(e.teacher || "Преподаватель")}</b><span class="ev-subj">${esc(e.subj)}</span>${d ? `<span class="ev-date">${d.getDate()} ${MONTHS_G ? MONTHS_G[d.getMonth()] : ""} ${d.getFullYear()}</span>` : ""}</div>
      <div class="ev-band"><span>Оцените работу преподавателя</span>${starRow("mt", "")}<small class="ev-def">Не выбрал - будет 5 звёзд</small></div>
      ${tagRow("evaluation_lesson_teach", "tt")}
      <label class="ev-cm"><span>Комментарий</span><textarea class="m-in" name="ct" rows="3" maxlength="500" placeholder="Ваш комментарий"></textarea><small class="num" id="evcnt">0 / 500</small></label>
      <p class="ev-bonus">Бонус: 1 <span class="coin"></span> за оценку</p>
      <p class="ev-note">Оценки анонимны и преподавателям не предоставляются</p>`,
      i + 1 < L.length ? "Далее" : "Отправить", {
        check: v => +v.mt && +v.mt <= 3 && v.ct.length < 20 ? "При оценке 3 и ниже журнал просит комментарий от 20 символов" : "",
        run: async v => { const tags = (v.tt || "").split(",").filter(Boolean).map(Number);
          const body = { key: e.key, mark_teach: +v.mt || 5, comment_teach: v.ct || "", tags_teach: tags, mark_lesson: null, comment_lesson: "", tags_lesson: [] };
          let r = await postJson("feedback/students/evaluate-lesson", body);
          if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403) r = await postJson("feedback/students/evaluate-lesson", Object.assign(body, { mark_lesson: +v.mt || 5 }));   // если серверу нужна оценка занятия - та же шкала
          const er = apiErr(r); if (er) throw er;
          M.evalList = L.filter(x => x !== e); LS.set("model", M); if (M.evalList.length) setTimeout(() => openLessonRate(0), 1450); else { setTimeout(render, 900); setTimeout(() => sync("after-eval"), 1500); } } }, "Главная");
    const f = R.getElementById("fdlg"); f.classList.add("hsend", "evdlg");
    const ta = f.querySelector("[name=ct]"), cnt = R.getElementById("evcnt"); ta.addEventListener("input", () => cnt.textContent = ta.value.length + " / 500");
    R.querySelectorAll("[data-sr]").forEach(g => g.addEventListener("click", ev => { const b = ev.target.closest("[data-sv]"); if (!b) return; const id = g.dataset.sr, inp = R.querySelector(`[name=${id}]`); inp.value = b.dataset.sv;
      g.querySelectorAll(".rt-s").forEach(x => x.classList.toggle("on", +x.dataset.sv <= +inp.value)); R.getElementById("w-" + id).textContent = LESSON_W[+inp.value]; }));
    R.querySelectorAll("[data-tg]").forEach(g => g.addEventListener("click", ev => { const b = ev.target.closest("[data-tv]"); if (!b) return; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
      R.querySelector(`[name=${g.dataset.tg}]`).value = [...g.querySelectorAll("[aria-pressed=true]")].map(x => x.dataset.tv).join(","); }));
  }
  const MONTHS_G = MON;
  const hwRef = h => h.id != null ? "id" + h.id : "i" + (M.hw || []).indexOf(h);
  function openHwForm(ref) {
    ref = String(ref); const L = M.hw || [];
    const h = ref.startsWith("id") ? L.find(x => String(x.id) === ref.slice(2)) : L[+ref.replace(/^i/, "")]; if (!h) { toast("Задание не найдено - обнови данные"); return; }
    const d = h.due ? fromIso(h.due) : null, left = d ? Math.ceil((d - new Date(new Date().toDateString())) / 864e5) : null;
    const dueChip = d ? `<span class="hs-chip ${left < 0 ? "bad" : left <= 1 ? "warn" : ""}">${ic("clock")}срок ${dm(d)}${left != null ? " · " + (left < 0 ? "просрочено" : left === 0 ? "сегодня" : left === 1 ? "завтра" : "осталось " + left + " " + plural(left, "день", "дня", "дней")) : ""}</span>` : "";
    const WORDS = ["", "Совсем не хватило", "Скорее не хватило", "Частично", "В основном хватило", "Полностью хватило"];
    formDlg(`Сдать задание`, `<b class="hs-subj">${esc(h.subj)}</b>${h.theme ? `<span class="hs-theme">${esc(h.theme)}</span>` : ""}<span class="hs-meta">${dueChip}${h.teacher ? `<span class="hs-chip">${ic("profile")}${esc(h.teacher)}</span>` : ""}</span>`,

      `<section class="hs-sec"><div class="hs-h"><b>1</b><div><h4>Твоя работа</h4><p>Файл, текст или оба сразу</p></div></div>
        <label class="hs-drop" id="drop"><span class="hs-ic">${ic("upload")}</span><span class="hs-dt"><b id="dropb">Выбери файл</b><small id="dropname">или перетащи сюда · архив, документ, фото · не .txt и не .csv</small></span><span class="hs-x" id="dropx" hidden title="Убрать файл">×</span><input type="file" name="file"></label>
        <textarea class="m-in" name="answer" rows="2" placeholder="Ответ текстом или ссылка на работу (необязательно)"></textarea></section>
      <section class="hs-sec hs-fb"><div class="hs-h"><b>2</b><div><h4>Отзыв для журнала</h4><p>Журнал спрашивает это при сдаче · можно пропустить</p></div></div>
        <div class="hs-row"><div class="hs-rl">${ic("clock")}<span>Сколько времени ушло</span></div>
          <div class="hs-tline"><div class="hs-quick">${[[0, 15], [0, 30], [1, 0], [2, 0]].map(([a, b]) => `<button type="button" data-q="${a}|${b}" aria-pressed="false">${a ? a + " ч" : b + " мин"}</button>`).join("")}</div>
          <div class="hwf-time"><input class="m-in num" name="hh" inputmode="numeric" maxlength="2" placeholder="0"><small>ч</small><input class="m-in num" name="mm" inputmode="numeric" maxlength="2" placeholder="00"><small>мин</small></div></div></div>
        <div class="hs-row"><div class="hs-rl">${ic("star")}<span>Хватило знаний с урока?</span><em class="hs-w" id="hsw">не выбрано</em></div>
          <div class="rt-stars hwf-stars" id="hwst">${[1, 2, 3, 4, 5].map(k => `<button type="button" class="rt-s" data-hs="${k}" aria-label="${k}"><svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg></button>`).join("")}</div></div>
        <div class="hs-row"><div class="hs-rl">${ic("chat")}<span>Впечатление</span><small>можно несколько</small></div>
          <div class="hwf-tags">${HW_TAGS.map(t => `<button type="button" class="hwf-tag" data-ht="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("")}</div></div>
        <div class="hs-row"><button type="button" class="hs-ctog" id="hsct" aria-pressed="false">+ Добавить комментарий к заданию</button>
          <textarea class="m-in" name="ecomment" id="hsc" rows="3" maxlength="500" placeholder="Твой комментарий к заданию" hidden></textarea></div>
        <input type="hidden" name="stars" value="0"><input type="hidden" name="tags" value=""></section>`,
      "Сдать задание", { check: v => !v.file && !v.answer ? "Прикрепи файл или напиши ответ" : v.file && /\.(txt|csv)$/i.test(v.file.name) ? "Журнал не принимает .txt и .csv - заархивируй файл или сохрани в другом формате" : (v.hh && !/^\d{1,2}$/.test(v.hh)) || (v.mm && !(/^\d{1,2}$/.test(v.mm) && +v.mm < 60)) ? "Время: часы и минуты цифрами" : "", run: async v => { if (h.id != null) { try { return await sendHwDirect(h, v); } catch (e) { if (e.final) throw e; pushW("  ↳ прямая отправка не прошла (" + e.message + "), пробую через окно журнала"); } } return sendHw(h, v); } }, "ДЗ");
    R.getElementById("fdlg").classList.add("hsend");
    const inp = R.querySelector("#drop input"), nm = R.getElementById("dropname"), nb = R.getElementById("dropb"), dr = R.getElementById("drop"), dx = R.getElementById("dropx");
    const paint = () => { const f = inp.files[0]; nb.textContent = f ? f.name : "Выбери файл"; nm.textContent = f ? `${Math.max(1, Math.round(f.size / 1024))} КБ · нажми, чтобы заменить` : "или перетащи сюда · архив, документ, фото · не .txt и не .csv"; dr.classList.toggle("has", !!f); dx.hidden = !f; };
    inp.addEventListener("change", paint);
    dx.addEventListener("click", e => { e.preventDefault(); e.stopPropagation(); inp.value = ""; paint(); });
    dr.addEventListener("dragover", e => { e.preventDefault(); dr.classList.add("over"); }); dr.addEventListener("dragleave", () => dr.classList.remove("over"));
    dr.addEventListener("drop", e => { e.preventDefault(); dr.classList.remove("over"); if (e.dataTransfer.files[0]) { inp.files = e.dataTransfer.files; paint(); } });
    const hs = R.getElementById("hwst"), hsv = R.querySelector("[name=stars]"), htv = R.querySelector("[name=tags]"), hw = R.getElementById("hsw");
    hs.addEventListener("click", e => { const b = e.target.closest("[data-hs]"); if (!b) return; hsv.value = hsv.value === b.dataset.hs ? "0" : b.dataset.hs; hs.querySelectorAll(".rt-s").forEach(x => x.classList.toggle("on", +x.dataset.hs <= +hsv.value)); hw.textContent = WORDS[+hsv.value] || "не выбрано"; });
    R.querySelector(".hs-quick").addEventListener("click", e => { const b = e.target.closest("[data-q]"); if (!b) return; const [a, m] = b.dataset.q.split("|"); R.querySelector("[name=hh]").value = a; R.querySelector("[name=mm]").value = String(m).padStart(2, "0"); R.querySelectorAll(".hs-quick [data-q]").forEach(x => x.setAttribute("aria-pressed", x === b)); });
    R.querySelectorAll("[name=hh],[name=mm]").forEach(i => i.addEventListener("input", () => R.querySelectorAll(".hs-quick [data-q]").forEach(x => x.setAttribute("aria-pressed", "false"))));
    R.getElementById("hsct").addEventListener("click", e => { const b = e.currentTarget, on = b.getAttribute("aria-pressed") !== "true", ta = R.getElementById("hsc"); b.setAttribute("aria-pressed", on); ta.hidden = !on; b.textContent = on ? "− Убрать комментарий" : "+ Добавить комментарий к заданию"; if (on) ta.focus(); else ta.value = ""; });
    R.querySelector(".hwf-tags").addEventListener("click", e => { const b = e.target.closest("[data-ht]"); if (!b) return; b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true"); htv.value = [...R.querySelectorAll(".hwf-tag[aria-pressed=true]")].map(x => x.dataset.ht).join("|"); });
  }


  /* ======================= страницы сервисных разделов ======================= */
  const sHero = (p, extra = "") => `<section class="m-hero"><div class="m-ic">${ic(p.ic, "i big")}</div><div><b>${esc(p.n)}</b><span>${esc(p.d || "")}</span></div>${extra}</section>`;
  const P = id => PAGES.find(x => x.id === id);
  const goBtn = (label, text, pri) => `<button class="m-btn ${pri ? "pri" : ""}" data-classic-go="${esc(label)}">${text}</button>`;
  const copyBtn = v => `<button class="cpy" data-copy="${esc(v)}" title="Скопировать">${ic("copy")}</button>`;

  VIEWS.materials = () => `${sHero(P("materials"))}
    ${M.lib && M.lib.length ? `<section class="card"><div class="hd"><h2>Материалы</h2><small class="num">${M.lib.length}</small></div><div class="list">${M.lib.map(x => `<div class="li">${ic("book")}<div class="grow"><b>${esc(x.title)}</b><span>${esc(x.subj)}${x.date ? " · " + dm(fromIso(x.date)) : ""}</span></div>${x.url && /^https?:/.test(x.url) ? `<a class="m-btn" href="${esc(x.url)}" target="_blank" rel="noopener">Открыть</a>` : ""}</div>`).join("")}</div></section>` : `<p class="note">${M.libCount != null ? "В журнале материалов: " + M.libCount + "." : ""} Как только преподаватели что-то выложат, список появится здесь.</p>`}
    <div class="row r3">${[["Уроки", "book"], ["Библиотека", "book"], ["Видео", "play"], ["Статьи", "hw"], ["Практические задания", "check"], ["Тесты", "poll"]].map(([n, i]) => `<div class="card mat">${ic(i, "i big")}<div><b>${n}</b><span>Материалов пока нет</span></div><span class="cnt num">0</span></div>`).join("")}</div>
    <div class="card hint">${ic("help")}<div><b>Где брать материалы к парам</b><span>Преподаватели выкладывают сюда методические материалы и рекомендации. Файлы к конкретным заданиям лежат в карточках домашних заданий: кнопка «Файл задания».</span></div><button class="m-btn" data-page="homework">Домашние задания</button></div>`;

  VIEWS.market = () => `${sHero(P("market"), goBtn("Маркет", ic("ext") + "Открыть Маркет", true))}
    ${M.market && M.market.length ? `<div class="hwgrid">${M.market.map(x => `<div class="card mkt">${x.img ? `<img src="${esc(x.img)}" alt="">` : ""}<b>${esc(x.name)}</b>${x.price != null ? `<span class="rw num">${x.price} <span class="${x.cur === 2 ? "gem" : "coin"}"></span></span>` : ""}</div>`).join("")}</div>` : `<p class="note">${M.market ? "Сейчас в Маркете для твоего филиала нет товаров." : ""}</p>`}
    ${cfg.mc ? `<div class="card hint nomc">${ic("help")}<div><b>Золото и изумруды</b><span>Это те же топкоины (золото) и топгемы (изумруды) журнала - включён пиксельный вид валюты. Вернуть: Настройки → Валюта → «Как в журнале»</span></div></div>` : ""}
    <div class="row r2"><div class="card kpi"><div class="lab"><span class="coin"></span>Топкоины${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.coins ?? "-"}</div><div class="sub">за посещения, сданные вовремя ДЗ и работу на паре</div></div>
    <div class="card kpi"><div class="lab"><span class="gem"></span>Топгемы${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.gems ?? "-"}</div><div class="sub">за оценки</div></div></div>
    <div class="card hint">${ic("bag")}<div><b>Как купить</b><span>Товары покупаются за накопленные топкоины и топгемы. Покупки не влияют на рейтинг. Забрать товар можно в учебной части филиала.</span></div></div>`;

  const rub = n => (+n || 0).toLocaleString("ru-RU") + " ₽";
  VIEWS.payment = () => {
    const LP = M.pay;
    if (!LP) { prepareClassic("Оплата"); return `${sHero(P("payment"), `<button class="m-btn pri" data-oclick="Оплата|скачать сч|Счёт скачивается">${ic("hw")}Скачать счёт</button>` + goBtn("Оплата", ic("ext") + "Открыть в журнале"))}<div class="card"><div class="restday"><b>Данные об оплате не пришли</b>Журнал не отдал раздел оплаты. Нажми «Обновить» вверху или открой раздел в журнале</div></div>`; }
    return payView({ recv: LP.recv, inn: LP.inn, bik: LP.bik, acc: LP.acc, purpose: LP.purpose, plan: LP.plan || [], hist: LP.hist || [] }, LP);
  };
  function payView(PAY, LP) {
    const now = new Date(), next = PAY.plan.find(x => fromIso(x[0]) >= now), paid = PAY.hist.reduce((a, x) => a + x[2], 0), left = PAY.plan.reduce((a, x) => a + x[2], 0);
    const days = next ? dayDiff(now, fromIso(next[0])) : null;
    prepareClassic("Оплата");
    return `${sHero(P("payment"), `<button class="m-btn pri" data-oclick="Оплата|скачать сч|Счёт скачивается">${ic("hw")}Скачать счёт</button>`)}
    <div class="m-alert">${ic("alert")}<span>Оплата принимается только безналичным способом. Если требуют наличные - сообщите через «Заявить о нарушении» в разделе оплаты.</span></div>
    <div class="row r3">
      <div class="card kpi"><div class="lab">${ic("cal")}Следующий платёж</div><div class="val num" style="font-size:30px">${next ? rub(next[2]) : "-"}</div><div class="sub">${next ? `до ${longDate(fromIso(next[0]))} ${fromIso(next[0]).getFullYear()} · через <b class="num">${days}</b> ${plural(days, "день", "дня", "дней")}` : "платежей нет"}</div></div>
      <div class="card kpi"><div class="lab">${ic("check")}Оплачено</div><div class="val num" style="font-size:30px">${rub(paid)}</div><div class="sub"><b class="num">${PAY.hist.length}</b> ${plural(PAY.hist.length, "платёж", "платежа", "платежей")}</div></div>
      <div class="card kpi"><div class="lab">${ic("card")}Осталось по графику</div><div class="val num" style="font-size:30px">${rub(left)}</div><div class="sub"><b class="num">${PAY.plan.length}</b> ${plural(PAY.plan.length, "платёж", "платежа", "платежей")}</div></div>
    </div>
    <div class="row r2">
      <section class="card"><div class="hd"><h2>Реквизиты для оплаты</h2><small>нажми, чтобы скопировать</small></div>
        ${[["Получатель", PAY.recv], ["ИНН", PAY.inn], ["БИК", PAY.bik], ["Расчётный счёт", PAY.acc], ...(LP && LP.bank ? [["Банк", LP.bank]] : []), ["Назначение платежа", PAY.purpose]].map(([k, v]) => `<dl class="m-kv"><dt>${k}</dt><dd>${esc(v)}${copyBtn(v)}</dd></dl>`).join("")}</section>
      <div class="m-stack">
        <section class="card"><div class="hd"><h2>График платежей</h2></div><div class="tscroll"><table class="t m-t"><thead><tr><th>Оплатить до</th><th>Описание</th><th class="r">Сумма</th></tr></thead><tbody>${PAY.plan.map(x => `<tr><td class="num">${dm(fromIso(x[0]))}.${x[0].slice(0, 4)}</td><td>${esc(x[1])}</td><td class="r num"><b>${rub(x[2])}</b>${x[3] ? ' <span class="stat-good">оплачено</span>' : ""}</td></tr>`).join("")}</tbody></table></div></section>
        <section class="card"><div class="hd"><h2>История платежей</h2></div><div class="tscroll"><table class="t m-t"><thead><tr><th>Дата</th><th>Назначение</th><th class="r">Оплачено</th></tr></thead><tbody>${PAY.hist.map(x => `<tr><td class="num">${dm(fromIso(x[0]))}.${x[0].slice(0, 4)}</td><td>${esc(x[1]) || '<span class="soft">-</span>'}</td><td class="r num stat-good"><b>${rub(x[2])}</b></td></tr>`).join("")}</tbody></table></div></section>
      </div></div>
    <div class="btns"><button class="m-btn" data-oclick="Оплата|заявить о нарушении|Форма открыта поверх Дневника">${ic("alert")}Заявить о нарушении</button><span class="note" style="align-self:center">${LP ? `Данные журнала${LP.updated ? ", обновлены " + dm(fromIso(LP.updated)) : ""}${LP.debt ? ` · задолженность <b class="stat-bad">${rub(LP.debt)}</b>` : " · задолженности нет"}` : ""}. Счёт скачивается в журнале.</span></div>`;
  }

  VIEWS.profile = () => {
    const u = M.user, bd = u.birthday ? fromIso(isoOf(u.birthday)) : null, reg = u.registration_date ? fromIso(isoOf(u.registration_date)) : null;
    return `<section class="hero prof"><div class="hero-id">${photo("xl")}<div><div class="cap">${esc(u.group || "")}${u.stream_name ? " · " + esc(u.stream_name) : ""}</div><h2>${esc(u.name || "")}</h2>
      <div class="facts"><span>Уровень <b class="num">${u.level ?? "-"}</b></span><span>Достижений <b class="num">${u.achieves_count ?? "-"}</b></span><span>Топкоины <b class="num">${u.coins ?? "-"}</b></span><span>Топгемы <b class="num">${u.gems ?? "-"}</b></span></div></div></div></section>
    <div class="row r2">
      <section class="card"><div class="hd"><h2>Данные</h2><small>меняются через учебную часть после модерации</small></div>
        <dl class="m-kv"><dt>ФИО</dt><dd>${esc(u.name || "-")}</dd></dl>
        <dl class="m-kv"><dt>Группа</dt><dd>${esc(u.group || "-")}</dd></dl>
        ${u.stream_name ? `<dl class="m-kv"><dt>Поток</dt><dd>${esc(u.stream_name)}</dd></dl>` : ""}
        ${bd ? `<dl class="m-kv"><dt>Дата рождения</dt><dd class="num">${longDate(bd)} ${bd.getFullYear()}</dd></dl>` : ""}
        ${reg ? `<dl class="m-kv"><dt>В журнале с</dt><dd class="num">${longDate(reg)} ${reg.getFullYear()}</dd></dl>` : ""}
        ${M.prof && M.prof.phones.length ? `<dl class="m-kv"><dt>Телефон</dt><dd class="num">${M.prof.phones.map(p => esc(p.replace(/^7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4"))).join(", ")}</dd></dl>` : ""}
        ${M.prof && M.prof.email ? `<dl class="m-kv"><dt>Почта</dt><dd>${esc(M.prof.email)}</dd></dl>` : ""}
        ${M.prof && M.prof.address ? `<dl class="m-kv"><dt>Город</dt><dd>${esc(M.prof.address)}</dd></dl>` : ""}
        ${M.prof && M.prof.study ? `<dl class="m-kv"><dt>Учёба</dt><dd>${esc(M.prof.study)}</dd></dl>` : ""}
        ${M.prof && M.prof.links.length ? `<dl class="m-kv"><dt>Ссылки</dt><dd>${M.prof.links.map(l => `<a class="m-link" href="${esc(/^https?:/.test(l.value) ? l.value : "https://" + l.value)}" target="_blank" rel="noopener">${esc(l.value.replace(/^https?:\/\//, ""))}</a>`).join("<br>")}</dd></dl>` : ""}
        <dl class="m-kv"><dt>Телефон</dt><dd>${u.phoneOk === false ? '<span class="stat-bad">не подтверждён</span>' : '<span class="stat-good">подтверждён</span>'}</dd></dl>
        <dl class="m-kv"><dt>Почта</dt><dd>${u.emailOk === false ? '<span class="stat-bad">не подтверждена</span>' : '<span class="stat-good">подтверждена</span>'}</dd></dl></section>
      <section class="card"><div class="hd"><h2>Действия</h2></div>
        <div class="acts2"><button class="m-btn pri" data-form="profile">${ic("profile")}Изменить данные</button><button class="m-btn" data-form="photo">${ic("upload")}Загрузить фото</button><button class="m-btn" data-form="password">${ic("gear")}Сменить пароль</button></div>
        <div class="card hint" style="margin-top:14px;box-shadow:none">${ic("trophy")}<div><b>Профиль заполнен${M.prof && M.prof.fill != null ? " на " + M.prof.fill + "%" : ""}</b><span>${M.prof && M.prof.pending ? "Изменения ждут подтверждения учебной части." : M.prof && M.prof.fill >= 100 ? "Награда «Полностью заполненный профиль» (+5 топкоинов) уже получена." : "Заполни профиль полностью, чтобы получить +5 топкоинов."}${M.prof && M.prof.decline ? " Отклонено: " + esc(M.prof.decline) : ""}</span></div></div></section>
    </div>`;
  };

  const talk = (p, label, lines, btn, list) => `${sHero(p)}
    <div class="row r2"><section class="card"><div class="hd"><h2>Написать</h2></div>${lines.map(l => `<div class="li2">${ic("check")}<span>${l}</span></div>`).join("")}
      <div class="btns"><button class="m-btn pri" data-form="${p.id === "requests" ? "signal" : "complaint"}">${ic("chat")}${btn}</button>${goBtn(label, ic("ext") + "Через журнал")}</div><p class="note">Письмо уходит прямо из Дневника. Если что-то пойдёт не так, откроется форма журнала.</p></section>
    <section class="card"><div class="hd"><h2>${p.id === "requests" ? "Мои обращения" : "Мои жалобы"}</h2>${list ? `<small class="num">${list.length}</small>` : ""}</div>
      ${list && list.length ? `<div class="list">${list.map(x => `<div class="li"><div class="grow"><b>${esc(x.title)}</b><span class="num">${x.date ? dm(fromIso(x.date)) + "." + x.date.slice(0, 4) : ""}${x.days != null ? " · в работе " + x.days + " дн." : ""}</span></div>${x.status ? `<span class="tag">${esc(x.status)}</span>` : ""}</div>`).join("")}</div>` : `<div class="restday"><b>Пока пусто</b>Здесь будет статус ответа и число дней в работе</div>`}</section></div>`;
  VIEWS.requests = () => talk(P("requests"), "Обращения", (M.sigTypes && M.sigTypes.length ? M.sigTypes.map(t => "Тема: " + t) : ["Вопросы по учёбе, расписанию и оценкам"]).concat(["Справка об обучении готовится до 3 календарных дней", "Можно отметить «Срочно»"]), "Написать в учебную часть", M.signals);
  VIEWS.complaints = () => talk(P("complaints"), "Жалобы", ["Жалоба по учебному процессу", "Нет связи с филиалом", "Нет ответа на обращения"], "Написать жалобу");

  VIEWS.contacts = () => `${sHero(P("contacts"))}
    <div class="row r2">
      <section class="card"><div class="hd"><h2>Адрес</h2></div>
        ${M.contacts && M.contacts.address ? `<dl class="m-kv"><dt>Филиал</dt><dd>${esc(M.contacts.address)}${copyBtn(M.contacts.address)}</dd></dl>` : ""}
        <dl class="m-kv"><dt>Сайт</dt><dd><a class="m-link" href="https://top-university.ru/" target="_blank" rel="noopener">top-university.ru</a></dd></dl>
        ${(M.contacts && M.contacts.curators || []).map(c => `<dl class="m-kv"><dt>Учебная часть</dt><dd>${esc(c.name)}${c.mails.map(m => `<br><span class="m-link">${esc(m)}</span>${copyBtn(m)}`).join("")}</dd></dl>`).join("")}
        <div class="btns">${M.contacts && M.contacts.address ? `<a class="m-btn" href="https://yandex.ru/maps/?text=${encodeURIComponent(M.contacts.address)}" target="_blank" rel="noopener">${ic("pin")}Яндекс Карты</a>` : goBtn("Контакты", ic("pin") + "Открыть карту")}</div></section>
      <section class="card"><div class="hd"><h2>Приёмная комиссия</h2></div><div class="li2">${ic("check")}<span>Вопросы по покупке новых курсов</span></div><div class="li2">${ic("check")}<span>Записать на обучение друзей и знакомых</span></div><div class="btns"><a class="m-btn pri" href="https://top-university.ru/" target="_blank" rel="noopener">${ic("ext")}Оставить заявку на сайте</a></div></section>
      <section class="card"><div class="hd"><h2>Учебная часть</h2></div><div class="li2">${ic("check")}<span>Общие вопросы</span></div><div class="li2">${ic("check")}<span>Вопросы по учебному процессу</span></div><div class="li2">${ic("check")}<span>Вопросы по оплате и содержанию курсов</span></div><div class="btns"><button class="m-btn pri" data-form="signal">Задать вопрос</button></div></section>
      <section class="card"><div class="hd"><h2>Претензии и разногласия</h2></div><div class="li2">${ic("check")}<span>Жалоба по учебному процессу</span></div><div class="li2">${ic("check")}<span>Нет связи с филиалом</span></div><div class="li2">${ic("check")}<span>Нет ответа по вашим вопросам</span></div><div class="btns"><button class="m-btn pri" data-form="complaint">Отправить жалобу</button></div></section>
    </div>`;

  const FAQ = [
    ["Доступ и вход", [
      ["Как получить или восстановить доступ?", "На странице входа нажмите «Забыли пароль», укажите свою почту и нажмите «Отправить». На почту придёт письмо с логином и паролем. Если письма нет - обратитесь в учебную часть."],
      ["Не получается войти", "Проверьте раскладку клавиатуры и Caps Lock. Входите по адресу journal.top-academy.ru/login/index. Если данные верные, но вход не работает - сбросьте пароль или обратитесь в учебную часть."],
      ["Как изменить личные данные и пароль?", "В личном кабинете можно поменять фото, телефон и ссылки на соцсети. Для смены пароля введите текущий пароль и дважды новый, новый пароль придёт на почту."],
      ["Почему не меняются личные данные?", "Все изменения, кроме пароля, проходят модерацию в учебной части. После подтверждения менеджером их снова можно менять."]]],
    ["Учебный процесс", [
      ["Когда каникулы?", "Смотрите учебный план или спросите в учебной части филиала."],
      ["Где ссылка на онлайн-урок?", "Онлайн-уроки проходят в Microsoft Teams. Установите приложение на компьютер или телефон и войдите под своей учётной записью."],
      ["Как попасть на дополнительные занятия?", "Два варианта: индивидуальные платные занятия с преподавателем под ваш запрос или бесплатная групповая отработка, где преподаватель отвечает на вопросы потока."]]],
    ["Домашние задания", [
      ["Можно ли пересдать ДЗ?", "Если не согласны с оценкой за ДЗ или лабораторную, нажмите «Запрос на пересдачу». За пересдачу снимается 2 топгема, новые топгемы при повышении оценки не начисляются."],
      ["Почему ДЗ ещё не проверено?", "На проверку у преподавателя в среднем 4 дня. Если срок прошёл - напишите в учебную часть через «Обращения»."],
      ["Где академические долги?", "В разделе «Оценки», подраздел «Несданные экзамены»."],
      ["ДЗ не открывается или не загружается", "Обратитесь напрямую в учебную часть филиала."]]],
    ["Оценки и посещаемость", [
      ["Как считается средний балл?", "По сумме всех оценок за весь курс, независимо от переводов между группами. Типы оценок, которых у студента нет, не учитываются."],
      ["Как отмечается посещаемость?", "Преподаватель отмечает присутствие в первые 15 минут пары. Если пришли позже - ставится опоздание. Опоздания влияют на оценку посещаемости и успеваемость."],
      ["Можно перевестись в другую группу?", "Рассматривается индивидуально, обратитесь в учебную часть филиала."],
      ["Как оценить преподавателя?", "После пары появляется окно: поставьте оценку звёздами, отметьте кнопками и тегами, как прошло занятие, добавьте комментарий. Оценки анонимны и преподавателю не показываются."]]],
    ["Топкоины, топгемы и награды", [
      ["За что начисляются топкоины?", "+1 за посещение пары, +1 за своевременную сдачу ДЗ или лабораторной (за просроченное не даётся), от 1 до 5 - поощрение преподавателя за работу на уроке, +1/+2/+5 за 5/10/20 посещений подряд без пропусков, +1/+2/+3 за 5/10/20 без опозданий, +5 за заполненный профиль, +1 за футболку с логотипом, +10 за приведённого друга, +20 за опрос, +20 за отзыв в соцсетях, от 1 до 100 за конкурс."],
      ["Что такое достижения?", "Награды, которые можно получить только один раз. На баллы и рейтинг не влияют."],
      ["Как получить награду за конкурс, друга или футболку?", "Обратитесь в учебную часть филиала - начисление делают вручную."],
      ["Что купить в Маркете?", "Товары за топкоины и топгемы. На рейтинг покупки не влияют. Забрать товар - в учебной части."]]],
    ["Оплата и документы", [
      ["Какие способы оплаты?", "Онлайн через приложение банка или по счёту в отделении банка. Наличными не принимается."],
      ["Где счёт, реквизиты и график?", "В разделе «Оплата». QR-код для оплаты - на последней странице договора, в назначении укажите номер договора."],
      ["Можно перенести дату платежа?", "Через заявление в учебной части, не больше чем на 14 дней и при отсутствии задолженности."],
      ["Оплата не прошла", "Если прошло больше 3 дней - проверьте реквизиты и назначение платежа, затем обратитесь в учебную часть."],
      ["Как получить справку об обучении?", "В «Обращениях» нажмите «Получить справку». Срок - до 3 календарных дней."]]],
    ["Прочее", [
      ["Как связаться с администрацией?", "Через раздел «Контакты» или «Обращения»."],
      ["Где оставить отзыв об академии?", "На Google Картах, Яндекс Картах, Zoon или 2ГИС. Скриншот отзыва отправьте в учебную часть, чтобы получить +20."]]]
  ];
  VIEWS.faq = () => {
    const q = faqq; let n = 0;
    const blocks = FAQ.map(([sec, items]) => { const f = items.filter(([a, b]) => !q || norm(a + " " + b).includes(q)); n += f.length; return f.length ? `<section class="card"><div class="hd"><h2>${sec}</h2><small class="num">${f.length}</small></div>${f.map(([a, b]) => `<details class="qa" ${q ? "open" : ""}><summary>${esc(a)}${ic("chev")}</summary><p>${esc(b)}</p></details>`).join("")}</section>` : ""; }).join("");
    return `${sHero(P("faq"))}<div class="search">${ic("search")}<input id="faqq" placeholder="Поиск по вопросам: оплата, пароль, пересдача…" value="${esc(faqq)}" autocomplete="off"></div>
      ${blocks || `<div class="card"><div class="restday"><b>Ничего не найдено</b>Попробуй другое слово</div></div>`}`;
  };

  /* живая пара */
  let lastKey = "";
  let npKey = "";
  function tick() {
    if (!R) return;
    const now = new Date(), box = $("#now");
    const hero = R.querySelector(".hero[data-dp]"); if (hero && hero.dataset.dp !== dayPart(now.getHours()) && !$("#dlg").open) { render(); return; }
    const np = $("#nowpill"), fc = focus(now);
    if (np) {
      const { cur } = fc;
      if (cur) { const k = "c" + cur.day + cur.l.start;
        if (npKey !== k) { npKey = k; np.hidden = false; np.className = "nowpill live"; np.title = `${cur.l.subj} · ${roomTxt(cur.l.room)}`; np.innerHTML = `<span class="dot"></span><span class="tx"><span class="lbl2">Сейчас</span><b>${esc(cur.l.subj)}</b><span class="num">· ${cur.l.start} - ${cur.l.end}</span></span>`; }
      } else if (npKey !== "-") { npKey = "-"; np.hidden = true; }
    }
    if (box) {
      const { cur } = fc;
      if (!cur) { box.hidden = true; lastKey = ""; }
      else { const l = cur.l, k = cur.day + l.start, pi = pairIndex()(l.start);
        if (lastKey !== k || box.hidden) { lastKey = k; box.hidden = false;
          box.innerHTML = `<div><div class="cap">Сейчас идёт${pi >= 0 ? ` · ${pi + 1} пара` : ""}</div><div class="subj">${esc(l.subj)}</div><div class="meta">${esc(roomTxt(l.room))} · ${esc(l.teacher)}</div></div>
          <div class="cd"><span class="cap">Время пары</span><b class="num tm2">${l.start} - ${l.end}</b></div>`; } }
    }
    const nt = now.getTime();
    R.querySelectorAll(".lesson[data-s]").forEach(el => { const s = +el.dataset.s, e = +el.dataset.e, live = s <= nt && nt < e; el.classList.toggle("past", e && nt >= e); el.classList.toggle("live", live); el.querySelector(".p").style.width = live ? ((nt - s) / (e - s) * 100) + "%" : "0"; });
  }

  /* окна */
  function openDlg(cls, title, sub, rows, note) {
    const d = $("#dlg");
    d.innerHTML = `<div class="dlg ${cls}"><div class="dh2"><div><h3>${title}</h3><p class="num">${sub}</p></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div><dl class="num">${rows.map(r => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("")}</dl>${note ? `<div class="nt">${note}</div>` : ""}</div>`;
    d.showModal();
  }
  function openLesson(key) {
    const [day, start] = key.split("|"); const l = lessonsOn(fromIso(day)).find(x => x.start === start); if (!l) return;
    const d = fromIso(day);
    openDlg("s-" + subjKey(l.subj), esc(l.subj), `${DAYS[(d.getDay() + 6) % 7]}, ${longDate(d)}`, [["Время", `${l.start} - <span class="end">${l.end}</span>`], ["Аудитория", esc(roomTxt(l.room))], ["Преподаватель", esc(l.teacher)]]);
  }
  function openGrade(n) {
    const v = (M.visits || []).find(x => x.n === n); if (!v) return; const d = fromIso(v.date);
    const m = (k, cls) => v[k] != null ? `<span class="mark5 ${cls} ${vClass(v[k])}" style="display:inline-grid">${v[k]}</span>` : '<span class="soft">-</span>';
    const rows = [["Дата", `${DAYS[(d.getDay() + 6) % 7]}, ${longDate(d)}`]];
    if (v.teacher) rows.push(["Преподаватель", esc(v.teacher)]);
    if (v.topic) rows.push(["Тема", esc(v.topic)]);
    rows.push(["Посещение", v.miss ? '<span class="stat-bad">Пропуск</span>' : v.late ? '<span class="stat-bad">Опоздание</span>' : '<span class="stat-good">Был на паре</span>']);
    rows.push(["Домашнее задание", m("hw", "hw")], ["Классная работа", m("cw", "cw")]);
    ["lab", "ctrl", "prac", "fin"].forEach(k => { if (v[k] != null) rows.push([MK_N[k] + " работа", m(k, k)]); });
    openDlg("s-" + subjKey(v.subj), `Пара № ${v.n}`, esc(v.subj), rows);
  }

  /* события */
  function onClick(e) {
    if (CRYPTO && mkClick(e)) return;
    if (!e.target.closest(".dd")) closeDD();
    { const rt = e.target.closest("[data-rs],[data-ro],[data-rb],[data-rclose]"); if (rt && rateClick(rt)) return; }
    const t = e.target.closest("[data-gw],[data-am],[data-af],[data-lb],[data-act],[data-page],[data-les],[data-g],[data-day],[data-gm],[data-nf],[data-nw],[data-classic-go],[data-set],[data-tip],[data-sum],[data-gsub],[data-gt],[data-agt],[data-gper],[data-hwx],[data-copy],[data-hwf],[data-form],[data-oclick],[data-calm]"); if (!t) return;
    if (t.closest("#fdlg") && t.type === "submit") return;
    if (t.dataset.copy !== undefined) { const v = t.dataset.copy; const ok = () => { t.classList.add("ok"); t.innerHTML = ic("check"); setTimeout(() => { t.classList.remove("ok"); t.innerHTML = ic("copy"); }, 1200); }; navigator.clipboard ? navigator.clipboard.writeText(v).then(ok, () => toast("Не удалось скопировать")) : toast("Не удалось скопировать"); return; }
    if (t.tagName === "A" && !t.target) e.preventDefault();
    if (t.dataset.hwf !== undefined) { openHwForm(t.dataset.hwf); return; }
    if (t.dataset.tip) { toast(t.dataset.tip, true); return; }
    if (t.dataset.sum) { openSummary(t.dataset.sum); return; }
    if (t.dataset.gsub !== undefined) { const g = LS.get("goal", {}); g.subj = t.dataset.gsub; g.t = null; LS.set("goal", g); render(); return; }
    if (t.dataset.gper) { const [k, v] = t.dataset.gper.split("|"); const g = LS.get(k, {}); g.per = v; g.t = null; LS.set(k, g); render(); return; }
    if (t.dataset.hwx) { if (!e.target.closest("a")) t.classList.toggle("open"); return; }
    if (t.dataset.gt) { const g = LS.get("goal", {}); g.t = +t.dataset.gt; LS.set("goal", g); render(); return; }
    if (t.dataset.agt) { const g = LS.get("agoal", {}); g.t = +t.dataset.agt; LS.set("agoal", g); render(); return; }
    if (t.dataset.form === "lesson") { openLessonRate(0); return; }
    if (t.dataset.form) { ({ signal: openSignalForm, complaint: openComplaintForm, profile: openProfileForm, password: openPasswordForm, photo: openPhotoForm })[t.dataset.form](); return; }
    if (t.dataset.oclick) { const [lbl, rx, what] = t.dataset.oclick.split("|"); origClick(lbl, new RegExp(rx, "i"), what); return; }
    if (t.dataset.classicGo) { const lbl = t.dataset.classicGo; unmount(); showFab(); classicGo(lbl).catch(() => {}); return; }
    if (t.dataset.set) { let v = t.dataset.v; if (v === "true") v = true; if (v === "false") v = false; cfg[t.dataset.set] = v; saveCfg(); if (t.dataset.set === "gfx") { if (v !== "lite") LS.set("gfxauto", 0); fpsBad = 0; fpsN = 0; applyGfx(); } if (CRYPTO && t.dataset.set === "mkt") (v ? mkStart : mkStop)(); applyRaise(); host.style.background = resolveTheme() === "dark" ? "#0a0c10" : "#eff0f3"; render(); return; }
    if (t.dataset.page) { const dl = $("#dlg"); if (dl.open) dl.close(); if (t.dataset.page !== page) commitSeen(page); page = t.dataset.page; sessionStorage.setItem("dn2.page", page); host.scrollTop = 0; render(); const pg = $("#page"); pg.classList.add("enter"); setTimeout(() => pg.classList.remove("enter"), 400); return; }
    if (t.dataset.les) { openLesson(t.dataset.les); return; }
    if (t.dataset.g) { openGrade(+t.dataset.g); return; }
    if (t.dataset.day) { sc.day = +t.dataset.day; render(); return; }
    if (t.dataset.gm) { gf.mode = t.dataset.gm; R.querySelectorAll("[data-gm]").forEach(b => b.setAttribute("aria-pressed", b === t)); applyGF(); return; }
    if (t.dataset.nf) { nf = t.dataset.nf; render(); return; }
    if (t.dataset.gw) { const pg = R.querySelector("#gpager"), p = pg && pg.querySelector(`.gpage[data-w="${t.dataset.gw}"]`); if (p && pg._go) pg._go([...pg.children].indexOf(p)); return; }
    if (t.dataset.am || t.dataset.af) { if (t.dataset.am) avgMode = t.dataset.am; else avgFocus = t.dataset.af; const c = R.querySelector(".avgc"); if (c) c.outerHTML = avgChartHTML(stats()); fitAvg(); return; }
    if (t.dataset.calm) { const L = [...new Set((M.visits || []).map(v => v.date.slice(0, 7)))].sort(), i = L.indexOf(calYm) + +t.dataset.calm; if (L[i]) { calYm = L[i]; const sc0 = host.scrollTop; render(); host.scrollTop = sc0; } return; }
    if (t.dataset.lb) { lbMode = t.dataset.lb; LS.set("lb", lbMode); render(); return; }
    if (t.dataset.nw) { const id = isNaN(+t.dataset.nw) ? t.dataset.nw : +t.dataset.nw; readSet.add(id); LS.set("read", [...readSet]); markReadUI(id); openNews(id); return; }
    const a = t.dataset.act;
    if (a === "close") $("#dlg").close();
    if (a === "prev") { sc.mon = dayDate(sc.mon, -7); render(); }
    if (a === "next") { sc.mon = dayDate(sc.mon, 7); render(); }
    if (a === "cur") { schedGoCurrent(); render(); }
    if (a === "week" || a === "day") { sc.view = a; LS.set("view", a); render(); }
    if (a === "readall") { (M.news || []).forEach(n => readSet.add(n.id)); LS.set("read", [...readSet]); render(); }
    if (a === "reload") { location.reload(); return; }
    if (a === "month") { openSummary(t.dataset.ym); return; }
    if (a === "sumpng") { try { sumPNG(t.dataset.ym); } catch (e) { toast("Не получилось сохранить картинку"); } return; }
    if (a === "updcheck") { t.disabled = true; toast("Проверяю обновления…"); checkUpdate(true).then(() => { render(); const u = LS.get("upd", null); toast(u && verNewer(u.v, VERSION) ? `Доступна версия ${u.v}` : u ? "У тебя последняя версия" : "Не удалось проверить - нет связи с Gist"); }); return; }
    if (a === "upddis") { LS.set("upddis", t.dataset.v); render(); return; }
    if (a === "updgo") { LS.set("updAt", 0); toast("Открываю установку новой версии…"); return; }
    if (a === "paydis") { LS.set("paydis", { k: t.dataset.k, t: Date.now() }); render(); return; }
    if (a === "quizdis") { LS.set("quizdis", { k: t.dataset.k, t: Date.now() }); render(); return; }
    if (a === "bdaydis") { LS.set("bdaydis", new Date().getFullYear()); render(); return; }
    if (a === "mdis") { const l = LS.get("mdis", []); l.push(t.dataset.ym); LS.set("mdis", l); render(); return; }
    if (a === "sync") { t.classList.add("spinning"); toast("Обновляю данные из журнала…"); Promise.race([sync("manual").then(() => 1), sleep(20000).then(() => 0)]).then(done => { t.classList.remove("spinning"); if (!done) toast("Журнал отвечает медленно - данные обновятся, как только он ответит"); else if (syncState === "ok") toast("Данные обновлены"); }); }
    if (a === "diag") copyDiag(t);
    if (a === "reset") { try { Object.keys(localStorage).filter(k => k.startsWith("dn2.model")).forEach(k => localStorage.removeItem(k)); } catch (e) {} location.reload(); }
    if (a === "off") { cfg.on = false; saveCfg(); location.reload(); }
    if (a === "classic") goClassic();
    if (a === "logout") askLogout();
    if (a === "logout-yes") logout();
  }
  function onChange(e) {
    if (e.target.id === "goalsel" || e.target.id === "agsel") { const k = e.target.id === "goalsel" ? "goal" : "agoal"; LS.set(k, { ...LS.get(k, {}), subj: e.target.value, t: null }); render(); return; }
    if (e.target.id === "agoalin") { const v = parseInt(e.target.value, 10); const g = LS.get("agoal", {}); g.t = v >= 50 && v <= 99 ? v : null; LS.set("agoal", g); render(); return; }
    if (e.target.id === "goalin") { const v = parseFloat(String(e.target.value).replace(",", ".")); const g = LS.get("goal", {}); g.t = isFinite(v) ? v : null; LS.set("goal", g); render(); return; }
    const t = e.target;
    if (t.id === "gsubj") { gf.subj = t.value; applyGF(); return; }
    if (t.id === "gym") { gp.ym = t.value; gp.wk = null; render(); return; }
    if (t.id === "hwsubj") { hwq = norm(t.value); render(); return; }
    if (t.id === "faqq") return;
    if (t.dataset.hide) { const id = t.dataset.hide; cfg.hidden = t.checked ? cfg.hidden.filter(x => x !== id) : [...new Set([...cfg.hidden, id])]; saveCfg(); render(); return; }
  }
  function onKey(e) {
    if (e.key === "Escape" && R && R.querySelector(".dd.open")) { closeDD(); e.preventDefault(); return; }
    if (!host || page !== "schedule") return; const d = $("#dlg"); if (d && d.open) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") { const dir = e.key === "ArrowRight" ? 1 : -1;
      if (sc.view === "day") { sc.day += dir; if (sc.day > 6) { sc.day = 0; sc.mon = dayDate(sc.mon, 7); } if (sc.day < 0) { sc.day = 6; sc.mon = dayDate(sc.mon, -7); } } else sc.mon = dayDate(sc.mon, 7 * dir); render(); }
  }

  /* кнопка "Д" в классическом режиме + диагностика */
  let fab;
  // пустой прозрачный слой журнала (подложка меню и т.п.) поверх Дневника «съедает» нажатия - убираем его с пути
  W.addEventListener("pointerdown", e => {
    if (!host || !document.documentElement.classList.contains("dn-on")) return;
    const t = e.target; if (!t || t.nodeType !== 1 || inHost(t) || t === document.documentElement || t === document.body) return;
    if (t.closest("[data-dn-raise],.modal-content,.mat-dialog-container,.swal2-popup,[role=dialog],.cdk-overlay-pane")) return;
    const cs = getComputedStyle(t), r = t.getBoundingClientRect(), clear = /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) && cs.backgroundImage === "none" && cs.boxShadow === "none";
    if (clear && !(t.innerText || "").trim() && r.width > innerWidth * 0.5 && r.height > innerHeight * 0.5) { t.style.setProperty("pointer-events", "none", "important"); NET.clearedLayers = (NET.clearedLayers || 0) + 1; }
  }, true);
  function showFab() {
    if (fab) { fab.style.display = ""; return; }
    fab = document.createElement("div"); fab.id = "dn-fab";
    const r = fab.attachShadow({ mode: "open" });
    r.innerHTML = `<style>
      .b{position:fixed;right:18px;bottom:18px;z-index:2147483001;height:46px;padding:0 16px 0 6px;border-radius:14px;border:0;cursor:pointer;display:flex;align-items:center;gap:10px;
        background:linear-gradient(135deg,#0f1822,#1d2d38);color:#e8cf9c;font:700 15px Calibri,Carlito,"Segoe UI",sans-serif;box-shadow:0 10px 28px -8px rgba(0,0,0,.55),inset 0 0 0 1px rgba(220,188,126,.4)}
      .b span{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(220,188,126,.12)}.b svg{width:20px;height:20px}</style>
      <button class="b"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></span>Вернуться в Дневник</button>`;
    r.querySelector("button").onclick = () => { fab.style.display = "none"; if (!cfg.on) { cfg.on = true; saveCfg(); } injectDocCSS();
      if (isLoginRoute()) { if (isSignIn()) mountLogin(); else fab.style.display = ""; return; }
      { const pg = classicPage(); if (pg && PAGES.some(x => x.id === pg)) { page = pg; try { sessionStorage.setItem("dn2.page", pg); } catch (e) {} } }
      document.documentElement.classList.add("dn-on"); mount(); if (!M.live) sync("fab"); };
    document.documentElement.appendChild(fab);
  }
  function diagnostics() {
    const ks = Object.keys(NET.status), okN = ks.filter(k => NET.status[k] === 200).length;
    const lines = [`Запросы: ${okN} из ${ks.length} успешно`].concat(ks.filter(k => NET.status[k] !== 200).map(k => `  ✗ ${k}: ${NET.status[k]}`));
    if (CRYPTO && cfg.mkt && MKT.diag) lines.push(MKT.diag);
    if (NET.viewErr) lines.push("Раздел не открылся: " + NET.viewErr); if (NET.clearedLayers) lines.push("Убрано прозрачных слоёв журнала: " + NET.clearedLayers);
    return `# Дневник ${VERSION} · диагностика\nAPI: ${NET.base || DEFAULT_API} (${NET.base ? "найден" : "по умолчанию"}) · способ: ${NET.mode || "-"} · перехват: ${NET.hook || "unsafeWindow"}\nТокен: ${NET.token ? "найден (" + (NET.tokenSrc || "?") + ")" : "нет"} · перехват событий: ${NET.hook === "page" ? NET.hookEvents : "-"}${NET.modeNote ? " · " + NET.modeNote : ""}\nБраузер: ${navigator.userAgent}\n\n${lines.join("\n")}${NET.site401 ? "\nЖурнал получил 401: " + Math.round((Date.now() - NET.site401) / 1000) + " с назад" : ""}${NET.ddos ? "\nDDoS-Guard: да" : ""}\nОтметки оценки пар: учитель ${evTags("evaluation_lesson_teach").length}, занятие ${evTags("evaluation_lesson").length}${NET.tagPaths ? " · адреса: " + NET.tagPaths.join(", ") : ""}\n\n## Последнее окно журнала\n${NET.pop || "-"}\n\n## Отправки сайта\n${NET.writes.join("\n") || "-"}\n\n## Данные разделов журнала\n${Object.keys(NET.site).filter(k => !Object.values(NET.raw).some(r => r.path.startsWith(k))).map(k => "### " + k + "\n" + NET.site[k].slice(0, 800)).join("\n\n") || "-"}\n\n` +
      Object.keys(NET.raw).filter(k => !/ p[2-9]\d*$/.test(k) && (NET.status[k] !== 200 || /^(user|visits|hwCount|evalLessons)$/.test(k))).map(k => `### ${k} (${NET.raw[k].path})\n` + JSON.stringify(NET.raw[k].data).slice(0, 500)).join("\n\n");
  }
  // для тестов разработчика: доступно странице только при dn2.dev=1
  try { if (localStorage.getItem("dn2.dev") === "1") { W.dnevnikDiagnostics = () => diagnostics(); } } catch (e) {}
  function copyDiag(btn) {
    const t = diagnostics(), html = btn.innerHTML, icon = btn.classList.contains("iconbtn");
    const ok = () => { btn.classList.add("ok"); btn.innerHTML = icon ? ic("check") : ic("check") + "Скопировано"; setTimeout(() => { btn.classList.remove("ok"); btn.innerHTML = html; }, 1300); };
    const fb = () => { const ta = document.createElement("textarea"); ta.value = t; document.body.appendChild(ta); ta.select(); try { document.execCommand("copy"); ok(); } catch (e) { toast("Не удалось скопировать"); } ta.remove(); };
    navigator.clipboard ? navigator.clipboard.writeText(t).then(ok, fb) : fb();
  }


  /* ======================= окна журнала поверх Дневника ======================= */
  const RAISE_SEL = ".modal.show,.modal.in,.modal[style*='block'],[role=dialog],[aria-modal=true],.cdk-overlay-container,.mat-dialog-container,.swal2-container,.ngdialog,.p-dialog-mask,.ant-modal-root,.ReactModal__Overlay,[data-dn-raise]";
  function injectDocCSS() {
    if (document.getElementById("dn-doc")) return;
    const st = document.createElement("style"); st.id = "dn-doc";
    st.textContent = `html.dn-on.dn-raise :is(${RAISE_SEL}):is([data-dn-raise],:has([data-dn-raise])){z-index:2147483600!important}
      html.dn-on.dn-raise [data-dn-raise]{border-radius:18px!important;overflow:auto;box-shadow:0 0 0 100vmax rgba(5,7,10,.72),0 30px 80px -20px #000!important;font-family:Calibri,Carlito,"Segoe UI",sans-serif!important}
      html.dn-on.dn-raise [data-dn-raise] :is(button,.btn,input[type=submit]){border-radius:10px!important}
      html.dn-on.dn-raise:has([data-dn-raise]) .modal-backdrop{z-index:2147483590!important;background:#05070a!important;opacity:.72!important}
      html.dn-on.dn-raise :is(.modal-content,.mat-dialog-container,.swal2-popup,[role=dialog]>div){border-radius:18px!important;border:0!important;box-shadow:0 30px 80px -20px rgba(0,0,0,.7)!important;font-family:Calibri,Carlito,"Segoe UI",sans-serif!important;overflow:hidden}
      html.dn-on.dn-raise :is(.modal-content,.swal2-popup) :is(.btn-primary,button[type=submit]){border-radius:10px!important;background:var(--dnj-acc,#162230)!important;border-color:var(--dnj-acc,#162230)!important;color:var(--dnj-on,#f3ecdd)!important;font-weight:700!important}
      html.dn-on.dn-raise :is(.modal-content,.swal2-popup,.mat-dialog-container,[data-dn-raise]){background:var(--dnj-bg,#fbf8f2)!important;color:var(--dnj-ink,#1b1f27)!important;border:1px solid var(--dnj-bord,rgba(212,177,114,.55))!important}
      html.dn-on.dn-raise :is(.modal-content,.swal2-popup,.mat-dialog-container,[data-dn-raise]) :is(h1,h2,h3,h4,h5,.modal-title){color:var(--dnj-ink,#141821)!important;font-family:Calibri,Carlito,"Segoe UI",sans-serif!important;letter-spacing:-.01em}
      html.dn-on.dn-raise :is(.modal-header,.modal-footer){border-color:var(--dnj-line,rgba(20,24,33,.08))!important;background:transparent!important}
      html.dn-on.dn-raise :is(.modal-content,.swal2-popup,[data-dn-raise]) :is(input:not([type=checkbox]):not([type=radio]),textarea,select){border-radius:10px!important;border:1px solid var(--dnj-line,#d9d2c4)!important;background:var(--dnj-in,#fff)!important;color:var(--dnj-ink,#1b1f27)!important}
      html.dn-on.dn-raise :is(.modal-content,.swal2-popup,[data-dn-raise]) :is(.btn-primary,.btn-success,button[type=submit],.swal2-confirm){background:var(--dnj-acc,#d4b172)!important;color:var(--dnj-on,#141821)!important;border:0!important;font-weight:700!important;border-radius:10px!important}
      html.dn-on.dn-raise :is(.modal-content,.swal2-popup,[data-dn-raise]) :is(.btn-secondary,.btn-default,.btn-light,.btn-outline-primary,.btn-outline-secondary,.swal2-cancel){background:var(--dnj-in,#fff)!important;color:var(--dnj-ink,#1b1f27)!important;border:1px solid var(--dnj-line,#d9d2c4)!important;border-radius:10px!important}
      html.dn-on.dn-raise :is(.modal-content,.swal2-popup,[data-dn-raise]) :is(a,.text-primary,.link){color:var(--dnj-acc,#94702f)!important}
      html.dn-on.dn-raise [data-dn-raise] :is(input[type=radio],input[type=checkbox],input[type=range],progress){accent-color:var(--dnj-acc,#d4b172)!important}
      html.dn-on.dn-raise [data-dn-raise] :is(label,p,span,li,td,th,div){color:inherit}
      html.dn-on.dn-raise [data-dn-raise] button:not([class]):not([aria-label]){background:var(--dnj-acc,#d4b172)!important;color:var(--dnj-on,#141821)!important;border:0!important;border-radius:10px!important;padding:8px 16px!important;font-weight:700!important;cursor:pointer}
      html.dn-on.dn-raise [data-dn-raise]:not(:has(.modal-content,.modal-dialog,.mat-dialog-container,.swal2-popup)){padding:22px 24px!important}
      html.dn-on.dn-raise [data-dn-raise] textarea{min-width:min(100%,320px);padding:8px 10px!important}
      html.dn-on.dn-raise [data-dn-raise] label:has(input[type=radio],input[type=checkbox]){display:inline-flex;align-items:center;gap:6px;margin:4px 12px 4px 0;cursor:pointer}
      html.dn-on.dn-raise [data-dn-raise] :is(input:not([type=checkbox]):not([type=radio]),textarea,select):focus{outline:2px solid var(--dnj-acc,#d4b172)!important;outline-offset:1px}
      html.dn-on.dn-raise [data-dn-raise] ::selection{background:var(--dnj-acc,#d4b172);color:var(--dnj-on,#141821)}
      html.dn-on .dn-swallow{display:none!important}`;
    (document.head || document.documentElement).appendChild(st); applyRaise();
  }
  const ACC_HEX = { gold: ["#e8bf6a", "#b8862e"], sapphire: ["#6f98ff", "#3b6fe0"], emerald: ["#4fd6a6", "#1d9e75"], amethyst: ["#8f7dff", "#6c59d1"], rose: ["#ff79b0", "#d6437f"], graphite: ["#c9ccd4", "#5c5f68"] };
  function applyRaise() {
    const h = document.documentElement; h.classList.toggle("dn-raise", cfg.raise !== false);
    const dark = resolveTheme() === "dark", a = ACC_HEX[cfg.accent] || ACC_HEX.gold;
    const v = dark ? { bg: "#11141a", ink: "#eceef2", line: "#2a303b", in: "#161a21", acc: a[0], on: "#15110a", bord: a[0] + "66" } : { bg: "#ffffff", ink: "#141821", line: "#d9dce2", in: "#f5f6f8", acc: a[1], on: "#ffffff", bord: a[1] + "55" };
    Object.keys(v).forEach(k => h.style.setProperty("--dnj-" + k, v[k]));
  }
  // своё окно сайта (например, опрос) без стандартных классов: поднимаем, если оно появилось по центру экрана
  let raiseWatch;
  function watchPopups() {
    if (raiseWatch || !document.body) return;
    raiseWatch = new MutationObserver(list => {
      if (!host) return;
      try { quickSwallow(list); } catch (e) {}
      scheduleScan();
      if (cfg.raise === false) return;
      for (const m of list) for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || inHost(n)) continue;
        requestAnimationFrame(() => {
          if (!n.isConnected || bridging || n.__dnDone || n.closest(".dn-swallow") || Date.now() - navAt < 3000) return; const s = getComputedStyle(n); if (s.position !== "fixed") return;
          const r = n.getBoundingClientRect(); if (r.width < 200 || r.height < 120 || (r.width > innerWidth * 0.92 && r.height > innerHeight * 0.92 && !n.querySelector("[role=dialog],.modal-content,.modal-dialog,input[type=radio],input[type=checkbox],textarea,select"))) return;
          const cx = innerWidth / 2, cy = innerHeight / 2; if (!(r.left < cx && r.right > cx && r.top < cy && r.bottom > cy)) return;
          if ((n.innerText || "").trim().length < 8 || !n.querySelector("button,input,textarea,a,[role=button]")) return;
          if (NEWS_POP.test(n.innerText || "")) { scheduleScan(); return; }
          if (RATE_POP.test(n.innerText || "")) popSnap(n);
          if (RATE_POP.test(n.innerText || "") && !n.querySelector("input[type=file]")) { n.setAttribute("data-dn-raise", ""); scheduleScan(); return; }
          n.setAttribute("data-dn-raise", "");
          toast && R && toast("Журнал открыл окно - оно показано поверх Дневника");
        });
      }
    });
    raiseWatch.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "style", "open"] });
  }
  // Окно журнала «У вас есть непрочитанные объявления» заменяем своим окном в дизайне Дневника
  const NEWS_POP = /непрочитанн\S*\s+объявлен/i;
  const POP_SEL = ".modal,[role=dialog],[aria-modal=true],.swal2-container,.cdk-overlay-pane,.mat-dialog-container,[class*=modal],[class*=Modal],[class*=popup],[class*=Popup],[data-dn-raise]";
  let scanT = 0;
  function scheduleScan() { if (scanT) return; scanT = setTimeout(() => { scanT = 0; try { scanJournal(); } catch (e) {} }, 250); }
  const EVAL_POP = /оцените\s+(занятие|работу преподавателя)/i;
  function evalCatch(el) {
    const root = el.closest(".modal,[role=dialog],.swal2-container,.cdk-overlay-pane,[data-dn-raise]") || el;
    el.__dnDone = root.__dnDone = true; root.classList.add("dn-swallow"); document.querySelectorAll(".modal-backdrop,.cdk-overlay-backdrop").forEach(b => b.classList.add("dn-swallow")); popSnap(root);
    discoverTags(); if (evalBusy) return; evalBusy = true;
    api("evalLessons", "feedback/students/evaluate-lesson-list").then(r => { M.evalList = parseEval(r); LS.set("model", M); render();
      if (M.evalList.length) toast(`Журнал просит оценить ${M.evalList.length} ${plural(M.evalList.length, "пару", "пары", "пар")} - оценишь, когда удобно: карточка на главной`); }).catch(() => {}).finally(() => { setTimeout(() => { evalBusy = false; }, 20000); });
  }
  // вызывается прямо из MutationObserver: textContent не требует отрисовки, поэтому окно не успевает мигнуть
  function quickSwallow(list) {
    if (!host || bridging) return;
    const seen = new Set();
    for (const m of list) { const attr = m.type !== "childList", nodes = attr ? [m.target] : [...m.addedNodes];
      for (const n of nodes) { const e = n.nodeType === 1 ? n : n.parentElement; if (!e || inHost(e)) continue;
        const cand = attr ? (e.matches && e.matches(POP_SEL) ? e : null) : e.closest(POP_SEL) || (e.querySelector && e.querySelector(POP_SEL)); if (!cand || seen.has(cand) || cand.__dnDone) continue; seen.add(cand);
        const tx = cand.textContent || ""; if (tx.length < 3000 && EVAL_POP.test(tx)) evalCatch(cand); } }
  }
  function scanJournal() {
    if (!host || bridging || !document.body) return;
    for (const el of document.body.querySelectorAll(POP_SEL)) {
      if (el.__dnDone || inHost(el)) continue;
      const tx0 = el.textContent || ""; if (tx0.length > 5000 || !(EVAL_POP.test(tx0) || RATE_POP.test(tx0) || NEWS_POP.test(tx0))) continue;
      if (!vis(el)) continue;
      const tx = el.innerText || "";
      if (EVAL_POP.test(tx) && tx.length < 3000) { evalCatch(el); return; }
      if (!rate.root && tx.length < 2500 && RATE_POP.test(tx) && !NEWS_POP.test(tx) && !(el.closest(".modal,[role=dialog]") || el).querySelector("input[type=file],hw-upload-homework")) { const root = el.closest(".modal,[role=dialog],.swal2-container,.cdk-overlay-pane,[data-dn-raise]") || el; const f = readPop(root);
        // анкета из нескольких вопросов - не пересобираем, а показываем окно журнала поверх Дневника
        const multi = /анкет|опрос|вопрос\s*\d|\b\d+\s*(из|\/)\s*\d+\b/i.test(tx) || root.querySelectorAll("textarea").length > 1 || new Set([...root.querySelectorAll("input[type=radio]")].map(i => i.name)).size > 1 || root.querySelectorAll("select").length > 0;
        if (multi) { el.__dnDone = root.__dnDone = true; root.classList.remove("dn-swallow"); root.setAttribute("data-dn-raise", ""); popSnap(root); toast("Журнал открыл анкету - она показана поверх Дневника"); return; }
        if (f.stars.length || f.ta || f.opts.length) { el.__dnDone = root.__dnDone = true; popSnap(root); rateOpen(root); return; } }
      if (tx.length > 700 || !NEWS_POP.test(tx)) continue;
      el.__dnDone = true; swallow(el); newsNotice(unreadList(), true); if (!unreadList().length) sync("news-popup"); return;
    }
  }
  function swallow(el) {
    const root = el.closest(".modal,[role=dialog],.swal2-container,.cdk-overlay-pane") || el;
    root.classList.add("dn-swallow"); document.querySelectorAll(".modal-backdrop,.cdk-overlay-backdrop").forEach(b => b.classList.add("dn-swallow"));
    // закрываем окно кнопкой самого журнала, чтобы он считал его закрытым (кнопку «Перейти» не трогаем)
    const btn = [...root.querySelectorAll("button,[role=button],a,[class*=close]")].find(b => { const t = ((b.innerText || "") + " " + (b.getAttribute("aria-label") || "")).trim(); return !/перейти/i.test(t) && (/^(×|✕|x|закрыть|позже|отмена|ок|ok)$/i.test(t) || /close/i.test(String(b.className || "") + " " + (b.getAttribute("aria-label") || ""))); });
    if (btn) try { btn.click(); } catch (e) {}
    // через секунду проверяем: если журнал окно закрыл - снимаем скрытие; если нет - держим спрятанным, пока в нём это сообщение
    const check = () => { root.classList.remove("dn-swallow"); const still = root.isConnected && vis(root) && NEWS_POP.test(root.innerText || "");
      if (still) { root.classList.add("dn-swallow"); setTimeout(check, 3000); } else document.querySelectorAll(".dn-swallow").forEach(b => b.classList.remove("dn-swallow")); };
    setTimeout(check, 1200);
  }

  const RATE_POP = /оцени\S*|оценк\S*\s+(урок|пар|заняти|преподават)|как\s+прош\S+\s+(урок|пар|заняти)|понравил\S*|опрос|анкет|отзыв о (уроке|паре|занятии)/i;
  // структура последнего окна журнала - для диагностики (без значений полей)
  function popSnap(root) {
    try { const out = []; const walk = (el, d) => { if (out.length > 70 || d > 7) return; const t = el.children.length ? "" : (el.textContent || "").trim().slice(0, 40);
        out.push("  ".repeat(d) + el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".") : "") + (el.type ? `[${el.type}]` : "") + (t ? ` "${t}"` : "")); [...el.children].forEach(c => walk(c, d + 1)); };
      walk(root, 0); NET.pop = out.join("\n"); } catch (e) {}
  }
  const rate = { root: null, v: 0, t: 0 };
  const cleanTx = el => (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim();
  // пока окно журнала спрятано, его размеры нулевые - читаем, на мгновение сняв скрытие
  function peek(root, fn) { const h = root.classList.contains("dn-swallow"); if (h) root.classList.remove("dn-swallow"); try { return fn(); } finally { if (h) root.classList.add("dn-swallow"); } }
  function readPop(root) {
    return peek(root, () => {
      let best = null;
      root.querySelectorAll("*").forEach(p => { const ch = [...p.children].filter(vis); if (ch.length < 5 || ch.length > 10) return; const tg = ch[0].tagName; if (!ch.every(c => c.tagName === tg)) return;
        if (ch.some(c => { const r = c.getBoundingClientRect(); return r.width > 90 || r.height > 90 || (c.innerText || "").trim().length > 3; })) return;
        const sc = /star|rat|звезд|fa-star/i.test(String(p.className) + " " + ch[0].outerHTML.slice(0, 300)) ? 2 : 1; if (sc < 2 && ch.length !== 5) return;
        if (!best || sc > best.sc) best = { sc, ch }; });
      const stars = best ? best.ch : [];
      const inStars = el => stars.some(s => s === el || s.contains(el) || el.contains(s));
      const title = cleanTx(root.querySelector("h1,h2,h3,h4,h5,.modal-title,[class*=title],[class*=Title]") || root).slice(0, 90) || "Оцени урок";
      const ta = [...root.querySelectorAll("textarea,input[type=text]:not([readonly])")].filter(vis)[0] || null;
      const opts = [...root.querySelectorAll("input[type=radio],input[type=checkbox]")].filter(i => !inStars(i)).map(i => { const l = i.closest("label") || (i.id && root.querySelector(`label[for="${CSS.escape(i.id)}"]`)) || i.parentElement; return { el: i, lab: cleanTx(l).slice(0, 80), on: i.checked, radio: i.type === "radio" }; }).filter(o => o.lab);
      const btns = [...root.querySelectorAll("button,[role=button],input[type=submit],a.btn")].filter(b => vis(b) && !inStars(b) && !b.closest("label")).map(b => ({ el: b, lab: cleanTx(b).slice(0, 40), close: /close|закрыть/i.test(String(b.className) + " " + (b.getAttribute("aria-label") || "")) || /^(×|✕|x)$/i.test(cleanTx(b)), off: b.disabled })).filter(b => b.lab || b.close);
      const skip = new Set([title, ...btns.map(b => b.lab), ...opts.map(o => o.lab)]);
      const lines = (root.innerText || "").split(/\n+/).map(x => { x = x.trim(); if (skip.has(x)) return ""; skip.forEach(k => { if (k && k.length < 40) x = x.split(k).join(" "); }); return x.replace(/[×✕]/g, "").trim(); }).filter(x => x && x.length > 1 && !/^[★☆\d\s]+$/.test(x)).slice(0, 4);
      const on = stars.filter(s => /active|selected|checked|filled|full|on\b/i.test(String(s.className) + " " + String((s.firstElementChild || {}).className || "")) || (s.querySelector && s.querySelector("input:checked")) || s.checked).length;
      return { title, stars, ta, opts, btns, lines, on };
    });
  }
  function rateOpen(root) {
    rate.root = root; rate.v = 0; rate.t = 0;
    root.classList.add("dn-swallow"); document.querySelectorAll(".modal-backdrop,.cdk-overlay-backdrop").forEach(b => b.classList.add("dn-swallow"));
    rateRender();
  }
  function rateRender() {
    const root = rate.root, d = R && $("#dlg"); if (!root || !d) return;
    if (!root.isConnected) { rateDone(); return; }
    const f = readPop(root); rate.f = f; if (f.on && !rate.v) rate.v = f.on;
    const n = f.stars.length, v = rate.v;
    const WORDS = ["", "Очень плохо", "Плохо", "Нормально", "Хорошо", "Отлично"];
    const acts = f.btns.filter(b => !b.close);
    d.classList.remove("wide"); d.dataset.rate = "1";
    d.innerHTML = `<div class="dlg rate"><div class="dh2"><div class="jn-head"><div class="jn-ic">${ic("star", "i big")}</div><div><h3>${esc(f.title)}</h3>${f.lines[0] ? `<p>${esc(f.lines[0])}</p>` : ""}</div></div><button class="x" data-rclose aria-label="Закрыть">×</button></div>
      <div class="rt-body">${f.lines.slice(1).map(l => `<p class="rt-l">${esc(l)}</p>`).join("")}
      ${n ? `<div class="rt-stars" role="radiogroup" aria-label="Оценка">${f.stars.map((_, i) => `<button class="rt-s ${i < v ? "on" : ""}" data-rs="${i}" role="radio" aria-checked="${i + 1 === v}" aria-label="${i + 1}"><svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg></button>`).join("")}</div><div class="rt-w">${v ? (n === 5 ? WORDS[v] : v + " из " + n) : "Нажми на звезду"}</div>` : ""}
      ${f.opts.length ? `<div class="rt-opts">${f.opts.map((o, i) => `<button class="rt-o ${o.on ? "on" : ""}" data-ro="${i}" aria-pressed="${o.on}"><i class="${o.radio ? "r" : "c"}"></i>${esc(o.lab)}</button>`).join("")}</div>` : ""}
      ${f.ta ? `<textarea class="m-in" id="rate-ta" rows="3" placeholder="${esc(f.ta.getAttribute("placeholder") || "Комментарий (необязательно)")}">${esc(f.ta.value || "")}</textarea>` : ""}</div>
      <div class="ffoot">${acts.map((b, i) => `<button class="m-btn ${i === acts.length - 1 ? "pri" : ""}" data-rb="${f.btns.indexOf(b)}" ${b.off ? "disabled" : ""}>${esc(b.lab)}</button>`).join("") || `<button class="m-btn" data-rclose>Закрыть</button>`}</div></div>`;
    if (!d.open) d.showModal();
  }
  function fire(el) { try { ["pointerover", "mouseover", "mouseenter", "pointerdown", "mousedown", "pointerup", "mouseup"].forEach(t => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }))); el.click(); } catch (e) {} }
  function rateClick(t) {
    const f = rate.f; if (!f || !rate.root) return false;
    if (t.dataset.rs !== undefined) { const i = +t.dataset.rs, s = f.stars[i]; if (!s) return true; peek(rate.root, () => { const inp = s.matches("input") ? s : s.querySelector("input"); fire(inp || s.querySelector("svg,i,span") || s); if (!inp) fire(s); }); rate.v = i + 1; setTimeout(rateRender, 250); return true; }
    if (t.dataset.ro !== undefined) { const o = f.opts[+t.dataset.ro]; if (o) peek(rate.root, () => fire(o.el)); setTimeout(rateRender, 250); return true; }
    if (t.dataset.rb !== undefined) { const b = f.btns[+t.dataset.rb]; if (!b) return true; t.disabled = true; t.innerHTML = `<span class="spin"></span>${esc(b.lab)}`; peek(rate.root, () => fire(b.el)); const sent = !/позже|пропустить|отмена|не сейчас|закрыть|нет/i.test(b.lab);
      setTimeout(() => { if (!rate.root) return; const alive = rate.root.isConnected && peek(rate.root, () => vis(rate.root)); alive ? rateRender() : rateDone(sent); }, 900); return true; }
    if (t.dataset.rclose !== undefined) { rateDismiss(); return true; }
    return false;
  }
  function rateInput(t) { if (t.id !== "rate-ta" || !rate.f || !rate.f.ta) return false; setNative(rate.f.ta, t.value); return true; }
  function rateDismiss() {
    const root = rate.root; if (!root) return;
    const f = rate.f || readPop(root); const c = f.btns.find(b => b.close) || f.btns.find(b => /^(позже|пропустить|отмена|не сейчас|закрыть)$/i.test(b.lab));
    if (c) peek(root, () => fire(c.el));
    rateDone(false);
  }
  function rateDone(sent) {
    const root = rate.root; rate.root = null; rate.f = null;
    const d = R && $("#dlg"); if (d && d.dataset.rate) { delete d.dataset.rate; if (d.open) d.close(); }
    if (sent) toast("Спасибо! Оценка отправлена в журнал");
    // снимаем скрытие, только если журнал своё окно убрал; если оно ещё висит - прячем, пока не исчезнет
    const check = () => { if (root && root.isConnected && peek(root, () => vis(root))) { root.classList.add("dn-swallow"); setTimeout(check, 2000); } else { if (root) root.classList.remove("dn-swallow"); document.querySelectorAll(".dn-swallow").forEach(b => b.classList.remove("dn-swallow")); } };
    setTimeout(check, 600);
  }

  /* ======================= выход и вход ======================= */
  function askLogout() {
    const d = $("#dlg"); d.classList.remove("wide");
    d.innerHTML = `<div class="dlg"><div class="dh2"><div class="jn-head"><div class="jn-ic">${ic("profile", "i big")}</div><div><h3>Выйти из аккаунта?</h3><p>${esc(M.user.name || "")}</p></div></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
      <p class="note" style="padding:14px 22px 0;margin:0">Сохранённые в браузере данные Дневника будут удалены. Войти снова можно по логину и паролю журнала.</p>
      <div class="ffoot"><button class="m-btn" data-act="close">Отмена</button><button class="m-btn pri" data-act="logout-yes">Выйти</button></div></div>`;
    if (!d.open) d.showModal();
  }
  // вход журнала: access_token/refresh_token (закодированы) и любые JWT; Дневнику после выхода они не нужны
  function clearJournalAuth() {
    for (const st of [localStorage, sessionStorage]) { try { Object.keys(st).filter(k => !k.startsWith("dn2.") && (/token|refresh|access|auth|jwt/i.test(k) || JWT_RX.test(String(st.getItem(k) || "")))).forEach(k => st.removeItem(k)); } catch (e) {} }
    try { document.cookie.split(";").map(x => x.split("=")[0].trim()).filter(k => /token|refresh|access|auth|jwt/i.test(k)).forEach(k => { document.cookie = k + "=; Max-Age=0; path=/"; document.cookie = k + "=; Max-Age=0; path=/; domain=." + location.hostname.split(".").slice(-2).join("."); }); } catch (e) {}
    try { sessionStorage.setItem("dn2.out", String(Date.now())); localStorage.setItem("dn2.out", String(Date.now())); } catch (e) {}
  }
  async function logout(auto) {
    ["model", "seen", "read", "ava"].forEach(k => { try { localStorage.removeItem("dn2." + k); } catch (e) {} });
    forgetToken(); try { sessionStorage.removeItem("dn2.page"); } catch (e) {}
    M = EMPTY(); readSet = new Set(); seen = null; fresh = {}; NET.token = null;
    const d = R && $("#dlg"); if (d && d.open) d.close();
    // сначала пробуем кнопку выхода самого журнала
    const b = [...document.querySelectorAll("a,button,[role=button],li,span")].filter(el => !inHost(el) && /^(выход|выйти|выйти из аккаунта)$/i.test((el.innerText || el.textContent || "").trim()))[0];
    if (b) { try { (b.closest("a,button,[role=button]") || b).click(); } catch (e) {} await sleep(1500); if (isLoginRoute()) { clearJournalAuth(); return; } }
    // запасной путь: убираем сохранённый вход журнала и открываем страницу входа
    clearJournalAuth();
    location.href = location.origin + "/ru/auth/login/index";
  }

  const isSignIn = () => /auth\/login|\/login([\/?#]|$)/i.test(location.pathname + location.hash);
  let lhost = null, lR = null;
  const EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_OFF = '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  function mountLogin() {
    dropVeil();
    forgetToken(); NET.token = null; NET.tokenSrc = "";      // на странице входа старый вход недействителен
    if (lhost || !cfg.on) return;
    document.documentElement.classList.add("dn-on");
    lhost = document.createElement("div"); lhost.id = "dn-login";
    lhost.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:auto;background:#0a0c10";
    lR = lhost.attachShadow({ mode: "open" });
    const dp = dayPart(); let why = ""; try { why = sessionStorage.getItem("dn2.why") || ""; sessionStorage.removeItem("dn2.why"); } catch (e) {}
    if (neoOn()) loadNeoFonts();
    lR.innerHTML = `<style>${DN_CSS}</style><div class="dn lgn ${neoOn() ? "neo" : ""}" data-theme="${resolveTheme()}" data-accent="${esc(cfg.accent || "gold")}"><div class="lg-bg nh nh-${dp}">${heroScene(dp)}</div>
      <form class="lg-card" id="lf" autocomplete="on" novalidate>
        <div class="lg-brand"><div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></div><div><b>Дневник</b><span>Электронный журнал</span></div></div>
        <h1>${HELLO[dp]}</h1><p class="lg-sub">Войди с логином и паролем от журнала</p>
        <label class="lg-f"><span>Логин</span><div class="lg-pw"><input id="lu" name="username" autocomplete="username" autocapitalize="off" spellcheck="false" required><button type="button" class="lg-eye" id="eyeu" aria-label="Скрыть логин"><svg viewBox="0 0 24 24" aria-hidden="true">${EYE_OFF}</svg></button></div></label>
        <label class="lg-f"><span>Пароль</span><div class="lg-pw"><input id="lp" name="password" type="password" autocomplete="current-password" required><button type="button" class="lg-eye" id="eye" aria-label="Показать пароль" aria-pressed="false"><svg viewBox="0 0 24 24" aria-hidden="true">${EYE}</svg></button></div></label>
        <div class="lg-err" id="lerr" ${why ? "" : "hidden"}>${esc(why)}</div>
        <button class="lg-go" id="lgo" type="submit">Войти</button>
        <div class="lg-links"><button type="button" class="m-link" id="lforgot">Забыли пароль?</button><button type="button" class="m-link soft" id="lclassic">Обычный вход журнала</button></div>
      </form>
      <form class="lg-card" id="rf" novalidate hidden>
        <div class="lg-brand"><div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></div><div><b>Дневник</b><span>Восстановление доступа</span></div></div>
        <h1>Забыли пароль?</h1><p class="lg-sub">Укажи почту, привязанную к журналу. Логин и пароль придут письмом</p>
        <label class="lg-f"><span>E-mail</span><input id="re" type="email" autocomplete="email" autocapitalize="off" spellcheck="false" placeholder="name@mail.ru"></label>
        <div class="lg-err" id="rerr" hidden></div><div class="lg-ok" id="rok" hidden></div>
        <button class="lg-go" id="rgo" type="submit">Отправить</button>
        <div class="lg-links"><button type="button" class="m-link" id="rback">← Вернуться ко входу</button></div>
      </form></div>`;
    document.documentElement.appendChild(lhost);
    const $l = id => lR.getElementById(id);
    $l("eyeu").addEventListener("click", () => { const u = $l("lu"), hide = !u.classList.contains("masked");
      if (CSS.supports("-webkit-text-security", "disc")) u.classList.toggle("masked", hide); else { u.type = hide ? "password" : "text"; u.classList.toggle("masked", hide); }
      $l("eyeu").setAttribute("aria-label", hide ? "Показать логин" : "Скрыть логин"); $l("eyeu").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${hide ? EYE : EYE_OFF}</svg>`; u.focus(); });
    $l("eye").addEventListener("click", () => { const p = $l("lp"), show = p.type === "password"; p.type = show ? "text" : "password"; $l("eye").setAttribute("aria-pressed", show); $l("eye").setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль"); $l("eye").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${show ? EYE_OFF : EYE}</svg>`; p.focus(); });
    $l("lf").addEventListener("submit", e => { e.preventDefault(); doLogin(); });
    const view = rec => { $l("lf").hidden = rec; $l("rf").hidden = !rec; setTimeout(() => { try { $l(rec ? "re" : "lu").focus(); } catch (e) {} }, 40); };
    $l("lforgot").addEventListener("click", () => { const u = $l("lu").value.trim(); if (/@/.test(u) && !$l("re").value) $l("re").value = u; view(true); });
    $l("rback").addEventListener("click", () => { view(false); journalLink(/вернуться на страницу входа|вернуться ко входу|назад/i); });
    $l("rf").addEventListener("submit", e => { e.preventDefault(); doRecover(); });
    $l("lclassic").addEventListener("click", () => { unmountLogin(); showFab(); });
    setTimeout(() => { try { $l("lu").focus(); } catch (e) {} }, 60);
  }
  // ссылка в форме журнала (под нашим окном)
  function journalLink(rx) { const el = [...document.querySelectorAll("a,button,span,div,p")].filter(x => !inHost(x) && !(lhost && lhost.contains(x)) && x.children.length < 2 && rx.test((x.innerText || x.textContent || "").trim())).pop(); if (el) { (el.closest("a,button") || el).click(); return true; } return false; }
  const jInputs = sel => [...document.querySelectorAll(sel)].filter(el => !inHost(el) && !(lhost && lhost.contains(el)) && vis(el));
  let recovering = false;
  async function doRecover() {
    if (recovering || !lR) return;
    const $l = id => lR.getElementById(id), show = (id, t) => { const e = $l(id); if (e) { e.hidden = !t; e.textContent = t || ""; } };
    const mail = $l("re").value.trim();
    show("rok", ""); if (!/^\S+@\S+\.\S+$/.test(mail)) { show("rerr", "Введи почту полностью, например name@mail.ru"); return; }
    recovering = true; show("rerr", ""); const go = $l("rgo"); go.disabled = true; go.innerHTML = `<span class="spin"></span>Отправляю…`;
    try {
      const emailIn = () => jInputs("input[type=email],input[placeholder*='mail' i],input[name*='mail' i]")[0];
      let em = emailIn();
      if (!em) { journalLink(/^забыли пароль\??$/i); for (let i = 0; i < 25 && !(em = emailIn()); i++) await sleep(200); }
      if (!em) throw new Error("форма восстановления журнала не открылась. Попробуй «Обычный вход журнала»");
      const before = new Set(jInputs("div,span,p,small").map(x => x.textContent.trim()));
      setVal(em, mail);
      const w = new Promise(res => { const f = ev => { if (/\/g\/collect|analytics/i.test(ev.path || "")) return; const i = WL.indexOf(f); if (i >= 0) WL.splice(i, 1); res(ev); }; WL.push(f); setTimeout(() => { const i = WL.indexOf(f); if (i >= 0) WL.splice(i, 1); res(null); }, 12000); });
      await sleep(150);
      const scope = em.closest("form") || em.parentElement.parentElement || document.body;
      const btn = [...scope.querySelectorAll("button,input[type=submit]")].find(b => /^(отправить|восстановить|send)$/i.test((b.innerText || b.value || "").trim())) || scope.querySelector("button[type=submit],button");
      if (!btn) throw new Error("не нашёл кнопку отправки в журнале");
      btn.click();
      const ev = await w; await sleep(900);
      // что журнал написал в ответ (новый текст рядом с формой)
      const said = jInputs("div,span,p,small,li").filter(x => x.children.length === 0 && !before.has(x.textContent.trim()) && /письм|отправл|почт|не найден|ошиб|невер|провер|восстанов|существ/i.test(x.textContent)).map(x => x.textContent.trim()).filter(t => t.length < 200)[0];
      let apiMsg = ""; try { const j = ev && JSON.parse(ev.text || "{}"); apiMsg = (j && (j.message || j.error || (Array.isArray(j) && j[0] && j[0].message))) || ""; } catch (e) {}
      if (ev && ev.status >= 400) throw new Error(said || apiMsg || (ev.status === 404 || ev.status === 422 ? "Такая почта не найдена в журнале" : "Журнал ответил ошибкой " + ev.status));
      if (!ev && !said) throw new Error("Журнал не ответил. Проверь интернет и попробуй ещё раз");
      if (said && /не найден|ошиб|невер|не существ/i.test(said)) throw new Error(said);
      show("rok", (said ? said + ". " : "Письмо отправлено на " + mail + ". ") + "Проверь «Входящие» и «Спам»: логин и пароль придут в письме.");
    } catch (e) { show("rerr", e.message.charAt(0).toUpperCase() + e.message.slice(1)); }
    finally { recovering = false; const g = lR && $l("rgo"); if (g) { g.disabled = false; g.textContent = "Отправить"; } }
  }
  function unmountLogin() { if (!lhost) return; lhost.remove(); lhost = null; lR = null; }
  let logging = false;
  async function doLogin() {
    if (logging || !lR) return;
    const $l = id => lR.getElementById(id), err = t => { const e = $l("lerr"); if (!e) return; e.hidden = !t; e.textContent = t || ""; };
    const u = $l("lu").value.trim(), pw = $l("lp").value;
    if (!u || !pw) { err(!u ? "Введи логин" : "Введи пароль"); return; }
    logging = true; err(""); try { localStorage.removeItem("dn2.out"); } catch (e) {} const go = $l("lgo"); go.disabled = true; go.innerHTML = `<span class="spin"></span>Вхожу…`;
    try {
      // поля настоящей формы журнала (она под нашим окном)
      if (!jInputs("input[type=password]").length) journalLink(/вернуться на страницу входа|вернуться ко входу/i);
      let pin = null, t0 = Date.now();
      while (!(pin = [...document.querySelectorAll("input[type=password]")].filter(el => !inHost(el) && !(lhost && lhost.contains(el)))[0]) && Date.now() - t0 < 6000) await sleep(200);
      if (!pin) throw new Error("форма входа журнала не загрузилась. Обнови страницу");
      const form = pin.closest("form") || pin.parentElement.parentElement.parentElement || document.body;
      const uin = [...(form.querySelectorAll ? form.querySelectorAll("input") : [])].filter(el => el !== pin && /^(text|email|)$/i.test(el.type || "") )[0] || [...document.querySelectorAll("input:not([type=password]):not([type=hidden])")].filter(el => !inHost(el))[0];
      if (!uin) throw new Error("не нашёл поле логина журнала");
      setVal(uin, u); setVal(pin, pw);
      const w = new Promise(res => { const f = ev => { if (/auth|login|token/i.test(ev.path || "")) { const i = WL.indexOf(f); if (i >= 0) WL.splice(i, 1); res(ev); } }; WL.push(f); setTimeout(() => { const i = WL.indexOf(f); if (i >= 0) WL.splice(i, 1); res(null); }, 12000); });
      await sleep(150);
      const btn = [...(form.querySelectorAll ? form.querySelectorAll("button,input[type=submit]") : [])].find(b => /^(вход|войти|login|sign in)$/i.test((b.innerText || b.value || "").trim())) || (form.querySelector && form.querySelector("button[type=submit],input[type=submit]"));
      if (btn) btn.click(); else if (form.requestSubmit) form.requestSubmit(); else throw new Error("не нашёл кнопку входа журнала");
      const ev = await w;
      for (let i = 0; i < 40 && isLoginRoute() && !(ev && ev.status >= 400 && i >= 5); i++) await sleep(200);
      if (!isLoginRoute()) return;                          // вошли: журнал сам перейдёт на главную, Дневник откроется
      const msg = [...document.querySelectorAll("div,span,p,small,li")].filter(el => !inHost(el) && !(lhost && lhost.contains(el)) && vis(el) && el.children.length === 0 && /невер|ошиб|не найден|заблок|попыт|incorrect|invalid/i.test(el.textContent || "")).map(el => el.textContent.trim())[0];
      throw new Error(msg || (ev && ev.status >= 400 ? "Неверный логин или пароль" : "Журнал не ответил. Попробуй ещё раз"));
    } catch (e) { err(e.message.charAt(0).toUpperCase() + e.message.slice(1)); }
    finally { logging = false; const g = lR && $l("lgo"); if (g) { g.disabled = false; g.textContent = "Войти"; } }
  }

  /* ======================= запуск ======================= */
  const isLoginRoute = () => /(^|[\/#])(login|auth|recover|forgot|reset-password)([\/?#]|$)/i.test(location.pathname + location.hash);
  let started = false, tokenWait;
  function onToken() { if (!(started && cfg.on && !isLoginRoute())) return; const again = () => { if (!M.live || syncState !== "ok" || (NET.okCount || 0) < (NET.totalCount || 1)) sync("token2"); }; if (syncing) syncing.then(again); else again(); }
  // Журнал не делал запросов после нашего запуска (так бывает в Safari) - заставляем его обратиться к серверу:
  // тихо переключаем раздел под Дневником, журнал запрашивает данные, и Дневник получает вход.
  let kicks = 0;
  async function kickJournal() {
    if (kicks >= 2 || bridging || isLoginRoute() || !document.body) return; kicks++;
    try { await classicGo(kicks === 1 ? "Расписание" : "Домашние задания"); await sleep(900); await classicGo("Главная"); } catch (e) {}
  }
  // Проверка DDoS-Guard: страницу защиты нельзя закрывать Дневником - иначе она «висит» под ним
  const DDG = /ddos-guard|checking your browser|проверка браузера|проверяем ваш браузер/i;
  const isDdos = () => { try { if (DDG.test(document.title || "")) return true; const b = document.body; if (!b || b.getElementsByTagName("*").length > 150) return false; return DDG.test((b.textContent || "").slice(0, 6000)); } catch (e) { return false; } };
  let ddgBox = null;
  function ddosMode() {
    if (ddgBox || !document.body) return; unmount(); unmountLogin(); dropVeil(); document.documentElement.classList.remove("dn-on");
    ddgBox = document.createElement("div");
    ddgBox.style.cssText = "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;background:#11141a;color:#eceef2;border:1px solid rgba(212,177,114,.45);border-radius:14px;padding:12px 16px;font:15px Calibri,Carlito,'Segoe UI',sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 16px 40px -12px rgba(0,0,0,.6);max-width:calc(100vw - 32px)";
    ddgBox.innerHTML = '<span>Журнал проверяет браузер (DDoS-Guard). Дневник откроется сам после проверки</span><button style="display:none;border:0;border-radius:10px;padding:8px 12px;font:inherit;font-weight:700;background:#d4b172;color:#15110a;cursor:pointer">Перезагрузить</button>';
    const b = ddgBox.querySelector("button"); b.onclick = () => location.reload();
    document.body.appendChild(ddgBox);
    setTimeout(() => { if (ddgBox && isDdos()) b.style.display = ""; }, 10000);
    setTimeout(() => { if (!isDdos()) return; let n = 0; try { n = +sessionStorage.getItem("dn2.ddg") || 0; sessionStorage.setItem("dn2.ddg", String(n + 1)); } catch (e) {} if (n < 1) location.reload(); }, 25000);
  }
  function ddosCheck() { if (isDdos()) { ddosMode(); return true; } if (ddgBox) { ddgBox.remove(); ddgBox = null; } return false; }
  // Журнал «завис» (ни одного ответа сервера и нет данных) - одна автоматическая перезагрузка, дальше кнопка
  function hangCheck() {
    if (!started || !cfg.on || isLoginRoute() || M.live || ddgBox || syncState === "ok" || syncState === "auth") return;
    let last = 0; try { last = +sessionStorage.getItem("dn2.rl") || 0; } catch (e) {}
    if (Date.now() - last < 300000) return;
    try { sessionStorage.setItem("dn2.rl", String(Date.now())); } catch (e) {}
    location.reload();
  }
  function start() {
    if (started) return; started = true;
    if (!cfg.on) return;
    try { const bg = document.createElement("style"); bg.id = "dn-bg"; bg.textContent = "html.dn-on,html.dn-on body{background:#000!important;color-scheme:dark}html.dn-on,html.dn-on body{overflow:hidden!important;overscroll-behavior:none!important;height:100%!important}html.dn-on body{position:fixed!important;inset:0!important;width:100%!important;margin:0!important}";
      if (W.visualViewport) W.visualViewport.addEventListener("scroll", () => { if (host && document.documentElement.classList.contains("dn-on") && !typing() && (W.scrollY || W.scrollX || W.visualViewport.offsetTop)) W.scrollTo(0, 0); }); (document.head || document.documentElement).appendChild(bg);
      const tc = () => { if (!document.head) return setTimeout(tc, 100); let m = document.querySelector('meta[name="theme-color"]'); if (!m) { m = document.createElement("meta"); m.name = "theme-color"; document.head.appendChild(m); } m.content = "#000000"; }; tc(); } catch (e) {}
    NET.token = NET.token || scanStorageForToken();
    computeFresh();
    W.addEventListener("pagehide", () => commitSeen(page));
    const wb = () => document.body ? watchPopups() : setTimeout(wb, 200); wb();
    setInterval(() => { if (host && !document.hidden && !bridging) sync("interval"); }, 5 * 60 * 1000);
    if (CRYPTO && cfg.mkt) mkStart();
    { const u = LS.get("upd", null); setTimeout(() => checkUpdate(!!(u && u.v && verNewer(u.v, VERSION))), u && u.v && verNewer(u.v, VERSION) ? 4000 : 20000); }
    setTimeout(() => { if (W.__dnDup && W.__dnDup.length && R) toast(`Установлено две копии Дневника (${W.__dnDup.join(", ")}) - удали лишнюю в Userscripts/Tampermonkey`); }, 6000); setInterval(() => { if (!document.hidden) checkUpdate(); }, 15 * 60 * 1000);
    document.addEventListener("visibilitychange", () => { if (!document.hidden) checkUpdate(); });
    // три лёгких запроса: счётчики разделов, счётчики ДЗ, баллы (новая оценка = новые топгемы). Изменилось - полная синхронизация
    setInterval(async () => {
      if (!host || document.hidden || bridging || syncing || !M.live || Date.now() - lastSync < 60000) return;
      try { const r = await Promise.allSettled([api("pollC", "count/page-counters"), api("pollH", "count/homework"), api("pollU", "settings/user-info")]);
        ["pollC", "pollH", "pollU"].forEach(k => { delete NET.raw[k]; delete NET.status[k]; });
        const u = r[2].status === "fulfilled" ? userObj(r[2].value) : null;
        const sig = JSON.stringify([r[0].value || null, r[1].value || null, u ? u.gaming_points : null]);
        if (pollSig && sig !== pollSig) sync("poll"); pollSig = sig; } catch (e) {}
    }, 90 * 1000);
    W.addEventListener("online", () => { if (host && !bridging) { retryN = 0; sync("online"); } });
    // Вкладка долго висела в фоне (Safari держит старую копию страницы в памяти) - перезагружаем,
    // чтобы запустилась свежая версия Дневника и не было «старой версии» после обновления
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) { hiddenAt = Date.now(); return; }
      if (hiddenAt && Date.now() - hiddenAt > 2 * 3600e3 && !isLoginRoute() && !bridging) { location.reload(); return; }
      if (host && Date.now() - lastSync > 60 * 1000) sync("focus");
    });
    W.addEventListener("pageshow", e => { if (e.persisted && Date.now() - lastSync > 20 * 60000 && !isLoginRoute()) location.reload(); });
    if (isLoginRoute()) { if (isSignIn()) mountLogin(); else document.documentElement.classList.remove("dn-on"); return; }
    if (isSurveyRoute()) { showFab(); return; }
    try { mount(); } catch (e) { NET.viewErr = "запуск: " + String(e && e.message || e).slice(0, 160); try { if (host) host.remove(); } catch (x) {} host = null; R = null; document.documentElement.classList.remove("dn-on"); showFab(); return; }
    const dd = () => { if (ddosCheck()) return; setTimeout(ddosCheck, 1500); }; document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", dd) : dd();
    setTimeout(() => { if (!M.live && syncState !== "ok" && !Object.values(NET.status).some(x => x === 200) && !(NET.hookEvents > 3)) hangCheck(); }, 30000);
    if (NET.token) sync("start");
    else tokenWait = setTimeout(() => { if (!NET.token) { sync("cookie"); kickJournal(); } }, 2500);
  }
  // Реакция на смену маршрута (выход из аккаунта, страница входа)
  // сторож: если Дневник должен быть на экране, но его нет (журнал сменил страницу раньше, чем мы успели), включаем
  setInterval(() => {
    if (!cfg.on || !started || bridging || ddosCheck() || isSurveyRoute()) return;
    if (host || lhost || (fab && fab.style.display !== "none")) return;
    if (isLoginRoute()) { if (isSignIn()) mountLogin(); return; }
    document.documentElement.classList.add("dn-on"); mount(); sync("watchdog");
  }, 1500);
  // страница-анкета/опрос журнала: Дневник её не закрывает, а уступает место
  function isSurveyRoute() { return /survey|poll|questionnaire|quiz|anket|opros|interview/i.test(location.pathname + location.hash); }
  let lastRoute = location.href;
  setInterval(() => {
    if (location.href === lastRoute) return; lastRoute = location.href;
    if (isLoginRoute()) { unmount(); onSignedOut(); if (isSignIn() && cfg.on && started && (!fab || fab.style.display === "none")) mountLogin(); }
    else if (isSurveyRoute()) { if (host) { unmount(); showFab(); } }
    else { unmountLogin(); if (cfg.on && started && !host && (!fab || fab.style.display === "none")) { document.documentElement.classList.add("dn-on"); mount(); sync("route"); } }
  }, 700);

  if (cfg.on) {
    const pre = () => {
      try {
        const v = document.createElement("div"); v.id = "dn-veil";
        const acc = { sapphire: "#a9c6ef", emerald: "#9fe0c4", amethyst: "#cdb9f2", rose: "#f3bcd0", graphite: "#dde2e9" }[cfg.accent] || "#e8cf9c";
        const dark = (cfg.theme === "light") ? false : cfg.theme === "dark" ? true : matchMedia("(prefers-color-scheme: dark)").matches;
        v.style.cssText = `position:fixed;inset:0;z-index:2147482999;display:grid;place-items:center;background:${dark ? "#0a0c10" : "#eff0f3"};transition:opacity .25s`;
        v.innerHTML = '<div style="width:54px;height:54px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(135deg,#0f1822,#1d2d38);color:'+acc+';box-shadow:inset 0 0 0 1px rgba(220,188,126,.35);animation:dnvp 1.4s ease-in-out infinite"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></div><style>@keyframes dnvp{50%{transform:scale(.92);opacity:.7}}</style>';
        document.documentElement.appendChild(v);
        setTimeout(dropVeil, 6000);
      } catch (e) {}
      const st = document.createElement("style");
      st.textContent = `html.dn-on,html.dn-on body{overflow:hidden!important}`;
      document.documentElement.appendChild(st);
      injectDocCSS();
      if (!isLoginRoute()) document.documentElement.classList.add("dn-on");
      start();
    };
    if (document.documentElement) pre();
    else new MutationObserver((_, o) => { if (document.documentElement) { o.disconnect(); pre(); } }).observe(document, { childList: true });
  } else {
    const later = () => showFab();
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", later) : later();
  }
  W.dnevnikToggle = on => { cfg.on = on !== false; saveCfg(); location.reload(); };
})();
