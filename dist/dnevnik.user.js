// ==UserScript==
// @name         Дневник - новый дизайн журнала
// @namespace    dnevnik.artem
// @version      4.5.0
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
// @noframes
// @updateURL    https://gist.githubusercontent.com/havin8/1dfbe9d913d7e000c0de52ad11a9317f/raw/dnevnik.user.js
// @downloadURL  https://gist.githubusercontent.com/havin8/1dfbe9d913d7e000c0de52ad11a9317f/raw/dnevnik.user.js
// ==/UserScript==

(function () {
  "use strict";
  // Tampermonkey/Violentmonkey дают unsafeWindow. В Safari (приложение Userscripts) его нет:
  // тогда перехватчик запросов ставится прямо в страницу и передаёт данные событиями.
  function VERSION_HDR() {
    try {
      const i =
        typeof GM_info !== "undefined"
          ? GM_info
          : typeof GM !== "undefined" && GM && GM.info
            ? GM.info
            : null;
      return (i && i.script && i.script.version) || "?";
    } catch (e) {
      return "?";
    }
  }
  const HAS_UW = typeof unsafeWindow !== "undefined" && unsafeWindow !== window;
  const W = typeof unsafeWindow !== "undefined" ? unsafeWindow : window;
  if (W.__dnLoaded) {
    W.__dnDup = (W.__dnDup || []).concat(VERSION_HDR());
    // старые копии (до 4.0.6) пишут сюда true, новые - свою версию
    const other = typeof W.__dnLoaded === "string" ? W.__dnLoaded : "",
      me = VERSION_HDR();
    const older =
      !other ||
      other
        .split(".")
        .map(Number)
        .reduce((r, x, i) => (r !== 0 ? r : (x || 0) - (+me.split(".")[i] || 0)), 0) < 0;
    if (older) {
      const show = () =>
        setTimeout(() => {
          if (document.getElementById("dn-dup")) return;
          const b = document.createElement("div");
          b.id = "dn-dup";
          b.style.cssText =
            "position:fixed;left:12px;right:12px;top:calc(env(safe-area-inset-top) + 12px);z-index:2147483647;background:#2a1a1a;color:#fff;border:1px solid #e06c6c;border-radius:16px;padding:14px 44px 14px 16px;font:15px/1.4 Calibri,-apple-system,system-ui,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.4)";
          b.innerHTML = `<b>Запустилась старая копия Дневника${other ? " " + other : ""}</b><br>Установлено две копии: старая и ${me}. Открой приложение Userscripts (или Tampermonkey) и удали старую, оставь одну.<button aria-label="Закрыть" style="position:absolute;right:8px;top:8px;background:none;border:0;color:#fff;font-size:22px;line-height:1;padding:4px 8px">×</button>`;
          b.querySelector("button").onclick = () => b.remove();
          document.documentElement.appendChild(b);
        }, 1500);
      if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", show);
      else show();
    }
    return;
  }
  W.__dnLoaded = VERSION_HDR();
  const VERSION = (() => {
    try {
      const i =
        typeof GM_info !== "undefined"
          ? GM_info
          : typeof GM !== "undefined" && GM && GM.info
            ? GM.info
            : null;
      const v = i && i.script && i.script.version;
      if (v && /^\d+(\.\d+)*$/.test(v)) return v;
    } catch (e) {}
    return "4.5.0";
  })();

  /* ======================= настройки и хранилище ======================= */
  // небольшие настройки дублируются в хранилище расширения: журнал иногда очищает хранилище сайта (при входе/выходе),
  // и без копии сбрасывались бы акцент, скрытые карточки, цели и т.п.
  const KEEP = new Set([
    "cfg",
    "mdis",
    "paydis",
    "quizdis",
    "upddis",
    "bdaydis",
    "goal",
    "agoal",
    "lb",
    "mkper",
    "read",
  ]);
  const GMS =
    typeof GM_setValue === "function"
      ? GM_setValue
      : typeof GM !== "undefined" && GM && typeof GM.setValue === "function"
        ? (k, v) => GM.setValue(k, v)
        : null;
  const LS = {
    get(k, d) {
      try {
        const v = localStorage.getItem("dn2." + k);
        return v == null ? d : JSON.parse(v);
      } catch (e) {
        return d;
      }
    },
    set(k, v) {
      try {
        localStorage.setItem("dn2." + k, JSON.stringify(v));
      } catch (e) {}
      if (GMS && KEEP.has(k))
        try {
          const p = GMS("dn2." + k, JSON.stringify(v));
          if (p && p.catch) p.catch(() => {});
        } catch (e) {}
    },
  };
  const restoreKept = (getter) =>
    KEEP.forEach((k) => {
      try {
        if (localStorage.getItem("dn2." + k) == null) {
          const v = getter("dn2." + k);
          if (v != null && typeof v === "string") localStorage.setItem("dn2." + k, v);
        }
      } catch (e) {}
    });
  if (typeof GM_getValue === "function") restoreKept((k) => GM_getValue(k, null));
  const cfg = Object.assign(
    {
      on: true,
      theme: "dark",
      accent: "gold",
      mc: false,
      hidden: [],
      raise: true,
      mkt: false,
      gpv: "week",
      goals: true,
      gfx: "auto",
    },
    LS.get("cfg", {}),
  );
  const saveCfg = () => LS.set("cfg", cfg);
  // 4.5.0: значки валюты как в журнале стали видом по умолчанию - один раз переключаем всех, пиксельный можно вернуть в Настройках
  if (!LS.get("mc50", 0)) {
    cfg.mc = false;
    saveCfg();
    LS.set("mc50", 1);
  }
  cfg.raise = true;
  // Safari (Userscripts): хранилище расширения асинхронное - восстанавливаем и перерисовываем
  if (
    typeof GM_getValue !== "function" &&
    typeof GM !== "undefined" &&
    GM &&
    typeof GM.getValue === "function"
  ) {
    Promise.all(
      [...KEEP].map((k) =>
        GM.getValue("dn2." + k, null)
          .then((v) => [k, v])
          .catch(() => [k, null]),
      ),
    )
      .then((L) => {
        const got = Object.fromEntries(L.map(([k, v]) => ["dn2." + k, v]));
        let changed = false;
        KEEP.forEach((k) => {
          try {
            if (localStorage.getItem("dn2." + k) == null && got["dn2." + k] != null) {
              localStorage.setItem("dn2." + k, got["dn2." + k]);
              changed = true;
            }
          } catch (e) {}
        });
        if (changed) {
          Object.assign(cfg, LS.get("cfg", {}));
          cfg.raise = true;
          if (typeof render === "function")
            try {
              render();
            } catch (e) {}
        } else
          KEEP.forEach((k) => {
            const v = localStorage.getItem("dn2." + k);
            if (v != null && got["dn2." + k] == null)
              try {
                GM.setValue("dn2." + k, v).catch(() => {});
              } catch (e) {}
          });
      })
      .catch(() => {});
  } else if (GMS)
    KEEP.forEach((k) => {
      try {
        const v = localStorage.getItem("dn2." + k);
        if (v != null) GMS("dn2." + k, v);
      } catch (e) {}
    });
  const DEFAULT_API = "https://msapi.top-academy.ru/api/v2";
  const origFetch = W.fetch.bind(W);

  /* ======================= перехват токена и адреса API ======================= */
  const NET = { token: null, base: null, headers: {}, raw: {}, status: {}, writes: [], mode: "" };
  const JWT_RX = /eyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]{8,}/;
  function noteRequest(url, headers) {
    try {
      const u = new URL(url, location.href);
      if (!/(^|\.)top-academy\.ru$/i.test(u.hostname)) return;
      const i = u.pathname.indexOf("/api/v2/");
      if (i >= 0 && !NET.base) NET.base = u.origin + u.pathname.slice(0, i + 7);
      if (!headers) return;
      const h = {};
      if (headers instanceof Headers) headers.forEach((v, k) => (h[k.toLowerCase()] = v));
      else if (Array.isArray(headers)) headers.forEach(([k, v]) => (h[k.toLowerCase()] = v));
      else Object.keys(headers).forEach((k) => (h[k.toLowerCase()] = headers[k]));
      if (h.authorization && /bearer/i.test(h.authorization)) {
        const t = h.authorization.replace(/^bearer\s+/i, ""),
          changed = t !== NET.token;
        NET.token = t;
        NET.tokenSrc = "перехват";
        if (changed) {
          saveToken(t);
          onToken();
        }
      }
      for (const k of Object.keys(h))
        if (!/^(authorization|content-length|content-type|cookie|host)$/.test(k)) NET.headers[k] = h[k];
    } catch (e) {}
  }
  function noteWrite(method, url, body) {
    try {
      if (!method || /^(GET|HEAD|OPTIONS)$/i.test(method)) return;
      const u = new URL(url, location.href);
      if (/auth|login|token|password/i.test(u.pathname)) return;
      let shape = "";
      const kj = (j, d = 0) =>
        j && typeof j === "object" && !Array.isArray(j) && d < 3
          ? Object.keys(j)
              .map((k) =>
                j[k] && typeof j[k] === "object" && !Array.isArray(j[k]) ? `${k}{${kj(j[k], d + 1)}}` : k,
              )
              .join(", ")
          : "";
      if (body instanceof W.FormData)
        shape =
          "FormData: " +
          [...body.entries()]
            .map(([k, v]) =>
              v && typeof v === "object" && "size" in v ? `${k}=[файл, ${Math.round(v.size / 1024)} КБ]` : k,
            )
            .join(", ");
      else if (typeof body === "string") {
        try {
          shape = "JSON: " + kj(JSON.parse(body));
        } catch (e) {
          shape = "text";
        }
      } else if (body) shape = typeof body;
      pushW(`${method.toUpperCase()} ${u.pathname} · ${shape}`);
    } catch (e) {}
  }
  const WL = [];
  const pushW = (...l) => {
    NET.writes.push(...l);
    if (NET.writes.length > 60) NET.writes.splice(0, NET.writes.length - 60);
  };
  // Каждый ответ сервера журналу: запоминаем, не выкинуло ли его самого (401), и забираем новый вход после продления
  NET.site401 = 0;
  function noteSiteStatus(url, status, text) {
    try {
      const pth = pathOf(url);
      if (!/\/api\//.test(pth)) return;
      if (/auth\/(refresh|login)|\/login\b|token/i.test(pth)) {
        if (status >= 200 && status < 300 && text) {
          const j = JSON.parse(text);
          let t = null;
          const look = (o, d) => {
            if (!o || typeof o !== "object" || d > 3 || t) return;
            for (const k of Object.keys(o)) {
              const v = o[k];
              if (
                typeof v === "string" &&
                !/refresh/i.test(k) &&
                /access|token|jwt/i.test(k) &&
                JWT_RX.test(v)
              ) {
                t = v.match(JWT_RX)[0];
                return;
              }
              if (v && typeof v === "object") look(v, d + 1);
            }
          };
          if (/auth\/login/i.test(pth)) {
            try {
              localStorage.removeItem("dn2.out");
            } catch (e) {}
          }
          if (localStorage.getItem("dn2.out")) return;
          look(j, 0);
          if (t && t !== NET.token) {
            NET.token = t;
            NET.tokenSrc = "перехват";
            NET.site401 = 0;
            saveToken(t);
            onToken();
          }
        }
        return;
      }
      if (status === 401) {
        NET.site401 = Date.now();
        if (typeof staleCheck === "function") setTimeout(staleCheck, 2500);
      } else if (status >= 200 && status < 300) NET.site401 = 0;
    } catch (e) {}
  }
  function emitWrite(ev) {
    const sec = /auth|login|token|password|logout/i.test(ev.path || "");
    let msg = "";
    if (!sec && ev.status >= 400)
      try {
        const j = JSON.parse(ev.text);
        msg = String(j.message || j.error || "").slice(0, 120);
      } catch (e) {}
    pushW(`  ↳ ответ ${ev.status}${msg ? ": " + msg : ""}`);
    WL.slice().forEach((f) => {
      try {
        f(ev);
      } catch (e) {}
    });
  }
  function waitWrite(ms = 15000, expect) {
    return new Promise((res, rej) => {
      const clean = () => {
        clearTimeout(t);
        const i = WL.indexOf(f);
        if (i >= 0) WL.splice(i, 1);
      };
      const f = (ev) => {
        if (!/\/api\//.test(ev.path)) return;
        clean();
        if (expect && !expect.test(ev.path))
          rej(
            new Error(
              "журнал отправил не тот запрос (" +
                ev.path.replace(/^.*\/api\/v\d\//, "") +
                "). Проверь раздел в журнале",
            ),
          );
        else res(ev);
      };
      const t = setTimeout(() => {
        clean();
        rej(new Error("журнал не отправил запрос"));
      }, ms);
      WL.push(f);
    });
  }
  // после выхода из Дневника журнал не должен сам продлевать вход: запрос продления блокируется до следующего входа по логину
  const outBlocked = (u) => {
    try {
      return /auth\/refresh/i.test(String(u)) && !!localStorage.getItem("dn2.out");
    } catch (e) {
      return false;
    }
  };
  const pathOf = (u) => {
    try {
      return new URL(u, location.href).pathname;
    } catch (e) {
      return String(u);
    }
  };
  NET.site = {};
  function tagLabels() {
    if (!NET.tagRaw || !NET.tr) return;
    const o = LS.get("evtags", {});
    NET.tagRaw.forEach((t) => {
      const lb = NET.tr[t.translate_key];
      if (!lb) return;
      const L = (o[t.type] = o[t.type] || []);
      if (!L.some((x) => x.id === t.id)) L.push({ id: t.id, label: lb });
    });
    NET.evTags = o;
    LS.set("evtags", o);
  }
  function noteSite(url, data) {
    try {
      const u = new URL(url, location.href);
      if (!/\/api\//.test(u.pathname) || /auth|login|token/i.test(u.pathname)) return;
      const k = u.pathname.replace(/^.*\/api\/v\d\//, "");
      if (/translations/.test(k) && data && typeof data === "object") {
        NET.tr = data;
        tagLabels();
        return;
      }
      if (/languages/.test(k)) return;
      if (Array.isArray(data) && data.length && data[0] && data[0].translate_key && data[0].type) {
        NET.tagRaw = (NET.tagRaw || []).concat(data);
        tagLabels();
      }
      NET.site[k] = JSON.stringify(
        (SENS_PATH.test(k) ? shape : scrub)(Array.isArray(data) ? data.slice(0, 2) : data),
      ).slice(0, 1500);
    } catch (e) {}
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
      try {
        if (outBlocked(typeof input === "string" ? input : input && input.url))
          return Promise.resolve(
            new Response('{"message":"Unauthorized"}', {
              status: 401,
              headers: { "content-type": "application/json" },
            }),
          );
      } catch (e) {}
      try {
        const url = typeof input === "string" ? input : input.url;
        noteRequest(url, (init && init.headers) || (input && input.headers));
        noteWrite((init && init.method) || (input && input.method), url, init && init.body);
      } catch (e) {}
      const pr = origFetch(input, init);
      try {
        const m = (init && init.method) || (input && input.method) || "GET";
        if (!/^(GET|HEAD|OPTIONS)$/i.test(m)) {
          const url = typeof input === "string" ? input : input.url;
          pr.then((r) =>
            r
              .clone()
              .text()
              .then((t) => emitWrite({ method: m, path: pathOf(url), status: r.status, text: t })),
          ).catch(() => emitWrite({ method: m, path: pathOf(url), status: 0, text: "" }));
        }
      } catch (e) {}
      pr.then((r) => {
        try {
          const u0 = r.url || (typeof input === "string" ? input : input.url);
          if (/auth|login|token/i.test(u0))
            r.clone()
              .text()
              .then((t) => noteSiteStatus(u0, r.status, t))
              .catch(() => {});
          else noteSiteStatus(u0, r.status);
        } catch (e) {}
      }).catch(() => {});
      pr.then((r) => {
        try {
          if (
            (r.headers.get("content-type") || "").includes("json") &&
            !(init && init.method && init.method !== "GET")
          )
            r.clone()
              .json()
              .then((j) => noteSite(r.url, j))
              .catch(() => {});
        } catch (e) {}
      }).catch(() => {});
      return pr;
    };
    const XP = W.XMLHttpRequest.prototype,
      XO = XP.open,
      XH = XP.setRequestHeader,
      XS = XP.send;
    XP.open = function (m, u) {
      if (outBlocked(u)) {
        arguments[1] = String(u).replace(/auth\/refresh[^?#]*/i, "auth/dn-signed-out");
        u = arguments[1];
      }
      this.__dnUrl = u;
      this.__dnM = m;
      try {
        noteRequest(u);
      } catch (e) {}
      return XO.apply(this, arguments);
    };
    XP.setRequestHeader = function (k, v) {
      try {
        if (this.__dnUrl) noteRequest(this.__dnUrl, { [k]: v });
      } catch (e) {}
      return XH.apply(this, arguments);
    };
    XP.send = function (b) {
      try {
        if (this.__dnM && !/^(GET|HEAD|OPTIONS)$/i.test(this.__dnM)) {
          const m = this.__dnM,
            u = this.__dnUrl;
          this.addEventListener("loadend", function () {
            let t = "";
            try {
              t = this.responseType === "" || this.responseType === "text" ? this.responseText : "";
            } catch (e) {}
            emitWrite({ method: m, path: pathOf(u), status: this.status, text: t });
          });
        }
      } catch (e) {}
      try {
        this.addEventListener("loadend", function () {
          try {
            const u0 = this.responseURL || String(this.__dnUrl || "");
            let t = "";
            if (/auth|login|token/i.test(u0))
              try {
                t =
                  this.responseType === "" || this.responseType === "text"
                    ? this.responseText
                    : this.responseType === "json"
                      ? JSON.stringify(this.response)
                      : "";
              } catch (e) {}
            noteSiteStatus(u0, this.status, t);
          } catch (e) {}
        });
      } catch (e) {}
      try {
        noteWrite(this.__dnM, this.__dnUrl, b);
        if (!this.__dnM || /get/i.test(this.__dnM))
          this.addEventListener("load", function () {
            try {
              if ((this.getResponseHeader("content-type") || "").includes("json"))
                noteSite(
                  this.responseURL || this.__dnUrl,
                  this.responseType === "json" ? this.response : JSON.parse(this.responseText),
                );
            } catch (e) {}
          });
      } catch (e) {}
      return XS.apply(this, arguments);
    };
  } else {
    NET.hook = "page";
    NET.hookEvents = 0;
    var RPC = {},
      rpcN = 0;
    // запрос через страницу журнала: у него правильный адрес-источник, поэтому сервер его пропускает
    var pageRequest = (url, headers) =>
      new Promise((res, rej) => {
        const id = ++rpcN;
        const t = setTimeout(() => {
          delete RPC[id];
          rej(new Error("страница не ответила"));
        }, 12000);
        RPC[id] = (d) => {
          clearTimeout(t);
          res({ status: d.status, text: d.tx || "" });
        };
        document.dispatchEvent(
          new CustomEvent("dn-req", { detail: JSON.stringify({ id, url, h: headers }) }),
        );
      });
    document.addEventListener("dn-net", (e) => {
      NET.hookEvents++;
      let o;
      try {
        o = JSON.parse(e.detail);
      } catch (x) {
        return;
      }
      const d = o.d || {};
      try {
        if (o.t === "ready") {
          NET.pageReady = true;
          return;
        }
        if (o.t === "rpc") {
          const cb = RPC[d.id];
          if (cb) {
            delete RPC[d.id];
            cb(d);
          }
          return;
        }
        if (o.t === "req") {
          noteRequest(d.url, d.a ? { authorization: d.a } : null);
          return;
        }
        const m = String(d.m || "GET").toUpperCase();
        noteSiteStatus(d.url, d.status, d.tx);
        if (!/^(GET|HEAD|OPTIONS)$/.test(m)) {
          if (!/\/g\/collect/.test(d.url)) pushW(`${m} ${pathOf(d.url)}`);
          emitWrite({ method: m, path: pathOf(d.url), status: d.status, text: d.tx || "" });
        } else if (/json/i.test(d.ct || "") && d.tx) noteSite(d.url, JSON.parse(d.tx));
      } catch (x) {}
    });
    const inject = () => {
      try {
        const sc = document.createElement("script");
        sc.textContent = PAGE_HOOK;
        document.documentElement.appendChild(sc);
        sc.remove();
      } catch (x) {}
    };
    if (document.documentElement) inject();
    else
      new MutationObserver((_, o) => {
        if (document.documentElement) {
          o.disconnect();
          inject();
        }
      }).observe(document, { childList: true });
  }
  function jwtExp(t) {
    try {
      const p = JSON.parse(atob(String(t).split(".")[1].replace(/-/g, "+").replace(/_/g, "/")));
      return p && p.exp ? p.exp * 1000 : 0;
    } catch (e) {
      return 0;
    }
  }
  function saveToken(t) {
    NET.authDead = 0;
    try {
      sessionStorage.setItem("dn2.t", t);
    } catch (e) {}
    const exp = jwtExp(t);
    try {
      if (exp > Date.now()) localStorage.setItem("dn2.tk", JSON.stringify({ t, exp }));
    } catch (e) {}
  }
  function forgetToken() {
    try {
      sessionStorage.removeItem("dn2.t");
      localStorage.removeItem("dn2.tk");
    } catch (e) {}
  }
  // журнал показал страницу входа (вышли кнопкой журнала или вход истёк) - старый вход больше не нужен
  function onSignedOut() {
    if (NET.token || localStorage.getItem("dn2.tk")) {
      forgetToken();
      NET.token = null;
      NET.tokenSrc = null;
    }
  }
  // Ищем сохранённый вход журнала: JWT в любом хранилище или значение под ключом вроде token/access (в т.ч. внутри JSON)
  function scanStorageForToken() {
    try {
      const k = JSON.parse(localStorage.getItem("dn2.tk") || "null");
      if (k && k.t && k.exp > Date.now() + 30000) {
        NET.tokenSrc = NET.tokenSrc || "сохранён Дневником";
        return k.t;
      }
    } catch (e) {}
    try {
      const t = sessionStorage.getItem("dn2.t");
      if (t && !(jwtExp(t) && jwtExp(t) < Date.now())) {
        NET.tokenSrc = NET.tokenSrc || "сохранён Дневником";
        return t;
      }
    } catch (e) {}
    const found = [];
    const look = (v, path, d) => {
      if (v == null || d > 5) return;
      if (typeof v === "string") {
        const m = v.match(JWT_RX);
        if (m) {
          found.push([path, m[0], 2]);
          return;
        }
        if (/token|auth|access|jwt|bearer/i.test(path) && /^[\w\-.~+/=]{24,}$/.test(v))
          found.push([path, v, 1]);
        if (/^\s*[\[{]/.test(v)) {
          try {
            look(JSON.parse(v), path, d + 1);
          } catch (e) {}
        }
      } else if (typeof v === "object") for (const k of Object.keys(v)) look(v[k], path + "." + k, d + 1);
    };
    for (const [nm, get] of [
      ["localStorage", () => localStorage],
      ["sessionStorage", () => sessionStorage],
    ]) {
      try {
        const st = get();
        for (let i = 0; i < st.length; i++) {
          const k = st.key(i);
          if (!k || k.startsWith("dn2.")) continue;
          look(st.getItem(k), nm + ":" + k, 0);
        }
      } catch (e) {}
    }
    try {
      document.cookie.split(";").forEach((c) => {
        const i = c.indexOf("=");
        if (i < 0) return;
        let v = c.slice(i + 1).trim();
        try {
          v = decodeURIComponent(v);
        } catch (e) {}
        look(v, "cookie:" + c.slice(0, i).trim(), 0);
      });
    } catch (e) {}
    if (!found.length) return null;
    const rank = (f) =>
      f[2] * 10 +
      (/refresh/i.test(f[0]) ? -15 : 0) +
      (/access/i.test(f[0]) ? 3 : 0) +
      (jwtExp(f[1]) && jwtExp(f[1]) < Date.now() ? -30 : 0);
    found.sort((a, b) => rank(b) - rank(a));
    NET.tokenSrc = found[0][0].replace(/\..*$/, "");
    return found[0][1];
  }

  /* ======================= новая версия Дневника ======================= */
  // что нового в текущей версии - показывается в Настройках
  const CHANGES = [
    "Топкоины и топгемы - значками как в журнале",
    "iPad и iPhone: нажатия больше не сползают на соседние кнопки и пункты меню",
    "Итоги месяца: только завершённый месяц - текущий появится в последние 3 дня",
    "Настройки: графика - авто, полная или лёгкая для слабых устройств",
    "Безопасность: запросы с ключом входа уходят только на серверы журнала",
    "Если журнал поменяет вёрстку и Дневник не запустится - откроется обычный журнал с кнопкой Дневника",
    "Главная: под ближайшим учебным днём показан следующий за ним день, а не тот же",
    "Настройки: цели по баллу и посещаемости можно скрыть",
    "Средние показатели: вернулся прежний вид графика",
    "Все пары: при открытии всегда текущая неделя и её итог",
    "Меню: двузначные счётчики больше не обрезаются",
    "Метка «новое» - справа от названия, новая карточка обведена цветом акцента",
    "День рождения: конфетти не перекрывают текст",
    "Уведомления на главной: в две колонки, кнопки по центру",
  ];
  // карточка «Крипта» есть в основной версии; по умолчанию выключена (Настройки → Внешний вид)
  const CRYPTO = true;
  const UPD_URL =
    "https://gist.githubusercontent.com/havin8/1dfbe9d913d7e000c0de52ad11a9317f/raw/dnevnik.user.js";
  const verNewer = (a, b) => {
    const x = String(a).split(".").map(Number),
      y = String(b).split(".").map(Number);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
      const d = (x[i] || 0) - (y[i] || 0);
      if (d) return d > 0;
    }
    return false;
  };
  async function checkUpdate(force) {
    const last = LS.get("updAt", 0);
    if (!force && Date.now() - last < 20 * 60e3) return;
    LS.set("updAt", Date.now());
    const url = UPD_URL + "?t=" + Math.floor(Date.now() / 60000);
    let text = "";
    try {
      const gm =
        typeof GM_xmlhttpRequest === "function"
          ? GM_xmlhttpRequest
          : (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) || null;
      if (gm)
        text = await new Promise((res, rej) =>
          gm({
            method: "GET",
            url,
            timeout: 15000,
            onload: (r) => (r.status === 200 ? res(r.responseText) : rej()),
            onerror: rej,
            ontimeout: rej,
          }),
        );
    } catch (e) {}
    if (!text)
      try {
        const r = await origFetch(url, { cache: "no-store" });
        if (r.ok) text = await r.text();
      } catch (e) {}
    const m = String(text)
      .slice(0, 3000)
      .match(/@version\s+([\d.]+)/);
    if (!m) return;
    const prev = LS.get("upd", null);
    LS.set("upd", { v: m[1], at: Date.now() });
    if ((!prev || prev.v !== m[1]) && R && (page === "home" || page === "settings")) {
      render();
      if (verNewer(m[1], VERSION)) toast(`Вышла новая версия ${m[1]} - плашка на главной`);
    }
  }

  /* ======================= рынок: карточка «Крипта» (включается в Настройках) ======================= */
  // выключена - ничего не делает: нет таймеров, запросов, чтения сохранённых курсов и обработчиков жестов
  // доллар - USDT/RUB на Rapira (если не ответила - курс ЦБ), история доллара - курс ЦБ (cbr.ru), крипта - Bybit (запасной вариант Binance),
  // индекс страха и жадности - alternative.me. Ничего не рассчитываем «от себя»: только то, что отдают источники.
  const COINS = [
    ["BTC", "Bitcoin", "#f7931a", "₿"],
    ["TON", "Toncoin", "#0098ea", "◆"],
    ["SOL", "Solana", "#9945ff", "◎"],
    ["ETH", "Ethereum", "#8a92b2", "Ξ"],
  ];
  const FNG_RU = {
    "Extreme Fear": "сильный страх",
    Fear: "страх",
    Neutral: "нейтрально",
    Greed: "жадность",
    "Extreme Greed": "сильная жадность",
  };
  const MK_PER = {
    7: { bb: "60", bn: "1h", n: 168, ttl: 10 * 60e3, l: "7 дней" },
    30: { bb: "240", bn: "4h", n: 180, ttl: 30 * 60e3, l: "30 дней" },
    90: { bb: "D", bn: "1d", n: 90, ttl: 60 * 60e3, l: "90 дней" },
  };
  const MKT = {
    usd: null,
    cbr: null,
    cbrHist: [],
    coins: {},
    hist: {},
    histAt: {},
    fng: null,
    fngHist: [],
    at: 0,
    fngAt: 0,
    cbrAt: 0,
    fail: 0,
  };
  // сохранённые курсы читаем только когда карточка нужна; цены (маленькие) и графики (большие) хранятся отдельно - графики пишутся только когда обновились
  let mkLoaded = false,
    mkHistDirty = false,
    mkTimer = 0,
    mkBound = false;
  const mkEnsure = () => {
    if (mkLoaded) return;
    mkLoaded = true;
    Object.assign(MKT, LS.get("mkt2", {}), LS.get("mkth", {}));
  };
  function mkSave() {
    LS.set("mkt2", {
      usd: MKT.usd,
      cbr: MKT.cbr,
      coins: MKT.coins,
      fng: MKT.fng,
      at: MKT.at,
      fngAt: MKT.fngAt,
      cbrAt: MKT.cbrAt,
      fail: MKT.fail,
      rapErr: MKT.rapErr,
    });
    if (mkHistDirty) {
      mkHistDirty = false;
      LS.set("mkth", { cbrHist: MKT.cbrHist, hist: MKT.hist, histAt: MKT.histAt, fngHist: MKT.fngHist });
    }
  }
  // карточка на экране? (не грузим курсы, пока её не видно)
  const mkVisible = () => {
    const el = R && page === "home" && R.querySelector(".mkt");
    if (!el) return false;
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < innerHeight;
  };
  function mkStart() {
    if (!CRYPTO || !cfg.mkt) return;
    mkEnsure();
    if (R) mkBind(R);
    if (!mkTimer)
      mkTimer = setInterval(() => {
        if (host && !document.hidden && mkVisible()) marketLoad();
      }, 60 * 1000);
    setTimeout(() => marketLoad(), 600);
  }
  function mkStop() {
    clearInterval(mkTimer);
    mkTimer = 0;
  }
  document.addEventListener("visibilitychange", () => {
    if (mkTimer && !document.hidden && mkVisible()) marketLoad();
  });
  let mkPer = [7, 30, 90].includes(+LS.get("mkper", 30)) ? +LS.get("mkper", 30) : 30,
    mkBusy = false,
    mkSheet = null;
  const MK_CH = {};
  let mkLast = ""; // графики на экране: id -> { pts: [[время, значение]], fmt }

  function xget(url, asText) {
    const gm =
      typeof GM_xmlhttpRequest === "function"
        ? GM_xmlhttpRequest
        : typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function"
          ? GM.xmlHttpRequest
          : null;
    const parse = (t, st) => {
      if (asText) return t;
      try {
        return JSON.parse(t);
      } catch (e) {
        throw new Error(
          `ответ ${st || "?"}, не JSON: ${String(t || "")
            .replace(/\s+/g, " ")
            .slice(0, 60)}`,
        );
      }
    };
    const viaFetch = () =>
      origFetch(url, {
        cache: "no-store",
        credentials: "omit",
        headers: { accept: "application/json, text/plain, */*" },
      }).then(async (r) => {
        const t = await r.text();
        if (!r.ok) throw new Error("ответ " + r.status);
        return parse(t, r.status);
      });
    if (!gm) return viaFetch();
    return new Promise((res, rej) =>
      gm({
        method: "GET",
        url,
        timeout: 12000,
        headers: { accept: "application/json, text/plain, */*" },
        onload: (r) => {
          try {
            if (r.status !== 200) throw new Error("ответ " + r.status);
            res(parse(r.responseText, r.status));
          } catch (e) {
            rej(e);
          }
        },
        onerror: () => rej(new Error("сеть")),
        ontimeout: () => rej(new Error("таймаут")),
      }),
    ).catch((e1) =>
      viaFetch().catch((e2) => {
        throw new Error(e1.message + (e2.message !== e1.message ? " / " + e2.message : ""));
      }),
    );
  }
  const mnum = (v) => {
    const n = parseFloat(String(v).replace(",", "."));
    return isFinite(n) ? n : null;
  };
  const ddmmyyyy = (d) =>
    `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;

  const KR = { BTC: "XBT" };
  async function coinTicker(t) {
    for (let a = 0; a < 2; a++)
      try {
        const j = await xget(`https://api.bybit.com/v5/market/tickers?category=spot&symbol=${t}USDT`);
        const x = j && j.result && j.result.list && j.result.list[0];
        if (x && mnum(x.lastPrice))
          return {
            p: mnum(x.lastPrice),
            ch: mnum(x.price24hPcnt) * 100,
            hi: mnum(x.highPrice24h),
            lo: mnum(x.lowPrice24h),
            vol: mnum(x.turnover24h),
            src: "Bybit",
          };
      } catch (e) {}
    try {
      const x = await xget(`https://api.binance.com/api/v3/ticker/24hr?symbol=${t}USDT`);
      if (x && mnum(x.lastPrice))
        return {
          p: mnum(x.lastPrice),
          ch: mnum(x.priceChangePercent),
          hi: mnum(x.highPrice),
          lo: mnum(x.lowPrice),
          vol: mnum(x.quoteVolume),
          src: "Binance",
        };
    } catch (e) {}
    const k = await xget(`https://api.kraken.com/0/public/Ticker?pair=${KR[t] || t}USD`),
      x = k && k.result && Object.values(k.result)[0];
    if (x && mnum(x.c[0])) {
      const p = mnum(x.c[0]),
        o = mnum(x.o);
      return {
        p,
        ch: o ? ((p - o) / o) * 100 : null,
        hi: mnum(x.h[1]),
        lo: mnum(x.l[1]),
        vol: mnum(x.v[1]) * p,
        src: "Kraken",
      };
    }
    throw new Error("нет цены");
  }
  async function coinHist(t, per) {
    const P = MK_PER[per];
    for (let a = 0; a < 2; a++)
      try {
        const j = await xget(
          `https://api.bybit.com/v5/market/kline?category=spot&symbol=${t}USDT&interval=${P.bb}&limit=${P.n}`,
        );
        const l = j && j.result && j.result.list;
        if (Array.isArray(l) && l.length > 2)
          return l
            .map((k) => [+k[0], mnum(k[4])])
            .filter((x) => x[1] != null)
            .reverse();
      } catch (e) {}
    try {
      const l = await xget(
        `https://api.binance.com/api/v3/klines?symbol=${t}USDT&interval=${P.bn}&limit=${P.n}`,
      );
      if (Array.isArray(l) && l.length > 2)
        return l.map((k) => [+k[0], mnum(k[4])]).filter((x) => x[1] != null);
    } catch (e) {}
    const k = await xget(
        `https://api.kraken.com/0/public/OHLC?pair=${KR[t] || t}USD&interval=${{ 60: 60, 240: 240, D: 1440 }[P.bb] || 1440}`,
      ),
      r = k && k.result && Object.entries(k.result).find(([n]) => n !== "last");
    if (r && r[1].length > 2)
      return r[1]
        .slice(-P.n)
        .map((c) => [c[0] * 1000, mnum(c[4])])
        .filter((x) => x[1] != null);
    throw new Error("нет графика");
  }
  // курс ЦБ за 90 дней одним запросом (официальный XML Банка России)
  async function cbrHistory() {
    const to = new Date(Date.now() + 864e5),
      from = new Date(Date.now() - 95 * 864e5);
    const x = await xget(
      `https://www.cbr.ru/scripts/XML_dynamic.asp?date_req1=${ddmmyyyy(from)}&date_req2=${ddmmyyyy(to)}&VAL_NM_RQ=R01235`,
      true,
    );
    const out = [
      ...String(x).matchAll(
        /<Record Date="(\d\d)\.(\d\d)\.(\d{4})"[^>]*>[\s\S]*?<Nominal>(\d+)<\/Nominal>[\s\S]*?<Value>([\d,]+)<\/Value>/g,
      ),
    ]
      .map((m) => [new Date(+m[3], +m[2] - 1, +m[1]).getTime(), mnum(m[5]) / (+m[4] || 1)])
      .filter((r) => r[1]);
    if (out.length < 2) throw new Error("пусто");
    return out;
  }
  async function marketLoad(force) {
    if (!CRYPTO || !cfg.mkt || mkBusy || (mkEnsure(), !force && Date.now() - MKT.at < 55e3)) return;
    mkBusy = true;
    const now = Date.now();
    let ok = 0;
    const jobs = [
      rapiraLoad()
        .then(() => {
          ok++;
        })
        .catch((e) => {
          MKT.rapErr = { m: String(e.message || e).slice(0, 120), at: now };
        }),
      ...COINS.map(([t]) =>
        coinTicker(t)
          .then((r) => {
            MKT.coins[t] = r;
            ok++;
          })
          .catch(() => {}),
      ),
      mkHistLoad(mkPer, force),
    ];
    if (force || now - MKT.fngAt > 30 * 60e3)
      jobs.push(
        xget("https://api.alternative.me/fng/?limit=31")
          .then((j) => {
            const d = j && j.data;
            if (d && d[0]) {
              MKT.fng = {
                v: +d[0].value,
                c: d[0].value_classification,
                y: d[1] ? +d[1].value : null,
                w: d[7] ? +d[7].value : null,
                m: d[30] ? +d[30].value : null,
              };
              MKT.fngHist = d.map((x) => [+x.timestamp * 1000, +x.value]).reverse();
              MKT.fngAt = now;
              mkHistDirty = true;
            }
          })
          .catch(() => {}),
      );
    if (force || now - MKT.cbrAt > 3600e3)
      jobs.push(
        cbrHistory()
          .then((h) => {
            MKT.cbrHist = h;
            mkHistDirty = true;
            const a = h[h.length - 1],
              b = h[h.length - 2];
            MKT.cbr = { v: a[1], d: a[0], prev: b[1], pd: b[0] };
            MKT.cbrAt = now;
            ok++;
          })
          .catch(() =>
            xget("https://www.cbr-xml-daily.ru/daily_json.js")
              .then((j) => {
                const u = j && j.Valute && j.Valute.USD;
                if (u && mnum(u.Value)) {
                  MKT.cbr = { v: mnum(u.Value), prev: mnum(u.Previous), d: Date.parse(j.Date) || now };
                  MKT.cbrAt = now;
                }
              })
              .catch(() => {}),
          ),
      );
    await Promise.all(jobs);
    if (ok) {
      MKT.at = now;
      MKT.fail = 0;
    } else MKT.fail = now;
    mkSave();
    mkBusy = false;
    mkPaint();
  }
  async function rapiraLoad() {
    let err;
    for (let a = 0; a < 2; a++) {
      try {
        const j = await xget("https://api.rapira.net/open/market/rates"),
          list = Array.isArray(j) ? j : (j && (j.data || j.rates || j.list)) || [];
        const x = list.find(
          (r) =>
            String(r.symbol || "")
              .replace(/[_-]/, "/")
              .toUpperCase() === "USDT/RUB",
        );
        if (!x || !mnum(x.close)) throw new Error("нет пары USDT/RUB в ответе");
        MKT.usd = {
          v: mnum(x.close),
          prev: mnum(x.lastDayClose),
          hi: mnum(x.high),
          lo: mnum(x.low),
          bid: mnum(x.bidPrice),
          ask: mnum(x.askPrice),
          at: Date.now(),
        };
        MKT.rapErr = null;
        return;
      } catch (e) {
        err = e;
        await new Promise((r) => setTimeout(r, 800));
      }
    }
    throw err;
  }
  async function mkHistLoad(per, force) {
    const k = String(per),
      now = Date.now();
    if (!force && now - (MKT.histAt[k] || 0) < MK_PER[per].ttl) return;
    await Promise.all(
      COINS.map(([t]) =>
        coinHist(t, per)
          .then((a) => {
            (MKT.hist[t] = MKT.hist[t] || {})[k] = a;
            mkHistDirty = true;
          })
          .catch(() => {}),
      ),
    );
    MKT.histAt[k] = now;
  }
  function mkPaint() {
    const el = R && R.querySelector(".mkt");
    if (el && page === "home") {
      const h = marketHTML();
      if (h !== mkLast) {
        mkLast = h;
        el.outerHTML = h;
      }
    }
    const d = R && R.querySelector("#dlg");
    if (mkSheet && d && d.open && d.querySelector(".mks")) {
      const h = mkSheetHTML(mkSheet);
      if (h !== d.innerHTML) d.innerHTML = h;
    }
  }

  /* ---------- вид ---------- */
  const fx = (v, d) => v.toLocaleString("ru-RU", { minimumFractionDigits: d, maximumFractionDigits: d });
  // ≥1000 - с пробелом между разрядами, 1-1000 - два знака после запятой, <1 - четыре (чтобы «1,600» не читалось как 1600)
  const usdF = (v, full) => "$" + fx(v, v >= 1000 ? (full ? 2 : 0) : v >= 1 ? 2 : 4);
  const bigF = (v) => (v >= 1e9 ? fx(v / 1e9, 2) + " млрд" : v >= 1e6 ? fx(v / 1e6, 1) + " млн" : fx(v, 0));
  const chPill = (v) =>
    v == null || !isFinite(v)
      ? ""
      : `<span class="mk-ch ${v < 0 ? "mdn" : "mup"}">${v < 0 ? "▼" : "▲"} ${fx(Math.abs(v), 2)}%</span>`;
  const perCh = (a) => (a && a.length > 1 && a[0][1] ? (a[a.length - 1][1] / a[0][1] - 1) * 100 : null);
  const histOf = (t, per) => (MKT.hist[t] || {})[String(per)] || null;
  const cbrPer = (per) => {
    const h = MKT.cbrHist || [],
      from = Date.now() - per * 864e5;
    const s = h.filter((r) => r[0] >= from);
    return s.length > 1 ? s : null;
  };
  const dm2 = (ts) => {
    const d = new Date(ts);
    return `${String(d.getDate()).padStart(2, "0")}.${String(d.getMonth() + 1).padStart(2, "0")}`;
  };
  const hm2 = (ts) => new Date(ts).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" });
  // линия/область: SVG растягивается по ширине, точки и подписи - HTML поверх (не искажаются)
  function mkChart(id, pts, o) {
    // длинные ряды прореживаем (меньше узлов в SVG), последняя точка - всегда настоящая текущая
    const lim = o.max || (innerWidth < 760 ? 80 : 120);
    if (pts && pts.length > lim) {
      const src = pts,
        k = (src.length - 1) / (lim - 1);
      pts = Array.from({ length: lim }, (_, i) => src[Math.round(i * k)]);
    }
    if (!pts || pts.length < 2)
      return `<div class="mk-chart empty ${o.cls || ""}"><span>${o.empty || "Нет данных для графика"}</span></div>`;
    const vs = pts.map((p) => p[1]),
      mn = Math.min(...vs),
      mx = Math.max(...vs),
      pad = (mx - mn) * 0.12 || mx * 0.01;
    const lo = mn - pad,
      hi = mx + pad,
      X = (i) => (i / (pts.length - 1)) * 100,
      Y = (v) => (1 - (v - lo) / (hi - lo)) * 100;
    const line = pts.map((p, i) => `${X(i).toFixed(2)},${Y(p[1]).toFixed(2)}`).join(" ");
    MK_CH[id] = { pts, fmt: o.fmt, tfmt: o.tfmt || dm2 };
    const last = pts[pts.length - 1],
      gid = "mkg" + id;
    const tn = Math.min(o.ticks || 0, pts.length),
      ticks =
        tn > 1
          ? [
              ...new Set(
                Array.from({ length: tn }, (_, i) =>
                  dm2(pts[Math.round((i / (tn - 1)) * (pts.length - 1))][0]),
                ),
              ),
            ]
          : [];
    return `<div class="mk-chart ${o.cls || ""}" data-mkc="${id}" style="--lc:${o.col}"><div class="mk-plot">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"><defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${o.col}" stop-opacity="${o.area ? 0.34 : 0}"/><stop offset="1" stop-color="${o.col}" stop-opacity="0"/></linearGradient></defs>
      ${o.area ? `<polygon points="0,100 ${line} 100,100" fill="url(#${gid})"/>` : ""}<polyline points="${line}" fill="none" stroke="${o.col}" stroke-width="${o.w || 2}" stroke-linejoin="round" stroke-linecap="round" vector-effect="non-scaling-stroke"/></svg>
      ${o.dot ? `<i class="mk-last" style="left:${X(pts.length - 1)}%;top:${Y(last[1])}%"></i>` : ""}<div class="mk-scrub" hidden><i class="mk-vl"></i><i class="mk-dot"></i><span class="mk-tip"></span></div></div>
      ${ticks.length ? `<div class="mk-ticks">${ticks.map((t) => `<span>${t}</span>`).join("")}</div>` : ""}</div>`;
  }
  const MK_URL = {
    rapira: "https://rapira.net/exchange/USDT_RUB",
    cbr: "https://www.cbr.ru/currency_base/daily/",
    fng: "https://alternative.me/crypto/fear-and-greed-index/",
    Bybit: (t) => `https://www.bybit.com/trade/spot/${t}/USDT`,
    Binance: (t) => `https://www.binance.com/ru/trade/${t}_USDT?type=spot`,
  };
  const mkLink = (url, label) =>
    `<a class="m-btn mk-go" href="${url}" target="_blank" rel="noopener noreferrer">${ic("ext")}${label}</a>`;
  const coinIc = (col, sym) => `<span class="mk-ic" style="--c:${col}">${sym}</span>`;
  function fngBar(f) {
    const v = Math.max(0, Math.min(100, f.v));
    return `<div class="mk-fg" data-hold="fng"><div class="mk-fgh"><span>Индекс страха и жадности</span><b class="num">${f.v} · ${esc(FNG_RU[f.c] || f.c || "")}</b></div>
      <div class="mk-fgbar"><i style="left:${v}%"></i></div><div class="mk-fgl"><span>страх</span>${f.y != null ? `<span>вчера ${f.y}</span>` : ""}<span>жадность</span></div></div>`;
  }
  // доллар: Rapira, если ответила; иначе курс ЦБ - чтобы вместо «-» всегда был настоящий курс
  function usdNow() {
    const u = MKT.usd,
      c = MKT.cbr,
      fresh = u && Date.now() - (u.at || MKT.at) < 6 * 3600e3;
    if (fresh)
      return {
        v: u.v,
        ch: u.prev ? (u.v / u.prev - 1) * 100 : null,
        src: "Rapira",
        sub: "USDT/RUB",
        note: u.prev ? `вчера закрылся на ${fx(u.prev, 2)} ₽` : "",
      };
    if (c)
      return {
        v: c.v,
        ch: c.prev ? (c.v / c.prev - 1) * 100 : null,
        src: "ЦБ РФ",
        sub: c.d ? "курс на " + dm2(c.d) : "официальный курс",
        note: MKT.rapErr
          ? "Rapira сейчас не отвечает - показан курс ЦБ"
          : c.prev
            ? `${c.pd ? dm2(c.pd) : "до этого"} было ${fx(c.prev, 2)} ₽`
            : "",
      };
    return null;
  }
  const mkRub = (v, cls) => `${fx(v, 2)}<small class="${cls || ""}">₽</small>`;
  function marketHTML() {
    mkEnsure();
    const c = MKT.cbr,
      U = usdNow(),
      stale = MKT.at && Date.now() - MKT.at > 5 * 60e3,
      ch = cbrPer(mkPer),
      pc = perCh(ch);
    const st = ch ? { mx: Math.max(...ch.map((r) => r[1])), mn: Math.min(...ch.map((r) => r[1])) } : null;
    const status = !MKT.at
      ? mkBusy || !MKT.fail
        ? "загрузка…"
        : "нет связи"
      : (stale ? "нет связи · данные от " : "обновлено в ") + hm2(MKT.at);
    const pers = [7, 30, 90]
      .map(
        (p) =>
          `<button data-mkp="${p}" aria-pressed="${p === mkPer}">${p === 7 ? "7 дн" : p === 30 ? "30 дн" : "90 дн"}</button>`,
      )
      .join("");
    const srcs =
      [...new Set(COINS.map(([t]) => MKT.coins[t] && MKT.coins[t].src).filter(Boolean))].join(", ") ||
      "Bybit";
    const spread = MKT.usd && U && U.src === "Rapira" && c ? (MKT.usd.v / c.v - 1) * 100 : null;
    return `<section class="card mkt">
      <div class="mk-hd"><div class="mk-tt"><span class="mk-badge">${ic("trend")}</span><div><h2>Крипта</h2><small><button class="mk-upd" data-act="mkt" title="Обновить">${ic("refresh")}${status}</button></small></div></div>
        <div class="mk-hr"><div class="pill mk-pill">${pers}</div><button class="mk-x" data-act="mktoff" aria-label="Скрыть карточку" title="Скрыть (вернуть можно в Настройках)">×</button></div></div>
      <div class="mk-grid">
        <div class="mk-main" data-hold="usd">
          <div class="mk-mtop"><span class="mk-lbl">Доллар США</span><span class="mk-src">${U ? U.src + " · " + U.sub : "загрузка"}</span></div>
          <div class="mk-bigrow"><div class="mk-big num">${U ? mkRub(U.v) : "…"}</div>${chPill(U && U.ch)}</div>
          <div class="mk-bsub">${U && U.note ? esc(U.note) : "&nbsp;"}${spread != null ? `<span class="mk-dotsep"></span>ЦБ ${fx(c.v, 2)} ₽ · ${spread >= 0 ? "+" : "−"}${fx(Math.abs(spread), 2)}% к ЦБ` : ""}</div>
          ${mkChart("usd", ch, { col: "var(--gold)", area: 1, dot: 1, ticks: 5, w: 2.4, cls: "big", fmt: (v) => fx(v, 2) + " ₽", empty: "Нет данных ЦБ для графика" })}
          <div class="mk-stats"><div><span>Макс.</span><b class="num">${st ? fx(st.mx, 2) + " ₽" : "-"}</b></div><div><span>Мин.</span><b class="num">${st ? fx(st.mn, 2) + " ₽" : "-"}</b></div>
            <div><span>За ${MK_PER[mkPer].l}</span><b class="num ${pc == null ? "" : pc >= 0 ? "mup" : "mdn"}">${pc != null ? (pc >= 0 ? "+" : "−") + fx(Math.abs(pc), 2) + "%" : "-"}</b></div><div class="mk-sfoot">график и мин./макс. - курс ЦБ по дням</div></div>
        </div>
        <div class="mk-side">
          <div class="mk-list"><div class="mk-lh"><span>Монеты</span><span>${esc(srcs)} · за ${MK_PER[mkPer].l}</span></div>
          ${COINS.map(([t, nm, col, sym]) => {
            const x = MKT.coins[t],
              h = histOf(t, mkPer),
              pc = perCh(h);
            const up = (pc != null ? pc : x ? x.ch : 0) >= 0;
            return `<div class="mk-row" data-hold="${t}">${coinIc(col, sym)}<div class="mk-nm"><b>${nm}</b><span>${t}</span></div>
              ${mkChart("s" + t, h, { col: up ? "var(--good)" : "var(--bad)", w: 1.6, cls: "spark", fmt: usdF, empty: "", max: 48 })}
              <div class="mk-pr"><b class="num">${x ? usdF(x.p) : "-"}</b>${chPill(pc != null ? pc : x && x.ch)}</div></div>`;
          }).join("")}</div>
          ${MKT.fng ? fngBar(MKT.fng) : ""}
        </div>
      </div>
      <div class="mk-foot"><span>${ic("hand")}Нажми на доллар, монету или индекс - откроются подробности</span><span>Только для информации</span></div>
    </section>`;
  }
  // подробности по зажатию
  function mkSheetHTML(k) {
    mkEnsure();
    const per = () =>
      `<div class="pill mk-pill">${[7, 30, 90].map((p) => `<button data-mkp="${p}" aria-pressed="${p === mkPer}">${p === 7 ? "7 дн" : p === 30 ? "30 дн" : "90 дн"}</button>`).join("")}</div>`;
    const row = (a, b) => `<div><span>${a}</span><b class="num">${b}</b></div>`;
    let head = "",
      body = "";
    if (k === "usd") {
      const c = MKT.cbr,
        ch = cbrPer(mkPer),
        pc = perCh(ch),
        U = usdNow(),
        u = MKT.usd;
      head = `${coinIc("#3fb67e", "$")}<div class="mk-nm"><b>Доллар к рублю</b><span>${U ? U.src + " · " + U.sub : ""}</span></div>`;
      body = `<div class="mks-price"><b class="num">${U ? (U.src === "ЦБ РФ" ? fx(U.v, 4) + "<small>₽</small>" : mkRub(U.v)) : "-"}</b>${chPill(U && U.ch)}</div>
        <div class="mks-sec">Rapira · USDT/RUB</div>
        ${u ? `<div class="mks-grid">${row("Покупка", u.bid ? fx(u.bid, 2) + " ₽" : "-")}${row("Продажа", u.ask ? fx(u.ask, 2) + " ₽" : "-")}${row("Макс. за сутки", u.hi ? fx(u.hi, 2) + " ₽" : "-")}${row("Мин. за сутки", u.lo ? fx(u.lo, 2) + " ₽" : "-")}</div>` : ""}
        ${MKT.rapErr ? `<div class="mks-err">Rapira не ответила в ${hm2(MKT.rapErr.at)}: ${esc(MKT.rapErr.m)}</div>` : ""}
        <div class="mks-sec">Курс ЦБ РФ${c && c.d ? " на " + dm2(c.d) : ""}</div>${per()}
        ${mkChart("dusd", ch, { col: "var(--gold)", area: 1, dot: 1, ticks: 5, w: 2.4, cls: "sheet", fmt: (v) => fx(v, 2) + " ₽", empty: "Нет данных ЦБ" })}
        <div class="mks-grid">${row("Курс ЦБ (точно)", c ? fx(c.v, 4) + " ₽" : "-")}${row("Прошлый курс" + (c && c.pd ? " (" + dm2(c.pd) + ")" : ""), c && c.prev ? fx(c.prev, 2) + " ₽" : "-")}${row("За " + MK_PER[mkPer].l, pc != null ? (pc >= 0 ? "+" : "−") + fx(Math.abs(pc), 2) + "%" : "-")}
        ${row("Макс. за " + MK_PER[mkPer].l, ch ? fx(Math.max(...ch.map((r) => r[1])), 2) + " ₽" : "-")}${row("Мин. за " + MK_PER[mkPer].l, ch ? fx(Math.min(...ch.map((r) => r[1])), 2) + " ₽" : "-")}${u && c ? row("Rapira к ЦБ", (u.v >= c.v ? "+" : "−") + fx(Math.abs(u.v / c.v - 1) * 100, 2) + "%") : ""}</div>`;
    } else if (k === "fng") {
      const f = MKT.fng || {},
        h = MKT.fngHist || [];
      head = `<span class="mk-ic" style="--c:#e3b04b">${f.v != null ? f.v : "?"}</span><div class="mk-nm"><b>Индекс страха и жадности</b><span>${esc(FNG_RU[f.c] || f.c || "")} · alternative.me</span></div>`;
      body = `${f.v != null ? fngBar(f) : ""}
        <div class="mks-bars">${h.map((r) => `<i title="${dm2(r[0])}: ${r[1]}" style="height:${Math.max(4, r[1])}%;background:${r[1] < 25 ? "#e5534b" : r[1] < 47 ? "#e39a4b" : r[1] <= 54 ? "#9aa1b2" : r[1] <= 75 ? "#8fcf6a" : "#3fb67e"}"></i>`).join("")}</div>
        <div class="mk-cap">последние ${h.length} ${plural(h.length, "день", "дня", "дней")} · 0 - сильный страх, 100 - сильная жадность</div>
        <div class="mks-grid">${row("Сегодня", f.v != null ? f.v : "-")}${row("Вчера", f.y != null ? f.y : "-")}${row("Неделю назад", f.w != null ? f.w : "-")}${row("Месяц назад", f.m != null ? f.m : "-")}</div>`;
    } else {
      const c = COINS.find((x) => x[0] === k);
      if (!c) return "";
      const [t, nm, col, sym] = c,
        x = MKT.coins[t],
        h = histOf(t, mkPer),
        pc = perCh(h);
      const up = (pc != null ? pc : x ? x.ch : 0) >= 0;
      head = `${coinIc(col, sym)}<div class="mk-nm"><b>${nm}</b><span>${t}/USDT · ${x ? x.src : "Bybit"}</span></div>`;
      body = `<div class="mks-price"><b class="num">${x ? usdF(x.p, true) : "-"}</b>${chPill(x && x.ch)}<span class="soft">за сутки</span></div>${per()}
        ${mkChart("d" + t, h, { col: up ? "var(--good)" : "var(--bad)", area: 1, dot: 1, ticks: 5, w: 2.2, cls: "sheet", fmt: usdF, tfmt: mkPer === 7 ? (ts) => dm2(ts) + " " + hm2(ts) : dm2, empty: "Нет данных для графика" })}
        <div class="mks-grid">${row("Макс. за сутки", x && x.hi ? usdF(x.hi, true) : "-")}${row("Мин. за сутки", x && x.lo ? usdF(x.lo, true) : "-")}
        ${row("За " + MK_PER[mkPer].l, pc != null ? (pc >= 0 ? "+" : "−") + fx(Math.abs(pc), 2) + "%" : "-")}${row("Оборот за сутки", x && x.vol ? "$" + bigF(x.vol) : "-")}
        ${(() => {
          const U = usdNow();
          return row(
            "В рублях" + (U ? " (" + U.src + ")" : ""),
            x && U ? fx(x.p * U.v, x.p * U.v >= 1000 ? 0 : 2) + " ₽" : "-",
          );
        })()}${row(`Макс. за ${MK_PER[mkPer].l}`, h ? usdF(Math.max(...h.map((r) => r[1]))) : "-")}</div>`;
    }
    const cx = MKT.coins[k],
      links =
        k === "usd"
          ? mkLink(MK_URL.rapira, "Открыть USDT/RUB на Rapira") +
            mkLink(MK_URL.cbr, "Курсы ЦБ на сайте Банка России")
          : k === "fng"
            ? mkLink(MK_URL.fng, "Открыть индекс на alternative.me")
            : mkLink(
                (MK_URL[cx && cx.src] || MK_URL.Bybit)(k),
                `Открыть ${k}/USDT на ${(cx && cx.src) || "Bybit"}`,
              );
    return `<div class="dlg mks"><div class="mks-hd">${head}<button class="x" data-act="close" aria-label="Закрыть">×</button></div><div class="mks-b">${body}<div class="mks-links">${links}</div></div></div>`;
  }
  function mkOpen(k) {
    const d = R.querySelector("#dlg");
    mkSheet = k;
    d.className = "";
    d.innerHTML = mkSheetHTML(k);
    if (!d.open) d.showModal();
    d.addEventListener(
      "close",
      () => {
        mkSheet = null;
      },
      { once: true },
    );
  }

  /* ---------- жесты: зажатие открывает подробности, ведение по графику показывает значение ---------- */
  let mkHold = null,
    mkSwallow = 0;
  function mkBind(root) {
    if (mkBound) return;
    mkBound = true;
    root.addEventListener("pointerdown", (e) => {
      const h = e.target.closest("[data-hold]");
      if (!h || e.target.closest(".mk-chart:not(.spark),.mk-pill,button")) return;
      h.classList.add("pressing");
      mkHold = {
        el: h,
        x: e.clientX,
        y: e.clientY,
        t: setTimeout(() => {
          h.classList.remove("pressing");
          h.classList.add("popped");
          setTimeout(() => h.classList.remove("popped"), 260);
          try {
            navigator.vibrate && navigator.vibrate(12);
          } catch (er) {}
          mkSwallow = Date.now();
          mkHold = null;
          mkOpen(h.dataset.hold);
        }, 420),
      };
    });
    const cancel = () => {
      if (mkHold) {
        clearTimeout(mkHold.t);
        mkHold.el.classList.remove("pressing");
        mkHold = null;
      }
    };
    root.addEventListener("pointermove", (e) => {
      if (mkHold && Math.hypot(e.clientX - mkHold.x, e.clientY - mkHold.y) > 10) cancel();
      mkScrub(e);
    });
    ["pointerup", "pointercancel"].forEach((ev) =>
      root.addEventListener(
        ev,
        (e) => {
          cancel();
          if (e.pointerType !== "mouse") mkScrubEnd();
        },
        true,
      ),
    );
    root.addEventListener("pointerout", (e) => {
      const c = e.target.closest && e.target.closest(".mk-chart");
      if (c && e.pointerType === "mouse" && !c.contains(e.relatedTarget)) mkScrubEnd(c);
    });
    root.addEventListener("contextmenu", (e) => {
      if (e.target.closest("[data-hold],.mk-chart")) e.preventDefault();
    });
  }
  function mkScrub(e) {
    const c = e.target.closest && e.target.closest(".mk-chart[data-mkc]:not(.spark)");
    if (!c) return;
    if (e.pointerType !== "mouse" && !e.buttons && e.pressure === 0) return;
    const ch = MK_CH[c.dataset.mkc];
    if (!ch) return;
    const plot = c.querySelector(".mk-plot"),
      r = plot.getBoundingClientRect(),
      f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const i = Math.round(f * (ch.pts.length - 1)),
      p = ch.pts[i],
      vs = ch.pts.map((q) => q[1]),
      mn = Math.min(...vs),
      mx = Math.max(...vs),
      pad = (mx - mn) * 0.12 || mx * 0.01;
    const x = (i / (ch.pts.length - 1)) * 100,
      y = (1 - (p[1] - (mn - pad)) / (mx + pad - (mn - pad))) * 100;
    const s = plot.querySelector(".mk-scrub");
    s.hidden = false;
    c.classList.add("scrubbing");
    s.querySelector(".mk-vl").style.left = x + "%";
    const d = s.querySelector(".mk-dot");
    d.style.left = x + "%";
    d.style.top = y + "%";
    const tip = s.querySelector(".mk-tip");
    tip.innerHTML = `<b>${ch.fmt(p[1])}</b><span>${ch.tfmt(p[0])}</span>`;
    tip.style.left = Math.max(12, Math.min(88, x)) + "%";
  }
  function mkScrubEnd(c) {
    (c
      ? [c]
      : [
          ...R.querySelectorAll(".mk-chart.scrubbing"),
          ...(R.querySelector("#dlg") ? R.querySelector("#dlg").querySelectorAll(".mk-chart.scrubbing") : []),
        ]
    ).forEach((x) => {
      x.classList.remove("scrubbing");
      const s = x.querySelector(".mk-scrub");
      if (s) s.hidden = true;
    });
  }
  // клики рынка: период, обновить; клик сразу после зажатия глотаем
  function mkClick(e) {
    if (Date.now() - mkSwallow < 500 && e.target.closest("[data-hold]")) {
      e.preventDefault();
      return true;
    }
    const p = e.target.closest("[data-mkp]");
    if (p) {
      mkPer = +p.dataset.mkp;
      LS.set("mkper", mkPer);
      mkPaint();
      mkHistLoad(mkPer).then(() => {
        mkSave();
        mkPaint();
      });
      return true;
    }
    if (e.target.closest("[data-act=mktoff]")) {
      cfg.mkt = false;
      saveCfg();
      mkStop();
      render();
      toast("Крипта выключена - включить можно в Настройках");
      return true;
    }
    const a = e.target.closest("[data-act=mkt]");
    if (a) {
      toast("Обновляю курсы…");
      marketLoad(true);
      return true;
    }
    const h = e.target.closest("[data-hold]");
    if (h && !e.target.closest(".mk-chart.big,.mk-pill,button,a,#dlg")) {
      mkOpen(h.dataset.hold);
      return true;
    }
    return false;
  }

  /* ======================= запросы к API ======================= */
  const SECRET_KEY = /token|password|secret|session|refresh|access_key|cookie/i;
  // в диагностике не нужны личные данные: телефон, почта, адрес, дата рождения, реквизиты оплаты
  const PII_KEY =
    /phone|email|mail$|fio|full_name|ful_name|student_name|login|birth|^adress$|^address|date_birth|birthday|settlement_account|okpo|mfo|one_c_code|payer|fio_stud|amount_in_words|bank_name|passport|snils|inn$/i;
  const SENS_PATH =
    /leader|profile\/operations\/settings|settings\/user-info|payment\/|contacts\/operations|reviews\/|signal\/operations\/signals/;
  // структура без значений: строки заменяем пометкой, числа и флажки оставляем (по ним видно, как журнал отдаёт данные)
  const shape = (v, d = 0) =>
    d > 8 || v == null
      ? v
      : typeof v === "string"
        ? v
          ? "[текст]"
          : ""
        : Array.isArray(v)
          ? v
              .slice(0, 2)
              .map((x) => shape(x, d + 1))
              .concat(v.length > 2 ? [`…ещё ${v.length - 2}`] : [])
          : typeof v === "object"
            ? Object.fromEntries(Object.keys(v).map((k) => [k, shape(v[k], d + 1)]))
            : v;
  const scrub = (v, d = 0) =>
    d > 10 || v == null || typeof v !== "object"
      ? v
      : Array.isArray(v)
        ? v.map((x) => scrub(x, d + 1))
        : Object.fromEntries(
            Object.keys(v).map((k) => [
              k,
              SECRET_KEY.test(k) ||
              (PII_KEY.test(k) &&
                !/^is_|_type$|_verified$/.test(k) &&
                v[k] != null &&
                typeof v[k] !== "object" &&
                typeof v[k] !== "boolean") ||
              (typeof v[k] === "string" &&
                (JWT_RX.test(v[k]) || /[?&](x-amz-|signature|sig|token)=/i.test(v[k])))
                ? "[скрыто]"
                : scrub(v[k], d + 1),
            ]),
          );
  let apiActive = 0;
  const apiQ = [];
  const slot = () =>
    new Promise((r) => {
      if (apiActive < 6) {
        apiActive++;
        r();
      } else apiQ.push(r);
    });
  const unslot = () => {
    const n = apiQ.shift();
    if (n) n();
    else apiActive--;
  };
  async function api(name, path) {
    if (NET.authDead && Date.now() - NET.authDead < 4000)
      throw Object.assign(new Error("auth"), { auth: true });
    await slot();
    try {
      for (let a = 0; ; a++) {
        try {
          return await apiOnce(name, path);
        } catch (e) {
          const st = e.status;
          if (
            a >= 2 ||
            e.auth ||
            (NET.ddos && Date.now() - NET.ddos < 60000) ||
            (st && st !== 429 && st < 500)
          )
            throw e;
          delete NET.status[name];
          await sleep(700 * (a + 1) + Math.random() * 400);
        }
      }
    } finally {
      unslot();
    }
  }
  async function apiOnce(name, path) {
    const base = NET.base || DEFAULT_API;
    const headers = Object.assign({ accept: "application/json, text/plain, */*" }, NET.headers);
    if (NET.token) headers.authorization = "Bearer " + NET.token;
    if (NET.resetAt && Date.now() - NET.resetAt < 20000) headers["x-reset-cache"] = "true";
    const url = base + "/" + path;
    try {
      let r;
      try {
        r = await request(url, headers);
      } catch (e) {
        r = { status: 0, text: "", err: e };
      }
      if (NET.mode === "page" && r.status === 0) {
        NET.mode = "gm-only";
        try {
          r = await request(url, headers);
        } catch (e) {}
      }
      if (/gm/.test(NET.mode) && (r.status === 0 || r.status === 401 || r.status === 403)) {
        try {
          const f = await origFetch(url, { headers, mode: "cors", credentials: "include" });
          const t2 = await f.text();
          if (f.status >= 200 && f.status < 300) {
            NET.mode = "fetch";
            NET.modeNote = "расширение получило " + r.status + ", работает обычный запрос";
          }
          if ((f.status >= 200 && f.status < 300) || r.status === 0) r = { status: f.status, text: t2 };
        } catch (e) {}
      }
      if (r.status === 0 && r.err) throw r.err;
      const { status, text } = r;
      NET.status[name] = status;
      if (/ddos-guard|ddos guard/i.test(String(text || "").slice(0, 3000))) {
        NET.ddos = Date.now();
        throw new Error("DDoS-Guard");
      }
      if (status === 401) NET.authDead = Date.now();
      if (status === 401 || status === 403) throw Object.assign(new Error("auth"), { auth: true });
      if (status >= 200 && status < 300) {
        NET.authDead = 0;
        NET.ddos = 0;
      }
      if (status < 200 || status >= 300) throw Object.assign(new Error("HTTP " + status), { status });
      if (!String(text || "").trim()) {
        NET.status[name] = 200;
        return null;
      } // 204 / пустой ответ = данных нет
      const j = JSON.parse(text);
      NET.raw[name] = {
        path,
        data: (SENS_PATH.test(path) ? shape : scrub)(Array.isArray(j) ? j.slice(0, 2) : j),
      };
      return j;
    } catch (e) {
      NET.status[name] = NET.status[name] || String(e.message || e);
      throw e;
    }
  }
  // Запрос в обход ограничений браузера (CORS): через Tampermonkey, иначе обычный fetch
  const journalHost = (u) => {
    try {
      const x = new URL(String(u));
      return x.protocol === "https:" && /(^|\.)top-academy\.ru$/i.test(x.hostname);
    } catch (e) {
      return false;
    }
  };
  function request(url, headers) {
    if (!journalHost(url)) return Promise.reject(new Error("адрес не журнала"));
    if (NET.pageReady && typeof pageRequest === "function" && NET.mode !== "gm-only") {
      NET.mode = "page";
      return pageRequest(url, headers);
    }
    const gm =
      typeof GM_xmlhttpRequest === "function"
        ? GM_xmlhttpRequest
        : typeof GM !== "undefined" && GM && typeof GM.xmlHttpRequest === "function"
          ? GM.xmlHttpRequest
          : null;
    if (gm && NET.mode !== "fetch") {
      if (NET.mode !== "gm-only") NET.mode = "gm";
      return new Promise((res, rej) =>
        gm({
          method: "GET",
          url,
          headers: Object.assign({ referer: location.origin + "/", origin: location.origin }, headers),
          timeout: 20000,
          onload: (r) => res({ status: r.status, text: r.responseText }),
          onerror: () => rej(new Error("сеть")),
          ontimeout: () => rej(new Error("таймаут")),
        }),
      );
    }
    NET.mode = "fetch";
    const go = (cred) =>
      origFetch(url, { headers, credentials: cred, mode: "cors" }).then(async (r) => ({
        status: r.status,
        text: await r.text(),
      }));
    return go("omit").catch(() => go("include"));
  }
  const arr = (r) =>
    Array.isArray(r)
      ? r
      : r && typeof r === "object"
        ? r.data || r.items || r.result || r.list || r.rows || Object.values(r).find(Array.isArray) || []
        : [];
  const pick = (o, keys) => {
    if (!o) return undefined;
    for (const k of keys) {
      const v = o[k];
      if (v !== undefined && v !== null && v !== "") return v;
    }
    return undefined;
  };
  const num = (v) => (v === undefined || v === null || v === "" ? null : isFinite(+v) ? +v : null);
  function isoOf(s) {
    if (!s) return null;
    s = String(s);
    let m = s.match(/(\d{4})-(\d{2})-(\d{2})/);
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = s.match(/(\d{1,2})\.(\d{1,2})\.(\d{4})/);
    if (m) return `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    return null;
  }
  const hm = (s) => {
    const m = String(s || "").match(/(\d{1,2}):(\d{2})/);
    return m ? m[1].padStart(2, "0") + ":" + m[2] : "";
  };

  /* ======================= модель ======================= */
  const EMPTY = () => ({
    live: false,
    updatedAt: null,
    user: { name: "", group: "", coins: null, gems: null, photo: null, id: null },
    groupPlace: null,
    streamPlace: null,
    streamSize: null,
    schedule: {},
    schedLive: {},
    visits: [],
    leaders: [],
    feed: [],
    hw: [],
    hwStat: { all: 0, cur: 0, done: 0, wait: 0, late: 0 },
    news: [],
    reviews: [],
    exams: [],
    avg: [],
  });
  // кэш только с реальными данными этого аккаунта (никаких встроенных снимков)
  let M = (() => {
    const c = LS.get("model", null);
    return c && c.live ? Object.assign(EMPTY(), c) : EMPTY();
  })();
  const SEEDED = !M.live;

  let syncing = null,
    lastSync = 0,
    hwCountVal = null,
    retryN = 0,
    retryT = 0;
  // нет данных и журнал не ответил - пробуем снова через 15, 30, 60 секунд (например, пока идёт вход)
  function scheduleRetry() {
    if (retryN >= 5 || retryT) return;
    retryT = setTimeout(
      () => {
        retryT = 0;
        retryN++;
        if (!isLoginRoute()) sync("retry");
      },
      (M.live ? 20000 : 4000) * Math.pow(2, retryN),
    );
  }
  let syncStart = 0,
    authFails = 0,
    syncGen = 0,
    pollSig = "";
  // редко меняющиеся разделы (оплата, профиль, контакты, экзамены…) - раз в час или по кнопке «Обновить»
  const SLOW_MS = 3600e3;
  // Вход устарел: журнал сам получает 401, а Дневник - ни одного ответа. Не заставляем искать кнопку «Выйти» - выходим сами,
  // чтобы сразу появилось окно входа. Не чаще раза в 3 минуты, чтобы не зациклиться.
  function staleCheck() {
    if (!started || !cfg.on || isLoginRoute() || syncState !== "auth") return false;
    const siteSays = NET.site401 && Date.now() - NET.site401 < 90000;
    if (!(siteSays && authFails >= 1) && authFails < 3) return false;
    let last = 0;
    try {
      last = +sessionStorage.getItem("dn2.ao") || 0;
    } catch (e) {}
    if (Date.now() - last < 180000) return false;
    try {
      sessionStorage.setItem("dn2.ao", String(Date.now()));
      sessionStorage.setItem("dn2.why", "Вход в журнал устарел - войди заново");
    } catch (e) {}
    if (R) toast("Вход устарел - выхожу из аккаунта…");
    setTimeout(() => logout(true), 700);
    return true;
  }
  function sync(reason) {
    if (syncing && reason === "manual" && Date.now() - syncStart > 15000) syncing = null; // зависла - начинаем заново
    if (syncing) return syncing;
    syncStart = Date.now(); // не запускаем вторую синхронизацию поверх первой
    const g = ++syncGen,
      pr = doSync(reason, g).finally(() => {
        clearTimeout(slowT);
        if (syncing === pr) syncing = null;
        lastSync = Date.now();
      });
    const slowT = setTimeout(() => {
      if (syncing === pr && syncState === "loading" && M.live) {
        syncState = "ok";
        paintSync();
      }
    }, 20000);
    return (syncing = pr);
  }
  const strip = (m) => {
    const c = Object.assign({}, m);
    delete c.updatedAt;
    delete c.schedLive;
    return JSON.stringify(c);
  };
  let freshAt = 0;
  async function freshToken() {
    if (Date.now() - freshAt < 120000 || bridging || isLoginRoute()) return;
    freshAt = Date.now();
    const old = NET.token;
    kicks = Math.min(kicks, 1);
    kickJournal();
    for (let i = 0; i < 25 && NET.token === old; i++) await sleep(200);
  }
  async function doSync(reason, gen) {
    if (navigator.onLine === false) {
      setSync("error");
      return;
    }
    if (reason === "manual") NET.resetAt = Date.now();
    const slow =
      !M.live ||
      reason === "manual" ||
      reason === "start" ||
      Date.now() - (LS.get("slowAt", 0) || 0) > SLOW_MS;
    const opt = (n, pth) => (slow ? api(n, pth) : Promise.reject({ skip: true }));
    setSync("loading");
    {
      const ex = NET.token && jwtExp(NET.token);
      if (ex && ex < Date.now() + 20000) {
        await freshToken();
        if (jwtExp(NET.token) && jwtExp(NET.token) < Date.now()) {
          forgetToken();
          NET.token = null;
        }
      }
    }
    if (NET.tokenSrc !== "перехват") {
      const t = scanStorageForToken();
      if (t) NET.token = t;
    }
    const today = new Date(),
      mon = mondayOf(today);
    // счётчики ДЗ - один лёгкий запрос; полный список заданий (10+ запросов) - только если счётчики изменились или раз в час
    const hwcP = api("hwCount", "count/homework");
    const hwP = hwcP.then(
      (r) => {
        const sig = JSON.stringify(r);
        if (!slow && (M.hw || []).length && LS.get("hwsig", "") === sig) return null;
        return loadHomework().then((x) => {
          LS.set("hwsig", sig);
          return x;
        });
      },
      () => loadHomework(),
    );
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
      payI: opt("payIndex", "payment/operations/index"),
      payS: opt("paySchedule", "payment/operations/schedule"),
      payH: opt("payHistory", "payment/operations/history"),
      prof: opt("profile", "profile/operations/settings"),
      sig: api("signals", "signal/operations/signals-list"),
      sigT: opt("signalTypes", "signal/operations/problems-list"),
      evl: api("evalLessons", "feedback/students/evaluate-lesson-list"),
      libC: opt("libraryCount", "count/library"),
      cont: opt("contacts", "contacts/operations/index"),
      avg: opt("avgProgress", "dashboard/chart/average-progress"),
      attC: opt("attendanceChart", "dashboard/chart/attendance"),
      quiz: api("quizOpen", "library/quiz/opened-interview"),
      quizD: opt("quizDebt", "library/operations/quizzes-academic-debt"),
    };
    const keys = Object.keys(tasks),
      res = await Promise.allSettled(Object.values(tasks));
    if (gen !== syncGen) return; // пока ждали, началась более новая синхронизация
    const R = {};
    keys.forEach((k, i) => (R[k] = res[i]));
    const asked = keys.filter((k) => !(R[k].reason && R[k].reason.skip));
    const good = asked.filter((k) => R[k].status === "fulfilled").length;
    if (good && good < asked.length * 0.7) scheduleRetry();
    else if (good) retryN = 0;
    if (slow && good >= asked.length * 0.7) LS.set("slowAt", Date.now());
    NET.totalCount = asked.length;
    if (!good) {
      const auth = res.some((r) => r.reason && r.reason.auth);
      if (auth && NET.tokenSrc !== "перехват") {
        forgetToken();
        NET.token = null;
      }
      authFails = auth ? authFails + 1 : 0;
      setSync(auth ? "auth" : "error");
      if (auth) {
        if (staleCheck()) return;
        kickJournal();
      }
      scheduleRetry();
      return;
    }
    authFails = 0;
    NET.okCount = good;
    // другой аккаунт в этом же браузере - начинаем с чистого листа
    let base = M;
    try {
      if (R.user.status === "fulfilled") {
        const uid = pick(userObj(R.user.value), ["student_id", "id", "user_id"]);
        if (uid != null && M.user.id != null && String(uid) !== String(M.user.id)) {
          base = EMPTY();
          readSet = new Set();
          LS.set("read", []);
          avaMem = null;
          LS.set("ava", null);
          seen = null;
          LS.set("seen", null);
        }
      }
    } catch (e) {}
    const N = JSON.parse(JSON.stringify(base));
    setTimeout(() => {
      try {
        if (M.groupPlace) {
          const ym = iso(new Date()).slice(0, 7),
            h = LS.get("rankHist", {});
          h[ym] = Object.assign({ first: M.groupPlace }, h[ym] || {}, { last: M.groupPlace });
          LS.set("rankHist", h);
        }
      } catch (e) {}
    }, 0);
    const prevNews = new Set((base.news || []).map((n) => n.id)),
      wasLive = base.live;
    N.live = true;
    try {
      if (R.user.status === "fulfilled") parseUser(N, R.user.value);
    } catch (e) {}
    try {
      if (R.visits.status === "fulfilled") parseVisits(N, R.visits.value);
    } catch (e) {}
    try {
      if (R.lg.status === "fulfilled") N.leaders = parseLeaders(R.lg.value, N);
    } catch (e) {}
    try {
      if (R.ls.status === "fulfilled") {
        const s = parseLeaders(R.ls.value, N);
        const me = s.find((x) => x.me);
        N.streamPlace = me ? me.pos : N.streamPlace;
        N.streamSize = s.length;
        N.streamLeaders = s;
      }
    } catch (e) {}
    try {
      if (R.act.status === "fulfilled") {
        const all = arr(R.act.value).map(parseActivity).filter(Boolean);
        N.feed = all.slice(0, 30);
        N.feedAll = all.slice(0, 400);
      }
    } catch (e) {}
    try {
      if (R.news.status === "fulfilled") N.news = arr(R.news.value).map(parseNews).filter(Boolean);
    } catch (e) {}
    try {
      if (R.rev.status === "fulfilled") N.reviews = arr(R.rev.value).map(parseReview).filter(Boolean);
    } catch (e) {}
    try {
      if (R.exams.status === "fulfilled") N.exams = arr(R.exams.value).map(parseExam).filter(Boolean);
    } catch (e) {}
    hwCountVal = R.hwc.status === "fulfilled" ? R.hwc.value : null;
    try {
      if (hwCountVal) parseHwCount(N, hwCountVal);
    } catch (e) {}
    try {
      if (R.payI.status === "fulfilled")
        parsePay(
          N,
          R.payI.value,
          R.payS.status === "fulfilled" ? R.payS.value : null,
          R.payH.status === "fulfilled" ? R.payH.value : null,
        );
    } catch (e) {}
    try {
      if (R.prof.status === "fulfilled") N.prof = parseProfile(R.prof.value);
    } catch (e) {}
    try {
      if (R.sig.status === "fulfilled")
        N.signals = arr(R.sig.value).map((o) => ({
          title: String(pick(o, ["theme", "title", "subject", "name"]) || "Обращение"),
          status: String(pick(o, ["status_name", "status", "state"]) ?? ""),
          date: isoOf(pick(o, ["date", "created_at", "date_create", "time"])),
          days: num(pick(o, ["days_in_work", "days", "work_days"])),
        }));
    } catch (e) {}
    try {
      if (R.sigT.status === "fulfilled") {
        const L = arr(R.sigT.value);
        N.sigTypes = L.map((o) => String(pick(o, ["title", "name"]) || "")).filter(Boolean);
        N.sigIds = Object.fromEntries(
          L.map((o) => [String(pick(o, ["title", "name"]) || ""), pick(o, ["id"])]),
        );
      }
    } catch (e) {}
    try {
      if (R.evl.status === "fulfilled") N.evalList = parseEval(R.evl.value);
    } catch (e) {}
    try {
      if (R.cont.status === "fulfilled") {
        const c = R.cont.value || {};
        N.contacts = {
          address:
            arr(c.adress)
              .map((a) => a.adress_name)
              .filter(Boolean)[0] || "",
          curators: arr(c.teach_main).map((t) => ({
            name: t.teachMain_name || "",
            mails: arr(t.href_teach),
          })),
          site: arr(c.site_shag)[0] || "",
        };
      }
    } catch (e) {}
    try {
      if (R.avg.status === "fulfilled")
        N.avg = arr(R.avg.value)
          .map((o) => ({
            date: isoOf(pick(o, ["date", "month", "period"])),
            v: num(pick(o, ["points", "value", "avg", "average"])),
            p: num(pick(o, ["previous_points", "prev", "previous"])),
          }))
          .filter((x) => x.date && x.v != null);
    } catch (e) {}
    try {
      if (R.attC.status === "fulfilled")
        N.attChart = arr(R.attC.value)
          .map((o) => ({
            date: isoOf(pick(o, ["date", "month", "period"])),
            v: num(pick(o, ["points", "value", "percent", "attendance"])),
          }))
          .filter((x) => x.date && x.v != null && x.v <= 100);
    } catch (e) {}
    try {
      const qL = [R.quiz, R.quizD].filter((x) => x.status === "fulfilled").map((x) => x.value);
      if (qL.length) {
        const all = qL.flatMap((v) =>
          arr(v).length
            ? arr(v)
            : v && typeof v === "object" && (v.id || v.interview_id || v.name || v.title)
              ? [v]
              : [],
        );
        N.quiz = all.length
          ? { n: all.length, title: String(pick(all[0], ["name", "title", "theme", "interview_name"]) || "") }
          : null;
      }
    } catch (e) {}
    try {
      if (R.libC.status === "fulfilled")
        N.libCount = arr(R.libC.value).reduce(
          (a, x) => a + (num(pick(x, ["materials_count", "count"])) || 0),
          0,
        );
    } catch (e) {}
    try {
      if (R.sched.status === "fulfilled") {
        if (!M.live) N.schedule = {};
        N.schedLive = N.schedLive || {};
        Object.assign(N.schedule, R.sched.value.days);
        Object.assign(N.schedLive, R.sched.value.weeks);
      }
    } catch (e) {}
    const me = (N.leaders || []).find((x) => x.me);
    if (me) N.groupPlace = me.pos;
    // старые недели расписания не храним (кэш не растёт бесконечно)
    {
      const lim = iso(dayDate(mondayOf(new Date()), -56));
      Object.keys(N.schedule || {}).forEach((d) => {
        if (d < lim) delete N.schedule[d];
      });
      Object.keys(N.schedLive || {}).forEach((d) => {
        if (d < lim) delete N.schedLive[d];
      });
    }
    const changed = strip(N) !== strip(M);
    N.updatedAt = Date.now();
    M = N;
    LS.set("model", M);
    const hadFresh = JSON.stringify(Object.keys(fresh).map((k) => fresh[k].size));
    computeFresh();
    setSync("ok");
    if (changed || !wasLive || hadFresh !== JSON.stringify(Object.keys(fresh).map((k) => fresh[k].size)))
      render(); // экран обновляется только если в журнале что-то поменялось
    // новые объявления с прошлой синхронизации - показываем окно (в нашем дизайне)
    if (wasLive) {
      const nw = (M.news || []).filter((n) => !prevNews.has(n.id) && !isRead(n));
      if (nw.length) newsNotice(nw);
    }
    if (wasLive)
      try {
        const had = new Set();
        (base.visits || []).forEach((v) =>
          MK.forEach((k) => v[k] != null && had.add(v.date + "|" + v.ln + "|" + v.subj + "|" + k)),
        );
        const add = [];
        (M.visits || []).forEach((v) =>
          MK.forEach((k) => {
            if (v[k] != null && !had.has(v.date + "|" + v.ln + "|" + v.subj + "|" + k))
              add.push(`«${v[k]}» ${subjShort(v.subj)}`);
          }),
        );
        if (add.length && add.length <= 12)
          toast(
            add.length === 1
              ? "Новая оценка: " + add[0]
              : `Новые оценки: ${add.slice(0, 3).join(", ")}${add.length > 3 ? ` и ещё ${add.length - 3}` : ""}`,
          );
      } catch (e) {}
    try {
      const items = await hwP;
      if (!items || !items.length || gen !== syncGen) return;
      const before = JSON.stringify(M.hw),
        st = JSON.stringify(M.hwStat),
        c0 = fresh.homework ? fresh.homework.size : 0,
        wasDone = new Set((M.hw || []).filter((h) => h.status === "done").map((h) => h.id)),
        hadHw = (M.hw || []).length;
      parseHomework(M, items);
      if (hwCountVal) parseHwCount(M, hwCountVal);
      if (hadHw) {
        const nd = (M.hw || []).filter((h) => h.status === "done" && h.id != null && !wasDone.has(h.id));
        if (nd.length === 1)
          toast(
            `ДЗ проверено: «${nd[0].mark}» ${subjShort(nd[0].subj)}${nd[0].teacherComment ? " · есть комментарий" : ""}`,
          );
        else if (nd.length > 1 && nd.length < 10) toast(`Проверено заданий: ${nd.length}`);
      }
      if (JSON.stringify(M.hw) !== before || JSON.stringify(M.hwStat) !== st) {
        LS.set("model", M);
        computeFresh();
        if (["home", "homework"].includes(page) || (fresh.homework && fresh.homework.size !== c0)) render();
      }
    } catch (e) {}
  }
  async function loadWeeks(mons) {
    const out = {},
      weeks = {};
    await Promise.allSettled(
      mons.map(async (m) => {
        const a = iso(m),
          b = iso(dayDate(m, 6));
        const r = await api(
          "schedule " + a,
          `schedule/operations/get-by-date-range?date_start=${a}&date_end=${b}`,
        );
        for (let i = 0; i < 7; i++) out[iso(dayDate(m, i))] = [];
        arr(r).forEach((o) => {
          const d = isoOf(pick(o, ["date", "lesson_date", "day"]));
          if (!d) return;
          (out[d] = out[d] || []).push({
            start: hm(pick(o, ["started_at", "start", "time_start", "begin"])),
            end: hm(pick(o, ["finished_at", "end", "time_end", "finish"])),
            subj: String(pick(o, ["subject_name", "spec_name", "subject", "name_spec"]) || "Занятие"),
            teacher: String(pick(o, ["teacher_name", "teacher", "fio_teach"]) || ""),
            room: String(pick(o, ["room_name", "room", "auditorium", "classroom"]) || ""),
            n: num(pick(o, ["lesson", "lesson_number", "para"])),
          });
        });
        weeks[a] = Date.now();
      }),
    );
    Object.values(out).forEach((l) => l.sort((a, b) => a.start.localeCompare(b.start)));
    if (!Object.keys(weeks).length) throw new Error("расписание не загрузилось");
    return { days: out, weeks };
  }
  const weekLoading = {};
  async function ensureWeek(mon) {
    const k = iso(mon),
      ts = M.schedLive && M.schedLive[k];
    if (
      !M.live ||
      (weekLoading[k] && Date.now() - weekLoading[k] < 120000) ||
      (ts && Date.now() - ts < 30 * 60 * 1000)
    )
      return; // неделя свежее 30 минут - не перезапрашиваем
    weekLoading[k] = Date.now();
    try {
      const r = await loadWeeks([mon]);
      const before = JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => M.schedule[iso(dayDate(mon, d))]));
      Object.assign(M.schedule, r.days);
      M.schedLive = Object.assign(M.schedLive || {}, r.weeks);
      LS.set("model", M);
      if (
        JSON.stringify([0, 1, 2, 3, 4, 5, 6].map((d) => M.schedule[iso(dayDate(mon, d))])) !== before &&
        (page === "schedule" || page === "grades" || page === "home")
      ) {
        const sc0 = host && host.scrollTop;
        render();
        if (host) host.scrollTop = sc0;
      }
      weekLoading[k] = 0;
    } catch (e) {}
  }
  // type=0 - домашние, type=1 - лабораторные (журнал отдаёт по 6 на страницу)
  async function loadHomework() {
    const seen = new Map();
    const run = (type, sts) =>
      Promise.all(
        sts.map(async (st) => {
          for (let page = 1; page <= 10; page++) {
            let r;
            try {
              r = await api(
                `homework t${type} s${st} p${page}`,
                `homework/operations/list?page=${page}&status=${st}&type=${type}`,
              );
            } catch (e) {
              break;
            }
            const items = arr(r);
            if (!items.length) break;
            let fresh = 0;
            items.forEach((o) => {
              const id = type + ":" + (pick(o, ["id", "homework_id"]) ?? JSON.stringify(o).slice(0, 120));
              if (!seen.has(id)) {
                seen.set(id, Object.assign({ __st: st, __lab: type === 1 }, o));
                fresh++;
              }
            });
            if (!fresh || items.length < 6 || st !== 4) break;
          }
        }),
      );
    await run(0, [4, 0, 3, 2, 5]);
    // лабораторные: сначала общий список; если он пуст - остальные статусы не спрашиваем
    const labs0 = seen.size;
    await run(1, [4]);
    if (seen.size > labs0) await run(1, [0, 3, 2, 5]);
    return [...seen.values()];
  }
  const parseEval = (r) =>
    arr(r)
      .map((o) => ({
        key: o.key,
        date: isoOf(o.date_visit),
        teacher: String(o.fio_teach || ""),
        subj: String(o.spec_name || ""),
        photo: safeUrl(o.teach_photo) || null,
      }))
      .filter((o) => o.key);
  const userObj = (r) => (Array.isArray(r) ? r[0] : r && r.data && !Array.isArray(r.data) ? r.data : r);
  function parseUser(N, r) {
    const o = userObj(r);
    const name = pick(o, ["full_name", "fio", "name", "student_name"]);
    if (name) N.user.name = String(name);
    const g = pick(o, ["group_name", "group", "name_group"]);
    if (g) N.user.group = String(typeof g === "object" ? g.name || "" : g).replace(/\.$/, "");
    ["stream_name", "level", "birthday", "age", "registration_date", "achieves_count"].forEach((k) => {
      if (o[k] != null) N.user[k] = o[k];
    });
    if (o.visibility) {
      N.user.emailOk = !!o.visibility.is_email_verified;
      N.user.phoneOk = !!o.visibility.is_phone_verified;
      N.user.bday = !!o.visibility.is_birthday;
      N.user.debtor = !!o.visibility.is_debtor;
      N.user.quizLate = !!o.visibility.is_quizzes_expired;
    }
    const ph = pick(o, ["photo", "photo_path", "avatar", "photo_url"]);
    N.user.photo = ph && /^https?:|^\//.test(ph) && safeUrl(ph) ? String(ph) : null;
    const id = pick(o, ["student_id", "id", "user_id"]);
    if (id != null) N.user.id = id;
    const gp = arr(pick(o, ["gaming_points", "points", "balance"]) || []);
    if (gp.length) {
      const val = (x) => num(pick(x, ["points", "point", "amount", "value", "count"]));
      const typ = (x) =>
        num(pick(x, ["new_gaming_point_types__id", "point_types_id", "type", "type_id", "id"]));
      const s = [...gp].sort((a, b) => (typ(a) || 0) - (typ(b) || 0));
      if (val(s[0]) != null) N.user.coins = val(s[0]);
      if (s[1] && val(s[1]) != null) N.user.gems = val(s[1]);
    }
  }
  function parseVisits(N, r) {
    const list = arr(r)
      .map((o) => {
        const d = isoOf(pick(o, ["date_visit", "date", "lesson_date", "visit_date"]));
        if (!d) return null;
        const st = num(pick(o, ["status_was", "status", "was", "visit_status"]));
        return {
          date: d,
          ln: num(pick(o, ["lesson_number", "lesson", "para"])) ?? 0,
          miss: st === 0,
          late: st === 2,
          hw: num(pick(o, ["home_work_mark", "homework_mark", "hw_mark"])),
          cw: num(pick(o, ["class_work_mark", "classwork_mark", "cw_mark"])),
          lab: num(pick(o, ["lab_work_mark", "lab_mark"])),
          ctrl: num(pick(o, ["control_work_mark", "control_mark", "exam_mark"])),
          prac: num(pick(o, ["practical_work_mark", "practical_mark"])),
          fin: num(pick(o, ["final_work_mark", "final_mark"])),
          subj: String(pick(o, ["spec_name", "subject_name", "name_spec", "subject"]) || "Занятие"),
          teacher: String(pick(o, ["teacher_name", "teacher", "fio_teach"]) || ""),
          topic: String(pick(o, ["lesson_theme", "theme", "topic"]) || ""),
        };
      })
      .filter(Boolean);
    if (!list.length) {
      if (Array.isArray(r) && !r.length) N.visits = [];
      return;
    }
    list.sort((a, b) => a.date.localeCompare(b.date) || a.ln - b.ln);
    list.forEach((v, i) => (v.n = i + 1));
    N.visits = list;
  }
  function parseLeaders(r, N) {
    const me = (N.user.name || "").toLowerCase().split(/\s+/).slice(0, 2).join(" ");
    return arr(r)
      .map((o, i) => {
        const name = String(pick(o, ["full_name", "fio", "name", "student_name"]) || "");
        const id = pick(o, ["id", "student_id"]);
        const ph = pick(o, ["photo_path", "photo", "avatar"]);
        return {
          name,
          photo: ph && /^https?:|^\//.test(ph) ? String(ph) : null,
          pts: num(pick(o, ["amount", "points", "total", "sum"])) ?? 0,
          pos: num(pick(o, ["position", "place", "rank"])) ?? i + 1,
          me: (N.user.id != null && id === N.user.id) || (me && name.toLowerCase().startsWith(me)),
        };
      })
      .filter((x) => x.name)
      .sort((a, b) => a.pos - b.pos);
  }
  function parseActivity(o) {
    const d = isoOf(pick(o, ["date", "created_at", "time"]));
    const amt = num(pick(o, ["current_point", "points", "amount", "point"]));
    if (!d || amt == null) return null;
    const t = num(pick(o, ["point_types_id", "type", "point_type"]));
    const label = String(
      pick(o, ["achievements_name", "action_name", "name", "action", "point_types_name", "description"]) ||
        "Начисление",
    );
    return {
      date: d,
      label: actName(label),
      code: label,
      amt,
      kind: t === 2 ? "gem" : "coin",
      plus: num(o.action) !== 0,
    };
  }
  const ACTION_NAMES = {
    EVALUATION_LESSON_MARK: "Оценка занятия",
    ASSESMENT: "Оценка",
    ASSESSMENT: "Оценка",
    HOMETASK_INTIME: "Своевременное выполнение домашнего задания",
    VISIT: "Посещение пары",
    PAIR_VISIT: "Посещение пары",
  };
  // журнал иногда присылает внутренние коды (20_VISITS_WITHOUT_GAP) - переводим по смыслу
  function actName(c) {
    c = String(c || "").trim();
    if (ACTION_NAMES[c]) return ACTION_NAMES[c];
    if (!/^[A-Z0-9_ -]+$/.test(c) || !/[A-Z]/.test(c)) return c || "Начисление";
    const m = c.match(/(\d+)_?VISITS?_WITHOUT_(GAP|DELAY|LATE|MISS)/);
    if (m) return `${m[1]} посещений подряд без ${/GAP|MISS/.test(m[2]) ? "пропусков" : "опозданий"}`;
    const R = [
      [/E?_?MAIL/, "Подтверждение электронной почты"],
      [/PROFILE/, "Заполненный профиль"],
      [/FRIEND|INVITE|REFERR/, "Привёл друга учиться"],
      [/SHIRT|LOGO/, "Футболка с логотипом"],
      [/POLL|SURVEY|QUESTION/, "Участие в опросе"],
      [/CONTEST|COMPET|OLYMP/, "Участие в конкурсе"],
      [/REVIEW|SOCIAL/, "Отзыв"],
      [/PORTFOLIO/, "Работа в портфолио"],
      [/EXAM|COURSE/, "Экзамен или курсовая"],
      [/LAB/, "Лабораторная работа"],
      [/HOME|TASK|HW/, "Домашнее задание"],
      [/TEACHER|BONUS|ENCOURAG|PRAISE|REWARD/, "Поощрение преподавателя"],
      [/EVALUAT/, "Оценка занятия"],
      [/MARK|ASSES/, "Оценка"],
      [/VISIT|ATTEND/, "Посещение пары"],
    ];
    const f = R.find(([rx]) => rx.test(c));
    return f ? f[1] : "Начисление";
  }
  function parseNews(o) {
    const t = pick(o, ["theme", "title", "name", "subject"]);
    if (!t) return null;
    return {
      id: pick(o, ["id", "id_bbs"]) ?? t,
      title: String(t).replace(/<[^>]+>/g, ""),
      date: isoOf(pick(o, ["time", "date", "created_at", "publish_date"])),
      read: !!num(pick(o, ["viewed", "is_read", "read"])),
    };
  }
  function parseReview(o) {
    const text = pick(o, ["message", "text", "review", "comment"]);
    if (!text) return null;
    return {
      text: String(text).replace(/<[^>]+>/g, ""),
      teacher: String(pick(o, ["teacher", "fio_teach", "teacher_name", "author"]) || ""),
      subj: String(pick(o, ["spec", "subject", "spec_name", "subject_name"]) || ""),
      date: isoOf(pick(o, ["date", "created_at", "time"])),
    };
  }
  function parseExam(o) {
    const s = pick(o, ["spec", "subject", "spec_name", "subject_name", "name"]);
    if (!s) return null;
    return {
      subj: String(s),
      date: isoOf(pick(o, ["date", "date_exam", "exam_date"])),
      type: String(pick(o, ["type", "exam_type", "form"]) || ""),
    };
  }
  // текст из журнала может прийти с HTML (<p>, <br>, &nbsp;) - оставляем только сам текст
  function plainTx(v) {
    let t = String(v == null ? "" : v);
    if (/[<&]/.test(t)) {
      try {
        const d = new W.DOMParser().parseFromString(
          t.replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "</p>\n"),
          "text/html",
        );
        t = d.body.textContent || "";
      } catch (e) {}
    }
    return t
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }
  function parseHomework(N, items) {
    const now = new Date();
    N.hw = items
      .map((o) => {
        const stud = o.homework_stud || o.student_homework || o.homework_student || {};
        const mark = num(pick(stud, ["mark", "grade"])) ?? num(pick(o, ["mark", "grade"]));
        const sub = isoOf(pick(stud, ["creation_time", "date", "send_time", "created_at"]));
        const due = isoOf(pick(o, ["completion_time", "deadline", "date_end", "overdue_time"]));
        // overdue_time - после неё работа считается просроченной (может быть позже срока сдачи)
        const overRaw = o.overdue_time ? String(o.overdue_time) : "",
          over = isoOf(overRaw),
          overAt = overRaw ? new Date(overRaw.replace(" ", "T")) : null;
        const hc = o.homework_comment && typeof o.homework_comment === "object" ? o.homework_comment : {};
        const tc =
          o.homework_comment && typeof o.homework_comment === "object"
            ? o.homework_comment.text_comment
            : null;
        const comment = !!tc;
        const extra = {
          task: plainTx(o.comment),
          teacherComment: plainTx(tc),
          answer: plainTx(stud.stud_answer),
          taskFile: safeUrl(o.file_path) || null,
          myFile: safeUrl(stud.file_path) || null,
          cover: safeUrl(o.cover_image) || null,
          tFile: safeUrl(hc.attachment_path) || null,
          checked: isoOf(hc.date_updated),
          auto: !!num(stud.auto_mark),
          lab: !!o.__lab,
          over: over && over !== due ? over : null,
        };
        const lateNow = due && dayDate(fromIso(due), 1) <= now;
        // статус 5 - «Удалено преподавателем»: показываем в просроченных с пометкой
        const removed = num(o.status) === 5 && mark == null;
        let status = mark != null ? "done" : removed ? "late" : sub ? "wait" : lateNow ? "late" : "cur";
        extra.removed = removed;
        return {
          id: pick(o, ["id", "homework_id"]) ?? null,
          subj: String(pick(o, ["name_spec", "spec_name", "subject_name", "subject"]) || "Задание"),
          theme: String(pick(o, ["theme", "name", "title"]) || ""),
          due,
          sub,
          mark,
          status,
          comment,
          teacher: String(pick(o, ["fio_teach", "teacher_name", "teacher"]) || ""),
          ...extra,
        };
      })
      .sort((a, b) => (b.due || "").localeCompare(a.due || ""));
    const c = { all: N.hw.length, cur: 0, done: 0, wait: 0, late: 0 };
    N.hw.forEach((h) => c[h.status]++);
    N.hwStat = c;
  }
  function parsePay(N, idx, sch, hist) {
    const p = idx && idx.payment ? idx.payment : null;
    if (!p) return;
    N.pay = {
      recv: p.organization_name || "",
      inn: p.okpo || "",
      bik: p.mfo || "",
      acc: p.settlement_account || "",
      bank: p.bank_name || "",
      purpose: [p.purpose_of_payment, p.one_c_code ? "1С код: " + p.one_c_code : ""]
        .filter(Boolean)
        .join(" "),
      debt: num(p.amount_debt),
      next: num(p.amount_next),
      nextDate: isoOf(p.pay_date_start),
      updated: isoOf(p.updated_at),
      invoice: !!idx.has_invoice_access,
      plan: arr(sch)
        .map((x) => [
          isoOf(x.payment_date),
          String(x.description || ""),
          num(x.price) || 0,
          num(x.status) || 0,
        ])
        .filter((x) => x[0]),
      hist: arr(hist)
        .map((x) => [isoOf(x.date), String(x.description || "").replace(/;.*$/, ""), num(x.amount) || 0])
        .filter((x) => x[0]),
    };
  }
  function parseProfile(o) {
    if (!o || typeof o !== "object") return null;
    const ph = arr(o.phones)
      .map((x) => String(x.phone_number || ""))
      .filter(Boolean);
    return {
      name: o.ful_name || o.full_name || "",
      address: o.address || "",
      study: o.study || "",
      email: o.email || "",
      phones: ph,
      birth: isoOf(o.date_birth),
      links: arr(o.links)
        .filter((l) => l.value)
        .map((l) => ({ name: l.name === "LINK_TO_SOCIAL" ? "Соцсеть" : l.name, value: String(l.value) })),
      fill: num(o.fill_percentage),
      pending: !!(o.has_not_approved_data || o.has_not_approved_photo),
      decline: o.decline_comment || "",
      photo: o.photo_path || null,
    };
  }
  // counter_type журнала: 3 текущие (новые), 0 просроченные, 2 на проверке, 4 всего (проверено считаем сами)
  function parseHwCount(N, r) {
    const a = arr(r);
    if (!a.length) return;
    const c = {};
    a.forEach((x) => {
      const t = num(pick(x, ["counter_type", "type"]));
      if (t != null) c[t] = num(pick(x, ["counter", "count", "value"])) || 0;
    });
    if (c[4] == null) return;
    const loc = { done: 0 };
    (N.hw || []).forEach((h) => {
      if (h.status === "done") loc.done++;
    });
    N.hwStat = {
      all: c[4],
      total: c[4],
      cur: c[3] || 0,
      done: loc.done || Math.max(0, (c[4] || 0) - (c[3] || 0) - (c[0] || 0) - (c[2] || 0)),
      wait: c[2] || 0,
      late: c[0] || 0,
    };
  }

  /* ======================= утилиты дат и текста ======================= */
  function mondayOf(d) {
    const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  }
  function dayDate(mon, d) {
    const x = new Date(mon);
    x.setDate(x.getDate() + d);
    return x;
  }
  function iso(d) {
    return (
      d.getFullYear() +
      "-" +
      String(d.getMonth() + 1).padStart(2, "0") +
      "-" +
      String(d.getDate()).padStart(2, "0")
    );
  }
  function fromIso(s) {
    const [y, m, d] = s.split("-").map(Number);
    return new Date(y, m - 1, d);
  }
  function atTime(isoDay, t) {
    const d = fromIso(isoDay);
    const [h, m] = t.split(":").map(Number);
    d.setHours(h || 0, m || 0, 0, 0);
    return d;
  }
  const sameDay = (a, b) =>
    a.getFullYear() == b.getFullYear() && a.getMonth() == b.getMonth() && a.getDate() == b.getDate();
  const DAYS = ["Понедельник", "Вторник", "Среда", "Четверг", "Пятница", "Суббота", "Воскресенье"],
    DSH = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
  const MON = [
    "января",
    "февраля",
    "марта",
    "апреля",
    "мая",
    "июня",
    "июля",
    "августа",
    "сентября",
    "октября",
    "ноября",
    "декабря",
  ];
  const MONN = [
    "Январь",
    "Февраль",
    "Март",
    "Апрель",
    "Май",
    "Июнь",
    "Июль",
    "Август",
    "Сентябрь",
    "Октябрь",
    "Ноябрь",
    "Декабрь",
  ];
  const dm = (d) => String(d.getDate()).padStart(2, "0") + "." + String(d.getMonth() + 1).padStart(2, "0");
  const longDate = (d) => `${d.getDate()} ${MON[d.getMonth()]}`;
  const dayDiff = (a, b) =>
    Math.round(
      (new Date(b.getFullYear(), b.getMonth(), b.getDate()) -
        new Date(a.getFullYear(), a.getMonth(), a.getDate())) /
        864e5,
    );
  const esc = (s) =>
    String(s == null ? "" : s).replace(
      /[&<>"']/g,
      (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
    );
  // только http(s): javascript:, data: и прочее отбрасываем
  const safeUrl = (u) => {
    if (!u) return "";
    try {
      const x = new URL(String(u).trim(), location.href);
      return /^https?:$/.test(x.protocol) ? x.href : "";
    } catch (e) {
      return "";
    }
  };
  const plural = (n, a, b, c) => {
    const m10 = n % 10,
      m100 = n % 100;
    return m10 == 1 && m100 != 11 ? a : m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20) ? b : c;
  };
  const pairsW = (n) => n + " " + plural(n, "пара", "пары", "пар");
  // этажи филиала: 4 этаж - кабинеты 1-3 (3 - конференц-зал), 5 этаж - кабинеты 5-11
  // всё, что не просто номер (спортзал, другой адрес, «онлайн»), показываем ровно как в журнале
  const roomTxt = (r) => {
    const s = String(r || "").trim();
    if (!/^\d{1,3}$/.test(s)) return s;
    const n = +s,
      fl = n >= 1 && n <= 3 ? 4 : n >= 5 && n <= 11 ? 5 : null;
    return "каб. " + s + (fl ? " · " + fl + " этаж" : "");
  };
  // короткие названия длинных предметов (полное - в подсказке)
  const SUBJ_SHORT = {
    "элективные курсы по физической культуре и спорту": "Элективы по физкультуре",
    "физическая культура и спорт": "Физкультура",
    "технологии эффективной коммуникации": "Эфф. коммуникации",
    "введение в специальность": "Введ. в специальность",
    "современные методы и средства разработки программного обеспечения": "Методы разработки ПО",
    "программирование на языке с++ и ооп": "C++ и ООП",
    "платформа microsoft .net и программирование c#": "C# и .NET",
    "теория вероятностей и математическая статистика": "Теорвер и статистика",
    "защита интеллектуальной собственности": "Защита ИС",
    "иностранный язык": "Ин. язык",
    "теория информации и кодирования": "Теория информации",
    "алгоритмы и структуры данных": "Алгоритмы и СД",
    "компьютерные системы и сети": "Компьютерные сети",
    "информационные технологии": "Инф. технологии",
    "нейронные сети в машинном обучении": "Нейросети",
    "информационная безопасность": "Инфобез",
    "проектирование информационных систем": "Проект. ИС",
    "разработка мобильных приложений": "Мобильная разработка",
    // факультет дизайна
    "история культуры и искусства": "История искусств",
    "история и теория дизайна": "История дизайна",
    "типографика и печатная продукция": "Типографика",
    "визуальный анализ данных": "Виз. анализ данных",
    "рисунок и проектная графика": "Рисунок и графика",
    "проектирование в растровой графике": "Растровая графика",
    "пропедевтика и основы композиции": "Пропедевтика",
    "проектирование в графическом дизайне": "Графический дизайн",
    "проектирование в векторной графике": "Векторная графика",
    "создание интерьеров планов и чертежей autocad 3ds max": "AutoCAD и 3ds Max",
    "проектирование объектов анимации и визуализации maya": "Анимация в Maya",
    "концептуальное проектирование сайтов web дизайн": "Web-дизайн",
    "звуковые спецэффекты и дизайн звука": "Дизайн звука",
    "визуальные коммуникации в рекламе": "Виз. коммуникации",
    "основы промышленного дизайна": "Осн. пром. дизайна",
    "cgi и визуальные эффекты": "CGI и VFX",
    "проектирование объектов промышленного дизайна": "Пром. дизайн",
    "проектирование цифровых объектов и систем": "Цифровые объекты",
    "информационные технологии в дизайне": "ИТ в дизайне",
    "системы искусственного интеллекта": "Системы ИИ",
    "современные технологии в дизайне": "Технологии в дизайне",
    "управление цифровым продуктом": "Цифровой продукт",
    "продюсирование и маркетинг проектов": "Продюсирование",
    "управление человеческими ресурсами": "Управление персоналом",
    // обязательные для бакалавриата
    "безопасность жизнедеятельности": "БЖД",
    "основы российской государственности": "ОРГ",
    "выпускная квалификационная работа": "ВКР",
  };
  // ключ без регистра, «ё», знаков и скобок - «Web-дизайн» и «Web дизайн» совпадут
  const attCls = (v) => (v == null ? "" : v < 70 ? "stat-bad" : v < 90 ? "stat-warn" : "stat-good");
  const subjKeyN = (t) =>
    String(t || "")
      .toLowerCase()
      .replace(/ё/g, "е")
      .replace(/[^a-zа-я0-9]+/g, " ")
      .trim();
  const SUBJ_SHORT_N = Object.fromEntries(Object.entries(SUBJ_SHORT).map(([k, v]) => [subjKeyN(k), v]));
  // сокращаем только на главной; остальное длиннее лимита - по целым словам
  const subjShort = (t) => {
    const k = String(t || "").trim();
    const v = SUBJ_SHORT_N[subjKeyN(k)] || (/практик/i.test(k) && k.length > 24 ? "Практика" : "");
    return v || (k.length > 24 ? k.slice(0, 22).replace(/\s+\S*$/, "") + "…" : k);
  };
  const shortT = (t) => {
    const p = String(t || "")
      .split(" ")
      .filter(Boolean);
    return p.length
      ? p[0] +
          " " +
          p
            .slice(1)
            .map((x) => x[0] + ".")
            .join(" ")
      : "";
  };
  const f1 = (x) => x.toFixed(1).replace(".", ","),
    f2 = (x) => x.toFixed(2).replace(".", ",");
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
    const k = ["math", "phys", "inf", "pe", "intro", "tec", "lang", "biz"];
    let h = 0;
    for (const c of s) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return k[h % k.length];
  }

  /* ======================= расчёты ======================= */
  function stats() {
    const V = M.visits || [],
      total = V.length,
      miss = V.filter((v) => v.miss).length,
      late = V.filter((v) => v.late).length;
    const marks = [];
    let hwN = 0,
      cwN = 0,
      otherN = 0;
    V.forEach((v) => {
      if (v.hw != null) {
        marks.push(v.hw);
        hwN++;
      }
      if (v.cw != null) {
        marks.push(v.cw);
        cwN++;
      }
      ["lab", "ctrl", "prac"].forEach((k) => {
        if (v[k] != null) {
          marks.push(v[k]);
          otherN++;
        }
      });
    });
    const avg = marks.length ? marks.reduce((a, b) => a + b, 0) / marks.length : 0;
    const maxMark = marks.length ? Math.max(...marks) : 5;
    const scale = maxMark > 5 || (M.avg || []).some((x) => x.v > 5) ? 12 : 5;
    // Журнал считает «посещения подряд» по учебным дням: день с пропуском обнуляет серию без пропусков,
    // день с опозданием обнуляет серию без опозданий, а полностью пропущенный день её не прерывает.
    const D = [];
    V.forEach((v) => {
      const d = D[D.length - 1];
      if (d && d.date === v.date) {
        d.n++;
        if (v.miss) d.x++;
        if (v.late) d.l++;
      } else D.push({ date: v.date, n: 1, x: v.miss ? 1 : 0, l: v.late ? 1 : 0 });
    });
    let streak = 0,
      best = 0,
      run = 0,
      lateCur = 0,
      bestNoLate = 0,
      run2 = 0;
    D.forEach((d) => {
      run = d.x ? 0 : run + 1;
      best = Math.max(best, run);
      if (d.x < d.n) {
        run2 = d.l ? 0 : run2 + 1;
        bestNoLate = Math.max(bestNoLate, run2);
      }
    });
    streak = run;
    lateCur = run2;
    // журнал считает «посещения подряд» по парам: пропуск обнуляет серию без пропусков, опоздание - серию без опозданий (пропущенная пара её не прерывает)
    let pRun = 0,
      pBest = 0,
      lRun = 0,
      lBest = 0;
    V.forEach((v) => {
      pRun = v.miss ? 0 : pRun + 1;
      pBest = Math.max(pBest, pRun);
      if (!v.miss) {
        lRun = v.late ? 0 : lRun + 1;
        lBest = Math.max(lBest, lRun);
      }
    });
    const hwAll = (M.hw || []).filter((h) => h.sub && h.due);
    const early = hwAll.map((h) => dayDiff(fromIso(h.sub), fromIso(h.due)));
    return {
      total,
      miss,
      late,
      present: total - miss,
      att: total ? Math.round(((total - miss) / total) * 100) : 0,
      hwN,
      cwN,
      otherN,
      marks: marks.length,
      avg,
      scale,
      allTop: marks.length && marks.every((m) => m === maxMark),
      maxMark,
      streak,
      best,
      bestNoLate,
      lateCur,
      days: D.length,
      pStreak: pRun,
      pBest,
      pLate: lRun,
      pLateBest: lBest,
      earlyAvg: early.length ? early.reduce((a, b) => a + b, 0) / early.length : 0,
      onTime: early.filter((x) => x >= 0).length,
      hwCount: early.length,
    };
  }
  const lessonsOn = (d) => M.schedule[iso(d)] || [];
  function pairIndex() {
    const starts = new Set();
    Object.values(M.schedule).forEach((l) => l.forEach((x) => x.start && starts.add(x.start)));
    const s = [...starts].sort();
    return (t) => s.indexOf(t);
  }
  function occurrences(now) {
    const out = [];
    const m0 = mondayOf(now);
    for (let i = 0; i < 14; i++) {
      const d = dayDate(m0, i);
      lessonsOn(d).forEach(
        (l) =>
          l.start &&
          l.end &&
          out.push({ l, day: iso(d), s: atTime(iso(d), l.start), e: atTime(iso(d), l.end) }),
      );
    }
    return out.sort((a, b) => a.s - b.s);
  }
  let occC = null,
    occAt = 0,
    occM = null;
  const focus = (now) => {
    if (!occC || occM !== M || Math.abs(now - occAt) > 20000) {
      occC = occurrences(now);
      occAt = +now;
      occM = M;
    }
    const o = occC;
    return { cur: o.find((x) => x.s <= now && now < x.e), next: o.find((x) => x.s > now) };
  };

  /* ======================= интерфейс ======================= */
  const DN_CSS = `
.dn{
  --bg:#eff0f3; --surface:#ffffff; --surface-2:#f5f6f8; --hair:#e6e8ec; --line:#d9dce2;
  --ink:#141821; --muted:#5f6573; --soft:#848a97;
  --gold:#94702f; --gold-hi:#dcbc7e; --gold-wash:#f7f1e5;
  --sel:#162230; --sel-ink:#f3ecdd;
  --hero-a:#0f1822; --hero-b:#1d2d38; --hero-ink:#f1ece2;
  --good:#2b7d63; --good-wash:#e3f1eb; --bad:#b0435b; --bad-wash:#f8e6ea;
  --hw:#a07a33; --cw:#2c7a78;
  --shadow:0 1px 2px rgba(20,24,33,.05),0 6px 20px -8px rgba(20,24,33,.12);
  --font: Calibri, Carlito, "Segoe UI", system-ui, sans-serif;
  --math-t:#edf2f8; --math-c:#27466a; --math-d:#5b7fa8;
  --phys-t:#f8eee8; --phys-c:#7a3b22; --phys-d:#c07452;
  --inf-t:#e9f3ef;  --inf-c:#21574a;  --inf-d:#4f9a86;
  --pe-t:#eff2e4;   --pe-c:#4b571c;   --pe-d:#8a9a45;
  --intro-t:#f2ecf5;--intro-c:#58306a;--intro-d:#9468ad;
  --tec-t:#f8ebf0;  --tec-c:#782c49;  --tec-d:#bd6a8a;
  --lang-t:#f8f1e2; --lang-c:#6b5114; --lang-d:#bf9a45;
  --biz-t:#e8f0f3;  --biz-c:#1d5062;  --biz-d:#4f90a6;
  --oth-t:#f0f1f4;  --oth-c:#3e4452;  --oth-d:#8a909c;
}
.dn[data-theme="dark"]{
  color-scheme:dark;
  --bg:#0a0c10; --surface:#11141a; --surface-2:#161a21; --hair:#1e232c; --line:#2a303b;
  --ink:#eceef2; --muted:#9ba1ae; --soft:#7a8190;
  --gold:#d4b172; --gold-hi:#e8cf9c; --gold-wash:#1f1b13;
  --sel:#d4b172; --sel-ink:#15110a;
  --hero-a:#0f1620; --hero-b:#1a2632; --hero-ink:#f1ece2;
  --good:#62b99a; --good-wash:#12241e; --bad:#e07b92; --bad-wash:#2a1419;
  --hw:#d4b172; --cw:#5fb4b1;
  --shadow:0 1px 2px rgba(0,0,0,.4),0 8px 24px -10px rgba(0,0,0,.6);
  --math-t:#151d28; --math-c:#b3cbe6; --math-d:#6f93bd;
  --phys-t:#241915; --phys-c:#ecbca5; --phys-d:#cf8563;
  --inf-t:#132320;  --inf-c:#a6d8c7;  --inf-d:#5fae98;
  --pe-t:#1b1f13;   --pe-c:#cdd898;   --pe-d:#9aab55;
  --intro-t:#1f1824;--intro-c:#d6b9e3;--intro-d:#a67cbd;
  --tec-t:#25171d;  --tec-c:#ebb6ca;  --tec-d:#c97b99;
  --lang-t:#221d12; --lang-c:#e5cc8f; --lang-d:#c9a553;
  --biz-t:#132027;  --biz-c:#a5d1e0;  --biz-d:#5d9fb5;
  --oth-t:#181b21;  --oth-c:#c9cdd6;  --oth-d:#7a8190;
}
.s-math{--t:var(--math-t);--c:var(--math-c);--d:var(--math-d)}
.s-phys{--t:var(--phys-t);--c:var(--phys-c);--d:var(--phys-d)}
.s-inf{--t:var(--inf-t);--c:var(--inf-c);--d:var(--inf-d)}
.s-pe,.s-pe2{--t:var(--pe-t);--c:var(--pe-c);--d:var(--pe-d)}
.s-intro{--t:var(--intro-t);--c:var(--intro-c);--d:var(--intro-d)}
.s-tec{--t:var(--tec-t);--c:var(--tec-c);--d:var(--tec-d)}
.s-lang{--t:var(--lang-t);--c:var(--lang-c);--d:var(--lang-d)}
.s-biz{--t:var(--biz-t);--c:var(--biz-c);--d:var(--biz-d)}
.s-oth{--t:var(--oth-t);--c:var(--oth-c);--d:var(--oth-d)}
*{box-sizing:border-box}
[hidden]{display:none!important}
.dn{background:var(--bg);min-height:100%}
.dn{color:var(--ink);font-family:var(--font);font-size:15px;line-height:1.4;-webkit-font-smoothing:antialiased;margin:0}
button,select{font:inherit;color:inherit}
button{cursor:pointer}
a{color:inherit}
:focus-visible{outline:2px solid var(--gold);outline-offset:2px}
.num{font-variant-numeric:tabular-nums}
.cap{font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;font-weight:700}
svg.i{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round;flex:none}
.app{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
.side{position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:22px;padding:22px 16px;border-right:1px solid var(--hair);background:var(--surface)}
.brand{display:flex;align-items:center;gap:11px;padding:0 6px}
.mark{width:38px;height:38px;border-radius:11px;display:grid;place-items:center;background:linear-gradient(135deg,var(--hero-a),var(--hero-b));color:var(--gold-hi);font-weight:700;font-size:19px;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gold-hi) 35%,transparent)}
.brand b{display:block;font-size:17px;letter-spacing:-.01em}
.brand span{display:block;font-size:12.5px;color:var(--soft)}
.nav{display:flex;flex-direction:column;gap:2px}
.nav a{display:flex;align-items:center;gap:12px;padding:9px 12px;border-radius:10px;text-decoration:none;color:var(--muted);font-weight:700;position:relative}
.nav a:hover{background:var(--surface-2);color:var(--ink)}
.nav a[aria-current="page"]{background:var(--sel);color:var(--sel-ink)}
.nav a .bd{margin-left:auto;min-width:20px;height:20px;padding:0 6px;border-radius:999px;background:var(--bad);color:#fff;font-size:12px;display:grid;place-items:center}
.nav a[aria-current="page"] .bd{background:var(--sel-ink);color:var(--sel)}
.me{margin-top:auto;border:1px solid var(--hair);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px;background:var(--surface-2)}
.me .who{display:flex;gap:10px;align-items:center}
.ava{width:38px;height:38px;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:14px;background:linear-gradient(135deg,#2a3a48,#131c26);color:var(--gold-hi);flex:none}
.me .who b{display:block;font-size:14px;line-height:1.2}
.me .who span{font-size:12.5px;color:var(--soft)}
.wallet{display:flex;gap:6px}
.wallet div{flex:1;display:flex;align-items:center;gap:6px;background:var(--surface);border:1px solid var(--hair);border-radius:9px;padding:5px 8px;font-weight:700;font-size:14px}
.coin{width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 35% 35%,#f3d48f,#b7862e);box-shadow:inset 0 0 0 1px rgba(0,0,0,.12);flex:none}
.gem{width:14px;height:14px;flex:none;background:linear-gradient(135deg,#8fe0b8,#2a9a70);clip-path:polygon(50% 0,100% 38%,50% 100%,0 38%)}
.wallet small{font-weight:400;color:var(--soft);font-size:11.5px;margin-left:auto}
.main{min-width:0;padding:0 28px 48px}
.photo{width:38px;height:38px;border-radius:50%;flex:none;background:linear-gradient(135deg,#27313d,#161c24);background-size:cover;background-position:center;box-shadow:0 0 0 2px var(--surface),0 0 0 3px color-mix(in srgb,var(--gold) 70%,transparent)}
.photo.sm{width:26px;height:26px;box-shadow:0 0 0 1.5px var(--gold)}
.photo.lg{width:68px;height:68px;box-shadow:0 0 0 3px rgba(15,24,34,.9),0 0 0 4.5px color-mix(in srgb,var(--gold-hi) 80%,transparent)}
.top-ava{display:none}
.hero-id{display:flex;align-items:center;gap:24px;margin-top:4px;margin-bottom:10px}
.top{position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:14px;justify-content:space-between;padding:18px 0 14px;background:color-mix(in srgb,var(--bg) 88%,transparent);backdrop-filter:blur(8px)}
.top h1{margin:0;font-size:28px;letter-spacing:-.015em;line-height:1.1}
.top .cap{color:var(--gold)}
.tools{display:flex;gap:8px;align-items:center}
.iconbtn{width:38px;height:38px;border-radius:11px;border:1px solid var(--line);background:var(--surface);display:grid;place-items:center;color:var(--muted);box-shadow:var(--shadow)}
.iconbtn:hover{color:var(--ink)}
.top,.page{max-width:1480px;margin-inline:auto}
.page{display:flex;flex-direction:column;gap:18px}
@media (max-width:980px){
  .app{grid-template-columns:minmax(0,1fr)}
  .side{position:static;height:auto;min-width:0;border-right:0;border-bottom:1px solid var(--hair);padding:14px 16px 10px;gap:12px}
  .me{display:none}
  .nav{flex-direction:row;overflow-x:auto;scrollbar-width:none;margin-inline:-16px;padding:0 16px}
  .nav a{flex:none;padding:7px 12px}
  .main{padding:0 16px 40px}
  .top-ava{display:block}
  .photo.lg{width:54px;height:54px}
  .top h1{font-size:24px}
}
.card{background:var(--surface);border:1px solid var(--line);border-radius:18px;box-shadow:var(--shadow);padding:18px;min-width:0}
.card > h2,.card .hd h2{margin:0;font-size:17px;letter-spacing:-.005em}
.card .hd{display:flex;justify-content:space-between;align-items:baseline;gap:10px;flex-wrap:wrap;padding-bottom:12px;margin-bottom:14px;border-bottom:1px solid var(--hair)}
.card .hd a,.link{color:var(--gold);font-weight:700;font-size:13.5px;text-decoration:none;background:none;border:0;padding:0}
.card .hd small{color:var(--soft);font-size:13px}
.row{display:grid;gap:18px}
.r2{grid-template-columns:repeat(2,minmax(0,1fr))}
.r3{grid-template-columns:repeat(3,minmax(0,1fr))}
.r4{grid-template-columns:repeat(4,minmax(0,1fr))}
.r-7-5{grid-template-columns:minmax(0,7fr) minmax(0,5fr)}
@media (max-width:1180px){.r4{grid-template-columns:repeat(2,minmax(0,1fr))}.r3{grid-template-columns:1fr 1fr}}
@media (max-width:760px){.r2,.r3,.r-7-5{grid-template-columns:1fr}}
@media (max-width:460px){.r4{grid-template-columns:1fr 1fr;gap:10px}}
.muted{color:var(--muted)}
.soft{color:var(--soft)}
.note{font-size:13px;color:var(--soft)}
.hero{position:relative;overflow:hidden;border-radius:22px;padding:24px 26px;color:var(--hero-ink);
  background:radial-gradient(90% 140% at 100% 0%, color-mix(in srgb,var(--gold-hi) 22%,transparent), transparent 55%),linear-gradient(135deg,var(--hero-a),var(--hero-b));
  box-shadow:0 22px 44px -26px rgba(10,16,24,.75), inset 0 0 0 1px color-mix(in srgb,var(--gold-hi) 22%,transparent)}
.hero .cap{color:var(--gold-hi)}
.hero h2{margin:6px 0 4px;font-size:30px;line-height:1.1;letter-spacing:-.015em;text-wrap:balance}
.hero p{margin:0;opacity:.78;max-width:62ch}
.hero .facts{display:flex;flex-wrap:wrap;gap:10px;margin-top:18px}
.hero .facts span{border:1px solid rgba(241,236,226,.16);background:rgba(241,236,226,.05);border-radius:999px;padding:6px 12px;font-size:13.5px}
.hero .facts b{color:var(--gold-hi)}
.kpi{display:flex;flex-direction:column;gap:6px;position:relative}
.kpi .lab{display:flex;align-items:center;gap:8px;color:var(--muted);font-weight:700;font-size:13.5px}
.kpi .lab svg{color:var(--gold)}
.kpi .val{font-size:40px;font-weight:700;letter-spacing:-.02em;line-height:1}
.kpi .val small{font-size:17px;color:var(--soft);font-weight:400;margin-left:4px;letter-spacing:0}
.kpi .sub{font-size:13.5px;color:var(--muted)}
.kpi .sub b{color:var(--ink)}
.meter{height:6px;border-radius:3px;background:var(--surface-2);overflow:hidden;border:1px solid var(--hair)}
.meter i{display:block;height:100%;background:linear-gradient(90deg,var(--gold),var(--gold-hi));border-radius:3px}
.ring{position:absolute;right:16px;top:16px}
@media (max-width:1180px){.ring{display:none}}
.seg-bar{display:flex;height:10px;border-radius:5px;overflow:hidden;gap:2px}
.seg-bar i{display:block;height:100%}
.legend{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:13.5px;color:var(--muted)}
.legend span{display:inline-flex;align-items:center;gap:7px}
.legend i{width:9px;height:9px;border-radius:3px;display:inline-block}
.legend b{color:var(--ink)}
.pill{display:inline-flex;align-items:center;background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:3px;box-shadow:var(--shadow)}
.pill button{border:0;background:transparent;border-radius:9px;padding:6px 12px;font-weight:700;color:var(--muted)}
.pill button:hover{color:var(--ink)}
.pill button[aria-pressed="true"]{background:var(--sel);color:var(--sel-ink)}
.pill .lbl{padding:0 10px;font-weight:700;min-width:170px;text-align:center}
.pill .ar{font-size:18px;line-height:1;padding:4px 10px}
.bar-tools{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:space-between}
.bar-tools .grp{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
select.sel{border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:8px 12px;font-weight:700;box-shadow:var(--shadow);max-width:100%}
.tag{display:inline-flex;align-items:center;gap:6px;font-size:12.5px;font-weight:700;border-radius:999px;padding:2px 9px;background:var(--t,var(--surface-2));color:var(--c,var(--muted));white-space:nowrap}
.tag::before{content:"";width:6px;height:6px;border-radius:50%;background:var(--d,var(--soft))}
.stat-good{color:var(--good)} .stat-bad{color:var(--bad)}
.list{display:flex;flex-direction:column}
.li{display:flex;align-items:center;gap:12px;padding:10px 0;border-top:1px solid var(--hair)}
.li:first-child{border-top:0;padding-top:2px}
.li .grow{flex:1;min-width:0}
.li .grow b{display:block;font-weight:700}
.li .grow span{font-size:13px;color:var(--soft)}
.li .amt{display:flex;align-items:center;gap:6px;font-weight:700}
.lb .li{gap:10px}
.lb .pos{width:26px;height:26px;border-radius:8px;display:grid;place-items:center;font-weight:700;font-size:13px;background:var(--surface-2);color:var(--muted);flex:none}
.lb .li:nth-child(-n+3) .pos{background:var(--gold-wash);color:var(--gold)}
.lb .me-row{background:var(--gold-wash);margin:0 -10px;padding-inline:10px;border-radius:10px;border-top-color:transparent}
.lb .me-row + .li{border-top-color:transparent}
.lb .me-row .pos{background:var(--gold);color:var(--surface)}
.lb .me-row b{color:var(--gold)}
.lb .track{flex:0 0 32%;height:5px;border-radius:3px;background:var(--surface-2);overflow:hidden}
.lb .track i{display:block;height:100%;background:var(--soft);opacity:.5;border-radius:3px}
.lb .me-row .track i{background:var(--gold);opacity:1}
.lb .pts{width:38px;text-align:right;font-weight:700}
.now{position:relative;overflow:hidden;border-radius:20px;padding:20px 24px;color:var(--hero-ink);
  background:radial-gradient(120% 140% at 100% 0%, color-mix(in srgb,var(--gold-hi) 20%,transparent), transparent 55%),linear-gradient(135deg,var(--hero-a),var(--hero-b));
  box-shadow:0 20px 40px -24px rgba(10,16,24,.7), inset 0 0 0 1px color-mix(in srgb,var(--gold-hi) 22%,transparent);
  display:grid;grid-template-columns:1fr auto;gap:12px 32px;align-items:end}
.now .cap{color:var(--gold-hi)}
.now .subj{font-size:28px;font-weight:700;line-height:1.12;margin-top:6px;text-wrap:balance}
.now .meta{opacity:.78;margin-top:6px}
.now .cd{text-align:right;padding-left:28px;border-left:1px solid rgba(241,236,226,.14)}
.now .cd b{display:block;font-size:50px;line-height:.95;font-weight:700;color:var(--gold-hi);letter-spacing:-.02em;margin-top:6px}
.now .cd .left{display:block;margin-top:8px;font-size:14px;opacity:.8}
.now .bar{grid-column:1/-1;height:3px;border-radius:2px;background:rgba(241,236,226,.12);overflow:hidden;margin-top:6px}
.now .bar i{display:block;height:100%;width:0;background:linear-gradient(90deg,var(--gold),var(--gold-hi))}
@media (max-width:560px){.now{grid-template-columns:1fr}.now .cd{text-align:left;border-left:0;padding-left:0;border-top:1px solid rgba(241,236,226,.14);padding-top:12px}.now .subj{font-size:23px}}
.lesson{position:relative;display:flex;flex-direction:column;gap:5px;text-align:left;width:100%;height:100%;
  border:1px solid color-mix(in srgb,var(--d) 22%,transparent);border-radius:12px;padding:11px 13px 13px;
  background:linear-gradient(180deg,var(--t),color-mix(in srgb,var(--t) 55%,var(--surface)));
  transition:opacity .2s, transform .15s, box-shadow .15s;overflow:hidden}
.lesson:hover{transform:translateY(-1px);box-shadow:var(--shadow);border-color:color-mix(in srgb,var(--d) 55%,transparent)}
.lesson .t{display:flex;gap:8px;align-items:baseline;font-weight:700;color:var(--c);line-height:1.2}
.lesson .t::before{content:"";flex:none;width:7px;height:7px;border-radius:50%;background:var(--d);transform:translateY(-1px)}
.lesson .tt{font-size:13px;color:var(--muted);display:flex;align-items:center;gap:6px}
.lesson .tt i{display:inline-block;width:14px;height:1px;background:var(--soft)}
.lesson .tt b{color:var(--gold);font-weight:700;font-size:14px}
.lesson .r{display:flex;flex-wrap:wrap;gap:2px 10px;font-size:13px;color:var(--muted);margin-top:auto;padding-top:6px;border-top:1px solid color-mix(in srgb,var(--d) 16%,transparent)}
.lesson .room{font-weight:700;color:var(--ink)}
.lesson .p{position:absolute;left:0;bottom:0;height:3px;width:0;background:linear-gradient(90deg,var(--gold),var(--gold-hi))}
.lesson.past{opacity:.45}
.lesson.live{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold),0 10px 24px -14px rgba(148,112,47,.7)}
.lesson.live::after{content:"Идёт";position:absolute;top:9px;right:9px;font-size:10.5px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;background:var(--gold);color:var(--surface);border-radius:6px;padding:2px 7px}
.lesson.live .t{padding-right:46px}
.lesson.dim{opacity:.15}
.gridwrap{background:var(--surface);border:1px solid var(--line);border-radius:20px;overflow:hidden;box-shadow:var(--shadow)}
.grid{display:grid;grid-template-columns:92px repeat(5,minmax(0,1fr)) 72px;gap:1px;background:var(--hair)}
.grid > *{background:var(--surface)}
.dh{padding:14px 14px 12px;position:relative}
.dh .n{font-weight:700;font-size:16px}
.dh .d{font-size:13px;color:var(--muted);margin-top:1px}
.dh.today::after{content:"";position:absolute;left:14px;right:14px;bottom:0;height:2px;border-radius:2px;background:var(--gold)}
.dh.today .n{color:var(--gold)}
.th{display:flex;flex-direction:column;align-items:flex-start;justify-content:center;padding:10px 14px;font-size:13px;color:var(--muted);gap:1px}
.th .cap{color:var(--soft);font-size:10.5px;margin-bottom:3px}
.th b{color:var(--ink);font-size:14px;font-weight:400}
.ln{width:1px;height:12px;background:var(--line);margin:3px 0 3px 3px;display:block}
.end{color:var(--gold);font-weight:700}
.th .end{font-size:16px}
.cell{padding:7px;min-height:118px;display:flex}
.cell.today{background:color-mix(in srgb,var(--gold-wash) 70%,var(--surface))}
.hatch{display:flex;align-items:center;justify-content:center;color:var(--soft);font-size:13px;background-image:repeating-linear-gradient(135deg,transparent 0 9px,var(--hair) 9px 10px)!important}
.hatch span{background:var(--surface);padding:4px 10px;border-radius:999px;border:1px solid var(--hair)}
.wk span{writing-mode:vertical-rl;transform:rotate(180deg);padding:10px 4px}
.agenda{display:none;flex-direction:column;gap:14px}
.aday{background:var(--surface);border:1px solid var(--line);border-radius:18px;padding:14px;display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow)}
.aday.today{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold)}
.aday h3{margin:0;font-size:17px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;align-items:baseline;padding-bottom:8px;border-bottom:1px solid var(--hair)}
.aday h3 small{font-weight:400;color:var(--muted);font-size:13px}
.arow{display:grid;grid-template-columns:54px 1fr;gap:10px}
.tmc{display:flex;flex-direction:column;align-items:flex-start;font-size:13px;color:var(--muted);padding-top:10px}
.tmc b{color:var(--ink);font-weight:400;font-size:14px}
.tmc .ln{flex:1;height:auto;min-height:10px;max-height:28px;margin:4px 0 4px 3px}
.tmc .end{font-size:15px}
.free{color:var(--soft);font-size:14px}
@media (max-width:900px){ .gridwrap{display:none} .agenda{display:flex} }
.days{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.days button{border:1px solid var(--line);background:var(--surface);border-radius:12px;padding:9px 4px;display:flex;flex-direction:column;align-items:center;gap:2px}
.days button .w{font-weight:700}
.days button .dd{font-size:12px;color:var(--muted)}
.days button .dots{display:flex;gap:3px;height:6px;margin-top:3px}
.days button .dots i{width:5px;height:5px;border-radius:50%;background:var(--gold)}
.days button.today .w{color:var(--gold)}
.days button[aria-pressed="true"]{background:var(--sel);border-color:var(--sel);color:var(--sel-ink)}
.days button[aria-pressed="true"] .dd,.days button[aria-pressed="true"].today .w{color:var(--sel-ink)}
.days button[aria-pressed="true"] .dots i{background:var(--sel-ink)}
.tl{display:grid;grid-template-columns:64px 1fr;gap:10px}
.tl .tmc{font-size:14px}
.tl .tmc b{font-size:16px}
.tl .tmc .end{font-size:17px}
.tl .tmc .cap{font-size:10.5px;color:var(--soft);margin-bottom:2px}
.gap{grid-column:2;font-size:13px;color:var(--soft);display:flex;align-items:center;gap:10px}
.gap::before,.gap::after{content:"";height:1px;flex:1;background:repeating-linear-gradient(90deg,var(--line) 0 4px,transparent 4px 8px)}
.gap::before{flex:0 0 18px}
.restday{padding:36px 8px;text-align:center;color:var(--muted);font-size:15px;border-radius:14px;background-image:repeating-linear-gradient(135deg,transparent 0 9px,var(--hair) 9px 10px)}
.restday b{display:block;color:var(--ink);font-size:19px;margin-bottom:4px}
.strip{display:grid;grid-template-columns:repeat(auto-fill,minmax(74px,1fr));gap:8px}
.les{position:relative;border:1px solid var(--hair);background:var(--surface-2);border-radius:12px;padding:8px 6px 9px;display:flex;flex-direction:column;align-items:center;gap:3px;transition:transform .15s,border-color .15s,opacity .2s}
.les:hover{transform:translateY(-1px);border-color:var(--gold)}
.les .dt{font-size:11.5px;color:var(--soft)}
.les .n{font-size:19px;font-weight:700;line-height:1.1}
.les .mk{display:flex;gap:3px;min-height:20px;align-items:center}
.mark5{width:20px;height:20px;border-radius:50%;display:grid;place-items:center;font-size:12px;font-weight:700;color:var(--surface)}
.mark5.hw{background:var(--hw)} .mark5.cw{background:var(--cw)}
.les .dot0{width:5px;height:5px;border-radius:50%;background:var(--line)}
.les.miss{background:var(--bad-wash);border-color:color-mix(in srgb,var(--bad) 30%,transparent)}
.les.miss .n{color:var(--bad)}
.les.miss::after{content:"Н";position:absolute;top:5px;right:6px;font-size:10.5px;font-weight:700;color:var(--bad)}
.les.dim{opacity:.18}
.les .sd{width:18px;height:3px;border-radius:2px;background:var(--d)}
.cal{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:6px}
.cal .wd{font-size:11.5px;color:var(--soft);text-align:center;text-transform:uppercase;letter-spacing:.08em;font-weight:700}
.cal .c{aspect-ratio:1/1;max-width:100%;border-radius:10px;border:1px solid var(--hair);display:flex;flex-direction:column;justify-content:space-between;padding:6px 7px;font-size:13px;color:var(--soft)}
.cal .c.has{background:var(--good-wash);border-color:color-mix(in srgb,var(--good) 25%,transparent);color:var(--ink)}
.cal .c.part{background:var(--bad-wash);border-color:color-mix(in srgb,var(--bad) 35%,transparent)}
.cal .c.fut{border-style:dashed}
.cal .c .bars{display:flex;gap:2px}
.cal .c .bars i{flex:1;height:4px;border-radius:2px;background:var(--good)}
.cal .c .bars i.x{background:var(--bad)}
.cal .c.blank{border:0}
.wkchart{display:flex;align-items:flex-end;gap:14px;height:170px;padding-top:6px}
.wkchart .col{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px;height:100%}
.wkchart .stack{flex:1;width:100%;max-width:56px;display:flex;flex-direction:column-reverse;gap:2px}
.wkchart .stack i{display:block;border-radius:5px;background:var(--good)}
.wkchart .stack i.x{background:var(--bad)}
.wkchart .col b{font-size:14px}
.wkchart .col span{font-size:12px;color:var(--soft);text-align:center}
table.t{width:100%;border-collapse:collapse;font-size:14px}
table.t th{text-align:left;font-size:11.5px;text-transform:uppercase;letter-spacing:.1em;color:var(--soft);font-weight:700;padding:0 10px 8px 0;border-bottom:1px solid var(--hair)}
table.t td{padding:10px 10px 10px 0;border-bottom:1px solid var(--hair)}
table.t tr:last-child td{border-bottom:0}
table.t td.r,table.t th.r{text-align:right}
.tscroll{overflow-x:auto}
.hwgrid{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:12px}
.hw{border:1px solid var(--line);border-radius:16px;overflow:hidden;background:var(--surface);display:flex;flex-direction:column;box-shadow:var(--shadow)}
.hw .top2{padding:14px 14px 12px;background:linear-gradient(180deg,var(--t),var(--surface));display:flex;justify-content:space-between;gap:10px;align-items:flex-start;min-height:92px}
.hw .top2 b{color:var(--c);font-size:15.5px;line-height:1.2}
.hw .grade{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:21px;font-weight:700;background:var(--good);color:var(--surface);flex:none;box-shadow:0 0 0 4px var(--good-wash)}
.hw .wait{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;border:1.5px dashed var(--gold);color:var(--gold);flex:none}
.hw .foot{display:grid;grid-template-columns:1fr 1fr;border-top:1px solid var(--hair)}
.hw .foot div{padding:9px 14px;font-size:13px;color:var(--soft)}
.hw .foot div + div{border-left:1px solid var(--hair)}
.hw .foot b{display:block;color:var(--ink);font-size:14px}
.hw .early{padding:8px 14px;font-size:13px;border-top:1px solid var(--hair);display:flex;justify-content:space-between;gap:8px;color:var(--muted)}
.hw .early b{color:var(--good)}
.hw .early .late{color:var(--bad)}
.ach{display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:12px}
.a{border:1px solid var(--line);border-radius:16px;padding:16px;background:var(--surface);display:flex;flex-direction:column;gap:10px;box-shadow:var(--shadow)}
.a .ic{width:52px;height:52px;border-radius:14px;display:grid;place-items:center;background:var(--surface-2);color:var(--soft);border:1px solid var(--hair)}
.a .ic svg{width:26px;height:26px;fill:none;stroke:currentColor;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.a.got .ic{background:linear-gradient(135deg,var(--hero-a),var(--hero-b));color:var(--gold-hi);border-color:transparent;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gold-hi) 35%,transparent)}
.a b{font-size:15px;line-height:1.25}
.a .ft{margin-top:auto;display:flex;justify-content:space-between;align-items:center;gap:8px;font-size:13px}
.a .st{font-weight:700;color:var(--soft)}
.a.got .st{color:var(--good)}
.a .rw{display:flex;align-items:center;gap:5px;font-weight:700}
.news{display:flex;flex-direction:column}
.nw{display:grid;grid-template-columns:14px 1fr auto;gap:12px;align-items:start;padding:14px 4px;border-top:1px solid var(--hair);text-align:left;background:none;border-left:0;border-right:0;border-bottom:0;width:100%}
.nw:first-child{border-top:0}
.nw:hover{background:var(--surface-2)}
.nw .u{width:8px;height:8px;border-radius:50%;background:var(--gold);margin-top:7px}
.nw.read .u{background:transparent;border:1px solid var(--line)}
.nw .tx{font-weight:700;line-height:1.35}
.nw.read .tx{font-weight:400;color:var(--muted)}
.nw .dt{font-size:13px;color:var(--soft);white-space:nowrap;padding-top:2px}
.mgrp{font-size:11.5px;text-transform:uppercase;letter-spacing:.12em;font-weight:700;color:var(--soft);padding:16px 4px 4px}
.mgrp:first-child{padding-top:0}
.rv{display:flex;flex-direction:column;gap:14px}
.rv blockquote{margin:0;font-size:18px;line-height:1.5;position:relative;padding-left:26px}
.rv blockquote::before{content:"“";position:absolute;left:0;top:-8px;font-size:44px;color:var(--gold);line-height:1}
.rv .by{display:flex;align-items:center;gap:12px;padding-top:14px;border-top:1px solid var(--hair)}
.rv .by b{display:block}
.rv .by span{font-size:13px;color:var(--soft)}
dialog{border:1px solid var(--line);border-radius:20px;padding:0;background:var(--surface);color:var(--ink);width:min(440px, calc(100vw - 32px));box-shadow:0 30px 60px -20px rgba(0,0,0,.35)}
dialog::backdrop{background:rgba(10,14,20,.5);backdrop-filter:blur(2px)}
.dlg .dh2{background:linear-gradient(180deg,var(--t,var(--surface-2)),var(--surface));padding:20px 22px 14px;display:flex;justify-content:space-between;gap:12px;align-items:flex-start;border-bottom:1px solid var(--hair)}
.dlg .dh2 h3{margin:0;font-size:22px;line-height:1.2;color:var(--c,var(--ink));text-wrap:balance}
.dlg .dh2 p{margin:4px 0 0;color:var(--muted)}
.dlg .x{border:1px solid var(--line);background:var(--surface);border-radius:10px;width:32px;height:32px;font-size:18px;line-height:1;flex:none}
.dlg dl{margin:0;padding:16px 22px 20px;display:grid;grid-template-columns:auto 1fr;gap:9px 18px}
.dlg dt{color:var(--muted)}
.dlg dd{margin:0;font-weight:700}
.dlg .nt{padding:0 22px 18px;font-size:13px;color:var(--soft)}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
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
.m-hero{display:flex;align-items:center;gap:16px;flex-wrap:wrap;padding:18px 20px;border-radius:20px;color:var(--hero-ink);background:radial-gradient(90% 160% at 100% 0%,color-mix(in srgb,var(--gold-hi) 18%,transparent),transparent 55%),linear-gradient(135deg,var(--hero-a),var(--hero-b));box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gold-hi) 22%,transparent)}
.m-hero>div:nth-child(2){flex:1;min-width:200px}.m-hero b{display:block;font-size:19px}.m-hero span{opacity:.75;font-size:14px}
.m-ic{width:50px;height:50px;border-radius:14px;display:grid;place-items:center;background:color-mix(in srgb,var(--gold-hi) 12%,transparent);color:var(--gold-hi);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gold-hi) 30%,transparent)}
.m-hero .m-btn{background:rgba(241,236,226,.08);border-color:rgba(241,236,226,.2);color:var(--hero-ink)}
.m-stack{display:flex;flex-direction:column;gap:10px;min-width:0}
.m-alert{color:var(--bad)!important;background:var(--bad-wash);padding:12px 14px;border-radius:12px;border:1px solid color-mix(in srgb,var(--bad) 30%,transparent)}
.m-btn{border:1px solid var(--line);background:var(--surface-2);color:var(--ink);border-radius:10px;padding:9px 14px;font-weight:700;display:inline-flex;gap:8px;align-items:center;align-self:flex-start;cursor:pointer;transition:filter .15s,transform .15s}
.m-btn:hover{filter:brightness(1.08);transform:translateY(-1px)}
.m-btn.pri{background:var(--sel);color:var(--sel-ink);border-color:transparent}
.m-in{background:var(--surface-2);border:1px solid var(--line);border-radius:10px;padding:10px 12px;color:var(--ink);font:inherit;font-size:15px;width:100%;min-width:0}
.m-in:focus{outline:2px solid var(--gold);outline-offset:1px}
.m-in:disabled{opacity:.65}
textarea.m-in{resize:vertical;min-height:90px}
.m-kv{display:grid;grid-template-columns:minmax(110px,220px) 1fr;gap:12px;padding:9px 0;margin:0;border-top:1px solid var(--hair)}
.m-kv dt{color:var(--soft)} .m-kv dd{margin:0;font-weight:700;overflow-wrap:anywhere}
.m-link{color:var(--gold);font-weight:700;background:none;border:0;padding:0;text-decoration:none;cursor:pointer;font:inherit}
.m-link:hover{text-decoration:underline}
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
.photo.xl{width:92px;height:92px;box-shadow:0 0 0 3px rgba(15,24,34,.9),0 0 0 5px color-mix(in srgb,var(--gold-hi) 80%,transparent)}
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
.photo{display:grid;place-items:center;position:relative;overflow:hidden;color:var(--gold-hi);font-weight:700;letter-spacing:.02em}
.photo .ini{font-size:14px;line-height:1}
.photo .pimg{position:absolute;inset:0;background-size:cover;background-position:center;border-radius:50%}
.photo.sm .ini{font-size:10px}.photo.lg .ini{font-size:22px}.photo.xl .ini{font-size:30px}
.lb .photo.sm{box-shadow:none}.lb .me-row .photo.sm{box-shadow:0 0 0 1.5px var(--gold)}
.lesson .tt,.tt{color:var(--muted)}
.lesson .tt b,.tt b{color:inherit;font-weight:inherit;font-size:inherit}
.end{color:inherit;font-weight:inherit}
.tmc b,.tmc .end,.th b,.th .end{font-size:15.5px;color:var(--ink);font-weight:600}
.tmc .ln,.th .ln{opacity:.7}
.hw .grade.v4{background:#5d8fd6;box-shadow:0 0 0 4px rgba(93,143,214,.18)}
.hw .grade.v3{background:#e0973c;box-shadow:0 0 0 4px rgba(224,151,60,.18)}
.hw .grade.v2{background:var(--bad);box-shadow:0 0 0 4px var(--bad-wash)}
.legend .vk{display:inline-grid;place-items:center;width:16px;height:16px;border-radius:50%;font-size:10.5px;font-weight:700;color:var(--surface)}
.stripw{overflow:hidden}
.strip.days{display:flex!important;flex-wrap:wrap;row-gap:12px;margin:0 -10px 0 -11px}
.dg{display:flex;gap:8px;padding:0 10px;border-left:1px solid transparent;border-image:linear-gradient(to bottom,transparent,var(--line) 22%,var(--line) 78%,transparent) 1}
.dg .les{width:74px;flex:none}
.newtag{display:inline-block;margin-left:8px;padding:1px 7px;border-radius:6px;background:var(--gold);color:var(--surface);font-size:10.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;vertical-align:2px;white-space:nowrap}
.les.isnew{border-color:var(--gold);box-shadow:0 0 0 1px var(--gold) inset}
.les.isnew .dt{color:var(--gold);font-weight:700}
.hw.isnew{box-shadow:0 0 0 1.5px var(--gold)}
.li.isnew b::after{content:"новое";margin-left:8px;padding:1px 6px;border-radius:5px;background:var(--gold);color:var(--surface);font-size:10px;letter-spacing:.08em;text-transform:uppercase;vertical-align:1px}
.rv.isnew{box-shadow:0 0 0 1.5px var(--gold)}
.nav a .nd{margin-left:auto;min-width:8px;height:8px;border-radius:50%;background:var(--gold)}
.nav a .nd.c{min-width:20px;height:20px;padding:0 6px;border-radius:999px;color:var(--surface);font-size:12px;display:grid;place-items:center;font-weight:700}
.nav a[aria-current="page"] .nd{background:var(--sel-ink);color:var(--sel)}
.nowpill{display:flex;align-items:center;gap:8px;height:38px;padding:0 14px 0 12px;border-radius:12px;border:1px solid var(--line);background:var(--surface);font-size:13.5px;color:var(--muted);cursor:pointer;white-space:nowrap;max-width:min(420px,40vw);overflow:hidden;box-shadow:var(--shadow);position:relative;font:inherit}
.nowpill[hidden]{display:none}
.nowpill b{color:var(--ink);overflow:hidden;text-overflow:ellipsis}
.nowpill .tx{overflow:hidden;text-overflow:ellipsis;display:flex;gap:6px;min-width:0}
.nowpill .dot{flex:none;width:8px;height:8px;border-radius:50%;background:var(--soft)}
.nowpill.live{border-color:color-mix(in srgb,var(--gold) 55%,transparent)}
.nowpill.live .dot{background:var(--gold);animation:dnpulse 1.8s ease-out infinite}
.nowpill .pb{position:absolute;left:0;bottom:0;height:2px;background:linear-gradient(90deg,var(--gold),var(--gold-hi))}
@keyframes dnpulse{0%{box-shadow:0 0 0 0 rgba(212,177,114,.55)}100%{box-shadow:0 0 0 8px rgba(212,177,114,0)}}
@media (max-width:760px){.nowpill .lbl2{display:none}}
@media (max-width:640px){.top{flex-wrap:wrap}.top .tools{width:100%;justify-content:flex-end}.nowpill{margin-right:auto;flex:1;max-width:none}.top .tools [data-act=diag],.top .tools #themeBtn{display:none}}
.top .tools{min-width:0}
.hero p{max-width:none}
.hero p span{display:block}
.hero p span+span{margin-top:3px}
@media (max-width:640px){}
.avgc svg{width:100%;height:auto;display:block;overflow:visible}
.avgc .gl{stroke:var(--hair)}
.avgc .ax{fill:var(--soft);font-size:11.5px}
.avgc .vl{fill:var(--ink);font-size:12px;font-weight:700}
.avgc .ln{fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.avgc .ln.prev{stroke-dasharray:4 5;stroke-width:1.6;opacity:.7}
.avgc .ar{opacity:.14}
.avgc .tip{font-size:13px;color:var(--muted);margin-top:8px}
.avg-kpis{display:flex;flex-wrap:wrap;gap:8px 22px;margin-bottom:10px;font-size:13.5px;color:var(--muted)}
.avg-kpis b{color:var(--ink);font-size:17px;margin-left:4px}
.boot{display:flex;flex-direction:column;align-items:center;gap:10px;text-align:center;padding:70px 20px;color:var(--muted)}
.boot b{font-size:20px;color:var(--ink)}
.boot .spin{width:22px;height:22px;border-width:3px;margin:0 0 6px}
dialog::backdrop{backdrop-filter:none!important;background:rgba(8,10,14,.55)}
dialog[open]{animation:dnin .2s ease}
.nlist{display:flex;flex-direction:column;padding:6px 14px 4px}
.nlist .nw{padding:12px 8px;border-radius:10px}
.jn-ic{width:46px;height:46px;border-radius:14px;display:grid;place-items:center;background:var(--gold-wash);color:var(--gold);flex:none}
.jn-head{display:flex;gap:14px;align-items:center}
.legend span.mark5.sw{width:12px!important;height:12px!important;min-width:0;padding:0;flex:none;border-radius:50%}
.now .cd .tm2{font-size:30px!important;letter-spacing:-.01em}
.classic.out{border-style:solid;border-color:transparent;color:var(--soft)}
.classic.out:hover{color:var(--bad);border-color:color-mix(in srgb,var(--bad) 40%,transparent)}
.avf{margin:-2px 0 12px;display:inline-flex}
.avf button{font-size:13px}
.avgc .off{opacity:.12}
.avgc .ax.a{fill:color-mix(in srgb,var(--good) 80%,var(--soft))}
.avgc .ax.g{fill:color-mix(in srgb,var(--gold) 80%,var(--soft))}
.avg-kpis span{display:inline-flex;align-items:baseline;gap:6px}
.avg-kpis i{width:9px;height:9px;border-radius:3px;display:inline-block;align-self:center}
.avg-kpis small{font-size:12.5px;font-weight:700}
.avg-kpis .dim{opacity:.4}
.lb .pill button{font-size:13px}
.lgn{min-height:100vh;display:grid;place-items:center;padding:24px 16px;position:relative;overflow:hidden}
.lg-bg{position:fixed;inset:0;background:radial-gradient(70% 90% at 85% 0%,color-mix(in srgb,var(--gold-hi) 16%,transparent),transparent 60%),linear-gradient(160deg,#0b1017,#121c27 60%,#0a0e14)}
.lg-card{position:relative;width:min(420px,100%);background:var(--surface);border:1px solid var(--line);border-radius:24px;padding:30px 28px 24px;box-shadow:0 40px 90px -30px rgba(0,0,0,.6);display:flex;flex-direction:column;gap:14px;animation:dnin .35s ease}
.lg-brand{display:flex;align-items:center;gap:12px;margin-bottom:6px}
.lg-brand b{display:block;font-size:17px}.lg-brand span{font-size:12.5px;color:var(--soft)}
.lg-card h1{margin:4px 0 0;font-size:28px;letter-spacing:-.015em}
.lg-sub{margin:-8px 0 6px;color:var(--muted)}
.lg-f{display:flex;flex-direction:column;gap:6px;font-size:12.5px;font-weight:700;color:var(--soft)}
.lg-f input{width:100%;background:var(--surface-2);border:1px solid var(--line);border-radius:12px;padding:13px 14px;color:var(--ink);font:inherit;font-size:16px;font-weight:400;outline:none;transition:border-color .15s,box-shadow .15s}
.lg-f input:focus{border-color:var(--gold);box-shadow:0 0 0 3px color-mix(in srgb,var(--gold) 22%,transparent)}
.lg-pw{position:relative}
.lg-pw input{padding-right:50px}
.lg-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);width:38px;height:38px;border:0;border-radius:10px;background:none;color:var(--soft);display:grid;place-items:center;cursor:pointer}
.lg-eye:hover,.lg-eye[aria-pressed="true"]{color:var(--gold);background:var(--gold-wash)}
.lg-eye svg{width:20px;height:20px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.lg-err{background:var(--bad-wash);color:var(--bad);border-radius:10px;padding:10px 12px;font-size:14px;font-weight:700}
.lg-go{margin-top:4px;border:0;border-radius:12px;padding:14px;font:inherit;font-size:16px;font-weight:700;background:linear-gradient(135deg,var(--gold-hi),var(--gold));color:#141821;cursor:pointer;display:flex;gap:8px;align-items:center;justify-content:center;transition:filter .15s,transform .15s}
.lg-go:hover{filter:brightness(1.06);transform:translateY(-1px)}
.lg-go:disabled{opacity:.75;cursor:progress;transform:none}
.lg-go .spin{border-color:#141821;border-right-color:transparent;margin:0}
.lg-links{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:4px;font-size:14px}
.lg-links .soft{color:var(--soft);font-weight:400}
.tmc .ln,.th .ln{width:2px!important;border-radius:2px;opacity:1!important;margin-left:5px!important;background:linear-gradient(to bottom,color-mix(in srgb,var(--gold) 75%,transparent),color-mix(in srgb,var(--gold) 18%,transparent))!important}
.ach-sep{display:flex;align-items:center;gap:12px;margin:4px 0 12px;font-size:11px;letter-spacing:.14em;text-transform:uppercase;font-weight:700;color:var(--soft)}
.ach-sep::after{content:"";flex:1;height:1px;background:linear-gradient(90deg,var(--line),transparent)}
.ach+.ach-sep{margin-top:22px}
.kpi.att{position:relative;padding-right:118px}
.ring2{position:absolute;right:16px;top:50%;transform:translateY(-50%)}
.ring2 .tk line{stroke:var(--line);stroke-width:1}
.ring2 .r-v{font-size:17px;font-weight:700;fill:var(--ink)}
.ring2 .r-s{font-size:10px;fill:var(--soft)}
.kpi .ld{display:inline-block;width:7px;height:7px;border-radius:50%;margin:0 3px 0 6px;vertical-align:1px}
.kpi .ld:first-child{margin-left:0}
.ld.g{background:var(--good)}.ld.o{background:var(--late,var(--warn))}.ld.r{background:var(--bad)}
@media (max-width:1180px){.kpi.att{padding-right:96px}.ring2{width:72px;height:72px}}
.cpy.ok,.iconbtn.ok,.m-btn.ok{color:var(--good)!important;border-color:color-mix(in srgb,var(--good) 55%,transparent)!important}
.cpy.ok svg,.iconbtn.ok svg{stroke:var(--good)}
.lg-ok{background:var(--good-wash);color:var(--good);border-radius:10px;padding:10px 12px;font-size:14px;font-weight:700;line-height:1.45}
.dd{position:relative;display:inline-block;max-width:100%}
.dd>select{display:none!important}
.dd-btn{display:flex;align-items:center;gap:10px;justify-content:space-between;min-width:190px;max-width:100%;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:12px;padding:9px 12px 9px 14px;font:inherit;font-weight:700;box-shadow:var(--shadow);cursor:pointer;transition:border-color .15s}
.dd-btn span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dd-btn svg{width:16px;height:16px;flex:none;color:var(--soft);transition:transform .2s}
.dd-btn:hover,.dd.open .dd-btn{border-color:var(--gold)}
.dd.open .dd-btn svg{transform:rotate(180deg);color:var(--gold)}
.dd-list{position:absolute;left:0;top:calc(100% + 6px);z-index:30;min-width:100%;width:max-content;max-width:min(440px,calc(100vw - 32px));max-height:300px;overflow:auto;background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:6px;box-shadow:0 24px 50px -18px rgba(0,0,0,.6);animation:dnin .16s ease}
.dd-o{display:flex;align-items:center;justify-content:space-between;gap:14px;width:100%;text-align:left;border:0;background:none;color:var(--ink);font:inherit;font-size:14.5px;padding:9px 11px;border-radius:9px;cursor:pointer}
.dd-o:hover{background:var(--surface-2)}
.dd-o[aria-selected="true"]{background:var(--gold-wash);color:var(--gold);font-weight:700}
.dd-o svg{width:16px;height:16px;flex:none}
.dd-in{display:block;width:100%}.dd-in .dd-btn{width:100%;box-shadow:none;background:var(--surface-2);font-weight:400;padding:11px 12px}
.dd-in .dd-list{width:100%}
.att-l{display:flex;flex-wrap:wrap;gap:2px 12px}.att-l>span{white-space:nowrap}.att-l .ld{margin-left:0}
@media (max-width:980px){.nav{flex:none!important;align-items:center;min-height:0}.nav a{align-self:center;height:auto}}
.boot small{font-size:12.5px;max-width:520px}
@media (max-width:640px){.kpi.att{grid-column:1/-1;padding-right:112px}.ring2{width:84px;height:84px}}
@media (max-width:640px){.row.r4{grid-auto-flow:row dense}}
@media (max-width:980px){.app{grid-template-rows:auto 1fr;align-content:start}}
.dn{-webkit-text-size-adjust:100%;text-size-adjust:100%}
.dn button,.dn a,.dn .les,.dn .lesson{-webkit-tap-highlight-color:transparent;touch-action:manipulation}
@media (max-width:980px){
  .side{position:sticky!important;top:0;z-index:40;padding:10px 16px 8px!important;gap:8px!important;background:color-mix(in srgb,var(--bg) 94%,transparent);border-bottom:1px solid var(--hair);box-shadow:0 10px 24px -18px rgba(0,0,0,.8)}
  .brand .mark{width:32px;height:32px;border-radius:10px}.brand .mark svg{width:19px;height:19px}
  .brand b{font-size:16px}.brand span{font-size:11.5px}
  .nav a{padding:6px 12px!important;font-size:14.5px}.nav a svg{width:18px;height:18px}
  .top{position:static!important;backdrop-filter:none!important;background:none!important;padding:16px 0 10px!important}
  .main{padding-bottom:calc(40px + env(safe-area-inset-bottom))!important}
  .m-in,.lg-f input,.search input{font-size:16px!important}
}
@media (max-width:640px){.kpi.rank{grid-column:1/-1}}
@media (max-width:980px){.side{background:var(--surface)!important}}
@media (max-width:640px){.top{flex-wrap:nowrap}.top .tools{width:auto}.top:has(.nowpill:not([hidden])){flex-wrap:wrap}.top:has(.nowpill:not([hidden])) .tools{width:100%}.top h1{font-size:24px}}
.iconbtn.spinning svg,.m-btn.spinning svg{animation:dnspin .9s linear infinite}
.dn[data-accent=sapphire]{--gold:#2f5f9e;--gold-hi:#8fb3e8;--gold-wash:#eaf0f9}
.dn[data-accent=emerald]{--gold:#0f7f73;--gold-hi:#6fd6c8;--gold-wash:#e1f4f1}
.dn[data-accent=amethyst]{--gold:#6e4aa8;--gold-hi:#b9a0e6;--gold-wash:#f0eafa}
.dn[data-accent=rose]{--gold:#b0437f;--gold-hi:#f2a6d0;--gold-wash:#f9e6f1}
.dn[data-accent=graphite]{--gold:#4a5363;--gold-hi:#b6bdc9;--gold-wash:#eef0f3}
.dn[data-theme=dark][data-accent=sapphire]{--gold:#7ea6e0;--gold-hi:#b0c9ef;--gold-wash:#121a26;--sel:#7ea6e0;--hw:#7ea6e0}
.dn[data-theme=dark][data-accent=emerald]{--gold:#37c7b5;--gold-hi:#8ee6da;--gold-wash:#0f2422;--sel:#37c7b5;--hw:#37c7b5}
.dn[data-theme=dark][data-accent=amethyst]{--gold:#a98be0;--gold-hi:#cdb9f2;--gold-wash:#1b1526;--sel:#a98be0;--hw:#a98be0}
.dn[data-theme=dark][data-accent=rose]{--gold:#f07bbf;--gold-hi:#f7b3da;--gold-wash:#28121f;--sel:#f07bbf;--hw:#f07bbf}
.dn[data-theme=dark][data-accent=graphite]{--gold:#b8c0cc;--gold-hi:#dde2e9;--gold-wash:#181b20;--sel:#b8c0cc;--hw:#b8c0cc}
.dn[data-accent]:not([data-accent=gold]) .lg-go{background:linear-gradient(135deg,var(--gold-hi),var(--gold))}
.acc-row{display:flex;flex-wrap:wrap;gap:6px}
.acc{display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:999px;padding:6px 11px 6px 7px;font:inherit;font-size:13.5px;cursor:pointer}
.acc i{width:16px;height:16px;border-radius:50%;background:var(--c);box-shadow:inset 0 0 0 1px rgba(0,0,0,.15)}
.acc[aria-pressed=true]{border-color:var(--c);color:var(--ink);font-weight:700;box-shadow:0 0 0 2px color-mix(in srgb,var(--c) 35%,transparent)}
@media (max-width:640px){.acc span{display:none}.acc{padding:6px}}
.photo.cached .ini{visibility:hidden}
.cal .c .bars i.u{background:var(--line)}
.cal .c .bars i.p{background:transparent;box-shadow:inset 0 0 0 1px var(--line)}
.avgc{min-width:0;overflow:hidden}
.avgc .hd{flex-wrap:wrap;gap:8px}
.avf{flex-wrap:wrap;max-width:100%}
.dlg.rate{max-width:460px}
.rt-body{padding:14px 22px 4px;display:flex;flex-direction:column;gap:12px}
.rt-l{margin:0;color:var(--muted);font-size:14px}
.rt-stars{display:flex;justify-content:center;gap:6px}
.rt-s{border:0;background:none;padding:4px;cursor:pointer;color:var(--line);transition:transform .12s,color .12s}
.rt-s svg{width:40px;height:40px;fill:currentColor}
.rt-s.on{color:var(--gold)}
.rt-s:hover{transform:scale(1.12)}
.rt-stars:hover .rt-s{color:var(--gold-hi)}
.rt-stars .rt-s:hover~.rt-s{color:var(--line)}
.rt-w{text-align:center;font-weight:700;color:var(--gold);min-height:1.3em}
.rt-opts{display:flex;flex-direction:column;gap:6px}
.rt-o{display:flex;align-items:center;gap:10px;text-align:left;border:1px solid var(--line);background:var(--surface);color:var(--ink);border-radius:10px;padding:10px 12px;font:inherit;cursor:pointer}
.rt-o i{width:16px;height:16px;flex:none;border:2px solid var(--line);border-radius:50%}
.rt-o i.c{border-radius:4px}
.rt-o.on{border-color:var(--gold);background:var(--gold-wash)}
.rt-o.on i{border-color:var(--gold);background:var(--gold);box-shadow:inset 0 0 0 2px var(--surface)}
.dn{--warn:#a07a33;--gcol:var(--gold);--acc-deep:#94702f;--acc-light:var(--gold-hi)}
.dn[data-theme=dark]{--warn:#d4b172}
.dn[data-accent=emerald]{--gcol:var(--warn)}
.dn[data-accent=sapphire]{--acc-deep:#2f5f9e;--acc-light:#b0c9ef}
.dn[data-accent=emerald]{--acc-deep:#0f7f73;--acc-light:#8ee6da}
.dn[data-accent=amethyst]{--acc-deep:#6e4aa8;--acc-light:#cdb9f2}
.dn[data-accent=rose]{--acc-deep:#b0437f;--acc-light:#f7b3da}
.dn[data-accent=graphite]{--acc-deep:#4a5363;--acc-light:#dde2e9}
.hw .wait{border-color:var(--warn);color:var(--warn)}
.les.late::after{color:var(--warn)}
.dn[data-accent]:not([data-accent=gold]) .hero :is(.cap,.facts b){color:var(--acc-light)!important}
.dn[data-accent]:not([data-accent=gold]) .hero.t-morning :is(.cap,.facts b){color:var(--acc-deep)!important}
.dn[data-accent]:not([data-accent=gold]) .hero .photo.lg{box-shadow:0 0 0 3px rgba(15,24,34,.9),0 0 0 4.5px var(--acc-light)!important}
.dn[data-mc=true] .coin,.dn[data-mc=true] .gem{width:16px;height:16px;border-radius:0;box-shadow:none;clip-path:none;background:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA2UlEQVR42tWSOw6CQBCGv03ssPMEm1h7lsXKxsRL0NsYTCDU9h4AK05gjL0lJnsAILHQErHgIRAerf7VzO58/+xmBv5GSpEpRdY+F2NQGfu+AYBpvjidvpwYh56AW6vYNkxEP0QLpNNEKEXmeSBl/XvdoG1bjTwIYAI5rLVASmcQWq3oNshNHLS2kNIZhADeh1kRJaWBW5gY+L41AuUKoxQoXnA/7gGYr4fBMErZhY8qP58R1RScZV54myYsrs1um0vSgOp3E6CYaVKZdHXqWzbRXqI4Hod+Sx/Rb1xARdthEgAAAABJRU5ErkJggg==) center/contain no-repeat;image-rendering:pixelated}
.dn[data-mc=true] .gem{background-image:url(data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAA20lEQVR42mNgGGjAiFMmmOE/Cn8tdrUsuDTfXvOaIe3LTAYGBgaGa6/uMbxkmPcfmyFMuDRf+fcILvTy7CkG8a4kBgZdNFdhGIBFM4ohGzANwfDClX+PGDIeTGVgYGBgmKGQzcDAwMCwn2EFA8Prvwwvz55iIOwFNHD55wMI49l7rPJMlEYjE1G2Q4G4sRnpLtj/9zoDw8U3DAxSgkQmpGCG/wzhOgwMr/8i/C0lyNCU2MJQZx7MwHAZT+JDMWSVzn+GqZr/Gaol/ovfTfqPLQ3gT8roGoiyeSAAALZUULcK9JKEAAAAAElFTkSuQmCC)}
.lg-pw input.masked{-webkit-text-security:disc}
.dn[data-mc=true] .lab :is(.coin,.gem){width:22px;height:22px}
@media (max-width:560px){}
.hwf-time{display:flex;align-items:center;gap:6px}
.hwf-time input{width:64px;text-align:center}
.hwf-time b{color:var(--soft)}
.hwf-stars{justify-content:flex-start;gap:2px}
.hwf-stars .rt-s svg{width:30px;height:30px}
.hwf-tags{display:flex;flex-wrap:wrap;gap:6px}
.hwf-tag{border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:999px;padding:6px 12px;font:inherit;font-size:13.5px;cursor:pointer}
.hwf-tag[aria-pressed=true]{border-color:var(--gold);background:var(--gold-wash);color:var(--ink);font-weight:700}
.hwf-stars .rt-s{color:var(--line)!important}.hwf-stars .rt-s.on{color:var(--gold)!important}
.hsend .dh2 p{display:flex;flex-direction:column;gap:4px;margin-top:6px}
.hs-subj{color:var(--ink);font-size:16px}
.hs-theme{color:var(--muted);font-size:14px}
.hs-meta{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
.hs-chip{display:inline-flex;align-items:center;gap:6px;border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:12.5px;color:var(--muted)}
.hs-chip svg{width:14px;height:14px}
.hs-chip.warn{border-color:var(--warn);color:var(--warn)}
.hs-chip.bad{border-color:var(--bad);color:var(--bad)}
.hs-sec{display:flex;flex-direction:column;gap:12px;border:1px solid var(--hair);border-radius:14px;padding:14px 16px}
.hs-h{display:flex;gap:12px;align-items:center}
.hs-h>b{width:26px;height:26px;border-radius:50%;display:grid;place-items:center;background:var(--gold-wash);color:var(--gold);font-size:13px;flex:none}
.hs-h h4{margin:0;font-size:15px;color:var(--ink)}
.hs-h p{margin:1px 0 0;font-size:12.5px;color:var(--soft)}
.hs-drop{position:relative;display:flex;align-items:center;gap:14px;padding:14px 16px;border:1.5px dashed var(--line);border-radius:12px;cursor:pointer;transition:border-color .15s,background .15s}
.hs-drop:hover,.hs-drop.over{border-color:var(--gold);background:var(--gold-wash)}
.hs-drop.has{border-style:solid;border-color:var(--good);background:var(--good-wash)}
.hs-drop input{position:absolute;opacity:0;width:1px;height:1px}
.hs-ic{width:40px;height:40px;border-radius:10px;display:grid;place-items:center;background:var(--surface-2);color:var(--gold);flex:none}
.hs-drop.has .hs-ic{color:var(--good)}
.hs-dt{display:flex;flex-direction:column;min-width:0;flex:1}
.hs-dt b{color:var(--ink);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.hs-dt small{color:var(--soft);font-size:12.5px}
.hs-x{width:30px;height:30px;border-radius:8px;display:grid;place-items:center;font-size:18px;color:var(--muted);border:1px solid var(--line);background:var(--surface)}
@media (max-width:560px){}
.hs-f{display:flex;flex-direction:column;gap:6px}
.hs-f>span{font-size:12.5px;color:var(--soft);font-weight:700}
.hwf-time small{color:var(--soft);font-size:13px;margin-right:4px}
.hwf-time input{width:54px}
.hs-quick{display:flex;gap:4px;flex-wrap:wrap}
.hs-quick button{border:1px solid var(--line);background:none;color:var(--muted);border-radius:8px;padding:3px 8px;font:inherit;font-size:12.5px;cursor:pointer}
.hs-quick button:hover{border-color:var(--gold);color:var(--ink)}
.hs-w{color:var(--gold);font-weight:700;font-size:12.5px;min-height:1.2em}
.hsend .rt-s{transition:transform .12s}
.hs-ctog{align-self:flex-start;display:inline-flex;align-items:center;gap:7px}.hs-ctog svg{width:15px;height:15px}
.evl{margin-bottom:14px}
.hwf-stars .rt-s{transition:transform .12s!important}
@media (max-width:640px){
  .hero h2{padding-right:34px}
}
.dn[data-accent=emerald]{--cw:#2f5f9e}
.dn[data-theme=dark][data-accent=emerald]{--cw:#7ea6e0;--hw:#d4b172}
.tipb{width:24px;height:24px;border-radius:50%;border:1px solid var(--line);background:var(--surface);color:var(--muted);font:700 13px/1 Georgia,serif;font-style:italic;cursor:pointer;flex:none;margin-left:6px}
.tipb:hover{border-color:var(--gold);color:var(--gold)}
.photo.ev-ph{width:46px;height:46px}
.ev-note{display:flex;align-items:center;gap:8px;margin:0;font-size:13px;color:var(--soft)}
@media (min-width:981px){.side{height:100vh;height:100dvh;max-height:100dvh}}
.evl b .coin{display:inline-block;vertical-align:-2px;margin-left:2px}
.evdlg .dh2{flex-direction:column;align-items:center;text-align:center;position:relative}
.evdlg .dh2 .x{position:absolute;right:18px;top:18px}
.evdlg .dh2 h3{text-transform:uppercase;letter-spacing:.06em;font-size:19px}
.ev-step{display:flex;align-items:center;gap:12px;justify-content:center;margin-top:8px;color:var(--ink);font-size:17px}
.ev-step i{display:block;width:70px;height:3px;border-radius:2px;background:var(--gold)}
.ev-card{display:flex;flex-direction:column;align-items:center;gap:4px;text-align:center}
.ev-card .photo.ev-ph{width:84px;height:84px;font-size:24px;margin-bottom:6px}
.ev-name{font-size:16px;color:var(--ink)}
.ev-subj{font-weight:700;font-size:18px;color:var(--ink);margin-top:8px}
.ev-date{color:var(--muted)}
.ev-band{background:var(--surface-2);border-radius:14px;padding:16px;display:flex;flex-direction:column;align-items:center;gap:6px;text-align:center}
.ev-band>span{font-size:16px;color:var(--ink)}
.ev-band .hs-f>span:empty{display:none}
.ev-band .hwf-stars{justify-content:center}
.ev-band .hwf-stars .rt-s svg{width:38px;height:38px}
.ev-band .hs-w{text-align:center}
.evdlg .hwf-tags{justify-content:center}
.ev-cm{display:flex;flex-direction:column;gap:6px;font-weight:700;color:var(--ink)}
.ev-cm small{align-self:flex-end;color:var(--soft);font-weight:400}
.ev-bonus{margin:0;text-align:center;color:var(--ink);display:flex;align-items:center;justify-content:center;gap:6px}
.ev-note{margin:0;text-align:center;font-size:13px;color:var(--soft)}
.evdlg .ev-note{display:block}
.dn{--m-hw:#b7862e;--m-cw:#1f8a80;--m-lab:#7c5cc4;--m-ctrl:#c2456b;--m-prac:#2f72c4;--m-fin:#6b7382;--m-alt:#6f8f1e}
.dn[data-theme=dark]{--m-hw:#e3b04b;--m-cw:#45b8ac;--m-lab:#a98bf5;--m-ctrl:#ef7fa0;--m-prac:#6aa9f2;--m-fin:#c3c9d4;--m-alt:#b5d86a}
.mark5.hw{background:var(--m-hw)}.mark5.cw{background:var(--m-cw)}.mark5.lab{background:var(--m-lab)}.mark5.ctrl{background:var(--m-ctrl)}.mark5.prac{background:var(--m-prac)}.mark5.fin{background:var(--m-fin)}
.mark5{color:#0f1115}
.dn:not([data-theme=dark]) .mark5{color:#fff}
.hw.dueday{border-color:color-mix(in srgb,var(--bad) 55%,transparent);box-shadow:0 0 0 1px color-mix(in srgb,var(--bad) 30%,transparent)}
.ev-def{color:var(--soft);font-size:12px}
.dueban,.sumcard{display:flex;align-items:center;gap:14px;margin-bottom:14px;padding:14px 16px}
.dueban{background:linear-gradient(135deg,var(--bad-wash),color-mix(in srgb,var(--bad-wash) 70%,var(--surface)));border-color:color-mix(in srgb,var(--bad) 45%,transparent)}
.dueban .ic,.sumcard .ic{width:42px;height:42px;border-radius:12px;display:grid;place-items:center;flex:none}
.dueban .ic{background:color-mix(in srgb,var(--bad) 18%,transparent);color:var(--bad)}
.sumcard .ic{background:var(--gold-wash);color:var(--gold)}
.dueban .grow,.sumcard .grow{flex:1;min-width:0;display:flex;flex-direction:column}
.dueban span,.sumcard span{color:var(--muted);font-size:13.5px}
.dueban .m-btn{background:var(--bad);color:#1a0d11;border-color:var(--bad);font-weight:800}
.sumcard{background:radial-gradient(90% 160% at 100% 0%,color-mix(in srgb,var(--gold-hi) 18%,transparent),transparent 60%),var(--surface)}
.sumcard .x{border:0;background:none;color:var(--soft);font-size:20px;cursor:pointer;padding:4px 6px}
.goal .hd h2{display:flex;align-items:center;gap:8px}.goal .hd h2 svg{width:18px;height:18px;color:var(--gold)}
.gsel button,.gopt button{flex:none;border:1px solid var(--line);background:var(--surface);color:var(--muted);border-radius:999px;padding:5px 12px;font:inherit;font-size:13px;cursor:pointer;white-space:nowrap}
.gtop{display:flex;justify-content:space-between;align-items:flex-end}
.gtop small{color:var(--soft);margin-left:6px}
.gn{font-size:34px;font-weight:800;line-height:1}.gto .gn{color:var(--gold)}
.gbar{height:10px;border-radius:6px;background:var(--hair);position:relative;margin:12px 0}
.gbar i{position:absolute;inset:0 auto 0 0;border-radius:6px;background:linear-gradient(90deg,var(--gold),var(--gold-hi))}
.gbar em{position:absolute;top:-5px;width:3px;height:20px;border-radius:2px;background:var(--ink);transform:translateX(-1px)}
.gopt{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
.gopt button[aria-pressed=true]{border-color:var(--gold);color:var(--ink);background:var(--gold-wash);font-weight:700}
.gown{display:inline-flex;align-items:center;gap:6px;font-size:13px;color:var(--muted)}
.gown input{width:74px;border:1px solid var(--line);background:var(--surface-2);color:var(--ink);border-radius:999px;padding:5px 10px;font:inherit;font-size:13px}
.ghint{margin:12px 0 0;color:var(--muted);font-size:14px}.ghint b{color:var(--ink)}
.gplan{display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-top:10px}
.gplan span{min-width:30px;height:30px;padding:0 6px;border-radius:9px;display:grid;place-items:center;font-weight:800;border:1px dashed}
.gplan .k5{background:var(--good-wash);color:var(--good);border-color:color-mix(in srgb,var(--good) 50%,transparent)}
.gplan .k4{background:color-mix(in srgb,#6aa9f2 12%,transparent);color:#6aa9f2;border-color:color-mix(in srgb,#6aa9f2 50%,transparent)}
.gplan em{color:var(--soft);font-style:normal;font-size:12.5px;margin:0 4px}
.dlg.sumdlg{padding:0;max-width:560px;background:none;border:0}
.sum{position:relative;overflow:hidden;border-radius:24px;padding:24px 20px 20px;color:#eef0f5;background:radial-gradient(120% 70% at 100% 0%,color-mix(in srgb,var(--gold) 40%,transparent),transparent 60%),radial-gradient(90% 60% at 0% 100%,color-mix(in srgb,var(--good) 22%,transparent),transparent 60%),linear-gradient(160deg,#1a1430,#0f1320 70%)}
.sum .orn{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;filter:hue-rotate(var(--hue,0deg))}
.sum>*:not(.orn){position:relative}
.sum .x{position:absolute;right:14px;top:14px;border:1px solid rgba(255,255,255,.2);background:rgba(0,0,0,.25);color:#fff;border-radius:10px;width:32px;height:32px;font-size:18px;z-index:2}
.sum-nav{display:flex;justify-content:space-between;margin:-4px 44px 10px 0}
.sum-nav button{border:0;background:rgba(255,255,255,.08);color:#dfe3ea;border-radius:999px;padding:4px 12px;font:inherit;font-size:13px;cursor:pointer;text-transform:capitalize}
.sum .cap{color:var(--gold-hi)}
.sum h3{font-size:34px;line-height:1.02;margin:6px 0 6px;letter-spacing:-.02em;text-transform:none}
.sum h3::first-letter{text-transform:uppercase}
.sum .grad{background:linear-gradient(90deg,var(--gold-hi),#8fe0c0);-webkit-background-clip:text;background-clip:text;color:transparent}
.sum .sub{color:#b5bac6;margin:0 0 16px}
.sum .hero-n{display:flex;align-items:center;gap:14px;margin:0 0 14px}
.sum .hero-n b{font-size:58px;line-height:1;letter-spacing:-.03em}
.sum .hero-n span{color:#b5bac6;font-size:14px}.sum .hero-n em{color:#8fe0c0;font-style:normal;font-weight:700}
.sum .stat{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sum .st{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.09);border-radius:16px;padding:12px;backdrop-filter:blur(2px)}
.sum .st>b{font-size:28px;display:flex;align-items:center;gap:4px;line-height:1.1}
.sum .st>b.sm{font-size:17px}
.sum .st span{font-size:12.5px;color:#b5bac6}
.sum .st.w{grid-column:1/-1;display:flex;align-items:center;gap:12px}
.sum .st .em svg{width:30px;height:30px;color:var(--gold-hi)}
.sum .heat{display:grid;grid-template-columns:repeat(7,minmax(0,34px));gap:5px;margin-top:8px}
.sum .heat b{font-size:10.5px;color:#8a90a0;text-align:center;font-weight:700}
.sum .heat i{aspect-ratio:1;border-radius:5px;background:rgba(255,255,255,.06)}
.sum .heat i.e{background:none}.sum .heat i.g{background:color-mix(in srgb,var(--good) 80%,transparent)}.sum .heat i.mx{background:color-mix(in srgb,var(--bad) 80%,transparent)}
.sum .heat i.p{background:linear-gradient(135deg,color-mix(in srgb,var(--good) 80%,transparent) 50%,color-mix(in srgb,var(--bad) 80%,transparent) 50%)}.sum .heat i.l{background:color-mix(in srgb,#e3b04b 80%,transparent)}
.sum .hl{display:flex;flex-wrap:wrap;gap:10px;margin-top:8px}.sum .hl span{display:inline-flex;align-items:center;gap:5px}.sum .hl i{width:10px;height:10px;border-radius:3px;display:inline-block}
.sum .hl i.g{background:var(--good)}.sum .hl i.mx{background:var(--bad)}.sum .hl i.l{background:#e3b04b}.sum .hl i.p{background:linear-gradient(135deg,var(--good) 50%,var(--bad) 50%)}
.sum .coin,.sum .gem{margin:0 4px 0 2px}
.sum-foot{margin:14px 0 0;font-size:12px;color:#8a90a0;text-align:center}
@media (max-width:640px){.sum h3{font-size:28px}.sum .hero-n b{font-size:46px}}
#dlg.sumd{background:none!important;border:0!important;padding:0!important;box-shadow:none!important;max-width:min(560px,calc(100vw - 24px))}
.dlg.sumdlg{max-width:none;width:100%}
.notes{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-bottom:0}
.notes>.card{margin:0!important;padding:10px 12px!important;display:flex;align-items:center;gap:12px;min-width:0}
.notes .ic{width:34px!important;height:34px!important;border-radius:10px!important;display:grid;place-items:center;flex:none}
.notes .ic svg{width:18px;height:18px}
.notes .grow{flex:1;min-width:0;display:flex;flex-direction:column;line-height:1.3}
.notes .grow b{font-size:14.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notes .grow span{font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.notes .m-btn{padding:7px 12px;font-size:13.5px;min-height:0}
.notes .evl .ic{background:var(--gold-wash);color:var(--gold)}
.notes .evl b .coin{display:inline-block;vertical-align:-2px}
.notes .sumcard .x{padding:2px 4px}
.goals .goal .hd{align-items:center}
.goals .dd{min-width:170px;max-width:60%}
.goal .gtop small{display:block;margin:4px 0 0}
.lab .tipb{margin-left:auto}
.sum .st .col{display:flex;flex-direction:column;gap:2px}
.main,.dn{overflow-x:clip}
.goals .goal .hd .dd-list,.hd .dd:last-child .dd-list{left:auto;right:0}
.dd-list.flip{left:auto;right:0}
.gper{margin:-4px 0 12px;align-self:flex-start}
.gper button{padding:5px 12px;font-size:13px}
.avgc svg{height:auto;max-width:100%}
.hw .hwb{display:flex;flex-direction:column;gap:8px;padding:12px 12px 0}
.hw .hwb:empty{display:none}
.hw .hwx{margin:0;padding:9px 11px 10px;border-radius:12px;background:var(--surface-2);border:1px solid var(--hair);font-size:13.5px;line-height:1.45}
.hw .hwx span{font-size:10.5px;margin-bottom:4px}
.hw .hwx p{margin:0}
.hw .hwx.ans{border-left:3px solid var(--good)}
.hw .hwx.tc{background:var(--gold-wash);border-color:color-mix(in srgb,var(--gold) 28%,transparent)}
.hw .hwx.clamp{cursor:pointer}
.hw .hwx.clamp p{display:-webkit-box;-webkit-line-clamp:4;-webkit-box-orient:vertical;overflow:hidden}
.hw .hwx.clamp.open p{display:block}
.hw .hwx.clamp::after{content:"Показать полностью";display:block;margin-top:5px;font-size:12px;font-weight:700;color:var(--gold)}
.hw .hwx.clamp.open::after{content:"Свернуть"}
.hw .hwft{margin-top:auto;padding-top:12px}
.hw .hwft .early{border-top:1px solid var(--hair);padding:10px 14px}
.hw .hwact{display:flex;flex-wrap:wrap;gap:8px}
.hw .hwft .hwact{padding:0 12px 12px}
.hw .hwact a{flex:1 1 0;min-width:0;display:flex;align-items:center;justify-content:center;gap:7px;font-size:13px;font-weight:700;color:var(--ink);text-decoration:none;border:1px solid var(--line);border-radius:10px;padding:8px 10px;background:var(--surface-2);white-space:nowrap}
.hw .hwact a:hover{border-color:var(--gold)}
.hw .hwact svg{width:15px;height:15px;color:var(--gold);flex:none}
.hw .hwact .submit{flex:1 0 100%;margin:0;padding:10px 12px}
.calrow{align-items:stretch}
.calrow>.card{display:flex;flex-direction:column}
.calrow .cal{flex:1;grid-template-rows:auto;grid-auto-rows:minmax(48px,1fr)}
.calrow .cal .c{aspect-ratio:auto;min-height:48px;height:auto}
.calrow .wkc .wkchart{flex:1;height:auto;min-height:170px}
.toast{animation:dntoast .25s ease}
@keyframes dntoast{from{opacity:0;transform:translate(-50%,10px)}to{opacity:1;transform:translate(-50%,0)}}
.goals .goal .hd .dd-list,.hd .dd:last-child .dd-list{right:auto}
.dd-list{max-width:calc(100vw - 16px)}
.gown{gap:8px}
.gin{display:inline-flex;align-items:center;gap:3px;height:34px;padding:0 14px;border:1px solid var(--line);background:var(--surface-2);border-radius:999px;transition:border-color .15s}
.gin:focus-within{border-color:var(--gold);box-shadow:0 0 0 3px var(--gold-wash)}
.gown .gin input{width:46px;height:100%;border:0!important;background:none!important;padding:0!important;border-radius:0;outline:none;font:inherit;font-size:15px;font-weight:700;color:var(--ink);text-align:center;-moz-appearance:textfield;appearance:textfield}
.gown .gin input::-webkit-inner-spin-button,.gown .gin input::-webkit-outer-spin-button{-webkit-appearance:none;margin:0}
.gin input::placeholder{color:var(--soft);font-weight:400}
.gin em{font-style:normal;font-weight:700;color:var(--soft);font-size:14px}
.gin:has(input:not(:placeholder-shown)) em{color:var(--ink)}
@media (max-width:760px){input:not([type=checkbox]):not([type=radio]),textarea,select{font-size:16px!important}}
.dg.td{border-image:none;border-left:3px solid var(--gold)}
.dg.td .les{box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--gold) 45%,transparent)}
.m-btn{justify-content:center;line-height:1.15}
.m-btn svg,.hw .submit svg{flex:none;display:block}
.hw .submit{line-height:1.15}
.hw .submit::after{content:"";width:16px;flex:none}
.hw .submit svg{width:16px;height:16px}
@media (max-width:560px){.ffoot{display:grid;grid-template-columns:auto 1fr}.ffoot .m-btn{align-self:stretch;white-space:nowrap}}
.photo .pimg{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;border-radius:50%;opacity:0;transition:opacity .2s}
.photo .pimg.ok{opacity:1}
.sum-dl{display:flex;align-items:center;justify-content:center;gap:8px;width:100%;margin-top:16px;border:1px solid rgba(255,255,255,.18);background:rgba(255,255,255,.07);color:#eef0f5;border-radius:12px;padding:11px 14px;font:inherit;font-weight:700;cursor:pointer;position:relative;z-index:1}
.sum-dl:hover{background:rgba(255,255,255,.12)}
.sum-dl svg{width:17px;height:17px}
.hs-fb{gap:0;padding-bottom:4px}
.hs-fb .hs-h{margin-bottom:12px}
.hs-row{display:flex;flex-direction:column;gap:10px;padding:14px 0;border-top:1px solid var(--hair)}
.hs-rl{display:flex;align-items:center;gap:8px;font-size:14px;font-weight:700;color:var(--ink);line-height:1.2}
.hs-rl svg{width:16px;height:16px;color:var(--gold);flex:none}
.hs-rl small{color:var(--soft);font-weight:400;font-size:12.5px}
.hs-rl .hs-w{margin-left:auto;font-style:normal;min-height:0}
.hs-tline{display:flex;flex-wrap:wrap;align-items:center;gap:10px 14px}
.hs-fb .hs-quick{gap:6px}
.hs-fb .hs-quick button{border:1px solid var(--line);background:var(--surface-2);color:var(--ink);border-radius:999px;padding:7px 13px;font-size:13px;line-height:1.1}
.hs-fb .hs-quick button[aria-pressed=true]{border-color:var(--gold);background:var(--gold-wash);font-weight:700}
.hs-fb .hwf-time{gap:6px}
.hs-fb .hwf-time input{width:52px;height:36px;padding:0;text-align:center;border-radius:10px}
.hs-fb .hwf-stars{gap:4px}
.hs-fb .hwf-stars .rt-s svg{width:34px;height:34px}
.hs-fb .hwf-tags{gap:8px}
.hs-fb .hwf-tag{padding:7px 13px;line-height:1.15}
.hs-fb .hs-ctog{align-self:flex-start;border:0;background:none;padding:0;color:var(--gold);font:inherit;font-weight:700;font-size:14px;cursor:pointer}
.kpi .oth{display:flex;flex-wrap:wrap;gap:4px 10px;margin-top:6px}
.kpi .oth span{display:inline-flex;align-items:center;gap:5px;font-size:12.5px;color:var(--muted)}
.kpi .oth .mark5.sw{width:9px;height:9px;min-width:0;padding:0;border-radius:50%;display:inline-block}
.lesson.live .t{padding-right:56px}
.dn{--late:#b98a1c}.dn[data-theme=dark]{--late:#e6b35a}
.cal .c.lt{background:color-mix(in srgb,var(--late) 14%,transparent);border-color:color-mix(in srgb,var(--late) 45%,transparent);color:var(--ink)}
.cal .c .bars i.l{background:var(--late)}
.toast{text-align:center;white-space:pre-line;line-height:1.35}
.hint>.m-btn{align-self:center}
.lesson.live .t{padding-right:0}
.lesson.live>*{order:2}.lesson.live>.t{order:0}
.lesson.live::after{position:static;order:1;align-self:flex-start;margin:-1px 0 1px;line-height:1.3}
.m-hero>.m-btn,.m-hero>a.m-btn,.m-hero>.btns{align-self:center}
.page>.note:empty{display:none}
.page>.note{margin:-6px 0 -4px;padding:0 4px}
.rv{display:flex;flex-direction:column}
.rv>.tag,.rv>.newtag{align-self:flex-start}
.rv .by{margin-top:auto}
.lesson.live::after{display:none!important}
.hero .tmarks{display:flex;align-items:center;flex-wrap:wrap;gap:8px;margin-top:12px}
.hero .tmarks>b{font-size:14px;margin-right:2px}
.hero .tmk{display:inline-flex;align-items:center;gap:8px;border-radius:999px;padding:4px 12px 4px 4px;font:inherit;font-size:13.5px;color:inherit;cursor:pointer;border:1px solid rgba(241,236,226,.18);background:rgba(241,236,226,.08);max-width:100%;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.hero .tmk.more{padding:4px 12px;font-weight:700}
.hero .tmk .mark5{width:26px;height:26px;min-width:26px;border-radius:50%;display:inline-grid;place-items:center;font-size:13px;font-weight:800;color:#10131a}
@media (max-width:560px){.hero .tmk{font-size:13px}}
.hero .tmk .tsj{margin-left:3px}.hero .tmk{gap:5px}
.labtag{display:inline-block;margin-left:8px;font-size:10.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--m-lab);background:color-mix(in srgb,var(--m-lab) 14%,transparent);border-radius:6px;padding:2px 7px;vertical-align:2px}
.notes .payban.debt{border-color:color-mix(in srgb,var(--bad) 45%,transparent);background:linear-gradient(90deg,var(--bad-wash),transparent 70%),var(--surface)}
.notes .payban.debt .ic{background:var(--bad-wash);color:var(--bad)}
.notes .payban.soon{border-color:color-mix(in srgb,var(--late,#e6b35a) 45%,transparent);background:linear-gradient(90deg,color-mix(in srgb,var(--late,#e6b35a) 12%,transparent),transparent 70%),var(--surface)}
.notes .payban.soon .ic{background:color-mix(in srgb,var(--late,#e6b35a) 14%,transparent);color:var(--late,#e6b35a)}
.notes .quizban .ic{background:var(--gold-wash);color:var(--gold)}
.notes .card>.x{flex:none;border:0;background:none;color:var(--soft);font-size:20px;line-height:1;padding:2px 4px;cursor:pointer}
.notes .card>.x:hover{color:var(--ink)}
.notes .quizban b .coin{display:inline-block;vertical-align:-2px}
.bday{position:relative;overflow:hidden;display:flex;align-items:center;gap:26px;padding:28px 30px!important;border:0!important;color:#fff;
  background:radial-gradient(90% 140% at 100% 0%,color-mix(in srgb,var(--gold) 70%,transparent),transparent 60%),radial-gradient(70% 120% at 0% 100%,rgba(255,120,170,.45),transparent 60%),linear-gradient(135deg,#1c1530,#2a1d44 55%,#3b2254)}
.bday h2{margin:4px 0 6px;font-size:34px;letter-spacing:-.02em;line-height:1.1}
.bday p{margin:0;opacity:.85;font-size:15.5px;max-width:60ch}
.bday .cap{color:color-mix(in srgb,var(--gold) 60%,#fff);font-size:12px;letter-spacing:.14em;text-transform:uppercase;font-weight:700}
.bd-cake{width:96px;height:96px;flex:none;border-radius:26px;display:grid;place-items:center;background:rgba(255,255,255,.1);box-shadow:inset 0 0 0 1px rgba(255,255,255,.18);position:relative;z-index:1}
.bd-cake svg{width:64px;height:64px}
.bd-tx{position:relative;z-index:1;flex:1;min-width:0}
.bd-conf{position:absolute;inset:0;pointer-events:none}
.bd-conf i{position:absolute;width:8px;height:14px;border-radius:2px;transform:rotate(var(--r));opacity:.75;animation:dnconf 3.2s ease-in-out var(--d) infinite alternate}
.bd-conf i.c0{background:var(--gold)}.bd-conf i.c1{background:#ff8fb7}.bd-conf i.c2{background:#8fe0c0}.bd-conf i.c3{background:#ffd36b;width:6px;height:6px;border-radius:50%}
@keyframes dnconf{to{transform:rotate(calc(var(--r) + 40deg)) translateY(8px)}}
.bday>.x{position:absolute;top:12px;right:14px;z-index:2;border:1px solid rgba(255,255,255,.25);background:rgba(0,0,0,.2);color:#fff;border-radius:10px;width:32px;height:32px;font-size:18px;cursor:pointer}
@media (max-width:560px){.bday{flex-direction:column;align-items:flex-start;gap:14px;padding:22px!important}.bday h2{font-size:26px}.bd-cake{width:72px;height:72px}.bd-cake svg{width:48px;height:48px}}
@media (prefers-reduced-motion:reduce){.bd-conf i{animation:none}}
@media (max-width:560px){.notes :is(.payban,.quizban) .grow :is(b,span){white-space:normal}}
@media (max-width:560px){.bd-conf{left:auto;right:0;width:100%;height:34%}}
.notes .quizban.late{border-color:color-mix(in srgb,var(--bad) 45%,transparent)}
.notes .quizban.late .ic{background:var(--bad-wash);color:var(--bad)}
.notes .payban .grow span{white-space:normal}
.notes .updban{border-color:color-mix(in srgb,var(--gold) 45%,transparent);background:linear-gradient(90deg,var(--gold-wash),transparent 70%),var(--surface)}
.notes .updban .ic{background:var(--gold-wash);color:var(--gold)}
.notes .updban a.m-btn{text-decoration:none}
.ver .ver-top{display:flex;align-items:center;gap:16px;flex-wrap:wrap}
.ver .ver-ic{width:52px;height:52px;border-radius:15px;display:grid;place-items:center;background:var(--gold-wash);color:var(--gold);flex:none}
.ver .grow{flex:1;display:flex;flex-direction:column;gap:2px;min-width:200px}
.ver .cap{font-size:11.5px;letter-spacing:.14em;text-transform:uppercase;color:var(--gold);font-weight:700}
.ver .grow b{font-size:24px;line-height:1.1}
.ver .soft{font-size:13px;color:var(--soft)}
.ver a.m-btn{text-decoration:none}
.ver .ver-new{margin-top:14px;padding-top:12px;border-top:1px solid var(--hair)}
.ver .ver-new>span{font-size:11.5px;letter-spacing:.1em;text-transform:uppercase;color:var(--soft);font-weight:700}
.ver .ver-new ul{margin:8px 0 0;padding-left:18px;display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:4px 24px;color:var(--muted);font-size:14px}
.sum .st.place{justify-content:center;text-align:center}
.sum .st.place .col{align-items:flex-start;text-align:left}
.dn{--good:#2f8a62;--good-wash:#e6f3ec;--bad:#c4574c;--bad-wash:#f9e9e6;--warn:#a86a12;--late:#a86a12;--att:#2e8f8a;
  --m-hw:#c46a24;--m-cw:#3f86c9;--m-ctrl:#b8506a;--m-lab:#7658c2;--m-prac:#2f8a62;--m-fin:#6b7382}
.dn[data-theme=dark]{--good:#7fcca4;--good-wash:#15241d;--bad:#ef8a80;--bad-wash:#2a1918;--warn:#e9b35e;--late:#e9b35e;--att:#72c6c0;
  --m-hw:#ef9a58;--m-cw:#8cc0ee;--m-ctrl:#ec93a6;--m-lab:#b7a2ef;--m-prac:#86cfa8;--m-fin:#c3c9d4}
.stat-warn{color:var(--warn)}
.labtag.rm{background:var(--bad-wash);color:var(--bad)}
.hd small .newc{color:var(--gold);font-weight:700}
.lesson .t{overflow-wrap:anywhere;min-width:0}
.cal .c.has,.cal .c.lt,.cal .c.part{--st:var(--good);background:color-mix(in srgb,var(--st) 12%,var(--surface));border:1.5px solid color-mix(in srgb,var(--st) 58%,transparent);color:var(--st);transition:filter .15s}
.cal .c.lt{--st:var(--late)}.cal .c.part{--st:var(--bad)}
.cal .c.has>.num{color:var(--st);font-weight:700}
.cal .c.has:hover{filter:brightness(1.12)}
.cal .c .bars{gap:3px}.cal .c .bars i{height:4px;border-radius:2px;background:var(--good)}
.cal .c .bars i.x{background:var(--bad)}.cal .c .bars i.l{background:var(--late)}
.calc>.legend,.wkc>.legend{margin-top:14px}
.wkc{display:flex;flex-direction:column}
.wkchart2{flex:1;display:flex;gap:16px;min-height:240px;padding-top:4px}
.wkchart2 .col{flex:1;min-width:0;display:flex;flex-direction:column;align-items:center}
.wkchart2 .wk-pc{font-size:18px;line-height:1}.wkchart2 .wk-n{font-size:11.5px;color:var(--soft);margin:3px 0 10px}
.wkchart2 .tr{flex:1;width:100%;max-width:52px;border-radius:12px;background:color-mix(in srgb,var(--ink) 6%,transparent);display:flex;flex-direction:column;justify-content:flex-end;overflow:hidden}
.wkchart2 .tr i{display:block;border-radius:12px;min-height:6px;background:linear-gradient(180deg,var(--z),color-mix(in srgb,var(--z) 62%,var(--surface)))}
.wkchart2 .dt{font-size:11px;color:var(--soft);margin-top:14px;white-space:nowrap;font-weight:400}
@media (max-width:640px){.wkchart2{gap:10px}.wkchart2 .dt{font-size:10px}.wkchart2 .wk-pc{font-size:15px}}
.wkchart{gap:18px}
.wkchart .col{gap:4px}
.wkchart .wk-pc{font-size:15px;line-height:1}
.wkchart .wk-n{font-size:11.5px;color:var(--soft);margin-bottom:4px}
.wkchart .stack{display:flex;flex-direction:column;justify-content:flex-end;max-width:52px;gap:0}
.wk-bar{display:flex;flex-direction:column;border-radius:10px;overflow:hidden;box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--ink) 8%,transparent)}
.wk-bar i{display:block;min-height:3px;border-radius:0!important;box-shadow:none!important;background:color-mix(in srgb,var(--good) 78%,var(--surface))!important}
.wk-bar i.x{background:color-mix(in srgb,var(--bad) 74%,var(--surface))!important;border-bottom:2px solid var(--surface)}
.les.miss{background:var(--surface-2);border-color:color-mix(in srgb,var(--bad) 45%,var(--line))}
.les.miss::after,.les.late::after{content:none!important}
.les .sd{display:none}
.les-st{min-width:22px;height:20px;padding:0 6px;border-radius:7px;display:inline-grid;place-items:center;font-size:11.5px;font-weight:800;line-height:1}
.les-st.x{color:var(--bad);background:var(--bad-wash);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--bad) 55%,transparent)}
.les-st.l{color:var(--late);background:color-mix(in srgb,var(--late) 14%,transparent);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--late) 55%,transparent)}
.les .mark5{box-shadow:none}
.avgc .ax.a{fill:color-mix(in srgb,var(--att) 55%,var(--soft))}
.avgc .ax.a.stat-good{fill:var(--good)}.avgc .ax.a.stat-warn{fill:var(--warn)}.avgc .ax.a.stat-bad{fill:var(--bad)}
.avgc .vl.stat-good{fill:var(--good)}.avgc .vl.stat-warn{fill:var(--warn)}.avgc .vl.stat-bad{fill:var(--bad)}
.avgc .thr{stroke-dasharray:3 5;stroke-width:1;opacity:.45}.avgc .thr.stat-warn{stroke:var(--warn)}.avgc .thr.stat-bad{stroke:var(--bad)}
.avg-kpis b.stat-good{color:var(--good)}.avg-kpis b.stat-warn{color:var(--warn)}.avg-kpis b.stat-bad{color:var(--bad)}
.avgc .ax.g{fill:color-mix(in srgb,var(--gcol) 85%,var(--soft))}.avgc .ax.a{fill:color-mix(in srgb,var(--att) 85%,var(--soft))!important}
.avgc .vl{fill:var(--ink)}.avg-kpis .dlt{color:var(--soft);font-size:12px;margin-left:4px}
.avgc>.legend{margin-top:10px}
.dn{--att:#2e8f8a}.dn[data-theme=dark]{--att:#4fb3ab}
.gpairs .hd .sel,.gpairs .hd .dd{margin-left:auto;width:auto;min-width:170px}
.gtabs{display:flex;gap:6px;overflow-x:auto;scrollbar-width:none;margin-bottom:10px;padding-bottom:2px}.gtabs::-webkit-scrollbar{display:none}
.gtabs button{flex:none;display:flex;flex-direction:column;align-items:center;gap:1px;padding:6px 12px;border-radius:10px;background:var(--surface-2);border:1px solid var(--line);color:var(--muted);font:inherit;cursor:pointer}
.gtabs button b{font-size:12.5px}.gtabs button small{font-size:10.5px;color:var(--soft)}
.gtabs button[aria-pressed=true]{background:color-mix(in srgb,var(--gold) 20%,var(--surface-2));border-color:color-mix(in srgb,var(--gold) 60%,transparent);color:var(--ink)}
.gsum{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;font-size:13px;color:var(--muted);margin-bottom:8px}.gsum b{color:var(--ink)}
.gflt{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.gflt .sel,.gflt .dd{min-width:170px}
.gleg{margin:2px 0 10px}.stl b{display:inline-block;width:4px;height:12px;border-radius:2px;margin-right:6px;vertical-align:-2px}
.gpager{display:flex;align-items:flex-start;transition:height .25s ease;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;scrollbar-width:none;overscroll-behavior-x:contain;-webkit-overflow-scrolling:touch}.gpager::-webkit-scrollbar{display:none}
.gpage{flex:0 0 100%;scroll-snap-align:start;min-width:0}
.gday{display:grid;grid-template-columns:70px 1fr;gap:10px;align-items:center;padding:6px 0;border-top:1px solid var(--hair)}.gday:first-child{border-top:0}
.gday h4{font-size:14px;margin:0}.gday h4 span{display:block;font-size:11.5px;color:var(--soft);font-weight:400}
.gday.td h4{color:var(--gold)}
.grow2{display:grid;grid-template-columns:repeat(var(--slots),minmax(0,250px));gap:8px}
.pc2{grid-column:var(--col);height:52px;min-width:0;border-radius:9px;background:linear-gradient(180deg,color-mix(in srgb,var(--ink) 5.5%,transparent),color-mix(in srgb,var(--ink) 2.5%,transparent));border:1px solid color-mix(in srgb,var(--ink) 7%,transparent);box-shadow:inset 0 1px 0 color-mix(in srgb,var(--ink) 4%,transparent),0 4px 14px -8px rgba(0,0,0,.5);
  display:flex;align-items:center;justify-content:space-between;gap:6px;position:relative;overflow:hidden;padding:0 10px 0 16px;font:inherit;color:inherit;text-align:left;cursor:pointer;transition:transform .15s,border-color .15s,opacity .2s}
.pc2:hover{transform:translateY(-1px);border-color:color-mix(in srgb,var(--gold) 45%,transparent)}
.pc2.x::before,.pc2.l::before{content:"";position:absolute;left:0;top:0;bottom:0;width:5px;background:var(--bad)}.pc2.l::before{background:var(--late)}
.pc2.x{background:linear-gradient(90deg,color-mix(in srgb,var(--bad) 12%,transparent),color-mix(in srgb,var(--ink) 3%,transparent) 60%)}
.pc2.l{background:linear-gradient(90deg,color-mix(in srgb,var(--late) 10%,transparent),color-mix(in srgb,var(--ink) 3%,transparent) 60%)}
.pc2.isnew{box-shadow:0 0 0 1.5px var(--gold) inset}
.pc2.dim{opacity:.18}
.pc2 .pb{flex:1;min-width:0;display:flex;flex-direction:column;gap:1px}
.pc2 .pn{font-size:10.5px;color:var(--soft);display:flex;align-items:center;gap:6px}.pc2 .pn i{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.7}
.pc2 .ps{font-size:13.5px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pc2 .pm{flex:none;display:flex;gap:4px;align-items:center;justify-content:flex-end}
.pc2 .pm .mark5{width:24px;height:24px;font-size:13px;box-shadow:0 0 0 2px rgba(0,0,0,.2)}
.gdots,.gswipe{display:none}
@media (max-width:760px){
  .gday{grid-template-columns:1fr;gap:6px}.gday h4 span{display:inline;margin-left:6px}
  .grow2{grid-template-columns:1fr;gap:7px}.pc2{grid-column:auto;height:50px}
  .gdots{display:flex;justify-content:center;gap:6px;margin:12px 0 2px}.gdots i{width:6px;height:6px;border-radius:50%;background:var(--line);transition:width .2s}.gdots i.on{width:18px;border-radius:4px;background:var(--gold)}
  .gswipe{display:block;text-align:center;font-size:11.5px;color:var(--soft);margin-top:6px}
  .gsum{flex-direction:column;align-items:flex-start}
}
.mkt{padding:18px!important;position:relative;overflow:hidden}
.mkt::before{content:"";position:absolute;right:-120px;top:-160px;width:420px;height:420px;border-radius:50%;background:radial-gradient(circle,color-mix(in srgb,var(--gold) 16%,transparent),transparent 65%);pointer-events:none}
.mk-hd{position:relative;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:16px}
.mk-tt{display:flex;align-items:center;gap:12px;min-width:0}
.mk-badge{width:40px;height:40px;flex:none;border-radius:12px;display:grid;place-items:center;background:var(--gold-wash);color:var(--gold)}.mk-badge svg{width:20px;height:20px}
.mk-tt h2{margin:0;font-size:19px;line-height:1.15}
.mk-upd{display:inline-flex;align-items:center;gap:5px;border:0;background:none;padding:0;font:inherit;font-size:12.5px;color:var(--muted);cursor:pointer}.mk-upd svg{width:13px;height:13px}.mk-upd:hover{color:var(--ink)}
.mk-hr{display:flex;align-items:center;gap:8px}
.mk-pill button{padding:6px 10px;font-size:12.5px}
.mk-x{width:34px;height:34px;flex:none;border-radius:10px;border:1px solid var(--line);background:var(--surface);color:var(--muted);font-size:20px;line-height:1;display:grid;place-items:center;cursor:pointer;transition:color .15s,background .15s}.mk-x:hover{color:var(--ink);background:var(--surface-2)}
.mk-grid{position:relative;display:grid;grid-template-columns:minmax(0,1.3fr) minmax(0,1fr);gap:14px}
.mk-main,.mk-row,.mk-fg{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;transition:transform .16s ease,box-shadow .16s ease,background .16s}
.mk-main{border-radius:20px;padding:18px 18px 14px;background:linear-gradient(160deg,color-mix(in srgb,var(--gold) 12%,var(--surface-2)),var(--surface-2) 60%);border:1px solid color-mix(in srgb,var(--gold) 18%,var(--hair));display:flex;flex-direction:column;min-width:0}
.mk-mtop{display:flex;align-items:center;justify-content:space-between;gap:10px}
.mk-lbl{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--gold)}
.mk-src{font-size:11.5px;color:var(--muted);padding:3px 9px;border-radius:999px;background:color-mix(in srgb,var(--surface) 70%,transparent);border:1px solid var(--hair);white-space:nowrap}
.mk-bigrow{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:10px}
.mk-big{font-size:54px;font-weight:700;line-height:1;letter-spacing:-.02em}.mk-big small{font-size:.5em;margin-left:6px;color:var(--muted);font-weight:700}
.mk-bsub{display:flex;align-items:center;flex-wrap:wrap;gap:4px 8px;font-size:12.5px;color:var(--muted);margin-top:8px;min-height:18px}
.mk-dotsep{width:3px;height:3px;border-radius:50%;background:currentColor;opacity:.6}
.mk-ch{display:inline-flex;align-items:center;gap:3px;font-size:12px;font-weight:700;padding:3px 8px;border-radius:999px;white-space:nowrap}
.mk-ch.mup{color:var(--good);background:var(--good-wash)}.mk-ch.mdn{color:var(--bad);background:var(--bad-wash)}
.mup{color:var(--good)}.mdn{color:var(--bad)}
.mk-chart{position:relative;touch-action:pan-y}
.mk-chart.big{margin-top:12px}.mk-chart.big .mk-plot{height:170px}
.mk-chart.sheet .mk-plot{height:190px}
.mk-plot{position:relative}.mk-plot svg{display:block;width:100%;height:100%;overflow:visible}
.mk-chart.spark{width:100%;max-width:120px;justify-self:center}.mk-chart.spark .mk-plot{height:30px}
.mk-chart.empty{display:grid;place-items:center;color:var(--muted);font-size:13px;min-height:30px}.mk-chart.empty.big,.mk-chart.empty.sheet{min-height:150px}
.mk-ticks{display:flex;justify-content:space-between;font-size:11px;color:var(--muted);margin-top:8px}
.mk-last{position:absolute;width:10px;height:10px;margin:-5px 0 0 -5px;border-radius:50%;background:var(--lc);box-shadow:0 0 0 5px color-mix(in srgb,var(--lc) 22%,transparent)}
.mk-scrub{position:absolute;inset:0;pointer-events:none}
.mk-vl{position:absolute;top:0;bottom:0;width:0;border-left:1px dashed color-mix(in srgb,var(--ink) 35%,transparent)}
.mk-dot{position:absolute;width:12px;height:12px;margin:-6px 0 0 -6px;border-radius:50%;background:var(--surface);border:3px solid var(--lc)}
.mk-tip{position:absolute;top:-6px;transform:translate(-50%,-100%);background:var(--ink);color:var(--surface);border-radius:10px;padding:5px 9px;white-space:nowrap;font-size:12px;display:flex;flex-direction:column;align-items:center;line-height:1.2;box-shadow:0 6px 18px rgba(0,0,0,.25)}
.mk-tip b{font-size:13.5px}.mk-tip span{opacity:.7;font-size:11px}
.mk-chart.scrubbing .mk-last{opacity:0}
.mk-cap{font-size:11.5px;color:var(--muted);margin-top:6px}
.mk-stats{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:12px}
.mk-stats>div:not(.mk-sfoot){padding:8px 10px;border-radius:12px;background:color-mix(in srgb,var(--surface) 55%,transparent);border:1px solid var(--hair)}
.mk-stats span{display:block;font-size:11.5px;color:var(--muted)}.mk-stats b{font-size:15px}
.mk-sfoot{grid-column:1/-1;font-size:11px;color:var(--muted)}
.mk-side{display:flex;flex-direction:column;gap:12px;min-width:0}
.mk-list{border-radius:18px;background:var(--surface-2);border:1px solid var(--hair);padding:6px}
.mk-lh{display:flex;justify-content:space-between;gap:8px;padding:8px 10px 6px;font-size:11.5px;color:var(--muted)}.mk-lh span:first-child{font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ink);opacity:.8}
.mk-row{display:grid;grid-template-columns:34px minmax(0,1fr) minmax(56px,120px) auto;align-items:center;gap:12px;padding:10px;border-radius:13px;cursor:pointer}
.mk-row+.mk-row{box-shadow:0 -1px 0 var(--hair)}
.mk-row:hover{background:color-mix(in srgb,var(--surface) 70%,transparent)}
.mk-ic{width:34px;height:34px;flex:none;border-radius:50%;display:grid;place-items:center;font-weight:700;font-size:16px;color:#fff;background:var(--c);box-shadow:0 0 0 4px color-mix(in srgb,var(--c) 16%,transparent)}
.mk-nm{min-width:0}.mk-nm b{display:block;font-size:15px;line-height:1.15}.mk-nm span{font-size:12px;color:var(--muted)}
.mk-pr{text-align:right;display:flex;flex-direction:column;align-items:flex-end;gap:4px}.mk-pr b{font-size:15.5px}
.mk-fg{padding:14px 16px;border-radius:18px;background:var(--surface-2);border:1px solid var(--hair);cursor:pointer}
.mk-fgh{display:flex;justify-content:space-between;gap:8px;font-size:12.5px;color:var(--muted)}.mk-fgh b{color:var(--ink);font-size:13px}
.mk-fgbar{position:relative;height:8px;border-radius:99px;margin:12px 0 6px;background:linear-gradient(90deg,#e5534b,#e39a4b 30%,#e3c14b 50%,#8fcf6a 72%,#3fb67e)}
.mk-fgbar i{position:absolute;top:50%;width:16px;height:16px;margin:-8px 0 0 -8px;border-radius:50%;background:#fff;border:3px solid #1a1d24;box-shadow:0 2px 8px rgba(0,0,0,.35)}
.mk-fgl{display:flex;justify-content:space-between;font-size:11px;color:var(--muted)}
.pressing{transform:scale(.975);box-shadow:0 0 0 2px color-mix(in srgb,var(--gold) 55%,transparent)}
.popped{animation:mkpop .26s ease}@keyframes mkpop{40%{transform:scale(1.015)}}
.mk-foot{position:relative;display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:14px;font-size:11.5px;color:var(--muted)}
.mk-foot span:first-child{display:inline-flex;align-items:center;gap:6px}.mk-foot svg{width:14px;height:14px}
.mks{max-width:min(560px,calc(100vw - 24px))}
.mks-hd{display:flex;align-items:center;gap:12px;padding:18px 20px 14px;border-bottom:1px solid var(--hair);background:linear-gradient(180deg,var(--surface-2),var(--surface))}.mks-hd .x{margin-left:auto}
.mks-b{padding:16px 20px 20px}
.mks-price{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin-bottom:12px}.mks-price>b{font-size:38px;line-height:1}.mks-price>b small{font-size:.5em;margin-left:5px;color:var(--muted)}.mks-price .soft{font-size:12.5px;color:var(--muted)}
.mks-sec{margin:16px 0 8px;font-size:11.5px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted)}
.mks-err{margin-top:8px;padding:10px 12px;border-radius:12px;background:var(--bad-wash);color:var(--bad);font-size:12.5px}
.mks-b>.mk-pill{margin-bottom:26px}
.mks-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px;margin-top:12px}
.mks-grid>div{padding:10px 12px;border-radius:12px;background:var(--surface-2);border:1px solid var(--hair)}.mks-grid span{display:block;font-size:12px;color:var(--muted)}.mks-grid b{font-size:15px}
.mks-bars{display:flex;align-items:flex-end;gap:3px;height:110px;margin-top:16px}.mks-bars i{flex:1;border-radius:3px 3px 0 0;min-width:3px}
.mks .mk-fg{cursor:default}
@media (max-width:760px){.mkt{padding:16px!important}.mk-grid{grid-template-columns:minmax(0,1fr)}.mk-big{font-size:46px}.mk-chart.big .mk-plot{height:150px}
  .mk-hd{flex-wrap:wrap}.mk-tt{flex:1}.mk-hr{order:3;width:100%;justify-content:space-between}.mk-x{position:absolute;top:0;right:0}
  .mk-row{grid-template-columns:32px minmax(0,1fr) 64px auto;gap:10px;padding:10px 8px}.mk-stats b{font-size:14px}}
.mks-links{display:flex;flex-direction:column;gap:8px;margin-top:16px}.mk-go{display:flex;align-items:center;justify-content:center;gap:8px;text-decoration:none;width:100%}.mk-go svg{width:16px;height:16px}
.dn.neo{
  --acc:#6c59d1; --acc-t:#8f7dff; --acc-rgb:108,89,209; --acc2-rgb:236,72,140;
  --bg:#000; --surface:#0e0e0e; --surface-2:#161616; --hair:#1f1f1f; --line:#2a2a2a;
  --ink:#f2f2f2; --muted:#9a9aa2; --soft:#6d6d75;
  --gold:var(--acc-t); --gold-hi:var(--acc-t); --gold-wash:rgba(var(--acc-rgb),.16); --sel:var(--acc); --sel-ink:#fff; --gcol:var(--acc-t);
  --good:#56c596; --good-wash:rgba(86,197,150,.12); --warn:#e9cf7a; --late:#e9cf7a; --bad:#e0679e; --bad-wash:rgba(224,103,158,.12); --att:#3cc6c0;
  --m-hw:#ef9a58; --m-cw:#8cc4f0; --m-ctrl:#e57fa4; --m-lab:#a99bf5; --m-prac:#7dd3a8; --m-fin:#c3c9d4; --hw:#ef9a58; --cw:#8cc4f0;
  --glass:rgba(16,16,16,.74); --gline:#262626;
  --shadow:none;
  --math-t:#0c1d27; --math-c:#cdeafa; --math-d:#4fb0e6;
  --phys-t:#251019; --phys-c:#f6c9da; --phys-d:#e0679e;
  --inf-t:#0d1f17;  --inf-c:#c9efdc;  --inf-d:#56c596;
  --pe-t:#22200d;   --pe-c:#f3ebbf;   --pe-d:#d8c45a;
  --intro-t:#17142a;--intro-c:#ddd6ff;--intro-d:#9d8cff;
  --tec-t:#24180c;  --tec-c:#f6d9bd;  --tec-d:#e09a58;
  --lang-t:#221d0d; --lang-c:#f3e2b5; --lang-d:#d8b45a;
  --biz-t:#0b1f1f;  --biz-c:#c2eeec;  --biz-d:#3cc6c0;
  --oth-t:#181818;  --oth-c:#e2e2e6;  --oth-d:#a9abb5;
  --fh:DnHead,"Segoe UI",system-ui,sans-serif; --fb:DnBody,"Segoe UI",system-ui,sans-serif;
  font-family:var(--fb);color:var(--ink);
  background:
    radial-gradient(1000px 460px at 50% -180px,rgba(var(--acc-rgb),.40),rgba(var(--acc-rgb),.10) 50%,transparent 75%),
    radial-gradient(560px 300px at 82% -80px,rgba(var(--acc2-rgb),.24),transparent 70%),
    radial-gradient(420px 260px at 22% -60px,rgba(var(--acc-rgb),.22),transparent 70%),
    radial-gradient(640px 520px at 96% 38%,rgba(var(--acc2-rgb),.13),transparent 70%),
    radial-gradient(620px 560px at 4% 58%,rgba(var(--acc-rgb),.15),transparent 70%),
    radial-gradient(700px 520px at 88% 82%,rgba(var(--acc-rgb),.12),transparent 70%),
    radial-gradient(900px 420px at 40% calc(100% + 80px),rgba(var(--acc2-rgb),.18),rgba(var(--acc-rgb),.06) 50%,transparent 75%),
    url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='180' height='180'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E%3CfeColorMatrix values='0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 .07 0'/%3E%3C/filter%3E%3Crect width='180' height='180' filter='url(%23n)'/%3E%3C/svg%3E"),
    #000;
  background-repeat:no-repeat,no-repeat,no-repeat,no-repeat,no-repeat,no-repeat,no-repeat,repeat;min-height:100%;
}
.dn.neo[data-accent=amethyst]{--acc:#6c59d1;--acc-t:#8f7dff;--acc-rgb:108,89,209;--acc2-rgb:236,72,140}
.dn.neo[data-accent=sapphire]{--acc:#3b6fe0;--acc-t:#6f98ff;--acc-rgb:59,111,224;--acc2-rgb:20,190,230}
.dn.neo[data-accent=emerald]{--acc:#1d9e75;--acc-t:#4fd6a6;--acc-rgb:29,158,117;--acc2-rgb:60,200,90}
.dn.neo[data-accent=rose]{--acc:#d6437f;--acc-t:#ff79b0;--acc-rgb:214,67,127;--acc2-rgb:124,92,255}
.dn.neo[data-accent=gold]{--acc:#b8862e;--acc-t:#e8bf6a;--acc-rgb:184,134,46;--acc2-rgb:230,110,50}
.dn.neo[data-accent=graphite]{--acc:#5c5f68;--acc-t:#c9ccd4;--acc-rgb:140,145,158;--acc2-rgb:110,115,130}
.dn.neo .num,.dn.neo input,.dn.neo button,.dn.neo select,.dn.neo textarea{font-family:inherit}
.dn.neo .num{font-variant-numeric:tabular-nums}
.dn.neo :focus-visible{outline:none;box-shadow:0 0 0 2px var(--acc)}
.dn.neo .app{grid-template-columns:300px minmax(0,1fr)}
.dn.neo .side{background:#141414;border-right:1px solid #1c1c1c;padding:26px 20px 18px;gap:18px}
.dn.neo .brand b{font-family:var(--fh);font-weight:500;font-size:16px}
.dn.neo .brand span{color:#7a7a82}
.dn.neo .brand .mark{border-radius:50%;background:#0c0c0c;color:var(--acc-t);border:1.5px solid #2e2e2e}
.dn.neo .ngrp{font-weight:600;letter-spacing:.16em;color:#55555d;padding:18px 12px 6px}
.dn.neo .ngrp:first-child{padding-top:4px}
.dn.neo .ngrp:empty{border-top-color:#1f1f1f;padding:0;margin:14px 12px 8px}
.dn.neo .nav a,.dn.neo .classic{font-family:var(--fh);font-weight:400;font-size:14px;letter-spacing:.01em;color:#f2f2f2;border-radius:12px;padding:9px 12px;white-space:nowrap}
.dn.neo .nav a{background:none}
.dn.neo .nav a svg,.dn.neo .classic svg{color:#e6e6ea;width:20px;height:20px}
.dn.neo .nav a:hover{background:rgba(255,255,255,.03)}
.dn.neo .nav a[aria-current="page"],.dn.neo .nav a[aria-current="page"] svg{background:none;color:var(--acc-t)}
.dn.neo .nav a .bd{font-family:var(--fb);font-weight:700;background:#e0679e;color:#fff}
.dn.neo .nav a .nd{font-family:var(--fb);font-weight:700;background:var(--acc);color:#fff}
.dn.neo .classic{background:none;border:1.5px solid transparent;margin:0 -1.5px;transition:border-color .15s}
.dn.neo .classic:hover{border-color:#3a3a3a;background:none;color:#fff}
.dn.neo .me{border-radius:20px;border:1.5px solid #222;background:radial-gradient(120% 120% at 0% 0%,rgba(var(--acc-rgb),.14),transparent 60%),#0f0f0f;padding:12px;gap:12px}
.dn.neo .me .who{padding:4px;border-radius:14px}
.dn.neo .me .who.go{cursor:pointer;transition:background .15s}
.dn.neo .me .who.go:hover{background:rgba(255,255,255,.035)}
.dn.neo .me .who>div:not(.photo){flex:1;min-width:0}
.dn.neo .me .who b{font-family:var(--fh);font-weight:400;font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dn.neo .me .who span{font-size:12px;color:#7a7a82}
.dn.neo .me .who .chv{width:16px;height:16px;color:#6d6d75;transform:rotate(-90deg);flex:none}
.dn.neo .me .photo{width:42px;height:42px;box-shadow:0 0 0 2px #0f0f0f,0 0 0 3.5px var(--acc)}
.dn.neo .wallet{gap:8px}
.dn.neo .wallet div{border-radius:12px;background:rgba(255,255,255,.02);border:1px solid #232323;padding:7px 10px;font-weight:600}
.dn.neo .wallet small{color:#6d6d75}
.dn.neo .photo{background:linear-gradient(145deg,#1d1d22,#121214);color:#e6e6ea}
.dn.neo .photo .ini{font-family:var(--fh);font-weight:300;letter-spacing:.06em}
.dn.neo .main{padding:0 34px 48px}
.dn.neo .top{background:rgba(0,0,0,.3);-webkit-backdrop-filter:blur(18px);backdrop-filter:blur(18px);padding:28px 0 20px}
.dn.neo .top h1{font-family:var(--fh);font-weight:500;font-size:30px;letter-spacing:.01em;white-space:nowrap}
.dn.neo .top .cap{font-weight:600;letter-spacing:.16em;color:#6d6d75;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:48vw}
.dn.neo .iconbtn,.dn.neo .top-ava .photo{width:44px;height:44px;border-radius:50%;background:rgba(14,14,14,.6);border:1.5px solid #333;color:#f2f2f2}
.dn.neo .iconbtn:hover{border-color:#555}
.dn.neo .iconbtn.out:hover{border-color:#e0679e;color:#f39bbd}
.dn.neo .nowpill{height:44px;max-width:360px;white-space:nowrap;border-radius:999px;background:rgba(14,14,14,.6);border:1.5px solid #333;padding-inline:18px;color:#9a9aa2}
.dn.neo .sync.ok{color:var(--good)}
.dn.neo :is(.card,.gridwrap,.now,.m-hero,.hero.prof,.aday,article.hw){border-radius:26px;border:1.5px solid var(--gline);color:var(--ink);
  background:radial-gradient(90% 60% at 50% 0%,rgba(255,255,255,.025),transparent 70%),radial-gradient(45% 60% at 100% 0%,rgba(var(--acc-rgb),.06),transparent 70%),radial-gradient(60% 55% at 100% 100%,rgba(var(--acc-rgb),.05),transparent 70%),var(--glass);
  -webkit-backdrop-filter:blur(40px) saturate(130%);backdrop-filter:blur(40px) saturate(130%);box-shadow:inset 0 1px 0 rgba(255,255,255,.04)}
.dn.neo .card{padding:24px}
.dn.neo .gridwrap{padding:0;overflow:hidden}
.dn.neo article.hw{border-radius:22px}
.dn.neo .card>h2,.dn.neo .card .hd h2{font-family:var(--fh);font-weight:500;font-size:17px;letter-spacing:.01em}
.dn.neo .card .hd{border-bottom:0;padding-bottom:0;margin-bottom:18px;align-items:center}
.dn.neo .card .hd a,.dn.neo .link,.dn.neo .m-link{color:var(--acc-t);font-weight:500}
.dn.neo .card .hd a{font-size:12.5px}
.dn.neo .card .hd small{color:#6d6d75}
.dn.neo .row{gap:22px}
.dn.neo .li{border-top-color:#1c1c1c}
.dn.neo .note{color:#7a7a82}
.dn.neo .legend{color:#8a8a92;font-size:12.5px;gap:6px 16px}
.dn.neo .legend b{color:#e8e8ec;font-weight:500}
.dn.neo .legend i{width:8px;height:8px;border-radius:50%}
.dn.neo .restday{border-radius:18px;border-color:#262626;background:repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 2px,transparent 2px 10px)}
.dn.neo .pill{border:0;background:none;box-shadow:none;padding:0;gap:8px}
.dn.neo .pill button{border:1.5px solid #444;border-radius:999px;color:#d6d6da;font-weight:500;padding:6px 14px;background:none}
.dn.neo .pill button:hover{border-color:#777;color:#fff}
.dn.neo .pill button[aria-pressed="true"]{background:var(--acc);border-color:var(--acc);color:#fff}
.dn.neo .pill .lbl{border:1.5px solid #444;border-radius:999px;padding:6px 14px}
.dn.neo .pill .ar{border-radius:50%;width:36px;height:36px;padding:0;display:grid;place-items:center}
.dn.neo .m-btn{border-radius:999px;background:none;border:1.5px solid #444;padding:9px 18px;color:#f2f2f2}
.dn.neo .m-btn:hover{border-color:#777;transform:none}
.dn.neo .m-btn.pri{background:var(--acc);border-color:var(--acc);color:#fff}
.dn.neo .dd-btn{border-radius:999px;background:rgba(14,14,14,.6);border:1.5px solid #333;box-shadow:none}
.dn.neo .dd-menu,.dn.neo .dd-list{background:#121212!important;border:1.5px solid #2a2a2a!important;border-radius:18px!important;box-shadow:0 24px 60px -20px rgba(0,0,0,.9)!important}
.dn.neo :is(.sel,select.m-in,.m-in,.search){border-radius:16px;background:rgba(14,14,14,.6);border:1.5px solid #2e2e2e;box-shadow:none}
.dn.neo .m-in:focus{outline:none;border-color:var(--acc)}
.dn.neo label.sw{border-radius:16px;background:rgba(255,255,255,.02);border-color:#232323}
.dn.neo label.sw input:checked+.tr{background:var(--acc)}
.dn.neo .set-row{border-top-color:#1c1c1c}
.dn.neo .acc{border-radius:999px;border:1.5px solid #333;background:none}
.dn.neo .acc[aria-pressed="true"]{border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 18%,transparent)}
.dn.neo .tipb{border-color:#3a3a3a;color:#9a9aa2}
.dn.neo .newtag,.dn.neo .li.isnew b::after{background:rgba(86,197,150,.16)!important;color:#8fdcb8!important;border-radius:999px;text-transform:lowercase;letter-spacing:.02em;font-weight:600;box-shadow:inset 0 0 0 1px rgba(86,197,150,.35)}
.dn.neo .labtag{background:rgba(79,176,230,.14);color:#9fd2f2;border-radius:999px;text-transform:lowercase;letter-spacing:.02em;box-shadow:inset 0 0 0 1px rgba(79,176,230,.35)}
.dn.neo .labtag.rm{background:rgba(224,103,158,.16);color:#f3a9c8;box-shadow:inset 0 0 0 1px rgba(224,103,158,.38)}
.dn.neo .t .tag,.dn.neo .tag{background:none;color:#f2f2f2;padding:0;font-weight:500;font-size:14px;gap:10px}
.dn.neo .tag::before{width:7px;height:7px}
.dn.neo .mark5{display:inline-grid;place-items:center;line-height:1;font-weight:800;color:#121212;box-shadow:none}
.dn.neo .kpi .lab{font-weight:500;color:#c9c9ce;font-size:13.5px}
.dn.neo .kpi .lab svg{color:var(--acc-t)}
.dn.neo .kpi .val{font-family:var(--fh);font-weight:500;font-size:38px;letter-spacing:0}
.dn.neo .kpi .val small{font-family:var(--fb);font-size:15px;color:#6d6d75}
.dn.neo .kpi.att svg.ring2{width:76px;height:76px;filter:drop-shadow(0 0 8px rgba(86,197,150,.22))}
.dn.neo .kpi.att :is(.sub,.lab){padding-right:84px}
.dn.neo .meter{height:8px;border-radius:99px;background:#1a1a1a;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}
.dn.neo .meter i{border-radius:99px;background:linear-gradient(90deg,var(--acc),rgb(var(--acc2-rgb)))!important;box-shadow:0 0 14px -2px rgba(var(--acc-rgb),.7)}
.dn.neo .seg-bar{height:5px;gap:3px}
.dn.neo .seg-bar i{border-radius:99px;opacity:.85;background-image:linear-gradient(180deg,rgba(255,255,255,.18),rgba(255,255,255,0))}
.dn.neo .hero.nh{border-radius:26px;padding:30px 34px;min-height:236px;color:#fff;border:1.5px solid #2a2a2a;isolation:isolate;overflow:hidden}
.dn.neo .nh-morning{background:linear-gradient(180deg,#2b1a6e 0%,#8a3f9e 45%,#ff7a8f 78%,#ffc58a 100%)}
.dn.neo .nh-day{background:linear-gradient(180deg,#16307e 0%,#2c5fc4 42%,#5b9ae6 76%,#b9dafa 100%)}
.dn.neo .nh-evening{background:linear-gradient(180deg,#14092f 0%,#4a1672 40%,#c42f84 72%,#ff8a4c 100%)}
.dn.neo .nh-night{background:radial-gradient(60% 90% at 78% 30%,#241a66,transparent 70%),linear-gradient(180deg,#04040d 0%,#0b0c28 55%,#1a1446 100%)}
.dn.neo .nh-stars{position:absolute;inset:0;z-index:0;pointer-events:none;background-size:420px 220px;animation:nhtw 5s ease-in-out infinite;
  background-image:radial-gradient(1.2px 1.2px at 12% 18%,#fff,transparent),radial-gradient(1px 1px at 27% 62%,rgba(255,255,255,.8),transparent),radial-gradient(1.4px 1.4px at 41% 30%,#fff,transparent),radial-gradient(1px 1px at 55% 12%,rgba(255,255,255,.7),transparent),radial-gradient(1.3px 1.3px at 68% 48%,#fff,transparent),radial-gradient(1px 1px at 83% 22%,rgba(255,255,255,.8),transparent),radial-gradient(1.2px 1.2px at 92% 66%,#fff,transparent),radial-gradient(1px 1px at 6% 72%,rgba(255,255,255,.6),transparent),radial-gradient(1.1px 1.1px at 35% 84%,rgba(255,255,255,.6),transparent),radial-gradient(1px 1px at 76% 8%,#fff,transparent)}
.dn.neo .nh-art{position:absolute;top:0;right:0;bottom:0;left:auto;width:64%;height:100%;z-index:0;pointer-events:none}
.dn.neo .nh-land{position:absolute;left:0;right:0;bottom:0;width:100%;height:46%;z-index:0;pointer-events:none}
.dn.neo .nh-scrim{position:absolute;inset:0;z-index:0;pointer-events:none;background:linear-gradient(90deg,rgba(5,5,8,.8) 0%,rgba(5,5,8,.55) 34%,rgba(5,5,8,.08) 60%,transparent 74%)}
.dn.neo .hero.nh>*:not(.nh-art):not(.nh-land):not(.nh-scrim):not(.nh-stars){position:relative;z-index:2}
.dn.neo .hero.nh h2{font-family:var(--fh);font-weight:500;font-size:30px;letter-spacing:.01em;margin:8px 0 6px;text-shadow:0 2px 18px rgba(0,0,0,.35)}
.dn.neo .hero.nh .cap{font-weight:700;letter-spacing:.18em;font-size:11.5px}
.dn.neo .nh-morning .cap{color:#ffd29a}.dn.neo .nh-day .cap{color:#d8f0ff}.dn.neo .nh-evening .cap{color:#ffb38a}.dn.neo .nh-night .cap{color:#b9a8ff}
.dn.neo .hero.nh p{opacity:.9;max-width:56ch}
.dn.neo .hero.nh .photo.lg{width:78px;height:78px;box-shadow:0 0 0 3px rgba(5,5,8,.85),0 0 0 5px var(--ring,var(--acc-t))!important}
.dn.neo .nh-morning{--ring:#ffb38a}.dn.neo .nh-day{--ring:#b9dafa}.dn.neo .nh-evening{--ring:#ff7aa8}.dn.neo .nh-night{--ring:var(--acc-t)}
.dn.neo .hero.nh .facts span,.dn.neo .hero.nh .tmk{border:1.5px solid rgba(255,255,255,.22);background:rgba(8,8,12,.38);-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px);color:#fff}
.dn.neo .hero.nh .facts b{color:#fff!important}
.dn.neo .nh-art .nh-cl{animation:nhcl 40s ease-in-out infinite alternate}
.dn.neo .nh-art .nh-cl.b{animation-duration:56s;animation-direction:alternate-reverse}
.dn.neo .nh-art .nh-tw{animation:nhtw 3.4s ease-in-out infinite}
.dn.neo .nh-art .nh-au{animation:nhau 12s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
.dn.neo .nh-art .nh-glow{animation:nhgl 6s ease-in-out infinite alternate;transform-box:fill-box;transform-origin:center}
.dn.neo .nh-art .nh-birds{animation:nhbd 24s ease-in-out infinite alternate}
.dn.neo .nh-art .nh-shoot{animation:nhsh 9s ease-in infinite;opacity:0}
@keyframes nhcl{to{translate:40px 0}}
@keyframes nhtw{50%{opacity:.25}}
@keyframes nhau{to{opacity:.6;transform:translateY(8px) scaleX(1.08)}}
@keyframes nhgl{to{transform:scale(1.1);opacity:.8}}
@keyframes nhbd{to{translate:-50px -12px}}
@keyframes nhsh{0%,78%{opacity:0;translate:0 0}82%{opacity:1}100%{opacity:0;translate:-220px 110px}}
@media (prefers-reduced-motion:reduce){.dn.neo .hero.nh *{animation:none!important}}
.dn.neo .notes .card{border-radius:22px}
.dn.neo .notes .ic{border-radius:50%;background:rgba(var(--acc-rgb),.14);color:var(--acc-t)}
.dn.neo .lesson{border-radius:18px;background:rgba(255,255,255,.028);border:1px solid #262626;box-shadow:none;color:inherit}
.dn.neo .lesson .t{font-family:var(--fh);font-weight:400;font-size:14px;color:#f2f2f2;overflow-wrap:normal;hyphens:auto}
.dn.neo .lesson .t::before{width:7px;height:7px;background:var(--d)}
.dn.neo .lesson .tt,.dn.neo .lesson .tt b{color:#8a8a92}
.dn.neo .lesson .tt i{background:#3a3a40}
.dn.neo .lesson .r{color:#8a8a92;border-top:1px solid #1f1f1f}
.dn.neo .lesson .room{color:#d9d9de}
.dn.neo .lesson.past{opacity:.5}
.dn.neo .lesson.live{border-color:rgba(60,198,192,.55);background:linear-gradient(180deg,rgba(60,198,192,.07),rgba(60,198,192,.02)),rgba(255,255,255,.02);box-shadow:0 0 0 3px rgba(60,198,192,.07),0 18px 40px -26px rgba(60,198,192,.7)}
.dn.neo .lesson.live .t{color:#fff;font-weight:500}
.dn.neo .lesson.live::after{background:rgba(60,198,192,.14);color:#8fe3de;box-shadow:inset 0 0 0 1px rgba(60,198,192,.4);border-radius:999px;padding:3px 10px}
.dn.neo .lesson .p{background:linear-gradient(90deg,rgba(60,198,192,.9),rgba(60,198,192,.2));height:2px}
.dn.neo .lesson:hover{transform:translateY(-1px);border-color:#3a3a3a}
.dn.neo .lesson.dim{opacity:.15}
.dn.neo :is(.tl .tmc,.th) b{font-family:var(--fh);font-weight:500;font-size:14px}
.dn.neo :is(.tl .tmc,.th) .end{font-family:var(--fh);font-weight:400;font-size:13px;color:#6d6d75}
.dn.neo :is(.tl .tmc,.th) .cap{color:#6d6d75}
.dn.neo :is(.tmc,.th) .ln{background:#2a2a2a!important}
.dn.neo .gap{color:#6d6d75}
.dn.neo .gap::before,.dn.neo .gap::after{background:#222}
.dn.neo .td-list{display:flex;flex-direction:column;gap:2px;margin-top:18px}
.dn.neo .td-row{display:flex;align-items:flex-start;gap:14px;width:calc(100% + 24px);text-align:left;padding:10px 12px;margin:0 -12px;border:0;border-radius:14px;background:none;color:inherit;font:inherit;cursor:pointer;transition:background .15s;box-sizing:border-box}
.dn.neo .td-row:hover{background:#171717}
.dn.neo .td-ck{flex:none;width:20px;height:20px;margin-top:1px;border-radius:50%;border:1.5px solid #d9d9de;display:grid;place-items:center;color:#fff}
.dn.neo .td-ck svg{width:12px;height:12px;stroke-width:3}
.dn.neo .td-row.late .td-ck{border-color:var(--bad)}
.dn.neo .td-row.wait .td-ck{border-color:var(--warn);color:var(--warn)}
.dn.neo .td-row.done .td-ck{border-color:#8a8a92;color:#8a8a92}
.dn.neo .td-tx{min-width:0;display:flex;flex-direction:column;gap:5px}
.dn.neo .td-tx b{font-weight:500;font-size:14.5px;color:#f2f2f2;line-height:1.3}
.dn.neo .td-row.done .td-tx b{color:#6d6d75;text-decoration:line-through}
.dn.neo .td-tx>span{display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12.5px;color:#8a8a92}
.dn.neo .td-tag{padding:1px 9px;border-radius:999px;font-size:11px;font-weight:600;line-height:1.6}
.dn.neo .td-tag.g{background:rgba(86,197,150,.16);color:#8fdcb8;box-shadow:inset 0 0 0 1px rgba(86,197,150,.35)}
.dn.neo .td-tag.y{background:rgba(233,207,122,.14);color:#eedb9c;box-shadow:inset 0 0 0 1px rgba(233,207,122,.35)}
.dn.neo .td-tag.p{background:rgba(224,103,158,.16);color:#f3a9c8;box-shadow:inset 0 0 0 1px rgba(224,103,158,.38)}
.dn.neo .td-tag.c{background:rgba(79,176,230,.14);color:#9fd2f2;box-shadow:inset 0 0 0 1px rgba(79,176,230,.35)}
.dn.neo .td-foot{display:flex;flex-direction:column;gap:8px;margin-top:16px;padding-top:14px;border-top:1px solid #1c1c1c;font-size:12.5px;color:#8a8a92}
.dn.neo .td-foot span{display:flex;align-items:center;gap:8px}
.dn.neo .td-foot svg{width:15px;height:15px;color:#8a8a92}
.dn.neo .td-foot b{color:#d9d9de;font-weight:500}
.dn.neo .lb .li{border-top:0;border-radius:14px;padding:9px 12px;margin:0 -12px}
.dn.neo .lb .li:hover{background:#171717}
.dn.neo .lb .pos{background:none;color:#6d6d75;border-radius:50%}
.dn.neo .lb .li:nth-child(-n+3) .pos{background:none;color:#f2f2f2}
.dn.neo .lb .me-row{background:#1b1b1b;margin:0 -12px}
.dn.neo .lb .me-row .pos{background:var(--acc);color:#fff}
.dn.neo .lb .me-row b{color:#fff}
.dn.neo .track{height:6px;border-radius:99px;background:#1a1a1a}
.dn.neo .track i{border-radius:99px;background:linear-gradient(90deg,#3a3a40,#8a8a94)}
.dn.neo .lb .me-row .track i{background:linear-gradient(90deg,var(--acc),rgb(var(--acc2-rgb)));box-shadow:0 0 10px -2px rgba(var(--acc-rgb),.8)}
.dn.neo .li .amt{font-family:var(--fh);font-weight:500}
.dn.neo .now .subj{font-family:var(--fh);font-weight:500;font-size:26px}
.dn.neo .now .cd{border-left-color:#262626}
.dn.neo .now .cd b{font-family:var(--fh);font-weight:500;color:#fff}
.dn.neo .now .cap{color:var(--acc-t)}
.dn.neo .now .bar{background:#1c1c1c}.dn.neo .now .bar i{background:linear-gradient(90deg,var(--acc),rgb(var(--acc2-rgb)))}
.dn.neo .grid .dh{border-color:#1c1c1c}
.dn.neo .grid .dh .n{font-family:var(--fh);font-weight:500;font-size:14px}
.dn.neo .grid .dh.today .n{color:var(--acc-t)}
.dn.neo .grid .dh.today{box-shadow:inset 1.5px 0 0 rgba(var(--acc-rgb),.55),inset -1.5px 0 0 rgba(var(--acc-rgb),.55),inset 0 1.5px 0 rgba(var(--acc-rgb),.55);border-radius:0;background:linear-gradient(180deg,rgba(var(--acc-rgb),.12),transparent)}
.dn.neo .grid .dh.today::after{display:none}
.dn.neo .grid .dh.today .n::after{content:"сегодня";margin-left:8px;padding:2px 8px;border-radius:999px;font:600 10.5px var(--fb);letter-spacing:.04em;vertical-align:2px;background:rgba(var(--acc-rgb),.2);color:var(--acc-t)}
.dn.neo :is(.cell,.th){border-color:#181818!important}
.dn.neo .cell.today{background:none;box-shadow:inset 1.5px 0 0 rgba(var(--acc-rgb),.55),inset -1.5px 0 0 rgba(var(--acc-rgb),.55)}
.dn.neo .hatch{background:repeating-linear-gradient(135deg,rgba(255,255,255,.025) 0 2px,transparent 2px 9px)}
.dn.neo .days button{border-radius:18px;border:1.5px solid #333;background:transparent}
.dn.neo .days button[aria-pressed="true"]{background:var(--acc);color:#fff;border-color:var(--acc)}
.dn.neo .aday h3{font-family:var(--fh);font-weight:500}
.dn.neo .cal .c,.dn.neo .cal .c.has,.dn.neo .cal .c.lt,.dn.neo .cal .c.part{background:none;border:0;border-radius:12px;align-items:center;justify-content:center;gap:6px;color:#f2f2f2;padding:6px 2px}
.dn.neo .cal .c>.num{color:#f2f2f2;font-weight:500;font-size:15px}
.dn.neo .cal .c.part>.num{color:var(--bad)}
.dn.neo .cal .c:not(.has):not(.lt):not(.part)>.num{color:#5a5a62}
.dn.neo .cal .c:hover{background:#171717;filter:none}
.dn.neo .cal .c .bars{flex:none;gap:3px;justify-content:center}
.dn.neo .cal .c .bars i{flex:none;width:4px;height:4px;border-radius:50%}
.dn.neo .cal .c .bars i.u{background:#3a3a3a}.dn.neo .cal .c .bars i.p{box-shadow:none;background:var(--acc-t)}
.dn.neo .wkchart2 .wk-pc{font-family:var(--fh);font-weight:400}
.dn.neo .wkchart2 .tr{border-radius:14px;background:rgba(255,255,255,.025);box-shadow:inset 0 0 0 1px #1f1f1f}
.dn.neo .wkchart2 .tr i{border-radius:14px;opacity:.78;background:linear-gradient(180deg,color-mix(in srgb,var(--z) 85%,#fff),color-mix(in srgb,var(--z) 22%,transparent) 70%,transparent)!important;box-shadow:inset 0 1.5px 0 color-mix(in srgb,var(--z) 70%,#fff)}
.dn.neo .avgc .ln{stroke-width:2.6;filter:drop-shadow(0 3px 8px color-mix(in srgb,currentColor 55%,transparent))}
.dn.neo .avgc .gl{stroke:#1c1c1c}
.dn.neo .avgc>.legend{display:none}
.dn.neo .avg-kpis b{font-family:var(--fh);font-weight:500}
.dn.neo table th{letter-spacing:.01em;text-transform:none;font-size:13.5px;font-weight:500;color:#e6e6ea;border-bottom-color:#1f1f1f!important}
.dn.neo table td{border-color:transparent!important}
.dn.neo table tbody tr:hover td{background:#161616}
.dn.neo table tbody tr:hover td:first-child{border-radius:12px 0 0 12px}.dn.neo table tbody tr:hover td:last-child{border-radius:0 12px 12px 0}
.dn.neo .gpairs .hd{margin-bottom:14px}
.dn.neo .gtabs{gap:8px;margin-bottom:14px}
.dn.neo .gtabs button{border-radius:14px;border:1.5px solid #333;background:none;padding:6px 14px;align-items:flex-start}
.dn.neo .gtabs button b{font-weight:600;font-size:12.5px;color:#e6e6ea}
.dn.neo .gtabs button small{color:#6d6d75}
.dn.neo .gtabs button[aria-pressed=true]{background:var(--acc);border-color:var(--acc)}
.dn.neo .gtabs button[aria-pressed=true] :is(b,small){color:#fff}
.dn.neo .gfbar{display:flex;align-items:center;justify-content:space-between;gap:10px 16px;flex-wrap:wrap;padding:12px 0;border-top:1px solid #1c1c1c;border-bottom:1px solid #1c1c1c}
.dn.neo .gfbar .gleg{margin:0}
.dn.neo .gflt{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.dn.neo .gsum{margin:14px 0 4px;font-size:12.5px;color:#8a8a92}
.dn.neo .gsum b{color:#f2f2f2;font-weight:600}
.dn.neo .gday{grid-template-columns:88px minmax(0,1fr);gap:14px;padding:10px 0;border-top:1px solid #161616}
.dn.neo .gday:first-child{border-top:0}
.dn.neo .gday h4{font-family:var(--fh);font-weight:500;font-size:15px;color:#f2f2f2}
.dn.neo .gday h4 span{font-family:var(--fb);font-size:12px;color:#6d6d75;margin-top:2px}
.dn.neo .gday.td h4{color:var(--acc-t)}
.dn.neo .grow2{grid-template-columns:repeat(var(--slots),minmax(0,1fr));gap:10px}
.dn.neo .pc2{height:60px;border-radius:16px;background:rgba(255,255,255,.03);border:1px solid #242424;box-shadow:none;padding:0 12px 0 16px}
.dn.neo .pc2:hover{border-color:#3a3a3a;transform:translateY(-1px)}
.dn.neo .pc2 .pn{color:#6d6d75;font-size:11px}
.dn.neo .pc2 .ps{font-size:14px;color:#f2f2f2}
.dn.neo .pc2.x::before,.dn.neo .pc2.l::before{width:4px;border-radius:0 3px 3px 0;top:10px;bottom:10px}
.dn.neo .pc2.x{background:linear-gradient(90deg,rgba(224,103,158,.1),rgba(255,255,255,.02) 55%)}
.dn.neo .pc2.l{background:linear-gradient(90deg,rgba(233,207,122,.09),rgba(255,255,255,.02) 55%)}
.dn.neo .pc2.isnew{border-color:var(--acc);box-shadow:none}
.dn.neo .pc2 .pm{gap:6px}
.dn.neo .pc2 .pm .mark5{width:30px;height:30px;font-size:14px;box-shadow:0 0 0 2px #0e0e0e}
.dn.neo .gdots i.on{background:var(--acc)}
.dn.neo .les{border-radius:14px;background:rgba(255,255,255,.03);border-color:#242424}
.dn.neo .gbar{height:8px;background:#1a1a1a;box-shadow:inset 0 1px 2px rgba(0,0,0,.6)}
.dn.neo .gbar i{background:linear-gradient(90deg,var(--acc),rgb(var(--acc2-rgb)));box-shadow:0 0 14px -2px rgba(var(--acc-rgb),.7)}
.dn.neo .gbar em{background:#fff}
.dn.neo article.hw .top2>div>b{display:block;font-family:var(--fh);font-weight:400;font-size:15px;margin-bottom:6px}
.dn.neo article.hw .labtag,.dn.neo article.hw .newtag{display:inline-block;margin:2px 4px 2px 0}
.dn.neo article.hw.isnew{border-color:var(--acc);box-shadow:none}
.dn.neo .hw .submit{border-radius:999px;background:var(--acc);color:#fff}
.dn.neo .hw .wait{border-color:#3a3a3a}
.dn.neo .hint{border-radius:22px}
.dn.neo .m-hero b{font-family:var(--fh);font-weight:500}
.dn.neo .m-ic,.dn.neo .ver .ver-ic{border-radius:50%;background:transparent;color:#f2f2f2;box-shadow:inset 0 0 0 1.5px #333}
.dn.neo .mat .cnt{font-family:var(--fh);font-weight:400}
.dn.neo .mat>svg{color:var(--acc-t)}
.dn.neo .m-kv{border-top-color:#1c1c1c}
.dn.neo .hero.prof{color:#fff}
.dn.neo .hero.prof h2{font-family:var(--fh);font-weight:500}
.dn.neo .hero.prof .cap{color:var(--acc-t)}
.dn.neo .hero.prof .facts span{border:1.5px solid #333;background:none}
.dn.neo .photo.xl{box-shadow:0 0 0 3px #0e0e0e,0 0 0 5px var(--acc)}
.dn.neo .qa{border-top-color:#1c1c1c}
.dn.neo .qa summary{font-weight:500}
.dn.neo .qa[open] summary svg{color:var(--acc-t)}
.dn.neo .ver .grow b{font-family:var(--fh);font-weight:500}
.dn.neo .ver .cap{color:var(--acc-t)}
.dn.neo .ver .ver-new{border-top-color:#1c1c1c}
.dn.neo .rv{border-radius:22px}
.dn.neo .nw{border-radius:14px}
.dn.neo .ach .a{border-radius:20px;background:rgba(255,255,255,.025);border:1px solid #232323}
.dn.neo .ach .a .ic{border-radius:50%}
.dn.neo dialog{background:#0f0f0f;border:1.5px solid #2a2a2a;border-radius:26px;box-shadow:0 40px 120px -30px rgba(0,0,0,.95),0 0 0 1px rgba(255,255,255,.02)}
.dn.neo dialog::backdrop{background:rgba(0,0,0,.6);-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.dn.neo .dlg .dh2{background:radial-gradient(80% 140% at 0% 0%,color-mix(in srgb,var(--d,var(--acc)) 22%,transparent),transparent 70%)}
.dn.neo .dlg .dh2 h3{font-family:var(--fh);font-weight:500;color:#fff}
.dn.neo .dlg .x{border-radius:50%;border:1.5px solid #333;background:none;color:#e6e6ea}
.dn.neo .dlg dd{font-weight:500}
.dn.neo .toast{background:rgba(21,21,21,.96);color:#fff;border:1.5px solid #2a2a2a;border-radius:18px;max-width:min(420px,calc(100vw - 32px));white-space:pre-line;text-align:center;line-height:1.4;font-weight:500}
.dn.neo .mkt{--gold:var(--acc-t)}
.dn.neo .mk-main,.dn.neo .mk-list,.dn.neo .mk-fg{background:rgba(255,255,255,.025);border:1px solid #232323;border-radius:20px}
.dn.neo .mk-badge{border-radius:50%;background:rgba(var(--acc-rgb),.16);color:var(--acc-t)}
.dn.neo .mk-tt h2,.dn.neo .mk-big,.dn.neo .mks-price>b{font-family:var(--fh);font-weight:500}
.dn.neo .mk-lbl{color:var(--acc-t)}
.dn.neo .mk-row+.mk-row{box-shadow:0 -1px 0 #1c1c1c}
.dn.neo .mk-row:hover{background:#171717}
.dn.neo .mk-x{border-radius:50%;border:1.5px solid #333;background:none}
.dn.neo .mk-src,.dn.neo .mk-stats>div:not(.mk-sfoot),.dn.neo .mks-grid>div{background:rgba(255,255,255,.02);border-color:#232323}
.dn.neo .mkt::before{background:radial-gradient(circle,rgba(var(--acc-rgb),.18),transparent 65%)}
.dn.neo .pressing{box-shadow:0 0 0 2px rgba(var(--acc-rgb),.55)}
.dn.neo.lgn .lg-bg{overflow:hidden}
.dn.neo.lgn .lg-bg .nh-art{width:100%}
.dn.neo.lgn .lg-bg .nh-land{height:34%}
.dn.neo.lgn .lg-bg .nh-scrim{background:radial-gradient(60% 70% at 50% 50%,rgba(0,0,0,.55),transparent 80%)}
.dn.neo.lgn .lg-card{background:rgba(12,12,12,.72);border:1.5px solid rgba(255,255,255,.14);border-radius:30px;-webkit-backdrop-filter:blur(30px) saturate(130%);backdrop-filter:blur(30px) saturate(130%);box-shadow:0 40px 120px -30px rgba(0,0,0,.9)}
.dn.neo.lgn .lg-card h1{font-family:var(--fh);font-weight:500;letter-spacing:.01em}
.dn.neo.lgn .lg-brand b{font-family:var(--fh);font-weight:500}
.dn.neo.lgn .lg-brand .mark{border-radius:50%;background:#0c0c0c;color:var(--acc-t);border:1.5px solid #2e2e2e}
.dn.neo.lgn .lg-pw input,.dn.neo.lgn input{border-radius:16px;background:rgba(0,0,0,.45);border:1.5px solid #2e2e2e}
.dn.neo.lgn input:focus{border-color:var(--acc);outline:none}
.dn.neo.lgn .lg-go{background:var(--acc)!important;color:#fff;border-radius:999px}
.dn.neo.lgn a,.dn.neo.lgn .lg-links button{color:var(--acc-t)}
@media (max-width:980px){
  .dn.neo .app{grid-template-columns:minmax(0,1fr)}
  .dn.neo .side{border-right:0;border-bottom:1px solid #1c1c1c;padding:14px 12px 10px}
  .dn.neo .nav a{font-size:13.5px;padding:8px 12px;border-radius:999px}
  .dn.neo .nav a[aria-current="page"]{box-shadow:inset 0 0 0 1.5px var(--acc)}
  .dn.neo :is(.card,.gridwrap,.now,article.hw,.aday){-webkit-backdrop-filter:blur(14px);backdrop-filter:blur(14px)}
}
@media (max-width:760px){
  .dn.neo .gday{grid-template-columns:1fr;gap:8px}
  .dn.neo .grow2{grid-template-columns:1fr}
  .dn.neo .gfbar{flex-direction:column;align-items:flex-start}
}
@media (max-width:640px){
  .dn.neo .main{padding:0 12px 40px}
  .dn.neo .top h1{font-size:23px}
  .dn.neo .card{border-radius:24px;padding:18px}
  .dn.neo .hero.nh{padding:22px 20px;border-radius:24px;min-height:0}
  .dn.neo .nh-art{width:78%;opacity:.9}
  .dn.neo .nh-land{height:30%}
  .dn.neo .nh-scrim{background:linear-gradient(90deg,rgba(5,5,8,.82) 0%,rgba(5,5,8,.6) 55%,rgba(5,5,8,.25) 100%),linear-gradient(0deg,rgba(5,5,8,.6),transparent 60%)}
  .dn.neo .hero.nh h2{font-size:24px}
  .dn.neo .hero.nh .photo.lg{width:58px;height:58px}
  .dn.neo .kpi .val{font-size:30px}
}
@media (min-width:981px){.dn.neo .nav{-webkit-mask-image:linear-gradient(180deg,#000 calc(100% - 28px),transparent);mask-image:linear-gradient(180deg,#000 calc(100% - 28px),transparent)}
  .dn.neo .nav a{padding:8px 12px}}
.dn.neo .top{margin:0 -34px;padding:28px 34px 20px;max-width:none}
.dn.neo .top>div:first-child{min-width:0;flex:1}
.dn.neo .top h1{overflow:hidden;text-overflow:ellipsis}
.dn.neo .top .tools{flex:none}
.dn.neo .avgc .vl{paint-order:stroke;stroke:#0e0e0e;stroke-width:5px;stroke-linejoin:round;font-weight:700}
.dn.neo .r-7-5>.card:first-child{display:flex;flex-direction:column}
.dn.neo .dfoot{margin-top:auto;padding-top:16px;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:10px}
.dn.neo .dfoot>*{display:flex;align-items:center;gap:12px;padding:12px 14px;border-radius:18px;border:1px solid #232323;background:rgba(255,255,255,.02);color:inherit;font:inherit;text-align:left}
.dn.neo .dfoot>button{cursor:pointer;transition:border-color .15s}.dn.neo .dfoot>button:hover{border-color:rgba(var(--acc-rgb),.6)}
.dn.neo .dfoot>*>span{flex:none;width:36px;height:36px;border-radius:50%;display:grid;place-items:center;background:rgba(var(--acc-rgb),.14);color:var(--acc-t)}
.dn.neo .dfoot>*>span svg{width:18px;height:18px}
.dn.neo .dfoot b{display:block;font-weight:600;font-size:14px;color:#f2f2f2}
.dn.neo .dfoot small{display:block;font-size:12.5px;color:#8a8a92;margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.dn.neo .dfoot>*>div{min-width:0}
.dn.neo .r2>.card:has(.feedfit){display:flex;flex-direction:column}
.dn.neo .feedfit{flex:1;position:relative;min-height:240px}
.dn.neo .feedfit>.list{position:absolute;inset:0;overflow:hidden}
.dn.neo .feedfit+.legend{margin-top:0!important}
@media (max-width:760px){.dn.neo .feedfit{min-height:0}.dn.neo .feedfit>.list{position:static}}
.dn.neo .aday.today{border-color:rgba(var(--acc-rgb),.6);box-shadow:0 0 0 3px rgba(var(--acc-rgb),.08),0 20px 50px -30px rgba(var(--acc-rgb),.8)}
.dn.neo .aday.today h3{color:var(--acc-t)}
.dn.neo .aday.today h3::before{content:"Сегодня";order:-1;flex-basis:100%;font:600 11px var(--fb);letter-spacing:.14em;text-transform:uppercase;color:var(--acc-t);opacity:.85}
.dn.neo .aday h3{border-bottom-color:#1c1c1c}
.dn.neo .hatch{background:linear-gradient(180deg,rgba(255,255,255,.025),transparent 70%),repeating-linear-gradient(135deg,rgba(255,255,255,.035) 0 1px,transparent 1px 12px)!important;border-radius:16px;margin:6px}
.dn.neo .hatch span{background:#0e0e0e;border:1px solid #262626;color:#8a8a92;font-size:12px;letter-spacing:.06em;padding:8px 6px}
.dn.neo .hatch.wk{background:radial-gradient(80% 50% at 50% 50%,rgba(var(--acc-rgb),.08),transparent 75%),repeating-linear-gradient(135deg,rgba(255,255,255,.03) 0 1px,transparent 1px 12px)!important}
.dn.neo .gmonth{display:flex;flex-direction:column;gap:18px;margin-top:6px}
.dn.neo .gwk-h{display:flex;align-items:baseline;gap:12px;flex-wrap:wrap;padding:6px 0 8px;border-bottom:1px solid #1c1c1c;margin-bottom:4px}
.dn.neo .gwk-h>b{font-family:var(--fh);font-weight:500;font-size:14px;color:var(--acc-t)}
.dn.neo .gwk-h span{font-size:12.5px;color:#8a8a92}.dn.neo .gwk-h span b{color:#f2f2f2;font-weight:600}
.dn.neo .sum{background:radial-gradient(120% 60% at 100% 0%,rgba(var(--acc-rgb),.45),transparent 60%),radial-gradient(90% 50% at 0% 100%,rgba(var(--acc2-rgb),.18),transparent 70%),#0c0c0c;border:1.5px solid #2a2a2a;border-radius:28px;color:#f2f2f2}
.dn.neo .sum .orn{filter:none}
.dn.neo .sum .orn circle[r="60"],.dn.neo .sum .orn g[stroke]{stroke:var(--acc-t)}
.dn.neo .sum .orn rect{display:none}
.dn.neo .sum .orn path{fill:var(--acc)}
.dn.neo .sum .cap{color:var(--acc-t);font-weight:700;letter-spacing:.16em}
.dn.neo .sum h3{font-family:var(--fh);font-weight:500;letter-spacing:0}
.dn.neo .sum .grad{background:linear-gradient(90deg,var(--acc-t),rgb(var(--acc2-rgb)));-webkit-background-clip:text;background-clip:text;color:transparent}
.dn.neo .sum .hero-n b{font-family:var(--fh);font-weight:500}
.dn.neo .sum .hero-n em{color:var(--good)}
.dn.neo .sum .st{background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.08);border-radius:18px}
.dn.neo .sum .st>b{font-family:var(--fh);font-weight:500}
.dn.neo .sum .st .em svg{color:var(--acc-t)}
.dn.neo .sum .heat i{border-radius:8px}
.dn.neo .sum .heat i.l,.dn.neo .sum .hl i.l{background:color-mix(in srgb,var(--late) 85%,transparent)}
.dn.neo .sum .x{border-radius:50%;background:rgba(0,0,0,.35);border:1.5px solid rgba(255,255,255,.2)}
.dn.neo .sum-nav button{border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.1)}
.dn.neo .sum-dl{border-radius:999px;background:var(--acc);border-color:var(--acc);color:#fff;font-weight:600}
.dn.neo .sum-dl:hover{filter:brightness(1.1);background:var(--acc)}
@media (hover:none),(max-width:980px){
  .dn.neo :is(.card,.gridwrap,.now,.m-hero,.hero.prof,.aday,article.hw,.top){-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
  .dn.neo :is(.card,.gridwrap,.now,.m-hero,.hero.prof,.aday,article.hw){background:radial-gradient(90% 60% at 50% 0%,rgba(255,255,255,.03),transparent 70%),rgba(16,16,16,.9)}
  .dn.neo .top{background:linear-gradient(180deg,rgba(0,0,0,.92),rgba(0,0,0,.78))}
  .dn.neo .hero.nh :is(.facts span,.tmk){-webkit-backdrop-filter:none;backdrop-filter:none;background:rgba(8,8,12,.6)}
}
@media (max-width:640px){
  .dn.neo .top{margin:0;padding:16px 0 12px!important;gap:10px}
  .dn.neo .top h1{font-size:22px}
  .dn.neo .iconbtn,.dn.neo .top-ava .photo{width:40px;height:40px}
  .dn.neo .tools{gap:6px}
  .dn.neo .dfoot{grid-template-columns:1fr}
}
.dn.neo .cell.today.lr{box-shadow:inset 1.5px 0 0 rgba(var(--acc-rgb),.55),inset -1.5px 0 0 rgba(var(--acc-rgb),.55),inset 0 -1.5px 0 rgba(var(--acc-rgb),.55)}
.dn.neo .hatch span{background:none;border:0;color:#5a5a62;letter-spacing:.2em;text-transform:uppercase;font-size:11px;font-weight:600}
.dn.neo .pc0{grid-column:var(--col);height:60px;border-radius:16px;border:1.5px dashed #262626;display:flex;flex-direction:column;justify-content:center;padding:0 16px;font-size:12.5px;color:#55555d}
.dn.neo .pc0 span{font-size:11px;color:#45454c;margin-bottom:2px}
.dn.neo .gpager{transition:none}
@media (max-width:760px){.dn.neo .pc0{grid-column:auto;height:44px;flex-direction:row;align-items:center;gap:8px}}
.dn.neo .mtiles{display:flex;flex-wrap:wrap;gap:12px;margin-top:16px;align-items:stretch}
.dn.neo .mt-wk{flex-basis:100%;display:flex;align-items:center;gap:12px;font-size:11.5px;letter-spacing:.12em;text-transform:uppercase;color:#6d6d75;margin-top:6px}
.dn.neo .mt-wk:first-child{margin-top:0}
.dn.neo .mt-wk::after{content:"";flex:1;height:1px;background:#1f1f1f}
.dn.neo .mt-wk b{font-weight:600}
.dn.neo .mday{display:flex;flex-direction:column;gap:10px;padding:10px;border-radius:20px;border:1px solid #1f1f1f;background:rgba(255,255,255,.015)}
.dn.neo .mday.td{border-color:rgba(var(--acc-rgb),.5);background:rgba(var(--acc-rgb),.05)}
.dn.neo .mday-h{display:flex;align-items:baseline;gap:6px;padding:0 4px;flex-wrap:wrap}
.dn.neo .mday-h b{font-family:var(--fh);font-weight:500;font-size:13.5px;color:#f2f2f2}
.dn.neo .mday-h span{font-size:12px;color:#8a8a92}
.dn.neo .mday-h small{margin-left:auto;font-size:11.5px;color:#6d6d75}
.dn.neo .mday.td .mday-h b{color:var(--acc-t)}
.dn.neo .mday-l{display:flex;gap:6px}
.dn.neo .mt{position:relative;width:88px;display:flex;flex-direction:column;align-items:center;gap:4px;padding:9px 6px 10px;border-radius:14px;background:rgba(255,255,255,.035);border:1px solid #262626;color:inherit;font:inherit;cursor:pointer;transition:border-color .15s,transform .15s,opacity .2s}
.dn.neo .mt:hover{border-color:#3a3a3a;transform:translateY(-1px)}
.dn.neo .mt-t{font-size:10.5px;color:#6d6d75}
.dn.neo .mt>b{font-family:var(--fh);font-weight:500;font-size:20px;line-height:1.1;color:#f2f2f2}
.dn.neo .mt-s{max-width:100%;display:flex;align-items:center;gap:4px;font-size:10.5px;color:#9a9aa2;white-space:nowrap;overflow:hidden}
.dn.neo .mt-s>span{min-width:0;overflow:hidden;text-overflow:ellipsis}
.dn.neo .mt-s i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--d)}
.dn.neo .mt-m{display:flex;gap:3px;margin-top:auto;min-height:22px;align-items:center}
.dn.neo .mt-m .mark5{width:22px;height:22px;font-size:12px}
.dn.neo .mt-0{width:14px;height:2px;border-radius:2px;background:#2e2e2e}
.dn.neo .mt .st{position:absolute;top:6px;right:6px;font-style:normal;padding:1px 6px;border-radius:6px;font-size:10px;font-weight:800;line-height:1.5}
.dn.neo .mt .st.x{background:rgba(224,103,158,.2);color:#f3a9c8}
.dn.neo .mt .st.l{background:rgba(233,207,122,.18);color:#eedb9c}
.dn.neo .mt.x{border-color:rgba(224,103,158,.5);background:linear-gradient(180deg,rgba(224,103,158,.09),rgba(255,255,255,.02))}
.dn.neo .mt.x>b{color:#f3a9c8}
.dn.neo .mt.l{border-color:rgba(233,207,122,.45)}
.dn.neo .mt.isnew{box-shadow:0 0 0 1.5px var(--acc)}
.dn.neo .mt.dim{opacity:.18}
@media (max-width:640px){
  .dn.neo .mtiles{flex-direction:column;flex-wrap:nowrap;gap:10px}
  .dn.neo .mday{padding:10px}
  .dn.neo .mday-l{display:grid;grid-template-columns:repeat(auto-fill,minmax(56px,1fr));gap:6px}
  .dn.neo .mt{width:auto;padding:8px 4px 9px}
  .dn.neo .mt>b{font-size:18px}
  .dn.neo .mt-s{font-size:10px}
  .dn.neo .mt .st{top:4px;right:4px;padding:0 5px}
  .dn.neo .mt-m .mark5{width:20px;height:20px;font-size:11px}
}
.dn.neo .calnav{display:flex;gap:6px}
.dn.neo .hc-ar{width:32px;height:32px;border-radius:50%;border:1.5px solid #333;background:none;color:#e6e6ea;font-size:17px;line-height:1;cursor:pointer;display:grid;place-items:center}
.dn.neo .hc-ar:hover:not(:disabled){border-color:var(--acc)}
.dn.neo .hc-ar:disabled{opacity:.3;cursor:default}
@media (max-width:760px){.dn.neo .pc0{height:42px;flex-direction:row;align-items:center;justify-content:flex-start;gap:10px;padding:0 16px}.dn.neo .pc0 span{margin:0}}
.dn.neo :is(.card,.gridwrap):has(.dd.open){z-index:40;position:relative}
.dn.neo .goals .goal .hd .dd-list,.dn.neo .hd .dd:last-child .dd-list{left:auto;right:0}
.dn.neo .dd-list{background:#121212;border:1.5px solid #2a2a2a;border-radius:18px;box-shadow:0 24px 60px -20px rgba(0,0,0,.95);padding:6px}
.dn.neo .gin{border:1.5px solid #333;background:none}
.dn.neo .gin:focus-within{border-color:var(--acc);box-shadow:0 0 0 3px rgba(var(--acc-rgb),.18)}
.dn.neo .gin input:focus,.dn.neo .gin input:focus-visible{box-shadow:none!important;outline:none!important}
.dn.neo .gopt button:focus-visible{box-shadow:0 0 0 2px var(--acc);border-radius:999px}
.dn.neo .hw .hwact .submit,.dn.neo .hw .hwact .submit svg,.dn.neo .m-btn.pri svg{color:#fff}
.dn.neo .gpager{align-items:flex-start}
.dn.neo .mt.u{border:1.5px dashed #2e2e2e;background:none;cursor:default}
.dn.neo .mt.u>b{color:#45454c}.dn.neo .mt.u .mt-s{color:#6d6d75}
.dn.neo .mt-nm{font-size:9.5px;color:#55555d;white-space:nowrap}
.dn.neo .pc0.u{border-color:#2e2e2e;color:#8a8a92}.dn.neo .pc0.u b{color:#d6d6da;font-weight:500}
.dn.neo .pc0.u span{color:#6d6d75}
.dn.neo .mt .st2{display:none;min-width:22px;height:22px;border-radius:50%;place-items:center;font-size:11px;font-weight:800}
.dn.neo .mt .st2.x{background:rgba(224,103,158,.18);color:#f3a9c8;box-shadow:inset 0 0 0 1px rgba(224,103,158,.45)}
.dn.neo .mt .st2.l{background:rgba(233,207,122,.16);color:#eedb9c;box-shadow:inset 0 0 0 1px rgba(233,207,122,.45)}
@media (max-width:640px){.dn.neo .mt em.st{display:none}.dn.neo .mt .st2{display:inline-grid;width:20px;height:20px;min-width:20px}}
.dn.neo .cal .c .bars i.p{background:#3a3a3a}
.dn.neo :is(.tmc,.th) b{font-family:var(--fh);font-weight:500;color:#f2f2f2}
.dn.neo :is(.tmc,.th) .end{font-family:var(--fh);font-weight:400;color:#6d6d75!important}
.dn.neo .hero.nh .photo.lg{box-shadow:0 0 0 3px rgba(5,5,8,.85),0 0 0 5px var(--acc-t)!important}
.dn.neo :is(.mkt,.mks,.dlg .dh2){-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}
.dn.neo .mks .mk-chart{touch-action:none}
.dn.neo .sum .stat{grid-template-columns:repeat(2,minmax(0,1fr))}
.dn.neo .sum .st{min-width:0;overflow-wrap:anywhere}
.dn.neo .sum .heat{grid-template-columns:repeat(7,minmax(0,1fr));max-width:280px}
@media (max-width:560px){#dlg.sumd{max-width:calc(100vw - 16px)!important}.dn.neo .sum{padding:20px 16px 16px}.dn.neo .sum h3{font-size:28px}.dn.neo .sum .hero-n b{font-size:46px}.dn.neo .sum .st>b{font-size:22px}.dn.neo .sum .st>b.sm{font-size:15px}}
@media (max-width:980px){.dn.neo .ngrp{display:block!important;flex:none;align-self:center;width:1px;height:22px;padding:0!important;margin:0 8px!important;border:0!important;background:#2e2e2e;font-size:0;overflow:hidden}
  .dn.neo .ngrp:first-child{display:none!important}}
.dn.neo{--m-hw:#f2873a;--hw:#f2873a}
.dn.neo .ghint{display:block;margin:14px 0 0;font-size:13px;color:#8a8a92}.dn.neo .ghint b{color:#f2f2f2}
.dn.neo .sum .st{overflow-wrap:normal}
.dn.neo .sum .st>b{flex-wrap:wrap;column-gap:8px;row-gap:2px}
@media (max-width:560px){.dn.neo .sum .st>b{font-size:20px}}
.dn.neo .top{background:linear-gradient(180deg,rgba(0,0,0,.55),rgba(0,0,0,0))!important;-webkit-mask-image:linear-gradient(180deg,#000 60%,transparent);mask-image:linear-gradient(180deg,#000 60%,transparent)}
@media (hover:none),(max-width:980px){.dn.neo .top{-webkit-mask-image:none;mask-image:none}}
.dn.neo .main{isolation:isolate}
.dn.neo .main::before{content:"";position:absolute;left:0;right:0;top:0;height:1100px;z-index:-1;pointer-events:none;
  background:linear-gradient(112deg,transparent 30%,rgba(var(--acc-rgb),.09) 42%,rgba(var(--acc2-rgb),.07) 50%,transparent 62%),linear-gradient(112deg,transparent 55%,rgba(var(--acc-rgb),.05) 62%,transparent 70%);
  -webkit-mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.6) 45%,transparent 100%);mask-image:linear-gradient(180deg,#000 0%,rgba(0,0,0,.6) 45%,transparent 100%);filter:blur(10px)}
.dn.neo .dfoot>*{min-width:0;overflow:hidden}
.dn.neo .card,.dn.neo .card>*{min-width:0}
.dn.neo .hero-id{min-width:0}.dn.neo .hero-id>div:not(.photo){min-width:0;flex:1}
.dn.neo .hero.prof :is(h2,.cap){overflow-wrap:break-word}
.dn.neo .hero .facts{min-width:0}.dn.neo .hero .facts span{max-width:100%}
.dn.neo table td,.dn.neo table th{overflow-wrap:normal;word-break:normal}
.dn.neo table .num{white-space:nowrap}
.dn.neo .tscroll{overflow-x:auto;-webkit-overflow-scrolling:touch}
@media (max-width:640px){
  .dn.neo .tscroll table{font-size:13px}.dn.neo .tscroll table :is(td,th){padding-left:6px!important;padding-right:6px!important}
  .dn.neo .tscroll table td:first-child,.dn.neo .tscroll table th:first-child{padding-left:0!important}
  .dn.neo .tscroll .tag{white-space:normal;line-height:1.25}
  .dn.neo .hero.prof .hero-id{flex-direction:column;text-align:center;gap:14px}
  .dn.neo .hero.prof h2{font-size:24px;line-height:1.15}
  .dn.neo .hero.prof .facts{justify-content:center}
  .dn.neo .hint{flex-direction:column;align-items:center;text-align:center;gap:10px}
  .dn.neo .hint>div{min-width:0;width:100%}
  .dn.neo .hint .m-btn{align-self:center}
  .dn.neo .m-kv{grid-template-columns:110px minmax(0,1fr)}
}
@media (max-width:640px){.dn.neo .m-t td:first-child,.dn.neo .m-t td:last-child,.dn.neo .m-t th{white-space:nowrap}.dn.neo .m-t td:nth-child(2){min-width:140px}}
.dn.neo th .sh{display:none}@media (max-width:640px){.dn.neo th .lg{display:none}.dn.neo th .sh{display:inline}}
.dn.neo .notes{grid-template-columns:repeat(auto-fit,minmax(min(100%,360px),1fr))}
.dn.neo .notes>.card:last-child:nth-child(odd):not(:first-child){grid-column:1/-1}
.dn.neo .notes>.card{align-items:center}
.dn.neo .notes>.card>*{align-self:center;margin-block:0}
.dn.neo .bd-conf{left:auto;right:0;width:36%}
.dn.neo .bd-tx{max-width:62%}
@media (max-width:560px){.dn.neo .bd-conf{width:48%;height:46%;opacity:.6}.dn.neo .bd-tx{max-width:none}}
.dn.neo .nav a>span:not(.bd):not(.nd){flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;letter-spacing:-.015em}
.dn.neo .nav a :is(.bd,.nd){flex:none;min-width:20px;padding:0 5px;width:auto;margin-left:4px}
.dn.neo .rv{position:relative}
.dn.neo .rv>.newtag{position:absolute;top:16px;right:16px;margin:0}
.dn.neo .rv.isnew{border-color:var(--acc)!important;box-shadow:none!important}
.dn.neo article.hw .top2 b{display:inline}
.dn.neo article.hw .top2 .newtag{margin:0 0 0 6px;vertical-align:2px}
@media (min-width:981px){.dn.neo .side{padding-inline:14px}.dn.neo .nav a{padding-inline:10px;gap:10px}}
:host([data-lite]) .dn *,:host([data-lite]) .dn *::before,:host([data-lite]) .dn *::after{-webkit-backdrop-filter:none!important;backdrop-filter:none!important}
:host([data-lite]) .dn.neo :is(.card,.gridwrap,.now,article.hw,.aday){background-color:#121212}
:host([data-lite]) .dn.neo .top{background:#080808}
:host([data-lite]) .dn .hero.nh *,:host([data-lite]) .dn .bd-conf *{animation:none!important}
:host([data-lite]) .dn dialog::backdrop{background:rgba(0,0,0,.82)}
.dn:not([data-mc=true]) .coin,.dn:not([data-mc=true]) .gem{border-radius:0;box-shadow:none;clip-path:none;background:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iI0ZGQjU0NyIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjM5IiBmaWxsPSIjRkY5NTAwIi8+PGcgZmlsbD0iI0ZGQzQ2QiI+PHBhdGggZD0iTTQyIDIyaDE0djM1YzAgNCAyIDYgNiA2aDZ2MTJoLTljLTExIDAtMTctNi0xNy0xN3oiLz48cmVjdCB4PSIzMiIgeT0iMzYiIHdpZHRoPSIzNCIgaGVpZ2h0PSIxMiIgcng9IjQiLz48L2c+PC9zdmc+) center/contain no-repeat}
.dn:not([data-mc=true]) .gem{background-image:url(data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxMDAgMTAwIj48Y2lyY2xlIGN4PSI1MCIgY3k9IjUwIiByPSI1MCIgZmlsbD0iIzBCM0YwQiIvPjxjaXJjbGUgY3g9IjUwIiBjeT0iNTAiIHI9IjQyIiBmaWxsPSIjMkE3QTAwIi8+PHBvbHlnb24gcG9pbnRzPSI1MC4wLDI5LjAgNTAuMCw4LjAgODIuOCwyMy44IDY2LjQsMzYuOSIgZmlsbD0iIzdDQzgwMCIvPjxwb2x5Z29uIHBvaW50cz0iNjYuNCwzNi45IDgyLjgsMjMuOCA5MC45LDU5LjMgNzAuNSw1NC43IiBmaWxsPSIjNUVBRDAwIi8+PHBvbHlnb24gcG9pbnRzPSI3MC41LDU0LjcgOTAuOSw1OS4zIDY4LjIsODcuOCA1OS4xLDY4LjkiIGZpbGw9IiMzRTkyMDAiLz48cG9seWdvbiBwb2ludHM9IjU5LjEsNjguOSA2OC4yLDg3LjggMzEuOCw4Ny44IDQwLjksNjguOSIgZmlsbD0iIzJBN0EwMCIvPjxwb2x5Z29uIHBvaW50cz0iNDAuOSw2OC45IDMxLjgsODcuOCA5LjEsNTkuMyAyOS41LDU0LjciIGZpbGw9IiMxRjZCMDAiLz48cG9seWdvbiBwb2ludHM9IjI5LjUsNTQuNyA5LjEsNTkuMyAxNy4yLDIzLjggMzMuNiwzNi45IiBmaWxsPSIjM0U5MjAwIi8+PHBvbHlnb24gcG9pbnRzPSIzMy42LDM2LjkgMTcuMiwyMy44IDUwLjAsOC4wIDUwLjAsMjkuMCIgZmlsbD0iIzZCQkEwMCIvPjxwb2x5Z29uIHBvaW50cz0iNTAuMCwyOS4wIDY2LjQsMzYuOSA3MC41LDU0LjcgNTkuMSw2OC45IDQwLjksNjguOSAyOS41LDU0LjcgMzMuNiwzNi45IiBmaWxsPSIjOTRFMDAwIi8+PC9zdmc+)}
`;
  const IC = {
    home: '<path d="M3 10.5 12 3l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>',
    cal: '<rect x="3" y="5" width="18" height="16" rx="2.5"/><path d="M3 10h18M8 3v4M16 3v4"/>',
    grade: '<path d="M5 20V11M12 20V5M19 20v-6M3 20h18"/>',
    hw: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M9 14.5l2 2 4-4"/>',
    trophy:
      '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
    bell: '<path d="M6 9a6 6 0 0 1 12 0c0 6 3 8 3 8H3s3-2 3-8M10 20.5a2 2 0 0 0 4 0"/>',
    quote:
      '<path d="M20 15a2 2 0 0 1-2 2H8l-5 4V6a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z"/><path d="M8 9h8M8 12.5h5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    flame:
      '<path d="M12 3c.5 3.5 5 5.5 5 10.5a5 5 0 0 1-10 0c0-2.5 1.5-3.5 2-6 1.5 1 2 2.5 2 2.5s1.5-3 1-7z"/>',
    check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
    users:
      '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0M16 4.5a3.5 3.5 0 0 1 0 7M18 14a6 6 0 0 1 3.5 6"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    star: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/>',
    shirt: '<path d="M8 3 3 6l2 4 2-1v12h10V9l2 1 2-4-5-3a4 4 0 0 1-8 0z"/>',
    poll: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="M8 8h8M8 12h8M8 16h5"/>',
    medal:
      '<circle cx="12" cy="15" r="6"/><path d="M8.5 3h7l-2 7h-3zM12 12.5l.9 1.8 2 .3-1.4 1.4.3 2-1.8-1-1.8 1 .3-2-1.4-1.4 2-.3z"/>',
    mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3.5 6 8.5 7 8.5-7"/>',
    profile: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    timer: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2M9 2h6"/>',
    ext: '<path d="M14 4h6v6M20 4l-8 8M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    download: '<path d="M12 4v11M7 10l5 5 5-5M5 20h14"/>',
    hand: '<path d="M8 13V5.5a1.5 1.5 0 0 1 3 0V12M11 11.5v-2a1.5 1.5 0 0 1 3 0V12M14 10.5a1.5 1.5 0 0 1 3 0V12M17 11.5a1.5 1.5 0 0 1 3 0V16a6 6 0 0 1-6 6h-2a6 6 0 0 1-5-2.7L4.3 15.5a1.6 1.6 0 0 1 2.6-1.8L8 15"/>',
    trend: '<path d="M4 17l5-5 4 3 7-8"/><path d="M15 7h5v5"/>',
    refresh: '<path d="M20 11a8 8 0 0 0-14.7-4.4L4 8M4 4v4h4M4 13a8 8 0 0 0 14.7 4.4L20 16M20 20v-4h-4"/>',
    bug: '<rect x="7" y="8" width="10" height="12" rx="5"/><path d="M9 8V6a3 3 0 0 1 6 0v2M3 13h4M17 13h4M4 19l3-2M20 19l-3-2M4 7l3 2M20 7l-3 2"/>',
    book: '<path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2zM4 21a2 2 0 0 1 2-2h13"/><path d="M8 7h7M8 11h5"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3 10h18M7 15h4"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/>',
    pin: '<path d="M12 21s7-6.3 7-12a7 7 0 0 0-14 0c0 5.7 7 12 7 12z"/><circle cx="12" cy="9" r="2.5"/>',
    chat: '<path d="M4 5h16v11H9l-5 4z"/><path d="M8 9h8M8 12.5h5"/>',
    alert: '<path d="M12 3 2.5 20h19z"/><path d="M12 10v4.5M12 17.5h.01"/>',
    bag: '<path d="M5 8h14l-1 13H6zM9 8V6a3 3 0 0 1 6 0v2"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 0 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 0 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 0 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 0 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
    upload: '<path d="M12 16V4M7 9l5-5 5 5M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    play: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M10 9.5v5l4.5-2.5z"/>',
    chev: '<path d="M6 9l6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    send: '<path d="M21 3 10 14M21 3l-7 18-4-7-7-4z"/>',
  };
  const ic = (k, cls = "i") =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${IC[k] || ""}</svg>`;
  const ACH = [
    { t: "5 посещений подряд без пропусков", r: 1, goal: 5, kind: "streak", ic: "check" },
    { t: "10 посещений подряд без пропусков", r: 2, goal: 10, kind: "streak", ic: "check" },
    { t: "20 посещений подряд без пропусков", r: 5, goal: 20, kind: "streak", ic: "check" },
    { t: "5 посещений подряд без опозданий", r: 1, goal: 5, kind: "late", ic: "timer" },
    { t: "10 посещений подряд без опозданий", r: 2, goal: 10, kind: "late", ic: "timer" },
    { t: "20 посещений подряд без опозданий", r: 5, goal: 20, kind: "late", ic: "timer" },
    { t: "Полностью заполненный профиль", r: 5, kind: "profile", ic: "profile" },
    { t: "Привёл друга учиться", r: 10, rx: /друг/i, ic: "users" },
    { t: "Посещение академии в футболке с логотипом", r: 1, rx: /футболк/i, ic: "shirt" },
    { t: "Участие в опросе", r: 20, rx: /опрос/i, ic: "poll" },
    { t: "Участие в конкурсе", r: "1 - 100", rx: /конкурс/i, ic: "medal" },
    { t: "Подтверждение электронной почты", r: 3, kind: "mail", ic: "mail" },
    { t: "Отзыв", r: 20, rx: /отзыв/i, ic: "star" },
  ];
  let host,
    R,
    page = sessionStorage.getItem("dn2.page") || "home";
  if (page === "requests" || page === "complaints") page = "home";
  let sc = { view: LS.get("view", "week"), mon: null, day: 0 };
  let gf = { mode: "all", subj: "" },
    nf = "all",
    hwq = "",
    faqq = "";
  let readSet = new Set(LS.get("read", []));
  let syncState = SEEDED ? "seed" : "cache";

  const unread = () => (M.news || []).filter((n) => !n.read && !readSet.has(n.id)).length;
  const PAGES = [
    { id: "home", n: "Главная", ic: "home", g: "Учёба" },
    { id: "schedule", n: "Расписание", ic: "cal", g: "Учёба" },
    { id: "grades", n: "Оценки", ic: "grade", g: "Учёба" },
    { id: "homework", n: "Домашние задания", ic: "hw", g: "Учёба" },
    {
      id: "materials",
      n: "Учебные материалы",
      ic: "book",
      g: "Учёба",
      classic: "Учебные материалы",
      d: "Уроки, библиотека, видео, статьи и тесты от преподавателей",
    },
    { id: "awards", n: "Награды", ic: "trophy", g: "Активность" },
    { id: "news", n: "Объявления", ic: "bell", g: "Активность" },
    { id: "reviews", n: "Отзывы", ic: "quote", g: "Активность" },
    {
      id: "market",
      n: "Маркет",
      ic: "bag",
      g: "Активность",
      classic: "Маркет",
      d: "Товары за монеты и гемы",
    },
    {
      id: "payment",
      n: "Оплата",
      ic: "card",
      g: "Сервис",
      classic: "Оплата",
      d: "Реквизиты, график и история платежей",
    },
    {
      id: "profile",
      n: "Личный кабинет",
      ic: "profile",
      g: "Сервис",
      classic: "Личный кабинет",
      d: "Фото, контакты и смена пароля",
    },
    {
      id: "requests",
      n: "Обращения",
      ic: "chat",
      g: "Сервис",
      classic: "Обращения",
      d: "Вопросы в учебную часть и их статус",
    },
    {
      id: "complaints",
      n: "Жалобы",
      ic: "alert",
      g: "Сервис",
      classic: "Жалобы",
      d: "Жалоба генеральному директору",
    },
    {
      id: "faq",
      n: "Вопросы и ответы",
      ic: "help",
      g: "Сервис",
      classic: "F.A.Q.",
      d: "Частые вопросы о журнале, оплате и наградах",
    },
    {
      id: "contacts",
      n: "Контакты",
      ic: "pin",
      g: "Сервис",
      classic: "Контакты",
      d: "Адрес, приёмная комиссия и учебная часть",
    },
    { id: "settings", n: "Настройки", ic: "gear", g: "" },
  ];
  const visiblePages = () =>
    PAGES.filter((p) => p.id === "home" || p.id === "settings" || !cfg.hidden.includes(p.id));
  const photoUrl = (u) =>
    safeUrl(u).replace(/['"()\\\s]/g, (c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"));
  const initials = (n) =>
    String(n || "")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase();
  // фото из журнала поверх инициалов: если картинка не загрузится, останутся инициалы
  // своё фото храним уменьшенной копией: после перезагрузки оно видно сразу, без инициалов. Копия привязана к id и адресу фото
  let avaMem = LS.get("ava", null),
    avaBusy = false;
  const avaFail = {},
    imgPre = {};
  // картинку держим в памяти: после первой загрузки фото рисуется сразу, инициалы не мелькают
  function avaSrc(url) {
    if (!url || url !== M.user.photo || M.user.id == null) return null;
    if (avaMem && avaMem.id === String(M.user.id) && avaMem.url === url && avaMem.data) return avaMem.data;
    if (!avaBusy && !avaFail[url]) {
      avaBusy = true;
      cacheAva(url, String(M.user.id))
        .then(
          () => {
            if (!avaMem || avaMem.url !== url) avaFail[url] = 1;
          },
          () => {
            avaFail[url] = 1;
          },
        )
        .finally(() => {
          avaBusy = false;
        });
    }
    return null;
  }
  async function cacheAva(url, id) {
    const full = safeUrl(url.startsWith("/") ? location.origin + url : url);
    if (!/^https:/.test(full)) return;
    const draw = (src) =>
      new Promise((res, rej) => {
        const im = new Image();
        if (!/^data:|^blob:/.test(src)) im.crossOrigin = "anonymous";
        im.onload = () => {
          try {
            const k = 160,
              c = document.createElement("canvas"),
              sc = Math.min(1, k / Math.min(im.naturalWidth, im.naturalHeight));
            c.width = Math.round(im.naturalWidth * sc);
            c.height = Math.round(im.naturalHeight * sc);
            c.getContext("2d").drawImage(im, 0, 0, c.width, c.height);
            res(c.toDataURL("image/jpeg", 0.85));
          } catch (e) {
            rej(e);
          }
        };
        im.onerror = rej;
        im.src = src;
      });
    let data = null;
    try {
      data = await draw(full);
    } catch (e) {}
    if (!data) {
      const gm =
        typeof GM_xmlhttpRequest === "function"
          ? GM_xmlhttpRequest
          : (typeof GM !== "undefined" && GM && GM.xmlHttpRequest) || null;
      if (gm)
        try {
          const buf = await new Promise((res, rej) =>
            gm({
              method: "GET",
              url: full,
              responseType: "arraybuffer",
              timeout: 15000,
              onload: (r) => (r.status === 200 && r.response ? res(r.response) : rej()),
              onerror: rej,
              ontimeout: rej,
            }),
          );
          const u8 = new Uint8Array(buf);
          let b = "";
          for (let i = 0; i < u8.length; i += 8192)
            b += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
          data = await draw("data:image/jpeg;base64," + btoa(b));
        } catch (e) {}
    }
    if (!data || data.length > 120000 || String(M.user.id) !== id || M.user.photo !== url) return;
    avaMem = { id, url, data };
    LS.set("ava", avaMem);
  }
  const imgBad = {};
  const photo = (cls = "", url = M.user.photo, name = M.user.name) => {
    const c = avaSrc(url),
      src = c || photoUrl(url),
      ok = !!src && (!!c || imgPre[url] === 2),
      bad = imgBad[url] && Date.now() - imgBad[url] < 60000;
    return `<div class="photo ${cls}${ok ? " cached" : ""}" role="img" aria-label="Фото"><span class="ini">${esc(initials(name))}</span>${src && !bad ? `<img class="pimg${ok ? " ok" : ""}" src="${esc(src)}" alt="" decoding="async" draggable="false" data-pu="${esc(url)}">` : ""}</div>`;
  };
  // ближайшая ещё не полученная награда за серию без пропусков
  const nextGoal = (s) => [5, 10, 20].find((g) => !(s.pBest >= g || achFeed(g, "streak"))) || null;
  const isRead = (n) => n.read || readSet.has(n.id);
  const unreadList = () => (M.news || []).filter((n) => !isRead(n));
  const dayPart = (h = new Date().getHours()) =>
    h >= 5 && h < 12 ? "morning" : h >= 12 && h < 17 ? "day" : h >= 17 && h < 22 ? "evening" : "night";
  /* ---------- новый стиль (тест): шрифты и сцена приветствия ---------- */
  const NEO_FONTS = {
    "u-lat":
      "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",
    "u-cyr":
      "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",
    "m-lat":
      "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",
    "m-cyr":
      "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",
  };
  let neoFontsState = 0;
  function loadNeoFonts() {
    if (neoFontsState || typeof FontFace !== "function" || !document.fonts) return;
    neoFontsState = 1;
    const LAT =
        "U+0020-007E,U+00A0,U+00AB,U+00B0,U+00B7,U+00BB,U+00D7,U+2010-2014,U+2019,U+201C,U+201D,U+2022,U+2026,U+20BD,U+2212",
      CYR = "U+0401,U+0410-044F,U+0451,U+2116";
    const buf = (b) => {
      const s = atob(b),
        u = new Uint8Array(s.length);
      for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
      return u.buffer;
    };
    Object.entries(NEO_FONTS).forEach(([k, b]) => {
      try {
        const [fam, sub] = k.split("-");
        const f = new FontFace(fam === "u" ? "DnHead" : "DnBody", buf(b), {
          weight: fam === "u" ? "300 700" : "400 700",
          unicodeRange: sub === "lat" ? LAT : CYR,
          display: "swap",
        });
        f.load()
          .then((x) => document.fonts.add(x))
          .catch(() => {});
      } catch (e) {}
    });
  }
  const neoOn = () => true;
  // сцена за приветствием: картина справа (светило, облака, сияние) + пейзаж по низу во всю ширину.
  // Картина вписывается по высоте и прижата вправо, поэтому на любой ширине луна и солнце видны целиком
  function heroScene(dp) {
    const rnd = (
      (i) => () =>
        (i = (i * 16807) % 2147483647) / 2147483647
    )(11);
    const f = (n) => n.toFixed(1);
    const L = {
      morning: ["#c86c9a", "#7e3c86", "#3d1d5c", "#1c0f30"],
      day: ["#6f9fe0", "#3b6cc4", "#22449a", "#0f2358"],
      evening: ["#8a2f86", "#561d6e", "#2c1044", "#12071f"],
      night: ["#2c2c6e", "#1b1b4a", "#0f0f2c", "#05050f"],
    }[dp];
    // пейзаж: дальние горы, холмы, ближний холм с ёлками
    let land = "";
    {
      let d = "M0 110";
      for (let x = 0; x < 2400; x += 170) {
        const up = 26 + rnd() * 46,
          w = 60 + rnd() * 50;
        d += ` L${f(x + w)} ${f(up)} L${f(x + w + 30)} ${f(up + 12 + rnd() * 10)} L${x + 170} ${f(84 + rnd() * 20)}`;
      }
      land += `<path d="${d} L2400 160 L0 160Z" fill="${L[0]}"/>`;
    }
    [
      [1, 96, 16, 210],
      [2, 118, 12, 140],
    ].forEach(([k, y0, a, p]) => {
      let d = `M0 ${y0}`;
      for (let x = 0; x <= 2400; x += 40)
        d += ` L${x} ${f(y0 + a * Math.sin(x / p + k * 2.1) + a * 0.45 * Math.sin(x / (p * 0.37) + k))}`;
      land += `<path d="${d} L2400 160 L0 160Z" fill="${L[k]}"/>`;
    });
    {
      let d = "M0 142",
        tr = "";
      for (let x = 0; x <= 2400; x += 40) {
        const y = 142 + 6 * Math.sin(x / 120);
        d += ` L${x} ${f(y)}`;
        if (x > 1100 && rnd() < 0.42) {
          const h = 16 + rnd() * 20,
            w = h * 0.42;
          tr += `<path d="M${f(x)} ${f(y - h)} L${f(x + w)} ${f(y + 2)} L${f(x - w)} ${f(y + 2)}Z"/>`;
        }
      }
      land += `<path d="${d} L2400 160 L0 160Z" fill="${L[3]}"/><g fill="${L[3]}">${tr}</g>`;
    }
    const cloud = (x, y, s, c1, c2, cls = "") =>
      `<g class="nh-cl ${cls}" transform="translate(${x} ${y}) scale(${s})"><g fill="${c1}"><ellipse cx="0" cy="8" rx="70" ry="22"/><circle cx="-26" cy="-6" r="26"/><circle cx="12" cy="-18" r="34"/><circle cx="46" cy="-2" r="22"/></g><ellipse cx="4" cy="16" rx="62" ry="10" fill="${c2}"/></g>`;
    const birds = (x, y, c) =>
      `<g class="nh-birds" fill="none" stroke="${c}" stroke-width="2.2" stroke-linecap="round"><path d="M${x} ${y}q8-8 16 0q8-8 16 0"/><path d="M${x + 44} ${y + 20}q6-6 12 0q6-6 12 0"/><path d="M${x - 30} ${y + 30}q5-5 10 0q5-5 10 0"/></g>`;
    let defs = `<filter id="nhb" x="-30%" y="-80%" width="160%" height="260%"><feGaussianBlur stdDeviation="10"/></filter><filter id="nhs" x="-20%" y="-200%" width="140%" height="500%"><feGaussianBlur stdDeviation="3"/></filter>`,
      art = "";
    if (dp === "night") {
      defs += `<radialGradient id="nhmg"><stop offset="0" stop-color="#fff6d6" stop-opacity=".55"/><stop offset=".45" stop-color="#b9a8ff" stop-opacity=".16"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></radialGradient>
        <radialGradient id="nhm" cx=".38" cy=".35" r=".75"><stop offset="0" stop-color="#fffdf1"/><stop offset=".6" stop-color="#f1e7c8"/><stop offset="1" stop-color="#c9b98f"/></radialGradient>
        <linearGradient id="nhau1" x1="0" x2="1"><stop offset="0" stop-color="#4be35a" stop-opacity="0"/><stop offset=".35" stop-color="#4be35a" stop-opacity=".7"/><stop offset=".65" stop-color="#2cc6f7" stop-opacity=".55"/><stop offset="1" stop-color="#7c5cff" stop-opacity="0"/></linearGradient>
        <linearGradient id="nhau2" x1="0" x2="1"><stop offset="0" stop-color="#7c5cff" stop-opacity="0"/><stop offset=".5" stop-color="#b06bff" stop-opacity=".6"/><stop offset="1" stop-color="#ff5c8a" stop-opacity="0"/></linearGradient>
        <linearGradient id="nhsh" x1="0" x2="1"><stop offset="0" stop-color="#fff"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>`;
      const st = Array.from(
        { length: 34 },
        (_, i) =>
          `<circle ${i % 3 ? "" : `class="nh-tw" style="animation-delay:${f(rnd() * 3)}s"`} cx="${f(40 + rnd() * 600)}" cy="${f(8 + rnd() * 200)}" r="${f(0.7 + rnd() * 1.5)}" fill="#fff" opacity="${f(0.5 + rnd() * 0.5)}"/>`,
      ).join("");
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
        <mask id="nhcut"><rect x="300" y="100" width="320" height="220" fill="#fff"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="300" y="${216 + i * 13}" width="320" height="${2.5 + i * 1.6}" fill="#000"/>`).join("")}</mask>`;
      art = `<circle class="nh-glow" cx="450" cy="250" r="260" fill="url(#nhg)"/><circle cx="450" cy="250" r="96" fill="url(#nhsun)" mask="url(#nhcut)"/>
        <g fill="#ff8fb0" opacity=".55" filter="url(#nhs)"><rect class="nh-cl" x="210" y="150" width="190" height="10" rx="5"/><rect class="nh-cl b" x="470" y="176" width="170" height="8" rx="4"/><rect class="nh-cl" x="300" y="200" width="120" height="6" rx="3"/></g>
        <g fill="#5a1c6a" opacity=".45" filter="url(#nhs)"><ellipse class="nh-cl b" cx="470" cy="232" rx="110" ry="5"/></g>${birds(240, 90, "#2a0f3e")}`;
    } else if (dp === "morning") {
      defs += `<radialGradient id="nhg"><stop offset="0" stop-color="#fff4cf" stop-opacity=".95"/><stop offset=".35" stop-color="#ffc58a" stop-opacity=".45"/><stop offset="1" stop-color="#ff7a8f" stop-opacity="0"/></radialGradient>
        <linearGradient id="nhc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff1f4"/><stop offset="1" stop-color="#ffb3c6"/></linearGradient>`;
      art = `<circle class="nh-glow" cx="440" cy="236" r="200" fill="url(#nhg)"/><circle cx="440" cy="236" r="54" fill="#fff3cf"/>
        ${cloud(250, 120, 0.8, "url(#nhc)", "#f28cab")}${cloud(560, 90, 0.6, "url(#nhc)", "#f28cab", "b")}${cloud(430, 170, 0.55, "url(#nhc)", "#f28cab")}${birds(300, 60, "#3b1d5c")}`;
    } else {
      // день: высокое солнце с мягкими лучами, объёмные облака, птицы - в той же манере, что утро
      defs += `<radialGradient id="nhg"><stop offset="0" stop-color="#fffdf0" stop-opacity=".95"/><stop offset=".3" stop-color="#fff4c4" stop-opacity=".45"/><stop offset="1" stop-color="#bfe0ff" stop-opacity="0"/></radialGradient>
        <linearGradient id="nhc" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#ffffff"/><stop offset="1" stop-color="#d6e7ff"/></linearGradient>`;
      art = `<circle class="nh-glow" cx="500" cy="84" r="190" fill="url(#nhg)"/><circle cx="500" cy="84" r="46" fill="#fffcee"/><circle cx="500" cy="84" r="58" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>
        <g opacity=".35" filter="url(#nhs)" fill="#fff"><ellipse class="nh-cl b" cx="330" cy="206" rx="170" ry="7"/><ellipse class="nh-cl" cx="560" cy="226" rx="120" ry="5"/></g>
        ${cloud(270, 130, 0.9, "url(#nhc)", "#a9c6ee")}${cloud(600, 168, 0.62, "url(#nhc)", "#a9c6ee", "b")}${cloud(400, 196, 0.5, "url(#nhc)", "#a9c6ee")}${birds(190, 70, "#1b2f6e")}`;
    }
    return `${dp === "night" ? `<div class="nh-stars"></div>` : ""}<svg class="nh-art" viewBox="0 0 640 320" preserveAspectRatio="xMaxYMin meet" aria-hidden="true"><defs>${defs}</defs>${art}</svg>
      <svg class="nh-land" viewBox="0 0 2400 160" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">${land}</svg><div class="nh-scrim"></div>`;
  }
  const HELLO = { morning: "Доброе утро", day: "Добрый день", evening: "Добрый вечер", night: "Доброй ночи" };
  // оценка ниже максимальной - свой цвет (5-балльная и 12-балльная шкала)
  let SCALE = 5;
  const vClass = (m) => {
    if (m == null) return "";
    const x = SCALE > 5 ? (m >= 10 ? 5 : m >= 7 ? 4 : m >= 4 ? 3 : 2) : m;
    return x >= 5 ? "" : x === 4 ? "v4" : x === 3 ? "v3" : "v2";
  };

  /* ---- «новое»: что появилось с прошлого просмотра раздела ---- */
  const MK = ["hw", "cw", "lab", "ctrl", "prac", "fin"];
  const MK_N = {
    hw: "Домашнее задание",
    cw: "Классная работа",
    lab: "Лабораторная",
    ctrl: "Контрольная",
    prac: "Практическая",
    fin: "Итоговая",
  };
  const vKey = (v) => v.date + "|" + v.ln + "|" + MK.map((k) => v[k] ?? "").join(",");
  const hKey = (h) => [h.subj, h.theme, h.due, h.status, h.mark ?? ""].join("|");
  const rKey = (r) => (r.date || "") + "|" + r.teacher + "|" + r.text.slice(0, 40);
  function feedKeys() {
    const c = {};
    return (M.feed || []).map((f) => {
      const b = f.date + "|" + f.label + "|" + f.amt;
      c[b] = (c[b] || 0) + 1;
      return b + "|" + c[b];
    });
  }
  const dupKeys = (ks) => {
    const c = {};
    return ks.map((k) => {
      c[k] = (c[k] || 0) + 1;
      return c[k] > 1 ? k + "#" + c[k] : k;
    });
  };
  // «на проверке» - это то, что сдал сам, не уведомляем
  const hwKeyed = () => {
    const L = (M.hw || []).filter((h) => h.status !== "wait"),
      K = dupKeys(L.map(hKey));
    return new Map(L.map((h, i) => [h, K[i]]));
  };
  const revKeys = () => dupKeys((M.reviews || []).map(rKey));
  const KEYS = {
    grades: () => (M.visits || []).filter((v) => MK.some((k) => v[k] != null)).map(vKey),
    homework: () => [...hwKeyed().values()],
    reviews: revKeys,
    awards: feedKeys,
  };
  let seen = LS.get("seen", null),
    fresh = {};
  function computeFresh() {
    if (!M.live) {
      fresh = {};
      return;
    }
    // первый раз, когда данные раздела появились, считаем их просмотренными - «новым» будет только то, что придёт потом
    seen = seen || {};
    let ch = false;
    Object.keys(KEYS).forEach((k) => {
      if (!Array.isArray(seen[k])) {
        const cur = KEYS[k]();
        if (cur.length) {
          seen[k] = cur;
          ch = true;
        }
      }
    });
    if (ch) LS.set("seen", seen);
    fresh = {};
    Object.keys(KEYS).forEach((k) => {
      const o = new Set(seen[k] || []);
      fresh[k] = new Set(Array.isArray(seen[k]) ? KEYS[k]().filter((x) => !o.has(x)) : []);
    });
  }
  function commitSeen(pg) {
    if (!seen || !KEYS[pg] || !fresh[pg] || !fresh[pg].size) return;
    seen[pg] = KEYS[pg]();
    LS.set("seen", seen);
    fresh[pg] = new Set();
  }
  const isNew = (pg, key) => !!(fresh[pg] && fresh[pg].has(key));

  function dropVeil() {
    const v = document.getElementById("dn-veil");
    if (v) {
      v.style.opacity = "0";
      setTimeout(() => v.remove(), 260);
    }
  }
  // графика: «полная» - стекло и анимации, «лёгкая» - без размытия и фоновых анимаций; «авто» включает лёгкую, если при прокрутке кадры заметно проседают
  const gfxLite = () => cfg.gfx === "lite" || (cfg.gfx !== "full" && LS.get("gfxauto", 0) === 1);
  function applyGfx() {
    if (host) {
      if (gfxLite()) host.setAttribute("data-lite", "");
      else host.removeAttribute("data-lite");
    }
  }
  let fpsBad = 0,
    fpsRun = false,
    fpsN = 0;
  function fpsProbe() {
    if (fpsRun || cfg.gfx !== "auto" || LS.get("gfxauto", 0) === 1 || fpsN >= 6 || document.hidden) return;
    fpsRun = true;
    fpsN++;
    const T = [];
    let last = 0,
      k = 0;
    const tick = (t) => {
      if (last) T.push(t - last);
      last = t;
      if (++k < 45) requestAnimationFrame(tick);
      else done();
    };
    const done = () => {
      fpsRun = false;
      T.sort((a, b) => a - b);
      const med = T[T.length >> 1] || 16;
      if (med > 30) fpsBad++;
      else fpsBad = Math.max(0, fpsBad - 1);
      if (fpsBad >= 2) {
        LS.set("gfxauto", 1);
        applyGfx();
      }
    };
    requestAnimationFrame(tick);
  }
  function mount() {
    dropVeil();
    if (host) return;
    if (!W.__dnScrollLock) {
      W.__dnScrollLock = 1;
      const fix = () => {
        if (host && document.documentElement.classList.contains("dn-on") && (W.scrollY || W.scrollX))
          W.scrollTo(0, 0);
      };
      W.addEventListener("scroll", fix, { passive: true });
      if (W.visualViewport) W.visualViewport.addEventListener("resize", () => setTimeout(fix, 60));
      document.addEventListener("focusout", () => setTimeout(fix, 60));
    }
    host = document.createElement("div");
    host.id = "dn-app";
    applyGfx();
    host.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;overflow:auto;overscroll-behavior:contain;background:#0a0c10";
    R = host.attachShadow({ mode: "open" });
    host.addEventListener(
      "scroll",
      () => {
        if (!fpsRun) setTimeout(fpsProbe, 0);
      },
      { passive: true },
    );
    R.innerHTML = `<style>${DN_CSS}</style><div class="dn" data-theme="${resolveTheme()}"><div class="app">
      <aside class="side"><div class="brand"><div class="mark"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></div><div><b>Дневник</b><span id="grp"></span></div></div><nav class="nav" id="nav"></nav>
        <button class="classic" data-act="classic">${ic("ext")}<span>Классический журнал</span></button>
        <div class="me" id="me"></div></aside>
      <div class="main"><header class="top"><div><div class="cap" id="eyebrow"></div><h1 id="title"></h1></div>
        <div class="tools"><button class="nowpill" id="nowpill" data-page="schedule" hidden></button><span class="sync" id="sync"></span><button class="iconbtn" data-act="sync" aria-label="Обновить данные" title="Обновить данные">${ic("refresh")}</button><span id="topAva"></span><button class="iconbtn out" data-act="logout" aria-label="Выйти из аккаунта" title="Выйти из аккаунта"><svg class="i" viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4"/></svg></button></div></header>
        <div class="page" id="page"></div></div></div><dialog id="dlg"></dialog><div class="toast" id="toast" hidden></div></div>`;
    document.documentElement.appendChild(host);
    const keepTitle = () => {
      if (host && /^\s*(journal|журнал)/i.test(document.title || "")) document.title = "Дневник";
    };
    keepTitle();
    new MutationObserver(keepTitle).observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: true,
    });
    new MutationObserver((list) => {
      if (!cfg.mc) return;
      for (const m of list) m.addedNodes.forEach((nd) => mcify(nd.nodeType === 1 ? nd : nd.parentNode));
    }).observe(R, { childList: true, subtree: true });
    if (CRYPTO && cfg.mkt) mkBind(R);
    R.addEventListener("click", onClick);
    R.addEventListener("change", onChange);
    R.addEventListener("input", onInput);
    R.addEventListener(
      "load",
      (e) => {
        const im = e.target;
        if (!im.classList || !im.classList.contains("pimg")) return;
        im.classList.add("ok");
        im.parentElement && im.parentElement.classList.add("cached");
        if (im.dataset.pu) imgPre[im.dataset.pu] = 2;
      },
      true,
    );
    R.addEventListener(
      "error",
      (e) => {
        const im = e.target;
        if (!im.classList || !im.classList.contains("pimg")) return;
        if (im.dataset.pu) imgBad[im.dataset.pu] = Date.now();
        im.parentElement && im.parentElement.classList.remove("cached");
        im.remove();
      },
      true,
    );
    R.getElementById("dlg").addEventListener("click", (e) => {
      if (e.target.id === "dlg") e.target.close();
    });
    R.getElementById("dlg").addEventListener("close", (e) => {
      e.target.classList.remove("wide", "sumd");
      if (e.target.dataset.rate && rate.root) rateDismiss();
      if (pendingNotice) {
        const l = pendingNotice;
        pendingNotice = null;
        setTimeout(() => newsNotice(l), 400);
      }
    });
    document.addEventListener("keydown", onKey);
    render();
    clearInterval(tickT);
    tickT = setInterval(tick, 1000);
    watchPopups();
  }
  let tickT = 0;
  function unmount() {
    if (!host) return;
    clearInterval(tickT);
    tickT = 0;
    if (avgRO) {
      avgRO.disconnect();
      avgRO = null;
    }
    if (raiseWatch) {
      raiseWatch.disconnect();
      raiseWatch = null;
    }
    host.remove();
    host = null;
    R = null;
    document.documentElement.classList.remove("dn-on");
  }
  const resolveTheme = () => "dark";
  const $ = (s) => R.querySelector(s);

  function setSync(s) {
    syncState = s;
    paintSync();
    if (!M.live && R && DATA_PAGES.has(page)) render();
  }
  const DATA_PAGES = new Set([
    "home",
    "schedule",
    "grades",
    "homework",
    "awards",
    "news",
    "reviews",
    "payment",
    "profile",
    "requests",
    "market",
    "materials",
  ]);
  function bootHTML() {
    if (syncState === "auth") {
      const codes = [
        ...new Set(Object.values(NET.status).filter((x) => typeof x === "number" && x >= 400)),
      ].join(", ");
      const why = !NET.token
        ? "Дневник не нашёл вход журнала" +
          (NET.hook === "page" ? ` (перехват: ${NET.hookEvents ? "работает" : "не сработал"})` : "")
        : `журнал ответил ${codes || "ошибкой"} · вход найден: ${NET.tokenSrc || "да"}`;
      return `<div class="card boot">${ic("profile", "i big")}<b>Нужно войти в журнал</b><span>Если ты уже вошёл, обнови страницу. Если не помогло - скопируй диагностику и пришли её</span><small class="soft">${esc(why)}</small><div class="btns"><button class="m-btn pri" data-act="sync">${ic("refresh")}Повторить</button><button class="m-btn" data-act="diag">${ic("bug")}Скопировать диагностику</button><button class="m-btn" data-act="classic">${ic("ext")}Открыть журнал</button></div></div>`;
    }
    if (syncState === "error")
      return `<div class="card boot">${ic("alert", "i big")}<b>${NET.ddos ? "Журнал проверяет браузер" : "Нет связи с журналом"}</b><span>${NET.ddos ? "Защита DDoS-Guard не пропускает запросы. Перезагрузи страницу - проверка пройдёт сама" : "Проверь интернет и попробуй ещё раз. Если журнал завис - перезагрузи страницу"}</span><div class="btns"><button class="m-btn pri" data-act="sync">${ic("refresh")}Повторить</button><button class="m-btn" data-act="reload">Перезагрузить страницу</button><button class="m-btn" data-act="classic">${ic("ext")}Классический журнал</button></div></div>`;
    return `<div class="card boot"><span class="spin"></span><b>Загружаю твои данные из журнала</b><span>Расписание, оценки, задания и рейтинг появятся через пару секунд</span></div>`;
  }
  function paintSync() {
    if (!R) return;
    const el = $("#sync");
    if (!el) return;
    const t = M.updatedAt ? new Date(M.updatedAt) : null;
    const when = t
      ? sameDay(t, new Date())
        ? "в " + t.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" })
        : dm(t)
      : "";
    const map = {
      loading: ["busy", "Обновляю…"],
      ok: [
        "ok",
        "Обновлено " +
          when +
          (NET.okCount && NET.okCount < (NET.totalCount || 0)
            ? ` · ${NET.okCount} из ${NET.totalCount} разделов`
            : ""),
      ],
      cache: ["", "Данные " + when],
      seed: ["busy", "Загружаю данные…"],
      error: ["bad", "Нет связи с журналом"],
      auth: ["bad", "Нужно войти в журнал"],
    };
    const [c, txt] = map[syncState] || ["", ""];
    el.className = "sync " + c;
    el.textContent = txt;
  }

  function render() {
    if (!R) return;
    const p = visiblePages().find((x) => x.id === page) || PAGES[0];
    page = p.id;
    $(".dn").dataset.theme = resolveTheme();
    $(".dn").dataset.accent = cfg.accent || "gold";
    $(".dn").dataset.mc = String(!!cfg.mc);
    {
      const on = neoOn();
      $(".dn").classList.toggle("neo", on);
      if (on) loadNeoFonts();
      host.style.background = on ? "#000" : resolveTheme() === "dark" ? "#0a0c10" : "#eff0f3";
    }
    $("#grp").textContent = M.user.group ? "Группа " + M.user.group : "Электронный журнал";
    const fr = (id) => (fresh[id] ? fresh[id].size : 0);
    const link = (x) =>
      `<a href="#" data-page="${x.id}" ${x.id === page ? 'aria-current="page"' : ""}>${ic(x.ic)}<span>${x.n}</span>${x.id === "home" && (M.evalList || []).length ? `<span class="bd num" title="Пары ждут оценки">${M.evalList.length}</span>` : x.id === "news" && unread() ? `<span class="bd num">${unread()}</span>` : fr(x.id) ? `<span class="nd c num" title="Новое">${fr(x.id)}</span>` : ""}</a>`;
    const vis = visiblePages();
    $("#nav").innerHTML =
      ["Учёба", "Активность", "Сервис"]
        .map((g) => {
          const it = vis.filter((x) => x.g === g);
          return it.length ? `<div class="ngrp">${g}</div>` + it.map(link).join("") : "";
        })
        .join("") +
      `<div class="ngrp"></div>` +
      link(PAGES.find((x) => x.id === "settings"));
    const nm = (M.user.name || "").split(" ");
    const profOk = vis.some((x) => x.id === "profile");
    $("#me").innerHTML =
      `<div class="who ${profOk ? "go" : ""}" ${profOk ? 'data-page="profile" title="Личный кабинет"' : ""}>${photo()}<div><b>${esc(nm.slice(0, 2).join(" ") || "Загрузка…")}</b><span>${esc(M.user.group)}${M.groupPlace ? " · " + M.groupPlace + " место в группе" : ""}</span></div>${profOk ? ic("chev", "i chv") : ""}</div>
      <div class="wallet"><div title="Топкоины"><span class="coin"></span><span class="num">${M.user.coins ?? "-"}</span><small>ТК</small></div><div title="Топгемы"><span class="gem"></span><span class="num">${M.user.gems ?? "-"}</span><small>ТГ</small></div></div>`;
    {
      const h = photo("top-ava"),
        ta = $("#topAva");
      if (ta.__h !== h) {
        ta.__h = h;
        ta.innerHTML = h;
      }
    }
    $("#title").textContent = p.n;
    const s = stats();
    SCALE = s.scale;
    $("#eyebrow").textContent = {
      settings: "Дневник " + VERSION,
      materials: "Учёба",
      market: "Топкоины и топгемы",
      payment: "Договор и платежи",
      profile: "Мои данные",
      requests: "Учебная часть",
      complaints: "Генеральному директору",
      faq: "Справка",
      contacts: "Связь с университетом",
      home: [M.user.name, M.user.group].filter(Boolean).join(" · "),
      schedule: "Неделя",
      grades: `${s.total} ${plural(s.total, "пара", "пары", "пар")} · ${s.marks} оценок`,
      homework: `${M.hwStat.total || M.hwStat.all} заданий`,
      awards: "Монеты, гемы и достижения",
      news: `${unread()} непрочитанных`,
      reviews: "О студенте",
    }[page];
    try {
      $("#page").innerHTML = !M.live && DATA_PAGES.has(page) ? bootHTML() : VIEWS[page](s);
      NET.viewErr = null;
    } catch (e) {
      NET.viewErr = page + ": " + String((e && e.message) || e).slice(0, 160);
      $("#page").innerHTML =
        `<section class="card"><div class="hd"><h2>Раздел не открылся</h2></div><p class="note">Похоже, журнал прислал данные в неожиданном виде. Нажми «Обновить» вверху или открой другой раздел. Ошибка: ${esc(NET.viewErr)}</p></section>`;
    }
    if (page === "grades") {
      applyGF();
      fitAvg();
      bindPairs();
    }
    if (page === "home") {
      requestAnimationFrame(fitFeed);
      setTimeout(fitFeed, 400);
      try {
        document.fonts && document.fonts.ready.then(() => R && page === "home" && fitFeed());
      } catch (e) {}
    }
    enhanceSelects($("#page"));
    paintSync();
    tick();
  }

  // скрываем строки начислений, которые не влезают по высоте (карточка тянется до соседней)
  function fitFeed() {
    if (!W.__dnFF) {
      W.__dnFF = 1;
      let t = 0;
      W.addEventListener("resize", () => {
        clearTimeout(t);
        t = setTimeout(() => {
          if (R && page === "home") fitFeed();
        }, 150);
      });
    }
    const box = R && R.querySelector(".feedfit");
    if (!box) return;
    const L = [...box.querySelectorAll(".li")];
    L.forEach((x) => (x.hidden = false));
    if (matchMedia("(max-width:760px)").matches) {
      L.forEach((x, i) => (x.hidden = i >= 6));
      return;
    }
    const lim = box.getBoundingClientRect().bottom;
    L.forEach((x, i) => {
      if (i >= 4 && x.getBoundingClientRect().bottom > lim + 1) x.hidden = true;
    });
  }
  let calYm = null;
  const VIEWS = {};
  function attRing(s, size = 88) {
    const c = size / 2,
      r = c - 9,
      L = 2 * Math.PI * r,
      tot = Math.max(1, s.total),
      gap = s.total > 1 ? 2.2 : 0;
    const parts = [
      [s.present - s.late, "var(--good)"],
      [s.late, "var(--warn)"],
      [s.miss, "var(--bad)"],
    ].filter((x) => x[0] > 0);
    let off = 0;
    const seg = parts
      .map(([n, col]) => {
        const len = (n / tot) * L,
          d = Math.max(0.6, len - gap);
        const el = `<circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${col}" stroke-width="7" stroke-dasharray="${d} ${L - d}" stroke-dashoffset="${-off}" transform="rotate(-90 ${c} ${c})"/>`;
        off += len;
        return el;
      })
      .join("");
    const ticks = Array.from({ length: 40 }, (_, i) => {
      const a = (i / 40) * 2 * Math.PI - Math.PI / 2,
        r1 = c - 2,
        r2 = c - (i % 5 ? 3.5 : 5);
      return `<line x1="${c + r1 * Math.cos(a)}" y1="${c + r1 * Math.sin(a)}" x2="${c + r2 * Math.cos(a)}" y2="${c + r2 * Math.sin(a)}"/>`;
    }).join("");
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" class="ring2" aria-hidden="true"><g class="tk">${ticks}</g><circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="var(--surface-2)" stroke-width="7"/>${seg}<text x="${c}" y="${c - 1}" text-anchor="middle" class="r-v">${s.present}</text><text x="${c}" y="${c + 12}" text-anchor="middle" class="r-s">из ${s.total}</text></svg>`;
  }
  function lessonHTML(l, day, pidx) {
    const s = l.start ? atTime(day, l.start).getTime() : 0,
      e = l.end ? atTime(day, l.end).getTime() : 0;
    return `<button class="lesson s-${subjKey(l.subj)}" data-les="${day}|${l.start}" data-s="${s}" data-e="${e}">
      <span class="t" title="${esc(l.subj)}">${esc(l.subj)}</span><span class="tt num">${esc(l.start)}<i></i><b>${esc(l.end)}</b></span>
      <span class="r"><span class="room">${esc(roomTxt(l.room))}</span><span>${esc(shortT(l.teacher))}</span></span><i class="p"></i></button>`;
  }
  const timeCol = (l, cap, pidx) =>
    `<div class="tmc num">${cap && pidx >= 0 ? `<span class="cap">${pidx + 1} пара</span>` : ""}<b>${esc(l.start)}</b><span class="ln"></span><span class="end">${esc(l.end)}</span></div>`;
  function gapTxt(day, a, b) {
    const m = Math.round((atTime(day, b.start) - atTime(day, a.end)) / 6e4);
    if (!(m > 0)) return "";
    return m >= 60
      ? `Окно ${Math.floor(m / 60)} ч${m % 60 ? " " + (m % 60) + " мин" : ""}`
      : `Перерыв ${m} мин`;
  }
  function dayTimeline(day) {
    const ls = lessonsOn(fromIso(day)),
      pi = pairIndex();
    return `<div class="tl">${ls.map((l, i) => (i ? `<div class="gap">${gapTxt(day, ls[i - 1], l)}</div>` : "") + timeCol(l, true, pi(l.start)) + lessonHTML(l, day)).join("")}</div>`;
  }

  VIEWS.home = (s) => {
    const now = new Date(),
      dp = dayPart(now.getHours()),
      hi = isBday() ? "С днём рождения" : HELLO[dp];
    const first = (M.user.name || "").split(" ")[1] || "";
    const L = M.leaders || [],
      meI = L.findIndex((x) => x.me),
      me = L[meI];
    const LL = lbMode === "stream" && (M.streamLeaders || []).length ? M.streamLeaders : L,
      maxL = LL.length ? LL[0].pts || 1 : 1;
    const LS2 = LL.slice(0, 10);
    const meL = LL.find((x) => x.me);
    if (meL && !LS2.includes(meL)) LS2.push(meL);
    const toNext = me && meI > 0 ? L[meI - 1].pts - me.pts : null,
      lead = me && L[meI + 1] ? me.pts - L[meI + 1].pts : null;
    const weekPairs = [0, 1, 2, 3, 4, 5, 6].reduce(
      (a, d) => a + lessonsOn(dayDate(mondayOf(now), d)).length,
      0,
    );
    const occ = occurrences(now);
    const todayLeft = occ.some((x) => sameDay(x.s, now) && x.e > now);
    const nx = occ.find((x) => x.e > now);
    const showDay = todayLeft ? iso(now) : nx ? nx.day : null;
    const isToday = showDay === iso(now);
    const goal = nextGoal(s);
    // оценки, поставленные сегодня (видны до 23:59): вместо строки про награду
    const MKS = {
      hw: "ДЗ",
      cw: "классная",
      lab: "лабораторная",
      ctrl: "контрольная",
      prac: "практическая",
      fin: "итоговая",
    };
    const todayMarks = [];
    (M.visits || [])
      .filter((v) => v.date === iso(now))
      .forEach((v) => {
        const m = MK.filter((k) => v[k] != null).map((k) => ({ k, v: v[k] }));
        if (!m.length) return;
        const o = todayMarks.find((x) => x.subj === v.subj);
        if (o) o.m.push(...m);
        else todayMarks.push({ subj: v.subj, m });
      });
    const evl = (M.evalList || []).length,
      now0 = new Date();
    const dueToday = (M.hw || [])
      .map((h, i) => ({ h, i }))
      .filter((x) => x.h.status === "cur" && x.h.due && dayDiff(now0, fromIso(x.h.due)) === 0);
    // оплата. Красная - долг (просроченные неоплаченные платежи или долг по данным журнала), жёлтая - платёж в ближайшие 3 дня.
    // Одновременно показывается только одна карточка: при долге ближайший платёж упоминается в ней же
    const pay = M.pay || {},
      today0 = iso(now0),
      unpaid = (pay.plan || []).filter((x) => !x[3]).sort((a, b) => a[0].localeCompare(b[0]));
    // долг - только реально просроченные неоплаченные платежи из графика (amount_debt журнала - это сумма к оплате за период, а не долг)
    const overdueP = unpaid.filter((x) => x[0] < today0),
      debtSum = overdueP.reduce((a, x) => a + (x[2] || 0), 0);
    const planNext = unpaid.find((x) => x[0] >= today0),
      payDays = planNext ? dayDiff(now0, fromIso(planNext[0])) : null;
    const payKind = payDays != null && payDays <= 3 ? "soon" : null;
    const payKey = "soon|" + (planNext ? planNext[0] : "");
    const payDis = LS.get("paydis", {});
    const payShow = !!payKind && payDis.k !== payKey;
    // опрос журнала: только открытый (который можно пройти); скрыть можно до завтра
    const quizKey = M.quiz && M.quiz.n ? (M.quiz.title || "") + "|" + M.quiz.n : "";
    const quizDis = LS.get("quizdis", {});
    const quizShow = !!quizKey && !(quizDis.k === quizKey && Date.now() - quizDis.t < 864e5);
    // не больше 3 карточек: оценка пары и оплата - всегда, потом сроки на сегодня, итоги - если есть место и нет горящих сроков
    const slots = Math.max(1, 3 - (evl ? 1 : 0) - (payShow ? 1 : 0) - (quizShow ? 1 : 0));
    let dueShow = dueToday,
      dueMore = 0;
    if (dueToday.length > slots) {
      dueShow = dueToday.slice(0, Math.max(0, slots - 1));
      dueMore = dueToday.length - dueShow.length;
    }
    const sumYm = !dueToday.length && !payShow ? summaryDue() : null;
    const upd = LS.get("upd", null),
      updShow = upd && upd.v && verNewer(upd.v, VERSION) && LS.get("upddis", "") !== upd.v;
    const hasNotes = dueToday.length || sumYm || evl || payShow || quizShow || updShow;
    const bdayShow = isBday() && LS.get("bdaydis", 0) !== now.getFullYear();
    return `${bdayShow ? bdayHTML() : ""}${hasNotes ? `<div class="notes">` : ""}${updShow ? `<div class="card updban"><div class="ic">${ic("download")}</div><div class="grow"><b>Вышла новая версия ${esc(upd.v)}</b><span>У тебя ${VERSION} · обновление займёт пару секунд</span></div><a class="m-btn pri" href="${UPD_URL}" target="_blank" rel="noopener" data-act="updgo">Обновить</a><button class="x" data-act="upddis" data-v="${esc(upd.v)}" aria-label="Скрыть">×</button></div>` : ""}${
      payShow
        ? `<div class="card payban ${payKind}"><div class="ic">${ic("card")}</div><div class="grow">${
            payKind === "debt"
              ? `<b>Задолженность по оплате${debtSum > 0 ? ": " + rub(debtSum) : ""}</b><span>${overdueP.length ? `срок был ${dm(fromIso(overdueP[0][0]))}${overdueP[0][1] ? " · " + esc(overdueP[0][1]) : ""}` : "журнал отмечает задолженность"}${planNext && payDays <= 3 ? ` · следующий ${rub(planNext[2])} до ${dm(fromIso(planNext[0]))}` : ""}</span>`
              : `<b>Скоро оплата${planNext[2] ? ": " + rub(planNext[2]) : ""}</b><span>${payDays === 0 ? "сегодня последний день" : `до ${dm(fromIso(planNext[0]))} · ${payDays === 1 ? "завтра" : "через " + payDays + " " + plural(payDays, "день", "дня", "дней")}`}${planNext[1] ? " · " + esc(planNext[1]) : ""}</span>`
          }
      </div><button class="m-btn" data-page="payment">Оплата</button><button class="x" data-act="paydis" data-k="${esc(payKey)}" aria-label="Скрыть до следующего платежа" title="Скрыть до следующего платежа">×</button></div>`
        : ""
    }${quizShow ? `<div class="card quizban"><div class="ic">${ic("poll")}</div><div class="grow"><b>Опрос от академии · +20 <span class="coin"></span></b><span>${esc((M.quiz && M.quiz.title) || "Можно пройти в журнале")}</span></div><button class="m-btn pri" data-act="classic">Пройти</button><button class="x" data-act="quizdis" data-k="${esc(quizKey)}" aria-label="Скрыть до завтра" title="Скрыть до завтра">×</button></div>` : ""}${dueShow.map(({ h, i }) => `<div class="card dueban"><div class="ic">${ic("clock")}</div><div class="grow"><b>Сегодня срок: ${esc(h.subj)}</b><span>${esc(h.theme || "Домашнее задание")} · до 23:59</span></div><button class="m-btn" data-hwf="${esc(hwRef(h))}">${ic("upload")}Сдать</button></div>`).join("")}${dueMore ? `<div class="card dueban"><div class="ic">${ic("clock")}</div><div class="grow"><b>Ещё ${dueMore} ${plural(dueMore, "задание", "задания", "заданий")} со сроком сегодня</b><span>до 23:59</span></div><button class="m-btn" data-page="homework">Все</button></div>` : ""}
    ${
      sumYm
        ? `<div class="card sumcard"><div class="ic">${ic("star")}</div><div class="grow"><b>Итоги: ${MONTHS_N[+sumYm.slice(5) - 1]}</b><span>${(() => {
            const st = monthStats(sumYm);
            return `${st.marks} ${plural(st.marks, "оценка", "оценки", "оценок")} · посещаемость ${st.att}%`;
          })()}</span></div><button class="m-btn pri" data-act="month" data-ym="${sumYm}">Смотреть</button><button class="x" data-act="mdis" data-ym="${sumYm}" aria-label="Скрыть">×</button></div>`
        : ""
    }${evl ? `<div class="card evl"><div class="ic">${ic("star")}</div><div class="grow"><b>Оцените ${evl} ${plural(evl, "занятие", "занятия", "занятий")} · +${evl} <span class="coin"></span></b><span>Оценки анонимны</span></div><button class="m-btn pri" data-form="lesson">Оценить</button></div>` : ""}${hasNotes ? `</div>` : ""}
    <section class="hero nh nh-${dp}" data-dp="${dp}">${heroScene(dp)}
      <div class="hero-id">${photo("lg")}<div><div class="cap">${DAYS[(now.getDay() + 6) % 7]}, ${longDate(now)}</div><h2>${hi}${first ? ", " + esc(first) : ""}</h2></div></div>
      <p><span>${s.marks ? (s.allTop ? `Все ${s.marks} ${plural(s.marks, "оценка", "оценки", "оценок")} - «${s.maxMark}».` : `Средний балл ${f2(s.avg)} по ${s.marks} ${plural(s.marks, "оценке", "оценкам", "оценкам")}.`) : "Оценок пока нет."} Без пропусков ${s.pStreak} ${plural(s.pStreak, "пара", "пары", "пар")} подряд.</span>${!todayMarks.length && goal ? `<span>До награды «${goal} посещений подряд» осталось ${Math.max(1, goal - s.pStreak)} ${plural(Math.max(1, goal - s.pStreak), "пара", "пары", "пар")}.</span>` : ""}</p>
      ${
        todayMarks.length
          ? `<div class="tmarks"><b>Сегодня уже:</b>${todayMarks
              .slice(0, 3)
              .map(
                (x) =>
                  `<button class="tmk" data-page="grades" title="${esc(x.subj)}: ${x.m.map((y) => `${y.v} (${MKS[y.k]})`).join(", ")}">${x.m.map((y) => `<span class="mark5 ${y.k}">${y.v}</span>`).join("")}<span class="tsj">${esc(subjShort(x.subj))}</span></button>`,
              )
              .join(
                "",
              )}${todayMarks.length > 3 ? `<button class="tmk more" data-page="grades">+${todayMarks.length - 3}</button>` : ""}</div>`
          : ""
      }
      <div class="facts"><span>Средний балл <b class="num">${s.marks ? f2(s.avg) : "-"}</b></span><span>Посещаемость <b class="num">${s.att}%</b></span>
        ${M.groupPlace ? `<span>Место в группе <b class="num">${M.groupPlace}</b>${M.streamPlace ? ` · на потоке <b class="num">${M.streamPlace}</b>` : ""}</span>` : ""}<span>На этой неделе <b class="num">${pairsW(weekPairs)}</b></span></div></section>
    ${CRYPTO && cfg.mkt ? marketHTML() : ""}
    <div class="row r4">
      <div class="card kpi"><div class="lab">${ic("star")}Средний балл</div><div class="val num">${s.marks ? (Math.abs(s.avg - Math.round(s.avg)) < 0.005 ? f1(s.avg) : f2(s.avg)) : "-"}<small>/ ${s.scale}</small></div><div class="sub"><b class="num">${s.marks}</b> оценок: ${s.hwN} за ДЗ, ${s.cwN} за работу на паре${s.otherN ? `, ${s.otherN} другие` : ""}</div></div>
      <div class="card kpi att">${attRing(s)}<div class="lab">${ic("check")}Посещаемость</div><div class="val num">${s.att}<small>%</small></div><div class="sub att-l"><span><span class="ld g"></span>был <b class="num">${s.present - s.late}</b></span>${s.late ? `<span><span class="ld o"></span>опоздал <b class="num">${s.late}</b></span>` : ""}<span><span class="ld r"></span>пропуск <b class="num">${s.miss}</b></span></div></div>
      <div class="card kpi"><div class="lab">${ic("flame")}Серия без пропусков</div><div class="val num">${s.pStreak}<small>${goal ? "/ " + goal + " " : ""}${plural(goal || s.pStreak, "пара", "пары", "пар")}</small></div><div class="meter"><i style="width:${goal ? Math.min(100, (s.pStreak / goal) * 100) : 100}%"></i></div><div class="sub">${!goal ? "Все награды за серию получены" : `До награды «${goal} посещений подряд» <b class="num">${Math.max(1, goal - s.pStreak)}</b> ${plural(Math.max(1, goal - s.pStreak), "пара", "пары", "пар")}`}</div></div>
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
        <div class="list">${LS2.map((x) => `<div class="li ${x.me ? "me-row" : ""}"><span class="pos num">${x.pos}</span>${photo("sm", x.me ? M.user.photo || x.photo : x.photo, x.name)}<div class="grow"><b>${esc(x.name)}</b></div><span class="track"><i style="width:${(x.pts / maxL) * 100}%"></i></span><span class="pts num">${x.pts}</span></div>`).join("") || `<p class="note">${lbMode === "stream" ? "Журнал не прислал рейтинг потока" : "Нет данных"}</p>`}</div></div>
      <div class="card"><div class="hd"><h2>Последние начисления</h2><a href="#" data-page="awards">Награды</a></div><div class="feedfit">${feedList(20)}</div>
        <div class="legend" style="margin-top:14px;padding-top:12px;border-top:1px solid var(--hair)"><span><span class="coin"></span>Топкоины <b class="num">${M.user.coins ?? "-"}</b></span><span><span class="gem"></span>Топгемы <b class="num">${M.user.gems ?? "-"}</b></span></div></div>
    </div>`;
  };
  // низ карточки «Сегодня»: сколько пар и до скольки, и что дальше - всё из расписания журнала
  function dayFoot(day) {
    const today = iso(new Date()),
      isT = day === today;
    const sum = (d) => {
      const ls = lessonsOn(fromIso(d)),
        mins = ls.reduce((a, l) => {
          const [h1, m1] = l.start.split(":").map(Number),
            [h2, m2] = l.end.split(":").map(Number);
          return a + Math.max(0, h2 * 60 + m2 - h1 * 60 - m1);
        }, 0);
      return { ls, mins };
    };
    const box = (icon, title, sub, btn) =>
      `<${btn ? 'button data-page="schedule"' : "div"}><span>${ic(icon)}</span><div><b class="num">${title}</b><small class="num">${sub}</small></div></${btn ? "button" : "div"}>`;
    const subjs = (ls) =>
      ls
        .slice(0, 3)
        .map((l) => esc(subjShort(l.subj)))
        .join(", ") + (ls.length > 3 ? "…" : "");
    const a = sum(day);
    if (!a.ls.length) return "";
    if (!isT) {
      // сегодня пары уже закончились (или их не было), карточка показывает ближайший учебный день
      const t = sum(today);
      return `<div class="dfoot">${t.ls.length ? box("check", `Сегодня ${pairsW(t.ls.length)} прошли`, `${esc(t.ls[0].start)} - ${esc(t.ls[t.ls.length - 1].end)} · ${f1(t.mins / 60).replace(",0", "")} ч занятий`) : box("check", "Сегодня пар не было", "выходной или свободный день")}
        ${(() => {
          let n2 = null;
          for (let k = 1; k <= 14 && !n2; k++) {
            const d = dayDate(fromIso(day), k);
            if (lessonsOn(d).length) n2 = d;
          }
          if (!n2) return "";
          const b = sum(iso(n2)),
            w2 = dayDiff(new Date(), n2) === 1 ? "Завтра" : DAYS[(n2.getDay() + 6) % 7] + ", " + longDate(n2);
          return box(
            "cal",
            `${w2} · ${pairsW(b.ls.length)}`,
            `с ${esc(b.ls[0].start)} до ${esc(b.ls[b.ls.length - 1].end)} · ${subjs(b.ls)}`,
            true,
          );
        })()}</div>`;
    }
    let nd = null;
    for (let k = 1; k <= 14 && !nd; k++) {
      const d = dayDate(fromIso(day), k);
      if (lessonsOn(d).length) nd = d;
    }
    const nl = nd ? lessonsOn(nd) : [],
      whenN = !nd
        ? ""
        : dayDiff(fromIso(day), nd) === 1
          ? "Завтра"
          : DAYS[(nd.getDay() + 6) % 7] + ", " + longDate(nd);
    return `<div class="dfoot">${box("clock", `${pairsW(a.ls.length)} · ${esc(a.ls[0].start)} - ${esc(a.ls[a.ls.length - 1].end)}`, `${f1(a.mins / 60).replace(",0", "")} ч занятий`)}
      ${nd ? box("cal", whenN, `${pairsW(nl.length)} с ${esc(nl[0].start)} · ${subjs(nl)}`, true) : ""}</div>`;
  }
  // список «как To do» в новом стиле: просроченные, текущие по сроку, на проверке, проверенные (зачёркнуты, с оценкой)
  function hwTodo(s) {
    const now = new Date(),
      ord = { late: 0, cur: 1, wait: 2, done: 3 };
    const L = (M.hw || [])
      .slice()
      .sort(
        (a, b) =>
          ord[a.status] - ord[b.status] ||
          (a.status === "done"
            ? (b.due || "").localeCompare(a.due || "")
            : (a.due || "").localeCompare(b.due || "")),
      )
      .slice(0, 4);
    const tag = (h) => {
      const d = h.due ? dayDiff(now, fromIso(h.due)) : null;
      return h.status === "done"
        ? `<span class="td-tag g">оценка ${esc(String(h.mark))}</span>`
        : h.status === "wait"
          ? `<span class="td-tag y">на проверке</span>`
          : h.status === "late" || (d != null && d < 0)
            ? `<span class="td-tag p">${h.removed ? "удалено" : "просрочено"}</span>`
            : d === 0
              ? `<span class="td-tag p">сегодня до 23:59</span>`
              : `<span class="td-tag c">до ${h.due ? dm(fromIso(h.due)) : "-"}</span>`;
    };
    const row = (h) =>
      `<button class="td-row ${h.status}" data-page="homework"><span class="td-ck">${h.status === "done" ? ic("check") : h.status === "wait" ? ic("clock") : ""}</span><span class="td-tx"><b>${esc(h.theme || "Домашнее задание")}</b><span>${esc(subjShort(h.subj))}${tag(h)}</span></span></button>`;
    const ex = M.exams || [];
    return `<div class="td-list">${L.map(row).join("") || `<p class="note">Заданий пока нет</p>`}</div>
      <div class="td-foot"><span>${ic("check")}Формы контроля: <b>${ex.length ? ex.map((x) => esc(x.subj) + (x.date ? " · " + dm(fromIso(x.date)) : "")).join(", ") : "предстоящих нет"}</b></span>${s.hwCount ? `<span>${ic("timer")}Сдаёшь заранее: <b class="num">${f1(s.earlyAvg)} дн.</b></span>` : ""}</div>`;
  }
  function hwSummary() {
    const c = M.hwStat,
      all = c.total || c.all;
    return `<div style="display:flex;align-items:baseline;gap:10px;margin-bottom:14px"><span style="font-size:40px;font-weight:700;line-height:1" class="num">${all}</span><span class="muted">заданий</span></div>
      <div class="seg-bar" style="margin-bottom:12px"><i style="flex:${c.done};background:var(--good)"></i><i style="flex:${c.wait};background:var(--warn)"></i><i style="flex:${c.cur};background:var(--line)"></i><i style="flex:${c.late};background:var(--bad)"></i></div>
      <div class="legend"><span><i style="background:var(--good)"></i>Проверено <b class="num">${c.done}</b></span><span><i style="background:var(--warn)"></i>На проверке <b class="num">${c.wait}</b></span><span><i style="background:var(--line)"></i>Новые <b class="num">${c.cur}</b></span><span><i style="background:var(--bad)"></i>Просрочено <b class="num">${c.late}</b></span></div>`;
  }
  const feedList = (n) => {
    const K = feedKeys();
    return `<div class="list">${
      (M.feed || [])
        .slice(0, n)
        .map(
          (f, i) =>
            `<div class="li ${isNew("awards", K[i]) ? "isnew" : ""}"><div class="grow"><b>${esc(actName(f.label))}</b><span class="num">${f.date ? dm(fromIso(f.date)) + "." + f.date.slice(0, 4) : ""}</span></div><span class="amt num">+${f.amt} <span class="${f.kind}"></span></span></div>`,
        )
        .join("") || `<p class="note">Начислений пока нет</p>`
    }</div>`;
  };

  function schedGoCurrent() {
    const now = new Date(),
      { cur, next } = focus(now),
      o = cur || next;
    sc.mon = mondayOf(o ? o.s : now);
    sc.day = o ? (o.s.getDay() + 6) % 7 : (now.getDay() + 6) % 7;
    if (sameDay(mondayOf(now), sc.mon)) sc.day = (now.getDay() + 6) % 7;
  }
  VIEWS.schedule = () => {
    if (!sc.mon) schedGoCurrent();
    ensureWeek(sc.mon);
    const a = sc.mon,
      b = dayDate(sc.mon, 6);
    const lbl =
      a.getMonth() === b.getMonth()
        ? `${a.getDate()} - ${b.getDate()} ${MON[b.getMonth()]}`
        : `${a.getDate()} ${MON[a.getMonth()]} - ${b.getDate()} ${MON[b.getMonth()]}`;
    const n = [0, 1, 2, 3, 4, 5, 6].reduce((s, d) => s + lessonsOn(dayDate(sc.mon, d)).length, 0);
    const loaded =
      M.schedule[iso(sc.mon)] !== undefined && (!M.live || (M.schedLive && M.schedLive[iso(sc.mon)]));
    return `<section class="now" id="now" hidden></section>
    <div class="bar-tools"><div class="grp"><div class="pill"><button class="ar" data-act="prev" aria-label="Предыдущая неделя">‹</button><span class="lbl num">${lbl}</span><button class="ar" data-act="next" aria-label="Следующая неделя">›</button></div>
      <div class="pill"><button data-act="cur">Сегодня</button></div></div>
      <div class="pill" role="group"><button data-act="week" aria-pressed="${sc.view === "week"}">Неделя</button><button data-act="day" aria-pressed="${sc.view === "day"}">День</button></div></div>
    ${!loaded ? `<div class="restday"><b>Загружаю неделю…</b>Данные придут из журнала</div>` : sc.view === "week" ? weekHTML() : dayHTML()}
    <div class="legend"><span><b class="num">${pairsW(n)}</b> на неделе</span><span><b class="num">${f1(n * 1.5).replace(",0", "")} ч</b> занятий</span></div>`;
  };
  function weekHTML() {
    const today = new Date(),
      pi = pairIndex();
    const days = [0, 1, 2, 3, 4, 5, 6].map((d) => ({
      d,
      dt: dayDate(sc.mon, d),
      ls: lessonsOn(dayDate(sc.mon, d)),
    }));
    const weekend = days.slice(5).some((x) => x.ls.length);
    const cols = weekend ? days : days.slice(0, 5);
    const rowsIdx = [...new Set(days.flatMap((x) => x.ls.map((l) => pi(l.start))))]
      .filter((i) => i >= 0)
      .sort((a, b) => a - b);
    const ROWS = Math.max(rowsIdx.length, 1);
    const starts = rowsIdx.map((i) => {
      for (const x of days) {
        const l = x.ls.find((l) => pi(l.start) === i);
        if (l) return l;
      }
      return null;
    });
    let g = `<div class="gridwrap"><div class="grid" style="grid-template-columns:92px repeat(${cols.length},minmax(0,1fr))${weekend ? "" : " 72px"}"><div></div>`;
    cols.forEach(
      (x) =>
        (g += `<div class="dh ${sameDay(x.dt, today) ? "today" : ""}"><div class="n">${DAYS[x.d]}</div><div class="d num">${dm(x.dt)} · ${x.ls.length ? pairsW(x.ls.length) : "свободно"}</div></div>`),
    );
    if (!weekend)
      g += `<div class="dh" style="padding-inline:10px"><div class="n" style="white-space:nowrap;font-size:14px">Сб, Вс</div></div>`;
    cols.forEach((x, ci) => {
      if (!x.ls.length)
        g += `<div class="hatch" style="grid-column:${ci + 2};grid-row:2 / span ${ROWS}"><span>${x.d >= 5 ? "Выходной" : "Свободный день"}</span></div>`;
    });
    if (!weekend)
      g += `<div class="hatch wk" style="grid-column:${cols.length + 2};grid-row:2 / span ${ROWS}"><span>Выходные</span></div>`;
    rowsIdx.forEach((ri, k) => {
      const l0 = starts[k];
      g += `<div class="th num"><span class="cap">${ri + 1} пара</span><b>${esc(l0.start)}</b><span class="ln"></span><span class="end">${esc(l0.end)}</span></div>`;
      cols.forEach((x) => {
        if (!x.ls.length) return;
        const l = x.ls.find((l) => pi(l.start) === ri);
        g += `<div class="cell ${sameDay(x.dt, today) ? "today" : ""}${k === rowsIdx.length - 1 ? " lr" : ""}">${l ? lessonHTML(l, iso(x.dt)) : ""}</div>`;
      });
    });
    g += `</div></div><div class="agenda">`;
    days.forEach((x) => {
      if (x.d >= 5 && !x.ls.length) return;
      g += `<section class="aday ${sameDay(x.dt, today) ? "today" : ""}"><h3>${DAYS[x.d]}, ${longDate(x.dt)}<small class="num">${x.ls.length ? pairsW(x.ls.length) + ` · ${x.ls[0].start} - ${x.ls[x.ls.length - 1].end}` : "свободный день"}</small></h3>`;
      g +=
        x.ls.map((l) => `<div class="arow">${timeCol(l, false)}${lessonHTML(l, iso(x.dt))}</div>`).join("") ||
        `<div class="free">Пар нет</div>`;
      g += `</section>`;
    });
    return g + `</div>`;
  }
  function dayHTML() {
    const today = new Date();
    let h = `<div class="days">`;
    for (let d = 0; d < 7; d++) {
      const dt = dayDate(sc.mon, d);
      h += `<button data-day="${d}" aria-pressed="${sc.day === d}" class="${sameDay(dt, today) ? "today" : ""}"><span class="w">${DSH[d]}</span><span class="dd num">${dm(dt)}</span><span class="dots">${"<i></i>".repeat(lessonsOn(dt).length)}</span></button>`;
    }
    const dt = dayDate(sc.mon, sc.day),
      ls = lessonsOn(dt);
    h += `</div><section class="card"><div class="hd"><h2>${DAYS[sc.day]}, ${longDate(dt)}</h2><small class="num">${ls.length ? pairsW(ls.length) + " · " + ls[0].start + " - " + ls[ls.length - 1].end : ""}</small></div>`;
    h += ls.length
      ? dayTimeline(iso(dt))
      : `<div class="restday"><b>Пар нет</b>${sc.day >= 5 ? "Выходной день" : "Свободный день"}</div>`;
    return h + `</section>`;
  }

  /* ---------- цель по баллу ---------- */
  function markList(subj, from) {
    const L = [];
    (M.visits || []).forEach((v) => {
      if (subj && v.subj !== subj) return;
      if (from && !(v.date >= from)) return;
      MK.forEach((k) => v[k] != null && L.push(v[k]));
    });
    return L;
  }
  // период цели: текущая неделя, текущий месяц или всё время
  const GPER = [
    ["week", "Неделя"],
    ["month", "Месяц"],
    ["all", "Всё время"],
  ];
  const perOf = (g) => (GPER.some((x) => x[0] === g.per) ? g.per : "all");
  function perFrom(per) {
    const n = new Date();
    return per === "week"
      ? iso(mondayOf(n))
      : per === "month"
        ? iso(new Date(n.getFullYear(), n.getMonth(), 1))
        : "";
  }
  const perName = (per) =>
    per === "week" ? "за эту неделю" : per === "month" ? "за этот месяц" : "за всё время";
  const perPill = (k, per) =>
    `<div class="pill gper" role="group">${GPER.map(([v, n]) => `<button data-gper="${k}|${v}" aria-pressed="${per === v}">${n}</button>`).join("")}</div>`;
  function goalOptions(a, top) {
    const r = (x) => Math.round(x * 100) / 100,
      step = top > 5 ? 0.5 : 0.1,
      o = [];
    if (a >= top - 0.1 * (top / 5)) {
      [top - 0.05 * (top / 5), top - 0.02 * (top / 5)].forEach((x) => x > a && o.push(r(x)));
    } else {
      const c = Math.floor(a / step + 1e-9) * step + step;
      o.push(r(c), r(Math.min(top - step, c + 2 * step)));
      const mil = (top > 5 ? [6, 7, 8, 9, 10, 11] : [3.5, 4, 4.5, 4.8]).find((x) => x > c + 2 * step);
      if (mil) o.push(mil);
    }
    return [...new Set(o)].filter((x) => x > a && x < top + 0.001).slice(0, 3);
  }
  const T2 = (x) => String(+(+x).toFixed(2)).replace(".", ",");
  function subjOptions(sel, id, withMarks) {
    const cnt = {};
    (M.visits || []).forEach((v) => {
      if (!withMarks || MK.some((k) => v[k] != null)) cnt[v.subj] = (cnt[v.subj] || 0) + 1;
    });
    const subs = Object.keys(cnt).sort((a, b) => a.localeCompare(b, "ru"));
    return {
      subs,
      html: `<select class="sel gsel2" id="${id}"><option value="">Все предметы</option>${subs.map((x) => `<option value="${esc(x)}" ${x === sel ? "selected" : ""}>${esc(x)}</option>`).join("")}</select>`,
    };
  }
  function goalHTML() {
    const g = LS.get("goal", {});
    const so = subjOptions(g.subj, "goalsel", true),
      subj = so.subs.includes(g.subj) ? g.subj : "";
    if (!markList(subj).length) return "";
    const per = perOf(g),
      L = markList(subj, perFrom(per));
    const head = `<section class="card goal"><div class="hd"><h2>${ic("star")}Цель по баллу</h2>${so.html}</div>${perPill("goal", per)}`;
    if (!L.length)
      return (
        head +
        `<p class="ghint">${perName(per)[0].toUpperCase() + perName(per).slice(1)} оценок пока нет - цель начнёт считаться с первой оценки.</p></section>`
      );
    const top = SCALE > 5 ? 12 : 5,
      n = L.length,
      S = L.reduce((x, y) => x + y, 0),
      a = S / n;
    const opts = goalOptions(a, top),
      T = +g.t > a && +g.t <= top ? +g.t : opts[0];
    // (S + k·m) / (n + k) >= T  =>  k = (T·n - S) / (m - T)
    const need = (m) => (m <= T ? Infinity : Math.max(0, Math.ceil((T * n - S) / (m - T) - 1e-9)));
    const k5 = T ? need(top) : 0,
      k4 = T ? need(top - 1) : 0,
      done = !T || a >= T;
    const chips = (k, c) =>
      k === Infinity
        ? ""
        : Array.from(
            { length: Math.min(k, 8) },
            () => `<span class="${c}">${c === "k5" ? top : top - 1}</span>`,
          ).join("") + (k > 8 ? `<span class="${c}">…×${k}</span>` : "");
    const lo = 2,
      pct = (x) => Math.max(0, Math.min(100, ((x - lo) / (top - lo)) * 100));
    return (
      head +
      `<div class="gtop"><div><span class="gn num">${f2(a)}</span><small>${perName(per)} · ${n} ${plural(n, "оценка", "оценки", "оценок")}</small></div>${T ? `<div class="gto"><span class="gn num">${T2(T)}</span><small>цель</small></div>` : ""}</div>
      ${T ? `<div class="gbar"><i style="width:${pct(a)}%"></i><em style="left:${pct(T)}%"></em></div>` : ""}
      <div class="gopt">${opts.map((x) => `<button data-gt="${x}" aria-pressed="${x === T}">${T2(x)}</button>`).join("")}<label class="gown"><span>своя</span><span class="gin"><input id="goalin" type="number" inputmode="decimal" step="0.01" min="${lo}" max="${top}" value="${T && !opts.includes(T) ? T : ""}" placeholder="${T2(Math.min(top, (opts[opts.length - 1] || a) + 0.1))}"></span></label></div>
      <p class="ghint">${
        !T
          ? `Выше уже некуда - держи все оценки на «${top}».`
          : done
            ? "Цель достигнута"
            : k5 === Infinity
              ? `Цель ${T2(T)} недостижима: даже «${top}» подряд её не дадут`
              : `Чтобы выйти на <b>${T2(T)}</b>, нужно ещё <b>${k5} × «${top}»</b>${k4 !== Infinity ? ` или <b>${k4} × «${top - 1}»</b>` : ""}.${per === "all" && k5 > 12 ? ` За всё время оценок много, поэтому средний меняется медленно - за месяц цель ближе.` : ""}`
      }</p>
      ${T && !done && k5 !== Infinity ? `<div class="gplan">${chips(k5, "k5")}${k4 !== Infinity && k4 <= 30 ? `<em>или</em>${chips(k4, "k4")}` : ""}</div>` : ""}</section>`
    );
  }
  // цель по посещаемости: (P + k) / (T0 + k) >= T  =>  k = (T·T0 - P) / (1 - T) пар подряд без пропусков
  function attGoalHTML() {
    const g = LS.get("agoal", {});
    const so = subjOptions(g.subj, "agsel", false),
      subj = so.subs.includes(g.subj) ? g.subj : "";
    const per = perOf(g),
      from = perFrom(per),
      all = (M.visits || []).filter((v) => !subj || v.subj === subj);
    if (!all.length) return "";
    const V = all.filter((v) => !from || v.date >= from);
    const head = `<section class="card goal"><div class="hd"><h2>${ic("check")}Цель по посещаемости</h2>${so.html}</div>${perPill("agoal", per)}`;
    if (!V.length)
      return (
        head +
        `<p class="ghint">${perName(per)[0].toUpperCase() + perName(per).slice(1)} пар пока не было.</p></section>`
      );
    const T0 = V.length,
      P = V.filter((v) => !v.miss).length,
      a = (P / T0) * 100;
    const ppd = T0 / new Set(V.map((v) => v.date)).size || 3;
    const opts = [70, 75, 80, 85, 90, 95, 97, 98, 99].filter((x) => x > a + 0.01).slice(0, 3);
    const T = +g.t > 0 && +g.t < 100 ? +g.t : opts[0] || (a >= 99.9 ? null : 99);
    const need = T ? Math.max(0, Math.ceil(((T / 100) * T0 - P) / (1 - T / 100) - 1e-9)) : 0;
    const spare = T && a >= T ? Math.floor((P - (T / 100) * T0) / (T / 100) + 1e-9) : 0,
      days = Math.ceil(need / ppd);
    return (
      head +
      `<div class="gtop"><div><span class="gn num">${Math.round(a)}%</span><small>${perName(per)} · ${P} из ${T0} ${plural(T0, "пары", "пар", "пар")}</small></div>${T ? `<div class="gto"><span class="gn num">${T}%</span><small>цель</small></div>` : ""}</div>
      ${T ? `<div class="gbar"><i style="width:${a}%"></i><em style="left:${T}%"></em></div>` : ""}
      <div class="gopt">${opts.map((x) => `<button data-agt="${x}" aria-pressed="${x === T}">${x}%</button>`).join("")}<label class="gown"><span>своя</span><span class="gin"><input id="agoalin" type="number" inputmode="numeric" step="1" min="50" max="99" value="${T && !opts.includes(T) ? T : ""}" placeholder="90"><em>%</em></span></label></div>
      <p class="ghint">${!T ? "Ни одного пропуска - так держать." : a >= T ? `Цель достигнута. Запас: можно пропустить ещё <b>${spare} ${plural(spare, "пару", "пары", "пар")}</b> и остаться на ${T}%.` : `Чтобы выйти на <b>${T}%</b>, нужно <b>${need} ${plural(need, "пару", "пары", "пар")} подряд без пропусков</b>${need > 0 ? ` - примерно ${days} ${plural(days, "учебный день", "учебных дня", "учебных дней")}` : ""}.${per === "all" && need > 20 ? " За всё время пар много, поэтому процент меняется медленно - за месяц цель ближе." : ""}`}</p></section>`
    );
  }
  /* ---------- итоги месяца ---------- */
  const MONTHS_N = [
    "январь",
    "февраль",
    "март",
    "апрель",
    "май",
    "июнь",
    "июль",
    "август",
    "сентябрь",
    "октябрь",
    "ноябрь",
    "декабрь",
  ];
  const MONTHS_P = [
    "январе",
    "феврале",
    "марте",
    "апреле",
    "мае",
    "июне",
    "июле",
    "августе",
    "сентябре",
    "октябре",
    "ноябре",
    "декабре",
  ];
  const MONTHS_R = MON;
  function monthStats(ym) {
    const V = (M.visits || []).filter((v) => v.date && v.date.startsWith(ym));
    if (!V.length) return null;
    const marks = [];
    V.forEach((v) => MK.forEach((k) => v[k] != null && marks.push(v[k])));
    const top = SCALE > 5 ? 12 : 5,
      days = {};
    V.forEach((v) => {
      const d = (days[v.date] = days[v.date] || { n: 0, miss: 0, late: 0 });
      d.n++;
      if (v.miss) d.miss++;
      if (v.late) d.late++;
    });
    let run = 0,
      best = 0;
    Object.keys(days)
      .sort()
      .forEach((d) => {
        if (days[d].miss) run = 0;
        else {
          run++;
          best = Math.max(best, run);
        }
      });
    const subj = {};
    V.forEach((v) => {
      const o = (subj[v.subj] = subj[v.subj] || { n: 0, m: [] });
      o.n++;
      MK.forEach((k) => v[k] != null && o.m.push(v[k]));
    });
    const often = Object.keys(subj).sort((a, b) => subj[b].n - subj[a].n)[0];
    const bestS = Object.keys(subj)
      .filter((k) => subj[k].m.length >= 3)
      .sort(
        (a, b) =>
          subj[b].m.reduce((x, y) => x + y, 0) / subj[b].m.length -
            subj[a].m.reduce((x, y) => x + y, 0) / subj[a].m.length || subj[b].m.length - subj[a].m.length,
      )[0];
    const hw = (M.hw || []).filter((h) => h.sub && h.sub.startsWith(ym)),
      early = hw.filter((h) => h.due).map((h) => dayDiff(fromIso(h.sub), fromIso(h.due)));
    const feed = (M.feedAll || M.feed || []).filter((f) => f.date.startsWith(ym) && f.plus),
      coins = feed.filter((f) => f.kind === "coin").reduce((x, f) => x + f.amt, 0),
      gems = feed.filter((f) => f.kind === "gem").reduce((x, f) => x + f.amt, 0);
    const miss = V.filter((v) => v.miss).length,
      rank = LS.get("rankHist", {})[ym];
    return {
      ym,
      pairs: V.length,
      miss,
      late: V.filter((v) => v.late).length,
      att: Math.round(((V.length - miss) / V.length) * 100),
      marks: marks.length,
      tops: marks.filter((x) => x >= top).length,
      top,
      avg: marks.length ? marks.reduce((x, y) => x + y, 0) / marks.length : null,
      best,
      days,
      often,
      oftenN: often ? subj[often].n : 0,
      bestS,
      bestSAvg: bestS ? subj[bestS].m.reduce((x, y) => x + y, 0) / subj[bestS].m.length : null,
      hwN: hw.length,
      hwEarly: early.length ? early.reduce((x, y) => x + y, 0) / early.length : null,
      coins,
      gems,
      rank,
      dayN: Object.keys(days).length,
    };
  }
  // день рождения: флаг журнала или дата рождения из профиля
  function isBday() {
    if (M.user.bday) return true;
    const b = (M.prof && M.prof.birth) || isoOf(M.user.birthday);
    return !!b && b.slice(5) === iso(new Date()).slice(5);
  }
  function bdayAge() {
    const b = (M.prof && M.prof.birth) || isoOf(M.user.birthday);
    if (!b) return 0;
    const a = new Date().getFullYear() - +b.slice(0, 4);
    return a > 5 && a < 100 ? a : 0;
  }
  function bdayHTML() {
    const first = (M.user.name || "").split(" ")[1] || "";
    const conf = Array.from(
      { length: 26 },
      (_, i) =>
        `<i style="left:${4 + ((i * 37) % 90)}%;top:${6 + ((i * 53) % 84)}%;--r:${(i * 47) % 360}deg;--d:${(i % 5) * 0.35}s" class="c${i % 4}"></i>`,
    ).join("");
    return `<section class="card bday"><div class="bd-conf" aria-hidden="true">${conf}</div><button class="x" data-act="bdaydis" aria-label="Скрыть">×</button>
      <div class="bd-cake" aria-hidden="true"><svg viewBox="0 0 64 64"><rect x="10" y="30" width="44" height="24" rx="6" fill="var(--gold)"/><path d="M10 38c6 4 10-4 15 0s9 4 14 0 9-4 15 0" stroke="#fff" stroke-opacity=".7" stroke-width="3" fill="none"/><rect x="18" y="20" width="4" height="12" rx="2" fill="#fff"/><rect x="30" y="18" width="4" height="14" rx="2" fill="#fff"/><rect x="42" y="20" width="4" height="12" rx="2" fill="#fff"/><path d="M20 14c2 2 2 4 0 5-2-1-2-3 0-5zM32 11c2 2 2 5 0 6-2-1-2-4 0-6zM44 14c2 2 2 4 0 5-2-1-2-3 0-5z" fill="#ffc861"/></svg></div>
      <div class="bd-tx"><span class="cap">${longDate(new Date())}${bdayAge() ? ` · тебе ${bdayAge()}` : ""}</span><h2>С днём рождения${first ? ", " + esc(first) : ""}!</h2><p>Пусть пары пролетают быстро, оценки радуют, а серия без пропусков не заканчивается. Хорошего дня!</p></div></section>`;
  }
  function monthsWithData() {
    return [...new Set((M.visits || []).map((v) => v.date && v.date.slice(0, 7)).filter(Boolean))].sort();
  }
  function summaryMonths() {
    const now = new Date(),
      cur = iso(now).slice(0, 7),
      dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    return monthsWithData().filter((m) => m < cur || (m === cur && now.getDate() > dim - 3));
  }
  function summaryDue() {
    const now = new Date(),
      cur = iso(now).slice(0, 7),
      dim = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
    const prev = iso(new Date(now.getFullYear(), now.getMonth() - 1, 1)).slice(0, 7),
      dis = LS.get("mdis", []);
    const ym = now.getDate() <= 3 ? prev : null; // итоги прошлого месяца - с 1 по 3 число, потом карточка убирается сама
    return ym && !dis.includes(ym) && monthStats(ym) ? ym : null;
  }
  function openSummary(ym) {
    try {
      preCur();
    } catch (e) {}
    const all = summaryMonths();
    if (!all.length) {
      toast("Итоги появятся, когда закончится первый месяц");
      return;
    }
    ym = ym && all.includes(ym) ? ym : all[all.length - 1];
    const st = monthStats(ym);
    if (!st) {
      toast("За этот месяц данных пока нет");
      return;
    }
    const [y, m] = ym.split("-").map(Number),
      mi = m - 1,
      i = all.indexOf(ym),
      first = (M.user.name || "").split(" ")[1] || "";
    const dim = new Date(y, m, 0).getDate(),
      off = (new Date(y, mi, 1).getDay() + 6) % 7;
    let heat = DSH.map((d) => `<b>${d}</b>`).join("") + '<i class="e"></i>'.repeat(off);
    for (let d = 1; d <= dim; d++) {
      const k = `${ym}-${String(d).padStart(2, "0")}`,
        x = st.days[k];
      heat += `<i class="${x ? (x.miss ? (x.miss === x.n ? "mx" : "p") : x.late ? "l" : "g") : ""}" title="${d} ${MONTHS_R[mi]}${x ? " · " + pairsW(x.n) + (x.miss ? ", пропусков: " + x.miss : "") : ""}"></i>`;
    }
    const title =
      st.avg != null && st.avg >= st.top - 0.05 * (st.top / 5)
        ? `${MONTHS_N[mi]}<br><span class="grad">на отлично</span>`
        : !st.miss
          ? `${MONTHS_N[mi]}<br><span class="grad">без пропусков</span>`
          : `${MONTHS_N[mi]}<br><span class="grad">в цифрах</span>`;
    const hue = [0, 20, 40, -20, -40, 60, 30, -10, 0, 25, -30, 50][mi];
    const d = $("#dlg");
    d.classList.remove("wide");
    d.classList.add("sumd");
    delete d.dataset.rate;
    d.innerHTML = `<div class="dlg sumdlg"><div class="sum" style="--hue:${hue}deg">
      <svg class="orn" viewBox="0 0 400 800" preserveAspectRatio="xMidYMid slice" aria-hidden="true"><defs><radialGradient id="sg1" cx="85%" cy="8%" r="65%"><stop offset="0" stop-color="var(--gold-hi)" stop-opacity=".5"/><stop offset="1" stop-color="var(--gold-hi)" stop-opacity="0"/></radialGradient></defs>
        <rect width="400" height="800" fill="url(#sg1)"/><g fill="none" stroke="var(--gold-hi)" stroke-opacity=".2">${[60, 100, 140, 180, 220, 260].map((r) => `<circle cx="370" cy="30" r="${r}"/>`).join("")}</g>
        <g fill="#fff">${Array.from({ length: 22 }, (_, k) => `<circle cx="${(k * 97) % 400}" cy="${((k * 61) % 420) + 20}" r="${(k % 3) * 0.5 + 0.6}" opacity="${0.3 + (k % 4) * 0.15}"/>`).join("")}</g>
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
  function preCur() {
    if (curImg.coin) return;
    ["coin", "gem"].forEach((k) => {
      const m = DN_CSS.match(
        k === "coin"
          ? /\.dn\[data-mc=true\] \.coin,[^{]*\{[^}]*url\((data:image\/png;base64,[^)]+)\)/
          : /\.dn\[data-mc=true\] \.gem\{background-image:url\((data:image\/png;base64,[^)]+)\)/,
      );
      if (m) {
        const im = new Image();
        im.src = m[1];
        curImg[k] = im;
      }
      const j = DN_CSS.match(
        k === "coin"
          ? /\.dn:not\(\[data-mc=true\]\) \.coin,[^{]*\{[^}]*url\((data:image\/svg\+xml;base64,[^)]+)\)/
          : /\.dn:not\(\[data-mc=true\]\) \.gem\{background-image:url\((data:image\/svg\+xml;base64,[^)]+)\)/,
      );
      if (j) {
        const im = new Image();
        im.src = j[1];
        curImg["j" + k] = im;
      }
    });
  }
  function curIcon(g, k, x, y, sz) {
    const im = curImg[k];
    if (cfg.mc && im && im.complete && im.naturalWidth) {
      g.imageSmoothingEnabled = false;
      g.drawImage(im, x, y, sz, sz);
      g.imageSmoothingEnabled = true;
      return;
    }
    const jm = curImg["j" + k];
    if (!cfg.mc && jm && jm.complete && jm.naturalWidth) {
      g.drawImage(jm, x, y, sz, sz);
      return;
    }
    if (k === "coin") {
      const gr = g.createRadialGradient(x + sz * 0.35, y + sz * 0.35, 1, x + sz / 2, y + sz / 2, sz / 2);
      gr.addColorStop(0, "#f3d48f");
      gr.addColorStop(1, "#b7862e");
      g.fillStyle = gr;
      g.beginPath();
      g.arc(x + sz / 2, y + sz / 2, sz / 2, 0, Math.PI * 2);
      g.fill();
      return;
    }
    const gr = g.createLinearGradient(x, y, x + sz, y + sz);
    gr.addColorStop(0, "#8fe0b8");
    gr.addColorStop(1, "#2a9a70");
    g.fillStyle = gr;
    g.beginPath();
    g.moveTo(x + sz / 2, y);
    g.lineTo(x + sz, y + sz * 0.38);
    g.lineTo(x + sz / 2, y + sz);
    g.lineTo(x, y + sz * 0.38);
    g.closePath();
    g.fill();
  }
  function sumPNG(ym) {
    const st = monthStats(ym);
    if (!st) return;
    const [y, m] = ym.split("-").map(Number),
      mi = m - 1,
      W0 = 1080,
      X = 80;
    const acc = (ACC_HEX[cfg.accent] || ACC_HEX.gold)[0],
      good = "#56c596",
      bad = "#e0679e",
      warn = "#e9cf7a",
      ink = "#f2f2f2",
      mut = "#9a9aa2";
    const F = (w, px) =>
      `${w} ${px}px DnBody, Calibri, Carlito, "Segoe UI", -apple-system, Arial, sans-serif`;
    // [значение, подпись, цвет, текстовое значение (название предмета)]
    const tiles = [
      [st.att + "%", `посещаемость · ${st.pairs - st.miss} из ${st.pairs}`, good],
      [String(st.best), plural(st.best, "день", "дня", "дней") + " подряд без пропусков"],
    ];
    if (st.avg == null) tiles.push([String(st.marks), plural(st.marks, "оценка", "оценки", "оценок")]);
    if (st.hwN)
      tiles.push([
        String(st.hwN),
        plural(st.hwN, "задание сдано", "задания сдано", "заданий сдано") +
          (st.hwEarly != null
            ? st.hwEarly < 0
              ? ` · через ${f1(-st.hwEarly)} дн. после срока`
              : ` · за ${f1(st.hwEarly)} дн. до срока`
            : ""),
      ]);
    if (st.coins || st.gems) {
      const t = ["", "начислено за месяц"];
      t.cur = 1;
      tiles.push(t);
    }
    if (M.groupPlace) {
      const r = st.rank || {},
        t = [String(r.last || M.groupPlace), "место в группе (по коинам и гемам)", null];
      t.center = 1;
      tiles.push(t);
    }
    if (st.often) tiles.push([st.often, `чаще всего в расписании · ${pairsW(st.oftenN)}`, null, 1]);
    if (st.bestS) tiles.push([st.bestS, `лучший средний · ${f2(st.bestSAvg)}`, null, 1]);
    // числа - по две в ряд (нечётное последнее - во всю ширину), названия предметов - всегда во всю ширину
    {
      const nums = tiles.filter((t) => !t[3]);
      if (nums.length % 2) nums[nums.length - 1].wide = 1;
      tiles.forEach((t) => {
        if (t[3]) t.wide = 1;
      });
    }
    const dim = new Date(y, m, 0).getDate(),
      off = (new Date(y, mi, 1).getDay() + 6) % 7,
      rows = Math.ceil((off + dim) / 7),
      gap = 12,
      cw = (W0 - 2 * X - 6 * gap) / 7,
      ch = 58,
      th = 150;
    let tRows = 0;
    {
      let col = 0;
      tiles.forEach((t) => {
        if (t.wide) {
          if (col) tRows++;
          tRows++;
          col = 0;
        } else {
          col++;
          if (col === 2) {
            tRows++;
            col = 0;
          }
        }
      });
      if (col) tRows++;
    }
    const H0 =
      120 +
      96 +
      58 +
      (st.avg != null ? 170 : 0) +
      56 +
      tRows * (th + 24) -
      24 +
      66 +
      22 +
      rows * (ch + gap) -
      gap +
      110;
    const c = document.createElement("canvas");
    c.width = W0;
    c.height = H0;
    const g = c.getContext("2d");
    const box = (x, yy, w, h, r) => {
      g.beginPath();
      if (g.roundRect) g.roundRect(x, yy, w, h, r);
      else g.rect(x, yy, w, h);
    };
    const fit = (t, w, px, wt) => {
      let f = px;
      g.font = F(wt, f);
      while (g.measureText(t).width > w && f > 30) {
        f -= 2;
        g.font = F(wt, f);
      }
      if (g.measureText(t).width > w) {
        while (t.length > 3 && g.measureText(t + "…").width > w) t = t.slice(0, -1);
        t += "…";
      }
      return t;
    };
    let gr = g.createLinearGradient(0, 0, W0, H0);
    gr.addColorStop(0, "#050505");
    gr.addColorStop(1, "#111111");
    g.fillStyle = gr;
    g.fillRect(0, 0, W0, H0);
    const rg = g.createRadialGradient(W0 - 90, 70, 10, W0 - 90, 70, 760);
    rg.addColorStop(0, acc + "70");
    rg.addColorStop(1, acc + "00");
    g.fillStyle = rg;
    g.fillRect(0, 0, W0, H0);
    // второй свет снизу, кольца, звёзды и волны внизу - как в окне итогов
    {
      const a2 =
        {
          gold: "#e66e32",
          sapphire: "#14bee6",
          emerald: "#3cc85a",
          amethyst: "#ec488c",
          rose: "#7c5cff",
          graphite: "#6e7382",
        }[cfg.accent] || "#ec488c";
      const r2 = g.createRadialGradient(80, H0 - 80, 10, 80, H0 - 80, 820);
      r2.addColorStop(0, a2 + "40");
      r2.addColorStop(1, a2 + "00");
      g.fillStyle = r2;
      g.fillRect(0, 0, W0, H0);
      g.strokeStyle = acc + "26";
      g.lineWidth = 2;
      for (let r = 140; r <= 740; r += 100) {
        g.beginPath();
        g.arc(W0 - 70, 50, r, 0, Math.PI * 2);
        g.stroke();
      }
      g.fillStyle = "#fff";
      for (let k = 0; k < 60; k++) {
        g.globalAlpha = 0.15 + (k % 5) * 0.1;
        g.beginPath();
        g.arc((k * 977) % W0, (k * 613) % (H0 * 0.55), (k % 3) * 0.6 + 0.8, 0, Math.PI * 2);
        g.fill();
      }
      g.globalAlpha = 1;
      [
        [acc, 0.16, 0],
        [a2, 0.14, 40],
      ].forEach(([c, o, d]) => {
        g.globalAlpha = o;
        g.fillStyle = c;
        g.beginPath();
        g.moveTo(0, H0 - 60 + d / 2);
        g.bezierCurveTo(W0 * 0.3, H0 - 120 + d / 2, W0 * 0.6, H0 - 10, W0, H0 - 80 + d / 2);
        g.lineTo(W0, H0);
        g.lineTo(0, H0);
        g.closePath();
        g.fill();
      });
      g.globalAlpha = 1;
      g.strokeStyle = "rgba(255,255,255,.12)";
      g.lineWidth = 3;
      box(14, 14, W0 - 28, H0 - 28, 56);
      g.stroke();
    }
    const first = (M.user.name || "").split(" ")[1] || "";
    let Y = 120;
    g.textBaseline = "alphabetic";
    g.fillStyle = acc;
    g.font = F(700, 28);
    g.fillText(`ДНЕВНИК · ИТОГИ ${y}`, X, Y);
    Y += 96;
    g.fillStyle = ink;
    g.font = F(700, 96);
    g.fillText(MONTHS_N[mi][0].toUpperCase() + MONTHS_N[mi].slice(1), X, Y);
    Y += 58;
    g.fillStyle = mut;
    g.fillText(
      fit(
        `${first ? first + ", в" : "В"} ${MONTHS_P[mi]} - ${pairsW(st.pairs)} за ${st.dayN} ${plural(st.dayN, "учебный день", "учебных дня", "учебных дней")}`,
        W0 - 2 * X,
        34,
        400,
      ),
      X,
      Y,
    );
    if (st.avg != null) {
      Y += 170;
      const t = f2(st.avg);
      g.fillStyle = ink;
      g.font = F(700, 160);
      g.fillText(t, X - 6, Y);
      const w = g.measureText(t).width;
      g.fillStyle = mut;
      g.font = F(400, 32);
      g.fillText("средний балл за месяц", X + w + 34, Y - 62);
      g.fillStyle = good;
      g.font = F(700, 32);
      g.fillText(`${st.tops} из ${st.marks} - «${st.top}»`, X + w + 34, Y - 16);
    }
    Y += 56;
    const tw = (W0 - 2 * X - 24) / 2;
    let col = 0;
    tiles.forEach((t) => {
      const w = t.wide ? W0 - 2 * X : tw;
      if (t.wide && col) {
        Y += th + 24;
        col = 0;
      }
      const tx = X + col * (tw + 24);
      {
        const tg = g.createLinearGradient(0, Y, 0, Y + th);
        tg.addColorStop(0, "rgba(255,255,255,.075)");
        tg.addColorStop(1, "rgba(255,255,255,.025)");
        g.fillStyle = tg;
      }
      box(tx, Y, w, th, 32);
      g.fill();
      g.strokeStyle = "rgba(255,255,255,.12)";
      g.lineWidth = 2;
      g.stroke();
      if (t.cur) {
        let x0 = tx + 30;
        g.font = F(700, 56);
        [
          [st.coins || 0, "coin"],
          [st.gems || 0, "gem"],
        ].forEach(([n, k]) => {
          const v = "+" + n;
          g.fillStyle = ink;
          g.fillText(v, x0, Y + 80);
          x0 += g.measureText(v).width + 10;
          curIcon(g, k, x0, Y + 38, 42);
          x0 += 42 + 30;
        });
      } else {
        g.fillStyle = t[2] || ink;
        const v = fit(t[0], w - 60, t[3] ? 46 : 62, 700);
        if (t.center) {
          const vw = g.measureText(v).width,
            iw = 46,
            x0 = tx + w / 2 - (iw + 16 + vw) / 2;
          g.save();
          g.translate(x0, Y + 32);
          g.scale(iw / 24, iw / 24);
          g.strokeStyle = acc;
          g.lineWidth = 2;
          g.lineCap = "round";
          g.lineJoin = "round";
          g.stroke(
            new Path2D(
              "M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0zM17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3",
            ),
          );
          g.restore();
          g.fillText(v, x0 + iw + 16, Y + 82);
        } else g.fillText(v, tx + 30, Y + (t[3] ? 76 : 82));
      }
      g.fillStyle = mut;
      {
        const l = fit(t[1], w - 60, 26, 400);
        if (t.center) {
          g.textAlign = "center";
          g.fillText(l, tx + w / 2, Y + 124);
          g.textAlign = "left";
        } else g.fillText(l, tx + 30, Y + 124);
      }
      if (t.wide) {
        Y += th + 24;
        col = 0;
      } else if (++col === 2) {
        Y += th + 24;
        col = 0;
      }
    });
    if (col) Y += th + 24;
    Y += 42;
    g.fillStyle = mut;
    g.font = F(700, 24);
    g.fillText("КАЛЕНДАРЬ МЕСЯЦА", X, Y);
    {
      let lx = W0 - X;
      g.font = F(400, 22);
      [
        ["пропуск", bad],
        ["частично", bad + "88"],
        ["опоздание", warn],
        ["все пары", good],
      ].forEach(([t, cl]) => {
        const w = g.measureText(t).width;
        lx -= w;
        g.fillStyle = mut;
        g.fillText(t, lx, Y);
        lx -= 26;
        g.fillStyle = cl;
        box(lx, Y - 17, 16, 16, 5);
        g.fill();
        lx -= 22;
      });
    }
    Y += 22;
    for (let d = 1; d <= dim; d++) {
      const k = off + d - 1,
        cx = X + (k % 7) * (cw + gap),
        cy = Y + Math.floor(k / 7) * (ch + gap),
        x = st.days[`${ym}-${String(d).padStart(2, "0")}`];
      g.fillStyle = !x
        ? "rgba(255,255,255,.04)"
        : x.miss
          ? x.miss === x.n
            ? bad
            : bad + "88"
          : x.late
            ? warn
            : good;
      box(cx, cy, cw, ch, 14);
      g.fill();
      g.fillStyle = x && !(x.miss && x.miss < x.n) ? "#0b0b0b" : mut;
      g.font = F(700, 24);
      g.fillText(String(d), cx + 16, cy + ch / 2 + 9);
    }
    g.fillStyle = mut;
    g.font = F(400, 24);
    g.fillText("Всё посчитано по данным журнала · Дневник", X, H0 - 50);
    const url = c.toDataURL("image/png"),
      name = `itogi-${ym}.png`;
    // на телефоне и планшете - меню «Поделиться» (можно сохранить в Фото), на компьютере - обычная загрузка
    try {
      const bin = atob(url.split(",")[1]),
        u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const file = new File([u8], name, { type: "image/png" });
      const touch =
        /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
        (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
      if (touch && navigator.canShare && navigator.canShare({ files: [file] })) {
        navigator.share({ files: [file] }).catch(() => {});
        return;
      }
    } catch (e) {}
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    (document.body || document.documentElement).appendChild(a);
    a.click();
    setTimeout(() => a.remove(), 1500);
    toast("Картинка сохранена");
  }
  VIEWS.grades = (s) => {
    const V = M.visits || [];
    const subjStats = {};
    V.forEach((v) => {
      const o = (subjStats[v.subj] = subjStats[v.subj] || { n: 0, miss: 0, m: [] });
      o.n++;
      if (v.miss) o.miss++;
      ["hw", "cw", "lab", "ctrl", "prac"].forEach((k) => v[k] != null && o.m.push(v[k]));
    });
    const keys = Object.keys(subjStats).sort((a, b) => subjStats[b].n - subjStats[a].n);
    const weeks = {};
    V.forEach((v) => {
      const k = iso(mondayOf(fromIso(v.date)));
      weeks[k] = weeks[k] || { p: 0, x: 0 };
      v.miss ? weeks[k].x++ : weeks[k].p++;
    });
    const wk = Object.keys(weeks)
      .sort()
      .slice(-6)
      .map((k) => ({ mon: fromIso(k), ...weeks[k] }));
    const wmax = Math.max(1, ...wk.map((w) => w.p + w.x));
    const calYms = [...new Set(V.map((v) => v.date.slice(0, 7)))].sort();
    if (!calYm || !calYms.includes(calYm)) calYm = calYms[calYms.length - 1] || iso(new Date()).slice(0, 7);
    const ci = calYms.indexOf(calYm),
      y = +calYm.slice(0, 4),
      mo = +calYm.slice(5, 7) - 1,
      first = new Date(y, mo, 1),
      off = (first.getDay() + 6) % 7,
      dim = new Date(y, mo + 1, 0).getDate(),
      now = new Date();
    const byDay = {};
    V.forEach((v) => {
      const d = fromIso(v.date);
      if (d.getMonth() === mo && d.getFullYear() === y)
        (byDay[d.getDate()] = byDay[d.getDate()] || []).push(v);
    });
    let cal =
      DSH.map((d) => `<div class="wd">${d}</div>`).join("") + `<div class="c blank"></div>`.repeat(off);
    for (let w = mondayOf(first); w <= new Date(y, mo, dim); w = dayDate(w, 7))
      if (!M.schedule[iso(w)] || !(M.schedLive && M.schedLive[iso(w)])) ensureWeek(w);
    for (let d = 1; d <= dim; d++) {
      const ls = byDay[d] || [],
        any = ls.some((x) => x.miss),
        dt = new Date(y, mo, d),
        plan = (M.schedule[iso(dt)] || []).length,
        n = Math.max(ls.length, plan),
        fut = dt > now && !sameDay(dt, now);
      // отметки посещений + пары по расписанию, которые ещё не отмечены (серые) или впереди (пунктир)
      const lateD = !any && ls.some((x) => x.late);
      const bars =
        ls.map((x) => `<i class="${x.miss ? "x" : x.late ? "l" : ""}"></i>`).join("") +
        `<i class="${fut ? "p" : "u"}"></i>`.repeat(n - ls.length);
      cal += `<div class="c ${ls.length ? "has" : ""} ${any ? "part" : ""} ${lateD ? "lt" : ""} ${!ls.length && dt > now ? "fut" : ""}" title="${n ? pairsW(n) + (ls.length < n ? ` · отмечено ${ls.length}` : "") + (any ? ", есть пропуски" : "") + (lateD ? ", опоздание" : "") : ""}"><span class="num">${d}</span><span class="bars">${bars}</span></div>`;
    }
    return `
    ${summaryMonths().length ? `<div class="card hint">${ic("star")}<div><b>Итоги месяца</b><span>Оценки, посещаемость, серии и календарь - за каждый месяц</span></div><button class="m-btn pri" data-act="month">Открыть</button></div>` : ""}
    <div class="row r4">
      <div class="card kpi"><div class="lab">${ic("star")}Средний балл</div><div class="val num">${s.marks ? f2(s.avg) : "-"}</div><div class="sub">${s.allTop ? `все <b class="num">${s.marks}</b> оценок - «${s.maxMark}»` : `по <b class="num">${s.marks}</b> оценкам`}</div></div>
      <div class="card kpi"><div class="lab">${ic("hw")}За домашние</div><div class="val num">${s.hwN}</div><div class="sub">оценок за ДЗ</div></div>
      <div class="card kpi"><div class="lab">${ic("users")}За работу на паре</div><div class="val num">${s.cwN}</div><div class="sub">оценок за классную работу${
        s.otherN
          ? `<span class="oth">${["lab", "ctrl", "prac", "fin"]
              .map((k) => [k, (M.visits || []).filter((v) => v[k] != null).length])
              .filter((x) => x[1])
              .map(
                ([k, n]) => `<span><i class="mark5 ${k} sw"></i>${MK_N[k]}: <b class="num">${n}</b></span>`,
              )
              .join("")}</span>`
          : ""
      }</div></div>
      <div class="card kpi"><div class="lab">${ic("check")}Пропуски</div><div class="val num">${s.miss}<small>из ${s.total}</small></div><div class="sub">${s.late ? `опозданий <b class="num">${s.late}</b>` : "опозданий нет"}</div></div>
    </div>
    ${cfg.goals === false ? "" : `<div class="row r2 goals">${goalHTML()}${attGoalHTML()}</div>`}
    ${pairsHTML(V, keys)}
    <div class="row r2 calrow">
      <div class="card calc"><div class="hd"><h2>${MONN[mo]} по дням</h2>${calYms.length > 1 ? `<div class="calnav"><button class="hc-ar" data-calm="-1" ${ci <= 0 ? "disabled" : ""} aria-label="Предыдущий месяц">‹</button><button class="hc-ar" data-calm="1" ${ci >= calYms.length - 1 ? "disabled" : ""} aria-label="Следующий месяц">›</button></div>` : ""}</div><div class="cal">${cal}</div><div class="legend"><span><i style="background:var(--good)"></i>Все пары</span><span><i style="background:var(--late)"></i>Опоздание</span><span><i style="background:var(--bad)"></i>Пропуск</span><span><i style="background:#4a4a52"></i>Нет отметки / впереди</span></div></div>
      <div class="card wkc"><div class="hd"><h2>Посещаемость по неделям</h2><small>доля посещённых пар</small></div>
        <div class="wkchart2">${wk
          .map((w) => {
            const t = w.p + w.x,
              pc = t ? Math.round((w.p / t) * 100) : 0;
            return `<div class="col" title="Был на ${w.p}, пропустил ${w.x}"><b class="num wk-pc ${attCls(pc)}">${pc}%</b><small class="num wk-n">${w.p} из ${t}</small><div class="tr"><i style="height:${pc}%;--z:var(--${pc < 70 ? "bad" : pc < 90 ? "warn" : "good"})"></i></div><span class="num dt">${dm(w.mon)} - ${dm(dayDate(w.mon, 6))}</span></div>`;
          })
          .join("")}</div>
        <div class="legend"><span><i style="background:var(--good)"></i>от 90%</span><span><i style="background:var(--warn)"></i>70-89%</span><span><i style="background:var(--bad)"></i>ниже 70%</span></div></div>
    </div>
    ${avgChartHTML(s)}
    <div class="card"><div class="hd"><h2>По предметам</h2><small>по данным журнала</small></div>
      <div class="tscroll"><table class="t"><thead><tr><th>Предмет</th><th class="r">Пар</th><th class="r">Оценок</th><th class="r"><span class="lg">Средний</span><span class="sh">Ср.</span></th><th class="r"><span class="lg">Посещаемость</span><span class="sh">Посещ.</span></th></tr></thead><tbody>
      ${keys
        .map((k) => {
          const o = subjStats[k],
            a = Math.round(((o.n - o.miss) / o.n) * 100),
            av = o.m.length ? o.m.reduce((x, y) => x + y, 0) / o.m.length : null;
          return `<tr><td><span class="tag s-${subjKey(k)}">${esc(k)}</span></td><td class="r num">${o.n}</td><td class="r num">${o.m.length}</td><td class="r num">${av != null ? f1(av) : "-"}</td><td class="r num ${attCls(a)}">${a}%</td></tr>`;
        })
        .join("")}
      </tbody></table></div></div>`;
  };
  const MSH = ["Янв", "Фев", "Мар", "Апр", "Май", "Июн", "Июл", "Авг", "Сен", "Окт", "Ноя", "Дек"];
  let avgMode = null,
    avgW = 900,
    avgFocus = "both",
    lbMode = LS.get("lb", "group");
  // график рисуется точно под ширину карточки, чтобы текст не сжимался
  let avgRO = null;
  function fitAvg() {
    const c = R && R.querySelector(".avgc");
    if (!c) return;
    const w = Math.round(c.clientWidth - 36);
    if (w > 120 && Math.abs(w - avgW) > 6) {
      avgW = w;
      c.outerHTML = avgChartHTML(stats());
    }
    const pg = R.querySelector("#page");
    if (typeof ResizeObserver === "function" && pg && !avgRO) {
      let t;
      avgRO = new ResizeObserver(() => {
        clearTimeout(t);
        t = setTimeout(fitAvg, 150);
      });
      avgRO.observe(pg);
    }
  }
  // два графика в одном: средний балл (левая шкала) и посещаемость в % (правая шкала)
  function avgChartHTML(s) {
    const V = M.visits || [];
    const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
    const bucket = (keyOf) => {
      const b = {};
      V.forEach((v) => {
        const k = keyOf(v);
        const o = (b[k] = b[k] || { m: [], n: 0, x: 0 });
        o.n++;
        if (v.miss) o.x++;
        MK.forEach((m) => v[m] != null && o.m.push(v[m]));
      });
      return b;
    };
    const byM = bucket((v) => v.date.slice(0, 7)),
      byW = bucket((v) => iso(mondayOf(fromIso(v.date))));
    const apiM = {};
    (M.avg || []).forEach((x) => {
      if (x.v > 0 && x.v <= 12) apiM[x.date.slice(0, 7)] = x.v;
    });
    const apiA = {};
    (M.attChart || []).forEach((x) => {
      if (x.v > 0) apiA[x.date.slice(0, 7)] = x.v;
    });
    const months = Object.keys(byM).sort().slice(-8);
    const mode = avgMode || (months.length >= 3 ? "month" : "week");
    const keys = mode === "month" ? months : Object.keys(byW).sort().slice(-6),
      B = mode === "month" ? byM : byW;
    const pts = keys.map((k) => {
      const o = B[k];
      return {
        lab: mode === "month" ? MSH[+k.slice(5, 7) - 1] : dm(fromIso(k)),
        g: mode === "month" && apiM[k] != null ? apiM[k] : mean(o.m),
        a: mode === "month" && apiA[k] != null ? apiA[k] : o.n ? ((o.n - o.x) / o.n) * 100 : null,
      };
    });
    const head = `<div class="hd"><h2>Средние показатели</h2><div class="pill" role="group"><button data-am="week" aria-pressed="${mode === "week"}">Недели</button><button data-am="month" aria-pressed="${mode === "month"}">Месяцы</button></div></div>`;
    if (!pts.length)
      return `<section class="card avgc">${head}<p class="note">Данных пока нет - график появится после первых пар.</p></section>`;
    const gv = pts.map((p) => p.g).filter((x) => x != null),
      av = pts.map((p) => p.a).filter((x) => x != null);
    // шкалы подобраны так, что у обеих ровно 6 делений и сетка общая: балл 2,5-5 (или 2-12), посещаемость 0-100%
    const big = s.scale > 5,
      gLo = big ? 2 : 2.5,
      gTop = big ? 12 : 5;
    const Wd = Math.max(240, avgW),
      H = avgW < 420 ? 200 : 240,
      L = 34,
      Rr = 44,
      T = 14,
      Bt = 28,
      ih = H - T - Bt;
    const X = (i) =>
      pts.length === 1 ? (L + Wd - Rr) / 2 : L + 14 + (i * (Wd - L - Rr - 28)) / (pts.length - 1);
    const Yg = (v) => T + ((gTop - Math.max(gLo, Math.min(gTop, v))) / (gTop - gLo)) * ih,
      Ya = (v) => T + ((100 - Math.max(0, Math.min(100, v))) / 100) * ih;
    let grid = "";
    for (let i = 0; i <= 5; i++) {
      const y = T + (i * ih) / 5,
        g = gTop - (i * (gTop - gLo)) / 5;
      grid += `<line class="gl" x1="${L}" x2="${Wd - Rr}" y1="${y}" y2="${y}"/><text class="ax g" x="${L - 8}" y="${y + 4}" text-anchor="end">${big ? g : String(g).replace(".", ",")}</text><text class="ax a" x="${Wd - Rr + 8}" y="${y + 4}">${100 - i * 20}%</text>`;
    }
    const qa = pts.map((p, i) => (p.a != null ? [X(i), Ya(p.a), p.a] : null)).filter(Boolean),
      qg = pts.map((p, i) => (p.g != null ? [X(i), Yg(p.g), p.g] : null)).filter(Boolean);
    // плавная линия через точки (кривые Безье по соседям), без заливки под ней
    const cy = (y) => Math.min(T + ih, Math.max(T, y)).toFixed(1); // кривая не выходит за шкалу
    const line = (q) =>
      q
        .map((p, i) => {
          if (!i) return `M${p[0]},${p[1]}`;
          const a = q[i - 2] || q[i - 1],
            b = q[i - 1],
            c = p,
            d = q[i + 1] || p,
            k = 0.18;
          const y1 = cy(b[1] + (c[1] - a[1]) * k),
            y2 = cy(c[1] - (d[1] - b[1]) * k);
          return `C${(b[0] + (c[0] - a[0]) * k).toFixed(1)},${Math.abs(b[1] - c[1]) < 0.5 ? b[1] : y1} ${(c[0] - (d[0] - b[0]) * k).toFixed(1)},${Math.abs(b[1] - c[1]) < 0.5 ? c[1] : y2} ${c[0]},${c[1]}`;
        })
        .join("");
    let body = "";
    if (qa.length > 1)
      body += `<path class="ln" stroke="var(--att)" style="color:var(--att)" d="${line(qa)}"/>`;
    if (qg.length > 1)
      body += `<path class="ln" stroke="var(--gcol)" style="color:var(--gcol)" d="${line(qg)}"/>`;
    const la = qa[qa.length - 1],
      lg = qg[qg.length - 1];
    // подписи последних значений: верхняя - над точкой, нижняя - под точкой
    const aTop = la && lg ? la[1] <= lg[1] : true;
    if (la)
      body += `<circle cx="${la[0]}" cy="${la[1]}" r="4.5" fill="var(--att)" stroke="var(--surface)" stroke-width="2"/><text class="vl" x="${la[0] - 6}" y="${aTop ? la[1] - 10 : la[1] + 19}" text-anchor="end">${Math.round(la[2])}%</text>`;
    if (lg)
      body += `<circle cx="${lg[0]}" cy="${lg[1]}" r="4.5" fill="var(--gcol)" stroke="var(--surface)" stroke-width="2"/><text class="vl" x="${lg[0] - 6}" y="${aTop ? lg[1] + 19 : lg[1] - 10}" text-anchor="end">${f2(lg[2])}</text>`;
    const xl = pts
      .map((p, i) => `<text class="ax" x="${X(i)}" y="${H - 6}" text-anchor="middle">${p.lab}</text>`)
      .join("");
    const lastG = gv.length ? gv[gv.length - 1] : null,
      lastA = av.length ? av[av.length - 1] : null;
    const dG = gv.length > 1 ? lastG - gv[gv.length - 2] : null,
      dA = av.length > 1 ? lastA - av[av.length - 2] : null;
    // изменение - нейтральное: рост при низкой посещаемости не должен выглядеть «хорошо»
    const tr = (d, f) =>
      d == null
        ? ""
        : ` <small class="dlt">${d > 0 ? "▲" : d < 0 ? "▼" : ""} ${f(Math.abs(d))} за ${mode === "month" ? "месяц" : "неделю"}</small>`;
    return `<section class="card avgc">${head}
      <div class="avg-kpis"><span><i style="background:var(--gcol)"></i>Средний балл<b class="num">${lastG != null ? f2(lastG) : "-"}</b>${tr(dG, f2)}</span><span><i style="background:var(--att)"></i>Посещаемость<b class="num ${attCls(lastA)}">${lastA != null ? Math.round(lastA) + "%" : "-"}</b>${tr(dA, (x) => Math.round(x) + "%")}</span></div>
      <svg viewBox="0 0 ${Wd} ${H}" preserveAspectRatio="xMidYMid meet" style="height:${H}px" role="img" aria-label="Средний балл и посещаемость">${grid}${body}${xl}</svg>
      <div class="legend"><span><i style="background:var(--gcol)"></i>средний балл - левая шкала</span><span><i style="background:var(--att)"></i>посещаемость - правая шкала</span></div></section>`;
  }
  // «Все пары»: выбранный месяц и неделя; показывается одна неделя, недели листаются пальцем (прокрутка со «щелчком»)
  let gp = { ym: null, wk: null };
  function pairsHTML(V, keys) {
    if (!V.length)
      return `<div class="card"><div class="hd"><h2>Все пары</h2></div><p class="note">Пока нет данных о парах</p></div>`;
    const yms = [...new Set(V.map((v) => v.date.slice(0, 7)))].sort().reverse();
    if (!gp.ym || !yms.includes(gp.ym)) gp.ym = yms[0];
    const inM = V.filter((v) => v.date.slice(0, 7) === gp.ym);
    const wks = [...new Set(inM.map((v) => iso(mondayOf(fromIso(v.date)))))].sort();
    if (!gp.wk || !wks.includes(gp.wk)) gp.wk = wks[wks.length - 1];
    wks.forEach((w) => {
      if (M.schedule[w] === undefined) ensureWeek(fromIso(w));
    });
    const slots = Math.min(
      7,
      Math.max(
        3,
        ...V.filter((v) => wks.includes(iso(mondayOf(fromIso(v.date))))).map((v) => v.ln + 1),
        ...inM.map((v) => lessonsOn(fromIso(v.date)).length),
      ),
    );
    const mk = (v) =>
      MK.filter((k) => v[k] != null)
        .map((k) => `<span class="mark5 ${k} ${vClass(v[k])}" title="${MK_N[k]}">${v[k]}</span>`)
        .join("");
    const card = (
      v,
    ) => `<button class="pc2 ${v.miss ? "x" : v.late ? "l" : ""} ${isNew("grades", vKey(v)) ? "isnew" : ""}" style="--col:${Math.min(slots, v.ln + 1)}" data-g="${v.n}" data-subj="${esc(v.subj)}" data-m="${MK.some((k) => v[k] != null) ? 1 : 0}" data-x="${v.miss ? 1 : 0}" title="${esc(v.subj)}${v.miss ? " · пропуск" : v.late ? " · опоздание" : ""}">
      <span class="pb"><span class="pn num">${v.ln + 1} пара<i></i>№${v.n}</span><span class="ps">${esc(v.subj)}</span></span><span class="pm">${mk(v)}</span></button>`;
    const weekStat = (w) => {
      const L = V.filter((v) => iso(mondayOf(fromIso(v.date))) === w);
      return {
        n: L.length,
        x: L.filter((v) => v.miss).length,
        m: L.reduce((a, v) => a + MK.filter((k) => v[k] != null).length, 0),
      };
    };
    const mv = cfg.gpv === "month";
    const page = (w) => {
      const L = (mv ? inM : V).filter((v) => iso(mondayOf(fromIso(v.date))) === w),
        days = [...new Set(L.map((v) => v.date))].sort();
      return `<div class="gpage" data-w="${w}">${days
        .map((d) => {
          const dt = fromIso(d);
          return `<div class="gday${d === iso(new Date()) ? " td" : ""}"><h4 class="num">${dm(dt)}<span>${DSH[(dt.getDay() + 6) % 7].toLowerCase()}</span></h4><div class="grow2" style="--slots:${slots}">${(() => {
            const dl = L.filter((v) => v.date === d).sort((a, b) => a.ln - b.ln),
              um = unmarked(d, dl),
              mx = Math.min(slots - 1, Math.max(...dl.map((v) => v.ln), ...um.map((u) => u.ln)));
            let h = "";
            for (let ln = 0; ln <= mx; ln++) {
              const here = dl.filter((v) => Math.min(slots, v.ln + 1) === ln + 1),
                u = um.find((x) => x.ln === ln);
              h += here.length
                ? here.map(card).join("")
                : u
                  ? `<div class="pc0 u s-${subjKey(u.subj)}" style="--col:${ln + 1}"><span>${ln + 1} пара · ${esc(u.start)}</span><b>${esc(subjShort(u.subj))}</b> · нет отметки в журнале</div>`
                  : `<div class="pc0" style="--col:${ln + 1}"><span>${ln + 1} пара</span>пары не было</div>`;
            }
            return h;
          })()}</div></div>`;
        })
        .join("")}</div>`;
    };
    const st = weekStat(gp.wk),
      wEnd = (w) => dm(dayDate(fromIso(w), 6));
    const legend =
      MK.filter((k) => k === "hw" || k === "cw" || inM.some((v) => v[k] != null))
        .map((k) => `<span><span class="mark5 ${k} sw"></span>${MK_N[k]}</span>`)
        .join("") +
      `<span class="stl"><b style="background:var(--bad)"></b>Пропуск</span><span class="stl"><b style="background:var(--late)"></b>Опоздание</span>`;
    return `<div class="card gpairs"><div class="hd"><h2>Все пары</h2><select class="sel" id="gym">${yms.map((m) => `<option value="${m}" ${m === gp.ym ? "selected" : ""}>${MONN[+m.slice(5) - 1]} ${m.slice(0, 4)}</option>`).join("")}</select></div>
      ${mv ? "" : `<div class="gtabs" role="tablist">${wks.map((w, i) => `<button role="tab" data-gw="${w}" aria-pressed="${w === gp.wk}"><b>Неделя ${i + 1}</b><small class="num">${dm(fromIso(w))} - ${wEnd(w)}</small></button>`).join("")}</div>`}
      <div class="gfbar"><div class="legend gleg">${legend}</div>
        <span class="gflt"><span class="pill" role="group">${[
          ["all", "Все"],
          ["marks", "С оценками"],
          ["miss", "Пропуски"],
        ]
          .map(([k, n]) => `<button data-gm="${k}" aria-pressed="${gf.mode === k}">${n}</button>`)
          .join("")}</span>
        <select class="sel" id="gsubj"><option value="">Все предметы</option>${keys.map((k) => `<option value="${esc(k)}" ${gf.subj === k ? "selected" : ""}>${esc(k)}</option>`).join("")}</select></span></div>
      ${mv ? "" : `<div class="gsum"><span id="gsum"><b class="num">${dm(fromIso(gp.wk))} - ${wEnd(gp.wk)}</b> · ${pairsW(st.n)} · пропусков <b class="num ${st.x ? "stat-bad" : ""}">${st.x}</b> · оценок <b class="num">${st.m}</b></span></div>`}
      ${
        mv
          ? monthTiles(inM)
          : `<div class="gpager" id="gpager">${wks.map(page).join("")}</div>
      ${wks.length > 1 ? `<div class="gdots">${wks.map((w) => `<i class="${w === gp.wk ? "on" : ""}"></i>`).join("")}</div><div class="gswipe">смахни, чтобы перейти к другой неделе</div>` : ""}`
      }</div>`;
  }
  function unmarked(d, dl) {
    const now = Date.now(),
      sch = lessonsOn(fromIso(d)).filter((l) => l.end && atTime(d, l.end).getTime() < now),
      extra = sch.length - dl.length;
    if (extra <= 0) return []; // только уже прошедшие пары
    const pi = pairIndex(),
      lns = new Set(dl.map((v) => v.ln));
    let L = sch
      .map((l) => ({ ln: pi(l.start), subj: l.subj, start: l.start }))
      .filter((x) => x.ln >= 0 && !lns.has(x.ln));
    if (L.length !== extra)
      L = sch.slice(-extra).map((l) => ({ ln: pi(l.start), subj: l.subj, start: l.start }));
    return L;
  }
  // все пары за месяц плиткой, как в дневнике журнала: свежие дни сверху, каждый день - своя рамка с датой, пары внутри по порядку.
  // Оценки - кружками, пропуск/опоздание - отдельной меткой в углу, чтобы не путались с оценками
  function monthTiles(L) {
    const days = [...new Set(L.map((v) => v.date))].sort().reverse(),
      td = iso(new Date());
    const mk = (v) =>
      MK.filter((k) => v[k] != null)
        .map((k) => `<span class="mark5 ${k} ${vClass(v[k])}" title="${MK_N[k]}">${v[k]}</span>`)
        .join("");
    // Н/О - отдельная метка; если за пару с пропуском всё же стоит оценка, остаётся только цветная рамка
    const tile = (v) => {
      const has = MK.some((k) => v[k] != null),
        lab = "";
      return `<button class="mt s-${subjKey(v.subj)} ${v.miss ? "x" : v.late ? "l" : ""} ${isNew("grades", vKey(v)) ? "isnew" : ""}" data-g="${v.n}" data-subj="${esc(v.subj)}" data-m="${has ? 1 : 0}" data-x="${v.miss ? 1 : 0}" title="${esc(v.subj)} · ${v.ln + 1} пара${v.miss ? " · пропуск" : v.late ? " · опоздание" : ""}">
      ${lab ? `<em class="st ${v.miss ? "x" : "l"}">${lab}</em>` : ""}<span class="mt-t num">${v.ln + 1} пара</span><b class="num">${v.n}</b><span class="mt-s"><i></i><span>${esc(subjShort(v.subj))}</span></span><span class="mt-m">${mk(v)}${lab ? `<span class="st2 ${v.miss ? "x" : "l"}">${lab}</span>` : ""}${!has && !lab ? '<span class="mt-0"></span>' : ""}</span></button>`;
    };
    const tile0 = (u) =>
      `<div class="mt u s-${subjKey(u.subj)}" title="${esc(u.subj)} · пара есть в расписании, но в журнале нет отметки"><span class="mt-t num">${u.ln + 1} пара</span><b>-</b><span class="mt-s"><i></i><span>${esc(subjShort(u.subj))}</span></span><span class="mt-m"><span class="mt-nm">нет отметки</span></span></div>`;
    let prevW = "";
    return `<div class="mtiles">${days
      .map((d) => {
        const dt = fromIso(d),
          w = iso(mondayOf(dt)),
          nw = w !== prevW;
        prevW = w;
        const dl = L.filter((v) => v.date === d).sort((a, b) => a.ln - b.ln),
          x = dl.filter((v) => v.miss).length,
          um = unmarked(d, dl);
        const items = [...dl.map((v) => [v.ln, tile(v)]), ...um.map((u) => [u.ln, tile0(u)])].sort(
          (a, b) => b[0] - a[0],
        );
        return `${nw ? `<div class="mt-wk"><b>${dm(fromIso(w))} - ${dm(dayDate(fromIso(w), 6))}</b></div>` : ""}<section class="mday ${d === td ? "td" : ""}"><header class="mday-h"><b class="num">${dm(dt)}</b><span>${DAYS[(dt.getDay() + 6) % 7].toLowerCase()}</span><small class="num">${pairsW(dl.length + um.length)}${x ? ` · <span class="stat-bad">пропусков ${x}</span>` : ""}</small></header><div class="mday-l">${items.map((z) => z[1]).join("")}</div></section>`;
      })
      .join("")}</div>`;
  }
  // после отрисовки: встаём на выбранную неделю, при листании - переключаем кнопку недели, точки и итог
  function bindPairs() {
    const pg = R && R.querySelector("#gpager");
    if (!pg) return;
    const pages = [...pg.querySelectorAll(".gpage")],
      tabs = [...R.querySelectorAll(".gtabs [data-gw]")],
      dots = [...R.querySelectorAll(".gdots i")];
    let cur = Math.max(
      0,
      pages.findIndex((p) => p.dataset.w === gp.wk),
    );
    // высота - по текущей неделе; меняется только когда лист встал, во время листания не дёргается
    const fit = (i) => {
      if (pages[i]) pg.style.height = pages[i].offsetHeight + "px";
    };
    const sumOf = (i) => {
      const w = pages[i] && pages[i].dataset.w;
      if (!w) return;
      const L = (M.visits || []).filter((v) => iso(mondayOf(fromIso(v.date))) === w),
        x = L.filter((v) => v.miss).length,
        m = L.reduce((a, v) => a + MK.filter((k) => v[k] != null).length, 0);
      const sm = R && R.querySelector("#gsum");
      if (sm)
        sm.innerHTML = `<b class="num">${dm(fromIso(w))} - ${dm(dayDate(fromIso(w), 6))}</b> · ${pairsW(L.length)} · пропусков <b class="num ${x ? "stat-bad" : ""}">${x}</b> · оценок <b class="num">${m}</b>`;
    };
    const light = (i) => {
      tabs.forEach((b, j) => b.setAttribute("aria-pressed", j === i));
      dots.forEach((d, j) => d.classList.toggle("on", j === i));
      sumOf(i);
    };
    const center = (i) => {
      const b = tabs[i];
      if (!b) return;
      const tb = b.parentElement;
      tb.scrollLeft = b.offsetLeft - tb.offsetLeft - (tb.clientWidth - b.offsetWidth) / 2;
    };
    const settle = (i) => {
      const w = pages[i] && pages[i].dataset.w;
      if (!w || !R) return;
      gp.wk = w;
      fit(i);
      center(i);
    };
    let ready = false;
    const go0 = () => {
      pg.scrollLeft = cur * pg.clientWidth;
    };
    fit(cur);
    go0();
    light(cur);
    center(cur);
    requestAnimationFrame(() => {
      go0();
      setTimeout(() => {
        go0();
        ready = true;
      }, 250);
    });
    pg._go = (i) => {
      cur = i;
      light(i);
      pg.scrollLeft = i * pg.clientWidth;
      settle(i);
    };
    // при листании пальцем вкладка недели переключается в тот же кадр, итог и высота - когда лист встал
    let raf = 0,
      t = 0;
    pg.addEventListener(
      "scroll",
      () => {
        if (!ready || raf) return;
        raf = requestAnimationFrame(() => {
          raf = 0;
          const i = Math.round(pg.scrollLeft / Math.max(1, pg.clientWidth));
          if (i !== cur) {
            cur = i;
            light(i);
          }
          clearTimeout(t);
          t = setTimeout(() => settle(cur), 120);
        });
      },
      { passive: true },
    );
  }
  function applyGF() {
    R.querySelectorAll(".pc2,.mt").forEach((el) => {
      let ok = true;
      if (gf.mode === "marks") ok = el.dataset.m === "1";
      if (gf.mode === "miss") ok = el.dataset.x === "1";
      if (gf.subj && el.dataset.subj !== gf.subj) ok = false;
      el.classList.toggle("dim", !ok);
    });
  }

  VIEWS.homework = (s) => {
    const c = M.hwStat,
      all = c.total || c.all;
    const subs = [...new Set((M.hw || []).map((h) => h.subj))];
    const HK = hwKeyed();
    const card = (h) => {
      const early = h.sub && h.due ? dayDiff(fromIso(h.sub), fromIso(h.due)) : null,
        left = h.due ? dayDiff(new Date(), fromIso(h.due)) : null;
      const badge =
        h.status === "done"
          ? `<span class="grade num ${vClass(h.mark)}" ${h.auto ? 'title="Оценка выставлена автоматически"' : ""}>${h.mark}</span>`
          : h.status === "wait"
            ? `<span class="wait" title="На проверке">${ic("clock")}</span>`
            : `<span class="wait ${h.status === "late" ? "bad" : ""}">${ic("hw")}</span>`;
      const foot =
        h.status === "cur" || h.status === "late"
          ? `<span>${h.status === "late" ? '<span class="late">Просрочено</span>' : left != null ? (left < 0 ? '<span class="late">Просрочено</span>' : left === 0 ? '<span class="late">Сегодня до 23:59</span>' : left === 1 ? "<b>Завтра</b> до 23:59" : `Осталось <b class="num">${left}</b> ${plural(left, "день", "дня", "дней")}`) : ""}</span>`
          : `<span>${early == null ? "" : early > 0 ? `За <b class="num">${early}</b> ${plural(early, "день", "дня", "дней")} до срока` : early === 0 ? "<b>В день срока</b>" : '<span class="late">Позже срока</span>'}</span>`;
      const nw = HK.has(h) && isNew("homework", HK.get(h));
      return `<article class="hw s-${subjKey(h.subj)} ${nw ? "isnew" : ""} ${h.status === "cur" && left != null && left <= 0 ? "dueday" : ""}"><div class="top2"><div><b>${esc(h.subj)}</b>${h.lab ? '<span class="labtag">лабораторная</span>' : ""}${h.removed ? '<span class="labtag rm">удалено преподавателем</span>' : ""}${nw ? `<span class="newtag">${h.status === "done" ? "оценка" : "новое"}</span>` : ""}${h.theme ? `<div class="th2">${esc(h.theme)}</div>` : ""}</div>${badge}</div>
        <div class="foot"><div>Срок<b class="num">${h.due ? dm(fromIso(h.due)) : "-"}</b></div><div>Сдано<b class="num">${h.sub ? dm(fromIso(h.sub)) : "-"}</b></div></div>
        <div class="hwb">${h.task ? `<div class="hwx ${h.task.length > 160 ? "clamp" : ""}" ${h.task.length > 160 ? 'data-hwx="1"' : ""}><span>Задание</span><p>${esc(h.task)}</p></div>` : ""}${h.answer ? `<div class="hwx ans"><span>Мой ответ</span><p>${/^https?:/.test(h.answer) ? `<a href="${esc(h.answer)}" target="_blank" rel="noopener">${esc(h.answer.replace(/^https?:\/\//, "").slice(0, 40))}…</a>` : esc(h.answer)}</p></div>` : ""}${h.teacherComment ? `<div class="hwx tc"><span>Комментарий преподавателя${h.checked ? ` · ${dm(fromIso(h.checked))}` : ""}</span><p>${esc(h.teacherComment)}</p></div>` : ""}${h.taskFile || h.myFile ? `<div class="hwact">${h.taskFile ? `<a href="${esc(h.taskFile)}" target="_blank" rel="noopener">${ic("hw")}Файл задания</a>` : ""}${h.myFile ? `<a href="${esc(h.myFile)}" target="_blank" rel="noopener">${ic("upload")}Мой файл</a>` : ""}</div>` : ""}</div>
        <div class="hwft"><div class="early">${foot}${h.teacher ? `<span class="soft">${esc(shortT(h.teacher))}</span>` : ""}</div>
        ${(h.status === "cur" || h.status === "late") && !h.removed ? `<div class="hwact"><button class="submit" data-hwf="${esc(hwRef(h))}">${ic("upload")}Сдать задание</button></div>` : ""}</div></article>`;
    };
    // новое - первым в своей группе, а группы с новым - выше остальных (не надо листать)
    const isNw = (h) => HK.has(h) && isNew("homework", HK.get(h));
    const grp = (st, title) => {
      const l = (M.hw || [])
        .filter((h) => h.status === st && (!hwq || norm(h.subj + " " + h.theme).includes(hwq)))
        .map((h, i) => ({ h, i, n: isNw(h) }))
        .sort((a, b) => b.n - a.n || a.i - b.i)
        .map((x) => x.h);
      const nn = l.filter(isNw).length;
      return l.length
        ? `<section class="card"><div class="hd"><h2>${title}</h2><small class="num">${nn ? `<b class="newc">+${nn} ${nn === 1 ? "новое" : "новых"}</b> · ` : ""}${l.length}</small></div><div class="hwgrid">${l.map(card).join("")}</div></section>`
        : "";
    };
    const groups = [
      ["cur", "Новые"],
      ["late", "Просроченные"],
      ["wait", "На проверке"],
      ["done", "Проверено"],
    ]
      .map(([st, t], i) => ({ i, html: grp(st, t), n: (M.hw || []).some((h) => h.status === st && isNw(h)) }))
      .sort((a, b) => b.n - a.n || a.i - b.i)
      .map((x) => x.html)
      .join("");
    return `<div class="row r4">
      <div class="card kpi"><div class="lab">${ic("hw")}Всего заданий</div><div class="val num">${all}</div><div class="sub">новых <b class="num">${c.cur}</b>, просрочено <b class="num">${c.late}</b></div></div>
      <div class="card kpi"><div class="lab">${ic("check")}Проверено</div><div class="val num">${c.done}</div><div class="meter"><i style="width:${all ? (c.done / all) * 100 : 0}%"></i></div><div class="sub"><b class="num">${all ? Math.round((c.done / all) * 100) : 0}%</b> от всех заданий</div></div>
      <div class="card kpi"><div class="lab">${ic("clock")}На проверке</div><div class="val num">${c.wait}</div><div class="sub">у преподавателей</div></div>
      <div class="card kpi"><div class="lab">${ic("timer")}Сдаёшь заранее</div><div class="val num">${s.hwCount ? f1(s.earlyAvg) : "-"}<small>дн.</small></div><div class="sub">${s.hwCount ? `<b class="num">${s.onTime}</b> из ${s.hwCount} сданы вовремя` : ""}</div></div></div>
      <div class="card hint">${ic("upload")}<div><b>Сдать задание</b><span>Кнопка «Сдать задание» на карточке: выбери файл или напиши ответ, Дневник сам отправит его в журнал</span></div></div>
      <div class="bar-tools"><div class="grp"><select class="sel" id="hwsubj"><option value="">Все предметы</option>${subs.map((x) => `<option ${hwq === norm(x) ? "selected" : ""}>${esc(x)}</option>`).join("")}</select></div><span class="note">Показано ${(M.hw || []).length} из ${all}</span></div>
      ${groups}`;
  };

  VIEWS.awards = (s) => `<div class="row r4">
      <div class="card kpi"><div class="lab"><span class="coin"></span>Топкоины${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.coins ?? "-"}</div><div class="sub">за посещения, оценки занятий и сданные вовремя ДЗ</div></div>
      <div class="card kpi"><div class="lab"><span class="gem"></span>Топгемы${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.gems ?? "-"}</div><div class="sub">начисляются за оценки, тратятся в Маркете</div></div>
      <div class="card kpi"><div class="lab">${ic("trophy")}Достижения</div><div class="val num">${achList(s).filter((a) => a.got).length}<small>из ${achList(s).length}</small></div><div class="meter"><i style="width:${(achList(s).filter((a) => a.got).length / achList(s).length) * 100}%"></i></div><div class="sub">${M.user.achieves_count != null ? `в журнале засчитано <b class="num">${M.user.achieves_count}</b>` : "по данным журнала и посещений"}</div></div>
      <div class="card kpi"><div class="lab">${ic("flame")}Серия без пропусков</div><div class="val num">${s.pStreak}<small>${plural(s.pStreak, "пара", "пары", "пар")}</small></div><div class="sub">лучшая серия <b class="num">${s.pBest}</b> · без опозданий <b class="num">${s.pLate}</b> ${plural(s.pLate, "пара", "пары", "пар")}</div></div></div>
    <section class="card"><div class="hd"><h2>Достижения</h2><small>серии считаются по парам, как в журнале</small></div>${(() => {
      const L = achList(s),
        got = L.filter((a) => a.got),
        no = L.filter((a) => !a.got);
      const card = (
        a,
      ) => `<div class="a ${a.got ? "got" : ""}"><div class="ic">${ic(a.ic, "i big")}</div><b>${esc(a.t)}</b>
      ${(a.kind === "streak" || a.kind === "late") && !a.got ? ((x) => `<div class="meter"><i style="width:${Math.min(100, (x / a.goal) * 100)}%"></i></div><span class="note num">${Math.min(x, a.goal)} из ${a.goal} ${plural(a.goal, "пары", "пар", "пар")} подряд</span>`)(a.kind === "streak" ? s.pStreak : s.pLate) : ""}
      <div class="ft"><span class="st">${a.got ? "Получено" : "Не получено"}</span><span class="rw num">+${a.r} <span class="coin"></span></span></div></div>`;
      return `${got.length ? `<div class="ach-sep"><span>Получено · ${got.length}</span></div><div class="ach">${got.map(card).join("")}</div>` : ""}${no.length ? `<div class="ach-sep"><span>Ещё впереди · ${no.length}</span></div><div class="ach">${no.map(card).join("")}</div>` : ""}`;
    })()}</section>
    <section class="card"><div class="hd"><h2>Последние начисления</h2></div>${feedList(30)}</section>`;
  const achFeed = (goal, kind) =>
    (M.feedAll || M.feed || []).some((f) => {
      const m = String(f.code || f.label).match(/(\d+)_?VISITS?_WITHOUT_(GAP|DELAY|LATE|MISS)/);
      return m && +m[1] === goal && (kind === "streak") === /GAP|MISS/.test(m[2]);
    });
  // начисления, которые не относятся к обычным (пары, оценки, ДЗ) и которых нет в списке наград - новая награда журнала
  const REGULAR_ACT =
    /^(Посещение пары|Оценка|Оценка занятия|Домашнее задание|Своевременное выполнение домашнего задания|Поощрение преподавателя|Лабораторная работа|Экзамен или курсовая|Работа в портфолио|Начисление)$/i;
  const achExtra = () => {
    const seen = new Set(),
      out = [];
    (M.feedAll || M.feed || []).forEach((f) => {
      const l = String(actName(f.label));
      if (!f.plus && f.plus !== undefined) return;
      if (REGULAR_ACT.test(l) || /посещений подряд/i.test(l) || seen.has(l)) return;
      if (
        ACH.some(
          (a) =>
            a.t.toLowerCase() === l.toLowerCase() ||
            (a.rx && a.rx.test(l)) ||
            (a.kind === "mail" && /почт/i.test(l)) ||
            (a.kind === "profile" && /профил/i.test(l)),
        )
      )
        return;
      seen.add(l);
      out.push({
        t: l === "Начисление" ? "Новая награда журнала" : l,
        r: f.amt,
        ic: "medal",
        got: true,
        extra: true,
      });
    });
    return out;
  };
  const achList = (s) =>
    ACH.map((a) => ({
      ...a,
      got:
        a.kind === "streak"
          ? s.pBest >= a.goal || achFeed(a.goal, "streak")
          : a.kind === "late"
            ? s.pLateBest >= a.goal || achFeed(a.goal, "late")
            : a.kind === "profile"
              ? !!(M.prof && M.prof.fill >= 100)
              : a.kind === "mail"
                ? M.user.emailOk === true
                : !!(a.rx && (M.feedAll || M.feed || []).some((f) => a.rx.test(actName(f.label)))),
    })).concat(achExtra());

  VIEWS.news = () => {
    const list = (M.news || []).filter((n) => nf === "all" || !(n.read || readSet.has(n.id)));
    let last = "",
      h = "";
    list.forEach((n) => {
      const d = n.date ? fromIso(n.date) : null;
      const m = d ? MONN[d.getMonth()] + " " + d.getFullYear() : "Без даты";
      if (m !== last) {
        h += `<div class="mgrp">${m}</div>`;
        last = m;
      }
      h += `<button class="nw ${n.read || readSet.has(n.id) ? "read" : ""}" data-nw="${esc(n.id)}"><span class="u"></span><span class="tx">${esc(n.title)}${isRead(n) ? "" : '<span class="newtag">новое</span>'}</span><span class="dt num">${d ? longDate(d) : ""}</span></button>`;
    });
    return `<div class="bar-tools"><div class="pill" role="group">${[
      ["all", "Все"],
      ["unread", "Непрочитанные"],
    ]
      .map(
        ([k, n]) =>
          `<button data-nf="${k}" aria-pressed="${nf === k}">${n}${k === "unread" ? ` <span class="num">${unread()}</span>` : ""}</button>`,
      )
      .join("")}</div>
      ${unread() ? `<button class="link" data-act="readall">Отметить все прочитанными</button>` : ""}</div>
      <section class="card"><div class="news">${h || `<div class="restday"><b>Всё прочитано</b>Новых объявлений нет</div>`}</div></section>
      <p class="note">Нажми на объявление, чтобы прочитать его полностью.</p>`;
  };
  VIEWS.reviews = () => {
    const RK = revKeys();
    return `<div class="row r2">${
      (M.reviews || [])
        .map((r, ri) => ({ r, nw: isNew("reviews", RK[ri]) }))
        .sort((a, b) => b.nw - a.nw)
        .map(({ r, nw }) => {
          const ini = r.teacher
            .split(" ")
            .slice(0, 2)
            .map((x) => x[0] || "")
            .join("");
          return `<article class="card rv s-${subjKey(r.subj)} ${nw ? "isnew" : ""}">${r.subj ? `<span class="tag">${esc(r.subj)}</span>` : ""}${nw ? '<span class="newtag">новое</span>' : ""}<blockquote>${esc(r.text)}</blockquote><div class="by"><div class="ava">${esc(ini)}</div><div><b>${esc(r.teacher)}</b><span class="num">${r.date ? dm(fromIso(r.date)) + "." + r.date.slice(0, 4) : ""}</span></div></div></article>`;
        })
        .join("") || `<div class="card"><p class="note">Отзывов пока нет</p></div>`
    }</div>`;
  };

  /* ======================= разделы журнала в новом дизайне ======================= */
  const norm = (x) =>
    String(x || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  const inHost = (el) =>
    (host && (el === host || host.contains(el))) || (fab && (el === fab || fab.contains(el)));
  function findNav(label) {
    const L = norm(label);
    let best = null;
    for (const el of document.body.querySelectorAll("a,button,li,span,div,p,[routerlink],[title]")) {
      if (inHost(el)) continue;
      const t = norm(el.textContent),
        ti = norm(el.getAttribute("title") || el.getAttribute("aria-label") || "");
      if (!(t === L || ti === L)) continue;
      const c = el.closest("a,button,li,[routerlink]") || el,
        r = c.getBoundingClientRect();
      const sc2 =
        (r.left < 340 ? 3 : 0) + (c.tagName === "A" ? 2 : 0) + (c.querySelector("svg,i,img") ? 1 : 0);
      if (!best || sc2 > best.s) best = { el: c, s: sc2 };
    }
    return best && best.el;
  }
  function settle(maxMs = 5000, quiet = 450) {
    return new Promise((res) => {
      let t,
        done = false;
      const fin = () => {
        if (done) return;
        done = true;
        o.disconnect();
        res();
      };
      const o = new MutationObserver(() => {
        clearTimeout(t);
        t = setTimeout(fin, quiet);
      });
      o.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
      t = setTimeout(fin, quiet);
      setTimeout(fin, maxMs);
    });
  }
  let navAt = 0,
    lastClassic = "";
  async function classicGo(label) {
    navAt = Date.now();
    lastClassic = "";
    let a = null;
    for (let i = 0; i < 20 && !(a = findNav(label)); i++) await new Promise((r) => setTimeout(r, 400));
    if (!a) throw new Error(`в журнале не найден пункт меню «${label}»`);
    a.click();
    await settle();
    lastClassic = label;
  }
  function locateContent() {
    const navEl = findNav("Расписание") || findNav("Главная");
    const navBox = navEl && (navEl.closest("nav,aside,[class*=side],[class*=menu]") || navEl.parentElement);
    const hdr = [...document.body.querySelectorAll("div,span,p")].find(
      (e) => !inHost(e) && /Группа:/.test(e.textContent || "") && e.children.length < 3,
    );
    let title = null;
    for (const el of document.body.querySelectorAll("h1,h2,h3,h4,div,span,p")) {
      if (inHost(el) || el.children.length) continue;
      const t = (el.textContent || "").trim();
      if (t.length < 4 || t.length > 40 || t !== t.toUpperCase() || !/[А-ЯA-Z]{3}/.test(t)) continue;
      const r = el.getBoundingClientRect();
      if (r.top > 40 && r.top < 260 && r.left > 30) {
        title = el;
        break;
      }
    }
    let root = title;
    if (!root)
      root = document
        .elementsFromPoint(innerWidth * 0.6, innerHeight * 0.45)
        .find((e) => !inHost(e) && e !== document.body && e !== document.documentElement);
    if (!root) throw new Error("не нашёл содержимое раздела");
    while (
      root.parentElement &&
      root.parentElement !== document.body &&
      !(navBox && root.parentElement.contains(navBox)) &&
      !(hdr && root.parentElement.contains(hdr))
    )
      root = root.parentElement;
    return { root, title };
  }
  function setNative(el, v) {
    const proto =
      el.tagName === "TEXTAREA"
        ? W.HTMLTextAreaElement.prototype
        : el.tagName === "SELECT"
          ? W.HTMLSelectElement.prototype
          : W.HTMLInputElement.prototype;
    const d = Object.getOwnPropertyDescriptor(proto, "value");
    d && d.set ? d.set.call(el, v) : (el.value = v);
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  function onInput(e) {
    const t = e.target;
    if (rateInput(t)) return;
    if (t.id === "faqq") {
      faqq = norm(t.value);
      const pos = t.selectionStart;
      render();
      const i = $("#faqq");
      if (i) {
        i.focus();
        i.setSelectionRange(pos, pos);
      }
      return;
    }
    if (!t.dataset || t.dataset.ref === undefined) return;
  }
  let toastT;
  function toast(msg, raw) {
    const t = $("#toast");
    if (!t) return;
    t.classList.toggle("nomc", !!raw);
    t.textContent = msg;
    t.hidden = false;
    clearTimeout(toastT);
    toastT = setTimeout(() => (t.hidden = true), 3800);
  }
  const CLASSIC_NAV = {
    home: ["Главная"],
    schedule: ["Расписание"],
    grades: ["Успеваемость", "Посещаемость", "Оценки", "Моя статистика"],
    homework: ["Домашние задания", "ДЗ"],
    materials: ["Учебные материалы", "Библиотека"],
    awards: ["Награды", "Достижения"],
    news: ["Объявления", "Новости"],
    reviews: ["Отзывы о студенте", "Отзывы"],
    market: ["Маркет"],
    payment: ["Оплата"],
    profile: ["Личный кабинет", "Профиль"],
    requests: ["Обращения"],
    complaints: ["Жалобы"],
    faq: ["F.A.Q.", "Вопросы и ответы"],
    contacts: ["Контакты"],
  };
  // раздел классического журнала -> раздел Дневника: по адресу страницы, иначе по активному пункту меню
  const CLASSIC_PATH = [
    [/dashboard|\/main\/?$/, "home"],
    [/schedule/, "schedule"],
    [/progress|statistic|attendance/, "grades"],
    [/homework/, "homework"],
    [/material|library/, "materials"],
    [/achiev|award|reward/, "awards"],
    [/news/, "news"],
    [/review|feedback-student/, "reviews"],
    [/market/, "market"],
    [/payment|pay/, "payment"],
    [/profile|settings\/user/, "profile"],
    [/signal/, "requests"],
    [/complain/, "complaints"],
    [/faq/, "faq"],
    [/contact/, "contacts"],
  ];
  function classicPage() {
    const p = location.pathname.toLowerCase(),
      hit = CLASSIC_PATH.find(([rx]) => rx.test(p));
    if (hit) return hit[1];
    try {
      const act = [...document.querySelectorAll("a.active, li.active a, a[aria-current], .active > a")]
        .map((a) => (a.textContent || "").trim())
        .find(Boolean);
      if (act)
        for (const [pg, ls] of Object.entries(CLASSIC_NAV))
          if (ls.some((l) => act.toLowerCase().startsWith(l.toLowerCase()))) return pg;
    } catch (e) {}
    return null;
  }
  function goClassic() {
    const pg = page;
    dropVeil();
    unmount();
    showFab();
    const labels = CLASSIC_NAV[pg];
    if (!labels) return;
    navAt = Date.now();
    (async () => {
      for (let i = 0; i < 16; i++) {
        for (const l of labels) {
          const a = findNav(l);
          if (a) {
            a.click();
            lastClassic = l;
            return;
          }
        }
        await sleep(250);
      }
    })();
  }
  function closeDD(except) {
    if (R)
      R.querySelectorAll(".dd.open").forEach((w) => {
        if (w === except) return;
        w.classList.remove("open");
        w.querySelector(".dd-list").hidden = true;
      });
  }
  function enhanceSelects(root) {
    if (!root) return;
    root.querySelectorAll("select.sel,select.m-in").forEach((sel) => {
      if (sel.dataset.dd) return;
      sel.dataset.dd = "1";
      const w = document.createElement("div");
      w.className = "dd" + (sel.classList.contains("m-in") ? " dd-in" : "");
      sel.parentNode.insertBefore(w, sel);
      w.appendChild(sel);
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "dd-btn";
      btn.setAttribute("aria-haspopup", "listbox");
      const list = document.createElement("div");
      list.className = "dd-list";
      list.setAttribute("role", "listbox");
      list.hidden = true;
      w.append(btn, list);
      const paint = () => {
        const o = sel.options[sel.selectedIndex];
        btn.innerHTML = `<span>${esc(o ? o.text : "")}</span>${ic("chev")}`;
        list.innerHTML = [...sel.options]
          .map(
            (o, i) =>
              `<button type="button" class="dd-o" role="option" data-i="${i}" aria-selected="${i === sel.selectedIndex}"><span>${esc(o.text)}</span>${i === sel.selectedIndex ? ic("check") : ""}</button>`,
          )
          .join("");
      };
      paint();
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = list.hidden;
        closeDD(w);
        list.hidden = !open;
        w.classList.toggle("open", open);
        if (open) {
          list.classList.remove("flip");
          list.style.left = "0px";
          list.style.right = "auto";
          const vw = document.documentElement.clientWidth || innerWidth,
            r = list.getBoundingClientRect();
          let dx = 0;
          if (r.right > vw - 8) dx = r.right - (vw - 8);
          if (r.left - dx < 8) dx = r.left - 8;
          if (dx) list.style.left = -Math.round(dx) + "px";
          const c = list.querySelector('[aria-selected="true"]');
          if (c) list.scrollTop = Math.max(0, c.offsetTop - list.clientHeight / 2);
        }
      });
      list.addEventListener("click", (e) => {
        const o = e.target.closest(".dd-o");
        if (!o) return;
        e.stopPropagation();
        sel.selectedIndex = +o.dataset.i;
        paint();
        closeDD();
        sel.dispatchEvent(new Event("change", { bubbles: true }));
      });
    });
  }

  // «Золото и изумруды»: меняем названия валют во всём тексте Дневника (окна, подсказки, заголовки)
  const MC_W = [
    [/Топкоин(ы|ов)/g, "Золото"],
    [/Топгем(ы|ов)/g, "Изумруды"],
    [/топкоинами/g, "слитками золота"],
    [/топкоинов/g, "слитков золота"],
    [/топкоина/g, "слитка золота"],
    [/топкоины/g, "слитки золота"],
    [/топкоин/g, "слиток золота"],
    [/топгемами/g, "изумрудами"],
    [/топгемов/g, "изумрудов"],
    [/топгема/g, "изумруда"],
    [/топгемы/g, "изумруды"],
    [/топгем/g, "изумруд"],
    [/^ТК$/, "ЗЛ"],
    [/^ТГ$/, "ИЗ"],
    [/Монеты, гемы/g, "Золото, изумруды"],
    [/монеты и гемы/g, "золото и изумруды"],
  ];
  const mcStr = (t) => {
    MC_W.forEach(([r, v]) => {
      t = t.replace(r, v);
    });
    return t;
  };
  function mcify(root) {
    if (!cfg.mc || !root) return;
    const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = tw.nextNode())) {
      const v = n.nodeValue;
      if (n.parentElement && n.parentElement.closest(".nomc")) continue;
      if (v && /топ(коин|гем)|монеты,? (и )?гемы|^Т[КГ]$/i.test(v.trim())) {
        const w = /^Т[КГ]$/.test(v.trim()) ? mcStr(v.trim()) : mcStr(v);
        if (w !== v) n.nodeValue = w;
      }
    }
    if (root.querySelectorAll)
      root.querySelectorAll("[title]").forEach((el) => {
        const t = el.getAttribute("title");
        if (/топ(коин|гем)/i.test(t)) el.setAttribute("title", mcStr(t));
      });
  }
  const ACCENTS = [
    ["gold", "Янтарь", "#e8bf6a"],
    ["sapphire", "Сапфир", "#6f98ff"],
    ["emerald", "Малахит", "#4fd6a6"],
    ["amethyst", "Аметист", "#8f7dff"],
    ["rose", "Роза", "#ff79b0"],
    ["graphite", "Графит", "#c9ccd4"],
  ];
  VIEWS.settings = () => {
    const opt = (k, v, l) =>
      `<button data-set="${k}" data-v="${v}" aria-pressed="${String(cfg[k]) === String(v)}">${l}</button>`;
    const st = Object.keys(NET.status);
    const ok = st.filter((k) => NET.status[k] === 200).length;
    const upd = LS.get("upd", null),
      newer = upd && upd.v && verNewer(upd.v, VERSION),
      chkAt = LS.get("updAt", 0);
    if (Date.now() - chkAt > 10 * 60000)
      setTimeout(
        () =>
          checkUpdate(true).then(() => {
            if (page === "settings") render();
          }),
        300,
      );
    return `<section class="card ver"><div class="ver-top"><div class="ver-ic">${ic("book", "i big")}</div><div class="grow"><span class="cap">Дневник</span><b class="num">Версия ${VERSION}</b>
        <span class="soft">${newer ? `доступна ${esc(upd.v)}` : upd && upd.v ? "у тебя последняя версия" : "проверка обновлений ещё не проходила"}${chkAt ? ` · проверено ${sameDay(new Date(chkAt), new Date()) ? "сегодня в " + new Date(chkAt).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : dm(new Date(chkAt))}` : ""}</span></div>
        ${newer ? `<a class="m-btn pri" href="${UPD_URL}" target="_blank" rel="noopener" data-act="updgo">${ic("download")}Обновить до ${esc(upd.v)}</a>` : `<button class="m-btn" data-act="updcheck">${ic("refresh")}Проверить обновления</button>`}</div>
      <div class="ver-new"><span>Что нового</span><ul>${CHANGES.map((c) => `<li>${esc(c)}</li>`).join("")}</ul></div></section>
    <section class="card"><div class="hd"><h2>Разделы в меню</h2><small>Выключенный раздел пропадает из меню</small></div>
      <div class="set-grid">${PAGES.filter((p) => !["home", "settings"].includes(p.id))
        .map(
          (p) =>
            `<label class="sw"><input type="checkbox" data-hide="${p.id}" ${cfg.hidden.includes(p.id) ? "" : "checked"}><span class="tr"></span>${ic(p.ic)}<span>${esc(p.n)}</span></label>`,
        )
        .join("")}</div></section>
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
    const d = new W.DOMParser().parseFromString(String(html || ""), "text/html"),
      out = d.createElement("div");
    const OK =
        /^(P|BR|B|STRONG|I|EM|U|S|UL|OL|LI|A|H[1-6]|BLOCKQUOTE|SPAN|DIV|TABLE|THEAD|TBODY|TR|TD|TH|HR|IMG|SMALL|SUB|SUP|PRE|CODE)$/,
      DROP =
        /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE|SVG|MATH|IFRAME|FRAME|OBJECT|EMBED|LINK|META|BASE|FORM|INPUT|BUTTON|SELECT|TEXTAREA|TITLE|AUDIO|VIDEO)$/;
    const cp = (src, dst, depth) => {
      if (depth > 40) return;
      src.childNodes.forEach((n) => {
        if (n.nodeType === 3) {
          dst.appendChild(d.createTextNode(n.data));
          return;
        }
        if (n.nodeType !== 1) return;
        const t = String(n.tagName).toUpperCase();
        if (DROP.test(t)) return;
        if (!OK.test(t)) {
          cp(n, dst, depth + 1);
          return;
        }
        const e = d.createElement(t.toLowerCase());
        if (t === "A") {
          const h = safeUrl(n.getAttribute("href"));
          if (h) {
            e.setAttribute("href", h);
            e.setAttribute("target", "_blank");
            e.setAttribute("rel", "noopener noreferrer");
          }
        }
        if (t === "IMG") {
          const u = safeUrl(n.getAttribute("src"));
          if (!u) return;
          e.setAttribute("src", u);
          e.setAttribute("alt", "");
          e.setAttribute("loading", "lazy");
        }
        if (t === "TD" || t === "TH")
          ["colspan", "rowspan"].forEach((k) => {
            const v = parseInt(n.getAttribute(k), 10);
            if (v > 1 && v < 50) e.setAttribute(k, String(v));
          });
        cp(n, e, depth + 1);
        dst.appendChild(e);
      });
    };
    cp(d.body, out, 0);
    return out.innerHTML;
  }
  const newsCache = {};
  function markReadUI(id) {
    R.querySelectorAll(`[data-nw="${CSS.escape(String(id))}"]`).forEach((el) => {
      el.classList.add("read");
      const t = el.querySelector(".newtag");
      t && t.remove();
    });
    const u = unread();
    R.querySelectorAll('[data-page="news"] .bd').forEach((b) => {
      if (u) b.textContent = u;
      else b.remove();
    });
    const pill = R.querySelector('[data-nf="unread"] .num');
    if (pill) pill.textContent = u;
    if (page === "news") {
      $("#eyebrow").textContent = `${u} непрочитанных`;
      if (!u) {
        const ra = R.querySelector('[data-act="readall"]');
        ra && ra.remove();
      }
    }
  }
  async function openNews(id) {
    const n = (M.news || []).find((x) => x.id === id) || { title: "Объявление" },
      d = $("#dlg"),
      dt = n.date ? fromIso(n.date) : null;
    const show = (body) => {
      d.classList.add("wide");
      d.innerHTML = `<div class="dlg"><div class="dh2"><div><h3>${esc(n.title)}</h3><p class="num">${dt ? longDate(dt) + " " + dt.getFullYear() : ""}</p></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div><div class="nbody">${body}</div></div>`;
      if (!d.open) d.showModal();
    };
    if (newsCache[id]) {
      show(newsCache[id]);
      markReadUI(id);
      return;
    }
    show(`<div class="m-load"><span class="spin"></span>Загружаю текст…</div>`);
    for (const path of [
      `news/operations/detail-news?news_id=${encodeURIComponent(id)}`,
      `news/operations/detail?id=${encodeURIComponent(id)}`,
    ]) {
      try {
        const r = await api("newsDetail", path);
        const o = Array.isArray(r) ? r[0] : r && r.data && !Array.isArray(r.data) ? r.data : r;
        const html = pick(o, ["text_bbs", "text", "body", "content", "description", "message"]);
        if (html) {
          newsCache[id] = cleanHTML(html);
          if (d.open) show(newsCache[id]);
          markReadUI(id);
          const n2 = (M.news || []).find((x) => x.id === id);
          if (n2 && !n2.read) {
            n2.read = true;
            LS.set("model", M);
          }
          return;
        }
      } catch (e) {}
    }
    // запасной путь: открыть объявление в журнале, его окно появится поверх Дневника
    d.close();
    markReadUI(id);
    toast("Открываю объявление из журнала…");
    try {
      await classicGo("Объявления");
      const key = norm(n.title).slice(0, 30);
      const card = [...document.body.querySelectorAll("div,li,a,article")]
        .filter((el) => !inHost(el) && norm(el.textContent).startsWith(key))
        .sort((a, b) => a.textContent.length - b.textContent.length)[0];
      if (!card) throw new Error("не найдено");
      card.click();
      await settle(2500, 350);
    } catch (e) {
      toast("Не получилось открыть текст. Попробуй в классическом журнале");
    }
  }

  let pendingNotice = null;
  function newsNotice(list, fromJournal) {
    if (!R) return;
    const d = $("#dlg");
    list = (list || []).filter((n) => !isRead(n));
    if (d.open) {
      if (!d.querySelector(".nlist")) pendingNotice = list.length ? list : pendingNotice;
      return;
    }
    const n = list.length;
    d.classList.add("wide");
    d.innerHTML = `<div class="dlg"><div class="dh2"><div class="jn-head"><div class="jn-ic">${ic("bell", "i big")}</div><div><h3>${n === 1 && !fromJournal ? "Новое объявление" : "У вас есть непрочитанные объявления"}</h3><p class="num">${n ? n + " " + plural(n, "объявление ждёт", "объявления ждут", "объявлений ждут") + " прочтения" : "Загляни в раздел объявлений"}</p></div></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
      ${
        n
          ? `<div class="nlist">${list
              .slice(0, 5)
              .map(
                (x) =>
                  `<button class="nw" data-nw="${esc(x.id)}"><span class="u"></span><span class="tx">${esc(x.title)}<span class="newtag">новое</span></span><span class="dt num">${x.date ? longDate(fromIso(x.date)) : ""}</span></button>`,
              )
              .join("")}</div>`
          : ""
      }
      <div class="ffoot"><button class="m-btn" data-act="close">Позже</button><button class="m-btn pri" data-page="news">${ic("bell")}Перейти в объявления</button></div></div>`;
    d.showModal();
  }

  /* ======================= отправка из Дневника ======================= */
  function findOrigButton(rx) {
    return [
      ...document.body.querySelectorAll("button,a,[role=button],input[type=button],input[type=submit]"),
    ].filter((el) => !inHost(el) && vis(el) && rx.test(((el.innerText || el.value || "") + "").trim()))[0];
  }
  // готовим раздел журнала заранее, чтобы клик по кнопке шёл в том же нажатии (скачивание не блокируется)
  const prepareClassic = (label) => {
    if (lastClassic !== label && !bridging) classicGo(label).catch(() => {});
  };
  async function origClick(label, rx, what) {
    let b = lastClassic === label ? findOrigButton(rx) : null;
    if (b) {
      b.click();
      toast(what);
      return;
    }
    toast("Готовлю раздел журнала…");
    try {
      await classicGo(label);
      b = findOrigButton(rx);
      if (!b) throw new Error("x");
      b.click();
      toast(what);
    } catch (e) {
      toast("Кнопка не нашлась, открываю журнал");
      goClassic();
      classicGo(label).catch(() => {});
    }
  }
  const sendPassword = (oldp, newp) =>
    direct(
      async () => {
        const e = apiErr(
          await postJson("profile/operations/change-password", {
            password_old: oldp,
            password: newp,
            password_repeat: newp,
          }),
        );
        if (e) {
          if (/парол|password/i.test(e.message)) e.final = true;
          throw e;
        }
      },
      () => sendPasswordUI(oldp, newp),
    );
  const sendPasswordUI = (oldp, newp) =>
    bridge(
      "Личный кабинет",
      async () => {
        const root = pageRoot();
        clickByText(/смена пароля|сменить пароль|изменить пароль/i, root);
        await settle(2000, 300);
        const pw = [...document.querySelectorAll("input[type=password]")].filter((el) => !inHost(el));
        if (pw.length < 2) throw new Error("не открылось окно смены пароля");
        const [a, b2, c] = pw.length >= 3 ? pw.slice(-3) : [null, ...pw.slice(-2)];
        if (a) setVal(a, oldp);
        setVal(b2, newp);
        if (c) setVal(c, newp);
        const rx = /^(сохранить|изменить|сменить|подтвердить|отправить)/i;
        await sleep(200);
        clickByText(rx, scopeFor(b2, rx));
      },
      /password|pass/i,
    );
  const sendPhoto = (file) =>
    bridge(
      "Личный кабинет",
      async () => {
        const root = pageRoot(),
          before = new Set(fileInputs());
        try {
          clickByText(/загрузить фото/i, root);
        } catch (e) {}
        await settle(1500, 300);
        const fi =
          fileInputs()
            .filter((x) => !before.has(x))
            .pop() || fileInputs().pop();
        if (!fi) throw new Error("не нашёл загрузку фото в журнале");
        const n0 = NET.writes.length;
        const dt = new W.DataTransfer();
        dt.items.add(file);
        fi.files = dt.files;
        fi.dispatchEvent(new Event("input", { bubbles: true }));
        fi.dispatchEvent(new Event("change", { bubbles: true }));
        await settle(3000, 500);
        if (NET.writes.length === n0) {
          const rx = /^(сохранить|загрузить|применить|ок|готово)$/i;
          const modal = [
            ...document.querySelectorAll("[role=dialog],.modal,.modal-content,[class*=modal],[class*=crop]"),
          ]
            .filter((el) => !inHost(el) && vis(el))
            .pop();
          clickByText(rx, modal || scopeFor(fi, rx));
        }
      },
      /photo|avatar|image|file|profile/i,
    );
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  let bridging = false;
  const vis = (el) => {
    const st = getComputedStyle(el),
      r = el.getBoundingClientRect();
    return st.display !== "none" && st.visibility !== "hidden" && (r.width > 0 || r.height > 0);
  };
  function setVal(el, v) {
    try {
      el.focus();
    } catch (e) {}
    setNative(el, v);
    el.dispatchEvent(new Event("blur", { bubbles: true }));
  }
  function clickByText(rx, scope) {
    const c = [
      ...(scope || document.body).querySelectorAll("button,a,[role=button],input[type=submit],div,span"),
    ]
      .filter(
        (el) =>
          !inHost(el) &&
          vis(el) &&
          rx.test(((el.innerText || el.value || "") + "").trim()) &&
          ((el.innerText || el.value || "") + "").trim().length < 40,
      )
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
    if (!c) throw new Error("в форме журнала не нашлась кнопка отправки");
    (c.closest("button,a,[role=button]") || c).click();
  }
  function scopeFor(el, rx) {
    let c = el;
    while (c && c !== document.body) {
      const st = getComputedStyle(c);
      if (
        (st.position === "fixed" ||
          c.getAttribute("role") === "dialog" ||
          /modal|dialog|popup/i.test(c.className || "")) &&
        [...c.querySelectorAll("button,a,[role=button],input[type=submit]")].some((b) =>
          rx.test(((b.innerText || b.value || "") + "").trim()),
        )
      )
        return c;
      c = c.parentElement;
    }
    c = el;
    while (c && c !== document.body) {
      if (
        [...c.querySelectorAll("button,[role=button],input[type=submit]")].some(
          (b) => vis(b) && rx.test(((b.innerText || b.value || "") + "").trim()),
        )
      )
        return c;
      c = c.parentElement;
    }
    return document.body;
  }
  function pageRoot() {
    try {
      return locateContent().root;
    } catch (e) {
      return document.body;
    }
  }
  async function bridge(label, fill, expect) {
    bridging = true;
    document.documentElement.classList.remove("dn-raise");
    try {
      await classicGo(label);
      await sleep(300);
      const w = waitWrite(15000, expect);
      w.catch(() => {});
      await fill();
      const ev = await w;
      if (ev.status >= 200 && ev.status < 300) return ev;
      let msg = "";
      try {
        const j = JSON.parse(ev.text);
        msg = j.message || j.error || (Array.isArray(j) && j[0] && j[0].message) || "";
      } catch (e) {}
      if (/не подтвержд/i.test(msg))
        throw new Error(
          "прошлое изменение ещё на проверке у учебной части. Новое можно отправить после её подтверждения",
        );
      if (ev.status === 401 || ev.status === 403)
        throw new Error("журнал просит войти заново. Обнови страницу журнала");
      throw new Error(`журнал ответил ошибкой ${ev.status}${msg ? ": " + msg : ""}`);
    } finally {
      bridging = false;
      setTimeout(applyRaise, 2000);
    }
  }
  async function chooseOption(root, text) {
    const sel = root.querySelector("select");
    if (sel) {
      const o = [...sel.options].find((o) => norm(o.text) === norm(text));
      if (!o) throw new Error("в журнале нет темы «" + text + "»");
      setNative(sel, o.value);
      return;
    }
    const trig = [...root.querySelectorAll("*")].find(
      (el) => !inHost(el) && vis(el) && el.children.length < 4 && /выберите/i.test(el.textContent || ""),
    );
    if (!trig) throw new Error("не нашёл выбор темы в форме журнала");
    trig.click();
    await sleep(350);
    const opts = [...document.body.querySelectorAll("li,div,span,a,option")].filter(
      (el) => !inHost(el) && vis(el) && norm(el.textContent) === norm(text),
    );
    if (!opts.length) throw new Error("не нашёл тему «" + text + "» в списке журнала");
    opts[opts.length - 1].click();
    await sleep(250);
  }
  const sendSignal = (type, theme, text, urgent) =>
    direct(
      async () => {
        const id = (M.sigIds || {})[type];
        if (id == null) throw new Error("нет номера темы");
        const e = apiErr(
          await postJson("signal/operations/create", {
            Signal: { id_problem: +id, message: text, quickly: !!urgent, theme },
          }),
        );
        if (e) throw e;
      },
      () => sendSignalUI(type, theme, text, urgent),
    );
  const sendSignalUI = (type, theme, text, urgent) =>
    bridge(
      "Обращения",
      async () => {
        const root = pageRoot();
        if (type) await chooseOption(root, type);
        const inp = [...root.querySelectorAll("input:not([type]),input[type=text]")].filter(vis)[0],
          ta = [...root.querySelectorAll("textarea")].filter(vis)[0];
        if (!inp || !ta) throw new Error("не нашёл поля формы обращения");
        setVal(inp, theme);
        setVal(ta, text);
        const cb = root.querySelector("input[type=checkbox]");
        if (cb && cb.checked !== !!urgent) cb.click();
        await sleep(200);
        clickByText(/^отправить$/i, scopeFor(ta, /^отправить$/i));
      },
      /signal/i,
    );
  const sendComplaint = (theme, text) =>
    direct(
      async () => {
        const e = apiErr(
          await postForm("contacts/operations/send-ceo", [
            ["MessageForm", JSON.stringify({ subject: theme, message: text })],
          ]),
        );
        if (e) throw e;
      },
      () => sendComplaintUI(theme, text),
    );
  const sendComplaintUI = (theme, text) =>
    bridge(
      "Жалобы",
      async () => {
        const root = pageRoot();
        const inp = [...root.querySelectorAll("input:not([type]),input[type=text]")].filter(vis)[0],
          ta = [...root.querySelectorAll("textarea")].filter(vis)[0];
        if (!inp || !ta) throw new Error("не нашёл поля формы жалобы");
        setVal(inp, theme);
        setVal(ta, text);
        await sleep(200);
        clickByText(/^отправить$/i, scopeFor(ta, /^отправить$/i));
      },
      /^(?!.*(personal|password|homework)).*$/i,
    );
  const sendProfile = (v) =>
    bridge(
      "Личный кабинет",
      async () => {
        const root = pageRoot(),
          P0 = M.prof || {},
          digits = (x) => String(x || "").replace(/\D/g, "");
        const inputs = [...root.querySelectorAll("input,textarea")].filter(
          (el) => !inHost(el) && el.type !== "file" && el.type !== "checkbox",
        );
        const find = (test) => inputs.find(test);
        const map = [
          ["phone", find((el) => P0.phones && P0.phones[0] && digits(el.value) === digits(P0.phones[0]))],
          ["email", find((el) => P0.email && el.value.trim() === P0.email)],
          ["address", find((el) => P0.address && el.value.trim() === P0.address)],
          ["study", find((el) => P0.study && el.value.trim() === P0.study)],
        ];
        let changed = 0;
        for (const [k, el] of map) {
          if (v[k] == null || !el) continue;
          if (k === "phone" ? digits(el.value) !== digits(v[k]) : el.value.trim() !== v[k]) {
            setVal(el, v[k]);
            changed++;
          }
        }
        if (!changed) throw new Error("нет изменений, которые можно сохранить");
        await sleep(250);
        clickByText(/^сохранить$/i, scopeFor(map.find((x) => x[1])[1], /^сохранить$/i));
      },
      /personal|profile/i,
    );
  function findHwCard(h) {
    const d = h.due ? fromIso(h.due) : null,
      mm = d ? String(d.getMonth() + 1).padStart(2, "0") : "";
    const dates = d
      ? [
          `${d.getDate()}.${mm}.${d.getFullYear()}`,
          `${String(d.getDate()).padStart(2, "0")}.${mm}.${d.getFullYear()}`,
          `${String(d.getDate()).padStart(2, "0")}.${mm}.${String(d.getFullYear()).slice(2)}`,
        ]
      : [];
    const words = (t) =>
      norm(t)
        .split(/[^а-яёa-z0-9]+/)
        .filter((w) => w.length >= 4)
        .map((w) => w.slice(0, 5));
    const sw = words(h.subj).slice(0, 3),
      tw = words(h.theme || "").slice(0, 4);
    const hasDate = (t) =>
      dates.some((x) => new RegExp("(^|[^0-9])" + x.replace(/\./g, "\\.") + "([^0-9]|$)").test(t));
    let best = null;
    for (const el of document.body.querySelectorAll("div,li,article,a,mat-card,[class*=card]")) {
      if (inHost(el) || !el.children.length || !vis(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 80 || r.height < 60 || r.width > innerWidth * 0.7 || r.height > innerHeight * 0.9)
        continue;
      const t = el.textContent || "",
        nt = norm(t);
      if (t.length > 600) continue;
      const dOk = !dates.length || hasDate(t),
        sOk = sw.filter((w) => nt.includes(w)).length + (sw[0] && nt.includes(sw[0].slice(0, 4)) ? 0.5 : 0),
        tOk = tw.filter((w) => nt.includes(w)).length;
      if (!dOk && !sOk) continue;
      const score = (dOk ? 10 : 0) + sOk * 3 + tOk * 2 - (r.width * r.height) / 1e6;
      if (!best || score > best.score) best = { el, score, dOk, sOk: sOk + tOk };
    }
    return best && ((best.dOk && (best.sOk || !sw.length)) || best.sOk >= 2) ? best.el : null;
  }
  const upModal = () =>
    [...document.querySelectorAll("hw-upload-homework,.text-homework-wrap,[class*=upload-homework]")].filter(
      (el) => !inHost(el) && vis(el),
    )[0] ||
    fileInputs()
      .map(
        (fi) =>
          fi.closest(
            ".modal-content,[role=dialog],.modal,.cdk-overlay-pane,[id*=modal],[class*=modal],[class*=upload]",
          ) || fi.parentElement,
      )
      .filter((el) => el && vis(el))[0];
  // открыть окно загрузки ДЗ: пробуем значок сдачи на карточке, потом саму карточку; чужие окна (информация о задании) закрываем
  async function openUpload(card) {
    const infoRx = /info|comment|chat|message|download-task|description/i;
    const cls = (el) =>
      String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className || "");
    const tries = [
      ...card.querySelectorAll(
        "[class*=upload],[class*=load],[class*=hw],[class*=file],[class*=icon],img,svg,button,[role=button]",
      ),
    ]
      .filter((el) => vis(el) && !infoRx.test(cls(el)) && !el.closest("[class*=info],[class*=comment]"))
      .sort(
        (a, b) =>
          /upload|load/i.test(cls(b)) - /upload|load/i.test(cls(a)) ||
          b.getBoundingClientRect().width * b.getBoundingClientRect().height -
            a.getBoundingClientRect().width * a.getBoundingClientRect().height,
      );
    const hidden = [...card.querySelectorAll(".upload-file,[class*=upload-file],[class*=upload]")];
    ["pointerover", "mouseover", "mouseenter"].forEach((t) =>
      card.dispatchEvent(new MouseEvent(t, { bubbles: true })),
    );
    for (const t of [...hidden, ...tries.slice(0, 5), card]) {
      const before = new Set([...document.querySelectorAll(".modal,[role=dialog]")].filter(vis));
      fire(t);
      await settle(1800, 300);
      const m = upModal();
      if (m) return m;
      const other = [...document.querySelectorAll(".modal,[role=dialog]")].filter(
        (el) => vis(el) && !before.has(el) && !inHost(el),
      )[0];
      if (other) {
        const x = [...other.querySelectorAll("button,[class*=close],[aria-label]")].find(
          (b) =>
            /close|закрыть/i.test(cls(b) + " " + (b.getAttribute("aria-label") || "")) ||
            /^(×|✕|закрыть|ок|ok)$/i.test((b.innerText || "").trim()),
        );
        if (x) fire(x);
        else document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        await settle(800, 250);
      }
    }
    return null;
  }
  // Прямая отправка формы на сервер журнала (как это делает сам журнал)
  const b64 = (buf) => {
    const u8 = new Uint8Array(buf);
    let b = "";
    for (let i = 0; i < u8.length; i += 8192) b += String.fromCharCode.apply(null, u8.subarray(i, i + 8192));
    return btoa(b);
  };
  async function postForm(path, fields, file) {
    const url = (NET.base || DEFAULT_API) + "/" + path;
    const h = Object.assign({ accept: "application/json, text/plain, */*" }, NET.headers);
    if (NET.token) h.authorization = "Bearer " + NET.token;
    delete h["content-type"];
    let r;
    if (NET.pageReady && typeof pageRequest === "function") {
      const f = file
        ? { k: file.k, name: file.v.name, type: file.v.type, b64: b64(await file.v.arrayBuffer()) }
        : null;
      r = await new Promise((res, rej) => {
        const id = ++rpcN;
        const t = setTimeout(() => {
          delete RPC[id];
          rej(new Error("журнал не ответил"));
        }, 60000);
        RPC[id] = (d) => {
          clearTimeout(t);
          res({ status: d.status, text: d.tx || "" });
        };
        document.dispatchEvent(
          new CustomEvent("dn-post", { detail: JSON.stringify({ id, url, h, f: fields, file: f }) }),
        );
      });
    } else {
      const fd = new W.FormData();
      fields.forEach(([k, v]) => fd.append(k, v));
      if (file) fd.append(file.k, file.v, file.v.name);
      const x = await origFetch(url, {
        method: "POST",
        headers: h,
        body: fd,
        credentials: "omit",
        mode: "cors",
      });
      r = { status: x.status, text: await x.text() };
    }
    pushW(
      `POST ${pathOf(url)} (Дневник) · поля: ${fields.map(([k]) => k).join(", ")}${file ? `, ${file.k}=[файл]` : ""}`,
      `  ↳ ответ ${r.status}`,
    );
    return r;
  }
  // JSON-отправка; в журнал действий пишем только названия полей (пароли и тексты не попадают в диагностику)
  async function postJson(path, obj) {
    const url = (NET.base || DEFAULT_API) + "/" + path,
      body = JSON.stringify(obj);
    const h = Object.assign({ accept: "application/json, text/plain, */*" }, NET.headers);
    if (NET.token) h.authorization = "Bearer " + NET.token;
    delete h["content-type"];
    let r;
    if (NET.pageReady && typeof pageRequest === "function") {
      r = await new Promise((res, rej) => {
        const id = ++rpcN;
        const t = setTimeout(() => {
          delete RPC[id];
          rej(new Error("журнал не ответил"));
        }, 30000);
        RPC[id] = (d) => {
          clearTimeout(t);
          res({ status: d.status, text: d.tx || "" });
        };
        document.dispatchEvent(
          new CustomEvent("dn-post", { detail: JSON.stringify({ id, url, h, json: body }) }),
        );
      });
    } else {
      const x = await origFetch(url, {
        method: "POST",
        headers: Object.assign({ "content-type": "application/json" }, h),
        body,
        credentials: "omit",
        mode: "cors",
      });
      r = { status: x.status, text: await x.text() };
    }
    const keys = (o) =>
      Object.keys(o)
        .map((k) =>
          o[k] && typeof o[k] === "object" && !Array.isArray(o[k]) ? k + "{" + keys(o[k]) + "}" : k,
        )
        .join(", ");
    pushW(`POST ${pathOf(url)} (Дневник) · поля: ${keys(obj)}`, `  ↳ ответ ${r.status}`);
    return r;
  }
  // ответ журнала -> понятная ошибка; final = не пробовать запасной путь через окна журнала
  function apiErr(r) {
    if (r.status >= 200 && r.status < 300) return null;
    let m = "";
    try {
      const j = JSON.parse(r.text);
      m =
        j.message ||
        (Array.isArray(j) &&
          j
            .map((x) => x.message)
            .filter(Boolean)
            .join("; ")) ||
        "";
    } catch (e) {}
    if (r.status === 401 || r.status === 403)
      return Object.assign(new Error("журнал просит войти заново. Обнови страницу"), { final: true });
    return Object.assign(new Error(`журнал ответил ${r.status}${m ? ": " + m : ""}`), {
      final: r.status === 422 && !!m && !/field|поле|required|обязател/i.test(m),
    });
  }
  const direct = async (fn, fallback) => {
    try {
      return await fn();
    } catch (e) {
      if (e.final || !fallback) throw e;
      pushW("  ↳ прямая отправка не прошла (" + e.message + "), пробую через окно журнала");
      return fallback();
    }
  };
  const HW_TAG_ID = (t) => HW_TAGS.indexOf(t) + 1;
  async function sendHwDirect(h, v) {
    const two = (x) => String(Math.min(99, +x || 0)).padStart(2, "0");
    step(v.file ? "Загружаю файл в журнал…" : "Отправляю ответ в журнал…");
    const r = await postForm(
      "homework/operations/create",
      [
        ["id", String(h.id)],
        ["answerText", v.answer || ""],
        ["spentTimeHour", two(v.hh)],
        ["spentTimeMin", two(v.mm)],
      ],
      v.file ? { k: "file", v: v.file } : null,
    );
    if (r.status === 401 || r.status === 403)
      throw Object.assign(new Error("журнал просит войти заново. Обнови страницу"), { final: true });
    if (r.status < 200 || r.status >= 300) {
      let m = "";
      try {
        const j = JSON.parse(r.text);
        m = j.message || (Array.isArray(j) && j[0] && j[0].message) || "";
      } catch (e) {}
      throw Object.assign(new Error(`журнал ответил ${r.status}${m ? ": " + m : ""}`), {
        final: r.status !== 404 && r.status !== 405,
      });
    }
    const tags = (v.tags || "")
      .split("|")
      .filter(Boolean)
      .map(HW_TAG_ID)
      .filter((x) => x > 0);
    if (+v.stars || v.ecomment || tags.length) {
      step("Сохраняю отзыв о задании…");
      try {
        await postForm("homework/evaluation/operations/save", [
          [
            "EvaluationHomeworkForm",
            JSON.stringify({
              id: null,
              idDomZad: +h.id,
              idStud: null,
              mark: +v.stars || null,
              comment: v.ecomment || "",
              tags,
            }),
          ],
        ]);
      } catch (e) {}
    }
    h.status = "wait";
    h.sub = h.sub || iso(new Date());
    LS.set("model", M);
  }
  const fileInputs = () => [...document.querySelectorAll("input[type=file]")].filter((el) => !inHost(el));
  const step = (t) => {
    const st = R && R.getElementById("fstat");
    if (st && st.classList.contains("busy")) st.innerHTML = `<span class="spin"></span>${esc(t)}`;
  };
  // что Дневник увидел на странице ДЗ - в диагностику (только структура и короткие подписи)
  function hwSnap(card, h) {
    try {
      if (card) {
        popSnap(card);
        NET.pop = "Карточка ДЗ (" + h.subj + ", срок " + h.due + "):\n" + NET.pop;
        return;
      }
      const cards = [...document.body.querySelectorAll("div,li,a")]
        .filter(
          (el) =>
            !inHost(el) &&
            vis(el) &&
            el.children.length &&
            /\d{1,2}\.\d{2}\.\d{2,4}/.test(el.textContent || "") &&
            (el.textContent || "").length < 200,
        )
        .slice(0, 12);
      NET.pop =
        "Задание не найдено (" +
        h.subj +
        ", срок " +
        h.due +
        "). Карточки на странице:\n" +
        cards
          .map(
            (c) =>
              "- " +
              String(c.className || c.tagName).slice(0, 50) +
              ": " +
              (c.innerText || "").replace(/\s+/g, " ").trim().slice(0, 80),
          )
          .join("\n");
    } catch (e) {}
  }
  const sendHw = (h, v) =>
    bridge(
      "ДЗ",
      async () => {
        step("Открываю «Домашние задания» в журнале…");
        let card = null;
        for (let i = 0; i < 12 && !(card = findHwCard(h)); i++) await sleep(400);
        if (!card) {
          hwSnap(null, h);
          throw new Error("не нашёл это задание на странице ДЗ журнала");
        }
        step("Нашёл задание, открываю окно сдачи…");
        const modal = await openUpload(card);
        if (!modal) {
          hwSnap(card, h);
          throw new Error("в журнале не открылось окно сдачи");
        }
        step(v.file ? "Прикрепляю файл и заполняю ответ…" : "Заполняю ответ…");
        const box = modal.closest(".modal-content,[role=dialog],.modal") || modal;
        const fi = box.querySelector("input[type=file]");
        if (v.file) {
          if (!fi) throw new Error("в окне журнала нет поля для файла");
          const dt = new W.DataTransfer();
          dt.items.add(v.file);
          fi.files = dt.files;
          fi.dispatchEvent(new Event("input", { bubbles: true }));
          fi.dispatchEvent(new Event("change", { bubbles: true }));
          await sleep(600);
        }
        if (v.answer) {
          const ta =
            box.querySelector("textarea") ||
            [...box.querySelectorAll("input[type=text]:not([placeholder*=ч]):not([placeholder*=м])")].filter(
              vis,
            )[0];
          if (ta) setVal(ta, v.answer);
          else if (!v.file) throw new Error("в окне журнала нет поля для текстового ответа");
        }
        const tIn = [...box.querySelectorAll("input")].filter(
          (i) => /^(чч|hh)$/i.test(i.placeholder || "") || /^(мм|mm)$/i.test(i.placeholder || ""),
        );
        if (tIn.length >= 2 && (v.hh || v.mm)) {
          setVal(tIn[0], String(+v.hh || 0).padStart(2, "0"));
          setVal(tIn[1], String(+v.mm || 0).padStart(2, "0"));
        }
        if (+v.stars) {
          const f = readPop(box.querySelector(".emoji-evaluation,[class*=evaluation],rating") || box);
          const st = f.stars[+v.stars - 1];
          if (st) {
            const inp = st.matches("input") ? st : st.querySelector("input");
            fire(inp || st);
          }
        }
        if (v.ecomment) {
          const tg = box.querySelector(".want-review-toggle,[class*=review-toggle]");
          if (tg) {
            fire(tg);
            await sleep(300);
          }
          const tas = [...box.querySelectorAll("textarea")];
          if (tas.length > 1) setVal(tas[tas.length - 1], v.ecomment);
        }
        (v.tags || "")
          .split("|")
          .filter(Boolean)
          .forEach((tg) => {
            const it = [
              ...box.querySelectorAll(".evaluation-tags-item,[class*=tags-item],[class*=tag]"),
            ].find((e) => norm(e.innerText) === norm(tg));
            if (it) fire(it);
          });
        await sleep(300);
        const send =
          box.querySelector(".btn-accept") ||
          [...box.querySelectorAll("button")].find((b) =>
            /^(отправить|загрузить|сдать)$/i.test((b.innerText || "").trim()),
          );
        if (!send) throw new Error("не нашёл кнопку «Отправить» в окне журнала");
        if (send.disabled)
          throw new Error(
            "журнал не даёт отправить: " +
              (((box.querySelector(".text-homework-err-wrap") || {}).innerText || "").trim() ||
                "проверь файл и поля"),
          );
        step("Отправляю, жду ответ журнала…");
        fire(send);
        // ошибка журнала в окне (например, неподходящий формат файла) - показываем её, окно журнала закрываем
        setTimeout(() => {
          const er = (
            (box.querySelector(".text-homework-err-wrap,[class*=err]") || {}).innerText || ""
          ).trim();
          if (er && box.isConnected) {
            hwErr = er;
            const dcl = box.querySelector(".btn-decline");
            if (dcl) fire(dcl);
          }
        }, 1500);
      },
      /homework|hometask|dz/i,
    ).catch((e) => {
      if (hwErr) {
        const m = hwErr;
        hwErr = "";
        throw new Error("журнал ответил: " + m);
      }
      const m0 = upModal();
      if (m0) {
        const dcl = (m0.closest(".modal-content,.modal") || m0).querySelector(".btn-decline");
        if (dcl) fire(dcl);
      }
      throw e;
    });
  let hwErr = "";

  // окна-формы Дневника
  let curForm = null;
  function formDlg(title, sub, body, submitText, onSubmit, classicLabel) {
    const d = $("#dlg");
    d.classList.add("wide");
    d.innerHTML = `<form class="dlg fdlg" id="fdlg"><div class="dh2"><div><h3>${title}</h3><p>${sub}</p></div><button type="button" class="x" data-act="close" aria-label="Закрыть">×</button></div>
      <div class="fbody">${body}</div><div class="fstat" id="fstat" hidden></div>
      <div class="ffoot"><button type="button" class="m-btn" data-classic-go="${esc(classicLabel)}">${ic("ext")}Через журнал</button><button type="submit" class="m-btn pri" id="fsend">${ic("send")}${submitText}</button></div></form>`;
    curForm = onSubmit;
    if (!d.open) d.showModal();
    enhanceSelects(d);
    R.getElementById("fdlg").addEventListener("submit", (e) => {
      e.preventDefault();
      runForm();
    });
  }
  async function runForm() {
    const f = R.getElementById("fdlg"),
      st = R.getElementById("fstat"),
      btn = R.getElementById("fsend");
    if (!f || !curForm) return;
    const val = {};
    f.querySelectorAll("[name]").forEach(
      (el) =>
        (val[el.name] =
          el.type === "checkbox"
            ? el.checked
            : el.type === "file"
              ? (el.files && el.files[0]) || null
              : el.value.trim()),
    );
    const bad = curForm.check ? curForm.check(val) : "";
    if (bad) {
      st.hidden = false;
      st.className = "fstat bad";
      st.textContent = bad;
      return;
    }
    btn.disabled = true;
    st.hidden = false;
    st.className = "fstat busy";
    st.innerHTML = `<span class="spin"></span>Отправляю через журнал…`;
    try {
      await curForm.run(val);
      st.className = "fstat ok";
      st.textContent = "Готово: журнал принял отправку";
      toast("Отправлено");
      setTimeout(() => {
        const d = $("#dlg");
        d && d.open && d.close();
      }, 1300);
      setTimeout(() => sync("after-send"), 1500);
    } catch (e) {
      st.className = "fstat bad";
      st.textContent = "Не получилось: " + e.message + ". Можно отправить через журнал - кнопка слева.";
      btn.disabled = false;
    }
  }
  const fField = (label, html) => `<label class="ff"><span>${label}</span>${html}</label>`;
  function openSignalForm() {
    const types = M.sigTypes && M.sigTypes.length ? M.sigTypes : ["Вопрос к учебной части"];
    formDlg(
      "Обращение в учебную часть",
      "Ответ придёт в раздел «Обращения»",
      fField(
        "Тема обращения",
        `<select class="m-in" name="type">${types.map((t) => `<option>${esc(t)}</option>`).join("")}</select>`,
      ) +
        fField(
          "Заголовок",
          `<input class="m-in" name="theme" maxlength="120" placeholder="Коротко о сути">`,
        ) +
        fField(
          "Сообщение",
          `<textarea class="m-in" name="text" rows="6" placeholder="Опиши вопрос подробно"></textarea>`,
        ) +
        `<label class="m-check"><input type="checkbox" name="urgent"><span>Срочно</span></label>`,
      "Отправить",
      {
        check: (v) => (!v.theme ? "Напиши заголовок" : !v.text ? "Напиши сообщение" : ""),
        run: (v) => sendSignal(v.type, v.theme, v.text, v.urgent),
      },
      "Обращения",
    );
  }
  function openComplaintForm() {
    formDlg(
      "Жалоба генеральному директору",
      "Опиши ситуацию: что случилось, когда и с кем",
      fField("Тема", `<input class="m-in" name="theme" maxlength="120">`) +
        fField("Сообщение", `<textarea class="m-in" name="text" rows="7"></textarea>`),
      "Отправить жалобу",
      {
        check: (v) => (!v.theme ? "Напиши тему" : !v.text ? "Напиши сообщение" : ""),
        run: (v) => sendComplaint(v.theme, v.text),
      },
      "Жалобы",
    );
  }
  function openProfileForm() {
    const p = M.prof || {},
      ph = p.phones && p.phones[0] ? p.phones[0] : "";
    formDlg(
      "Изменить данные",
      p.pending
        ? "Прошлое изменение ещё на проверке. Новое журнал примет после её подтверждения"
        : "Изменения проверяет учебная часть, это занимает время",
      fField(
        "Телефон",
        `<input class="m-in" name="phone" value="${esc(ph.replace(/^7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4"))}" inputmode="tel">`,
      ) +
        fField("Почта", `<input class="m-in" name="email" type="email" value="${esc(p.email || "")}">`) +
        fField("Город / адрес", `<input class="m-in" name="address" value="${esc(p.address || "")}">`) +
        fField("Место учёбы", `<input class="m-in" name="study" value="${esc(p.study || "")}">`),
      "Сохранить",
      {
        check: (v) => (v.email && !/^\S+@\S+\.\S+$/.test(v.email) ? "Проверь адрес почты" : ""),
        run: (v) => sendProfile(v),
      },
      "Личный кабинет",
    );
  }
  function openPasswordForm() {
    formDlg(
      "Сменить пароль",
      "Новый пароль придёт на почту",
      fField(
        "Текущий пароль",
        `<input class="m-in" name="old" type="password" autocomplete="current-password">`,
      ) +
        fField(
          "Новый пароль",
          `<input class="m-in" name="new1" type="password" autocomplete="new-password">`,
        ) +
        fField(
          "Повтори новый пароль",
          `<input class="m-in" name="new2" type="password" autocomplete="new-password">`,
        ),
      "Сменить пароль",
      {
        check: (v) =>
          !v.old
            ? "Введи текущий пароль"
            : v.new1.length < 6
              ? "Новый пароль - минимум 6 символов"
              : v.new1 !== v.new2
                ? "Пароли не совпадают"
                : "",
        run: (v) => sendPassword(v.old, v.new1),
      },
      "Личный кабинет",
    );
  }
  function openPhotoForm() {
    formDlg(
      "Загрузить фото",
      "Фото появится после проверки учебной частью",
      `<label class="drop" id="drop">${ic("upload")}<b>Выбери фото</b><span id="dropname">JPG или PNG</span><input type="file" name="file" accept="image/*"></label>`,
      "Загрузить",
      { check: (v) => (!v.file ? "Выбери фото" : ""), run: (v) => sendPhoto(v.file) },
      "Личный кабинет",
    );
    const inp = R.querySelector("#drop input"),
      nm = R.getElementById("dropname"),
      dr = R.getElementById("drop");
    inp.addEventListener("change", () => {
      nm.textContent = inp.files[0] ? inp.files[0].name : "JPG или PNG";
      dr.classList.toggle("has", !!inp.files[0]);
    });
  }
  const HW_TAGS = [
    "Все круто!",
    "Все понятно!",
    "Скучно!(",
    "Задание слишком сложное",
    "Мне нравится",
    "Не понятно, но нужно было сделать",
    "Задание слишком простое",
  ];
  const LESSON_W = ["", "Очень плохо", "Плохо", "Нормально", "Хорошо", "Отлично"];
  const starRow = (id, label) =>
    `<div class="hs-f"><span>${label}</span><div class="rt-stars hwf-stars" data-sr="${id}">${[1, 2, 3, 4, 5].map((k) => `<button type="button" class="rt-s" data-sv="${k}" aria-label="${k}"><svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg></button>`).join("")}</div><small class="hs-w" id="w-${id}">не выбрано</small><input type="hidden" name="${id}" value="0"></div>`;
  // отметки (теги) для оценки берём из ответов журнала: ids + русские подписи из его переводов
  const evTags = (type) => (NET.evTags || LS.get("evtags", {}))[type] || [];
  const tagRow = (type, name) => {
    const T = evTags(type);
    return T.length
      ? `<div class="hwf-tags" data-tg="${name}">${T.map((t) => `<button type="button" class="hwf-tag" data-tv="${esc(t.id)}" aria-pressed="false">${esc(t.label)}</button>`).join("")}</div><input type="hidden" name="${name}" value="">`
      : "";
  };
  let evalBusy = false,
    tagsP = null;
  function discoverTags(force) {
    const have = evTags("evaluation_lesson_teach").length && evTags("evaluation_lesson").length;
    if (tagsP || (have && !force) || (Date.now() - LS.get("evtagsAt", 0) < 6 * 3600e3 && !force && have))
      return tagsP || Promise.resolve();
    return (tagsP = (async () => {
      try {
        if (!NET.tr) {
          try {
            NET.tr = await api("tr", "public/translations");
            delete NET.raw.tr;
          } catch (e) {}
        }
        const srcs = [...document.querySelectorAll("script[src]")]
          .map((x) => x.src)
          .filter((u) => {
            try {
              return new URL(u).origin === location.origin && !/vendor|polyfill|runtime/.test(u);
            } catch (e) {
              return false;
            }
          });
        const paths = new Set();
        for (const src of srcs) {
          try {
            const t = await (await origFetch(src)).text();
            for (const m of t.matchAll(/apiUrl\(\)\+"\/([\w\/-]*tag[\w\/-]*)"/gi))
              if (!/homework/.test(m[1])) paths.add(m[1]);
          } catch (e) {}
        }
        NET.tagPaths = [...paths];
        [
          "feedback/students/get-tags",
          "feedback/students/tags",
          "feedback/students/evaluate-lesson-tags",
        ].forEach((x) => paths.add(x));
        for (const p of paths)
          for (const q of ["", "?type=evaluation_lesson", "?type=evaluation_lesson_teach"]) {
            try {
              const r = await api("tags", p + q);
              delete NET.raw.tags;
              delete NET.status.tags;
              if (Array.isArray(r) && r[0] && r[0].translate_key) {
                NET.tagRaw = (NET.tagRaw || []).concat(
                  r.map((x) => Object.assign({ type: x.type || (q ? q.split("=")[1] : "") }, x)),
                );
                tagLabels();
              }
            } catch (e) {
              delete NET.status.tags;
            }
            if (evTags("evaluation_lesson_teach").length && evTags("evaluation_lesson").length) break;
          }
        LS.set("evtagsAt", Date.now());
      } catch (e) {
      } finally {
        tagsP = null;
      }
    })());
  }
  async function openLessonRate(i = 0) {
    if (!evTags("evaluation_lesson_teach").length) await Promise.race([discoverTags(), sleep(4000)]);
    if (!(M.evalList || []).length) {
      try {
        const r = await api("evalLessons", "feedback/students/evaluate-lesson-list");
        M.evalList = parseEval(r);
      } catch (e) {}
    }
    const L = M.evalList || [],
      e = L[i];
    if (!e) {
      toast("Все пары уже оценены");
      return;
    }
    const d = e.date ? fromIso(e.date) : null;
    formDlg(
      "Оцените занятие",
      `${L.length > 1 || true ? `<span class="ev-step"><i></i><b class="num">${i + 1} из ${L.length}</b><i></i></span>` : ""}`,
      `<div class="ev-card">${photo("ev-ph", e.photo, e.teacher)}<b class="ev-name">${esc(e.teacher || "Преподаватель")}</b><span class="ev-subj">${esc(e.subj)}</span>${d ? `<span class="ev-date">${d.getDate()} ${MONTHS_G ? MONTHS_G[d.getMonth()] : ""} ${d.getFullYear()}</span>` : ""}</div>
      <div class="ev-band"><span>Оцените работу преподавателя</span>${starRow("mt", "")}<small class="ev-def">Не выбрал - будет 5 звёзд</small></div>
      ${tagRow("evaluation_lesson_teach", "tt")}
      <label class="ev-cm"><span>Комментарий</span><textarea class="m-in" name="ct" rows="3" maxlength="500" placeholder="Ваш комментарий"></textarea><small class="num" id="evcnt">0 / 500</small></label>
      <p class="ev-bonus">Бонус: 1 <span class="coin"></span> за оценку</p>
      <p class="ev-note">Оценки анонимны и преподавателям не предоставляются</p>`,
      i + 1 < L.length ? "Далее" : "Отправить",
      {
        check: (v) =>
          +v.mt && +v.mt <= 3 && v.ct.length < 20
            ? "При оценке 3 и ниже журнал просит комментарий от 20 символов"
            : "",
        run: async (v) => {
          const tags = (v.tt || "").split(",").filter(Boolean).map(Number);
          const body = {
            key: e.key,
            mark_teach: +v.mt || 5,
            comment_teach: v.ct || "",
            tags_teach: tags,
            mark_lesson: null,
            comment_lesson: "",
            tags_lesson: [],
          };
          let r = await postJson("feedback/students/evaluate-lesson", body);
          if (r.status >= 400 && r.status < 500 && r.status !== 401 && r.status !== 403)
            r = await postJson(
              "feedback/students/evaluate-lesson",
              Object.assign(body, { mark_lesson: +v.mt || 5 }),
            ); // если серверу нужна оценка занятия - та же шкала
          const er = apiErr(r);
          if (er) throw er;
          M.evalList = L.filter((x) => x !== e);
          LS.set("model", M);
          if (M.evalList.length) setTimeout(() => openLessonRate(0), 1450);
          else {
            setTimeout(render, 900);
            setTimeout(() => sync("after-eval"), 1500);
          }
        },
      },
      "Главная",
    );
    const f = R.getElementById("fdlg");
    f.classList.add("hsend", "evdlg");
    const ta = f.querySelector("[name=ct]"),
      cnt = R.getElementById("evcnt");
    ta.addEventListener("input", () => (cnt.textContent = ta.value.length + " / 500"));
    R.querySelectorAll("[data-sr]").forEach((g) =>
      g.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-sv]");
        if (!b) return;
        const id = g.dataset.sr,
          inp = R.querySelector(`[name=${id}]`);
        inp.value = b.dataset.sv;
        g.querySelectorAll(".rt-s").forEach((x) => x.classList.toggle("on", +x.dataset.sv <= +inp.value));
        R.getElementById("w-" + id).textContent = LESSON_W[+inp.value];
      }),
    );
    R.querySelectorAll("[data-tg]").forEach((g) =>
      g.addEventListener("click", (ev) => {
        const b = ev.target.closest("[data-tv]");
        if (!b) return;
        b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
        R.querySelector(`[name=${g.dataset.tg}]`).value = [...g.querySelectorAll("[aria-pressed=true]")]
          .map((x) => x.dataset.tv)
          .join(",");
      }),
    );
  }
  const MONTHS_G = MON;
  const hwRef = (h) => (h.id != null ? "id" + h.id : "i" + (M.hw || []).indexOf(h));
  function openHwForm(ref) {
    ref = String(ref);
    const L = M.hw || [];
    const h = ref.startsWith("id") ? L.find((x) => String(x.id) === ref.slice(2)) : L[+ref.replace(/^i/, "")];
    if (!h) {
      toast("Задание не найдено - обнови данные");
      return;
    }
    const d = h.due ? fromIso(h.due) : null,
      left = d ? Math.ceil((d - new Date(new Date().toDateString())) / 864e5) : null;
    const dueChip = d
      ? `<span class="hs-chip ${left < 0 ? "bad" : left <= 1 ? "warn" : ""}">${ic("clock")}срок ${dm(d)}${left != null ? " · " + (left < 0 ? "просрочено" : left === 0 ? "сегодня" : left === 1 ? "завтра" : "осталось " + left + " " + plural(left, "день", "дня", "дней")) : ""}</span>`
      : "";
    const WORDS = [
      "",
      "Совсем не хватило",
      "Скорее не хватило",
      "Частично",
      "В основном хватило",
      "Полностью хватило",
    ];
    formDlg(
      `Сдать задание`,
      `<b class="hs-subj">${esc(h.subj)}</b>${h.theme ? `<span class="hs-theme">${esc(h.theme)}</span>` : ""}<span class="hs-meta">${dueChip}${h.teacher ? `<span class="hs-chip">${ic("profile")}${esc(h.teacher)}</span>` : ""}</span>`,

      `<section class="hs-sec"><div class="hs-h"><b>1</b><div><h4>Твоя работа</h4><p>Файл, текст или оба сразу</p></div></div>
        <label class="hs-drop" id="drop"><span class="hs-ic">${ic("upload")}</span><span class="hs-dt"><b id="dropb">Выбери файл</b><small id="dropname">или перетащи сюда · архив, документ, фото · не .txt и не .csv</small></span><span class="hs-x" id="dropx" hidden title="Убрать файл">×</span><input type="file" name="file"></label>
        <textarea class="m-in" name="answer" rows="2" placeholder="Ответ текстом или ссылка на работу (необязательно)"></textarea></section>
      <section class="hs-sec hs-fb"><div class="hs-h"><b>2</b><div><h4>Отзыв для журнала</h4><p>Журнал спрашивает это при сдаче · можно пропустить</p></div></div>
        <div class="hs-row"><div class="hs-rl">${ic("clock")}<span>Сколько времени ушло</span></div>
          <div class="hs-tline"><div class="hs-quick">${[
            [0, 15],
            [0, 30],
            [1, 0],
            [2, 0],
          ]
            .map(
              ([a, b]) =>
                `<button type="button" data-q="${a}|${b}" aria-pressed="false">${a ? a + " ч" : b + " мин"}</button>`,
            )
            .join("")}</div>
          <div class="hwf-time"><input class="m-in num" name="hh" inputmode="numeric" maxlength="2" placeholder="0"><small>ч</small><input class="m-in num" name="mm" inputmode="numeric" maxlength="2" placeholder="00"><small>мин</small></div></div></div>
        <div class="hs-row"><div class="hs-rl">${ic("star")}<span>Хватило знаний с урока?</span><em class="hs-w" id="hsw">не выбрано</em></div>
          <div class="rt-stars hwf-stars" id="hwst">${[1, 2, 3, 4, 5].map((k) => `<button type="button" class="rt-s" data-hs="${k}" aria-label="${k}"><svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg></button>`).join("")}</div></div>
        <div class="hs-row"><div class="hs-rl">${ic("chat")}<span>Впечатление</span><small>можно несколько</small></div>
          <div class="hwf-tags">${HW_TAGS.map((t) => `<button type="button" class="hwf-tag" data-ht="${esc(t)}" aria-pressed="false">${esc(t)}</button>`).join("")}</div></div>
        <div class="hs-row"><button type="button" class="hs-ctog" id="hsct" aria-pressed="false">+ Добавить комментарий к заданию</button>
          <textarea class="m-in" name="ecomment" id="hsc" rows="3" maxlength="500" placeholder="Твой комментарий к заданию" hidden></textarea></div>
        <input type="hidden" name="stars" value="0"><input type="hidden" name="tags" value=""></section>`,
      "Сдать задание",
      {
        check: (v) =>
          !v.file && !v.answer
            ? "Прикрепи файл или напиши ответ"
            : v.file && /\.(txt|csv)$/i.test(v.file.name)
              ? "Журнал не принимает .txt и .csv - заархивируй файл или сохрани в другом формате"
              : (v.hh && !/^\d{1,2}$/.test(v.hh)) || (v.mm && !(/^\d{1,2}$/.test(v.mm) && +v.mm < 60))
                ? "Время: часы и минуты цифрами"
                : "",
        run: async (v) => {
          if (h.id != null) {
            try {
              return await sendHwDirect(h, v);
            } catch (e) {
              if (e.final) throw e;
              pushW("  ↳ прямая отправка не прошла (" + e.message + "), пробую через окно журнала");
            }
          }
          return sendHw(h, v);
        },
      },
      "ДЗ",
    );
    R.getElementById("fdlg").classList.add("hsend");
    const inp = R.querySelector("#drop input"),
      nm = R.getElementById("dropname"),
      nb = R.getElementById("dropb"),
      dr = R.getElementById("drop"),
      dx = R.getElementById("dropx");
    const paint = () => {
      const f = inp.files[0];
      nb.textContent = f ? f.name : "Выбери файл";
      nm.textContent = f
        ? `${Math.max(1, Math.round(f.size / 1024))} КБ · нажми, чтобы заменить`
        : "или перетащи сюда · архив, документ, фото · не .txt и не .csv";
      dr.classList.toggle("has", !!f);
      dx.hidden = !f;
    };
    inp.addEventListener("change", paint);
    dx.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      inp.value = "";
      paint();
    });
    dr.addEventListener("dragover", (e) => {
      e.preventDefault();
      dr.classList.add("over");
    });
    dr.addEventListener("dragleave", () => dr.classList.remove("over"));
    dr.addEventListener("drop", (e) => {
      e.preventDefault();
      dr.classList.remove("over");
      if (e.dataTransfer.files[0]) {
        inp.files = e.dataTransfer.files;
        paint();
      }
    });
    const hs = R.getElementById("hwst"),
      hsv = R.querySelector("[name=stars]"),
      htv = R.querySelector("[name=tags]"),
      hw = R.getElementById("hsw");
    hs.addEventListener("click", (e) => {
      const b = e.target.closest("[data-hs]");
      if (!b) return;
      hsv.value = hsv.value === b.dataset.hs ? "0" : b.dataset.hs;
      hs.querySelectorAll(".rt-s").forEach((x) => x.classList.toggle("on", +x.dataset.hs <= +hsv.value));
      hw.textContent = WORDS[+hsv.value] || "не выбрано";
    });
    R.querySelector(".hs-quick").addEventListener("click", (e) => {
      const b = e.target.closest("[data-q]");
      if (!b) return;
      const [a, m] = b.dataset.q.split("|");
      R.querySelector("[name=hh]").value = a;
      R.querySelector("[name=mm]").value = String(m).padStart(2, "0");
      R.querySelectorAll(".hs-quick [data-q]").forEach((x) => x.setAttribute("aria-pressed", x === b));
    });
    R.querySelectorAll("[name=hh],[name=mm]").forEach((i) =>
      i.addEventListener("input", () =>
        R.querySelectorAll(".hs-quick [data-q]").forEach((x) => x.setAttribute("aria-pressed", "false")),
      ),
    );
    R.getElementById("hsct").addEventListener("click", (e) => {
      const b = e.currentTarget,
        on = b.getAttribute("aria-pressed") !== "true",
        ta = R.getElementById("hsc");
      b.setAttribute("aria-pressed", on);
      ta.hidden = !on;
      b.textContent = on ? "− Убрать комментарий" : "+ Добавить комментарий к заданию";
      if (on) ta.focus();
      else ta.value = "";
    });
    R.querySelector(".hwf-tags").addEventListener("click", (e) => {
      const b = e.target.closest("[data-ht]");
      if (!b) return;
      b.setAttribute("aria-pressed", b.getAttribute("aria-pressed") !== "true");
      htv.value = [...R.querySelectorAll(".hwf-tag[aria-pressed=true]")].map((x) => x.dataset.ht).join("|");
    });
  }

  /* ======================= страницы сервисных разделов ======================= */
  const sHero = (p, extra = "") =>
    `<section class="m-hero"><div class="m-ic">${ic(p.ic, "i big")}</div><div><b>${esc(p.n)}</b><span>${esc(p.d || "")}</span></div>${extra}</section>`;
  const P = (id) => PAGES.find((x) => x.id === id);
  const goBtn = (label, text, pri) =>
    `<button class="m-btn ${pri ? "pri" : ""}" data-classic-go="${esc(label)}">${text}</button>`;
  const copyBtn = (v) =>
    `<button class="cpy" data-copy="${esc(v)}" title="Скопировать">${ic("copy")}</button>`;

  VIEWS.materials = () => `${sHero(P("materials"))}
    ${M.lib && M.lib.length ? `<section class="card"><div class="hd"><h2>Материалы</h2><small class="num">${M.lib.length}</small></div><div class="list">${M.lib.map((x) => `<div class="li">${ic("book")}<div class="grow"><b>${esc(x.title)}</b><span>${esc(x.subj)}${x.date ? " · " + dm(fromIso(x.date)) : ""}</span></div>${x.url && /^https?:/.test(x.url) ? `<a class="m-btn" href="${esc(x.url)}" target="_blank" rel="noopener">Открыть</a>` : ""}</div>`).join("")}</div></section>` : `<p class="note">${M.libCount != null ? "В журнале материалов: " + M.libCount + "." : ""} Как только преподаватели что-то выложат, список появится здесь.</p>`}
    <div class="row r3">${[
      ["Уроки", "book"],
      ["Библиотека", "book"],
      ["Видео", "play"],
      ["Статьи", "hw"],
      ["Практические задания", "check"],
      ["Тесты", "poll"],
    ]
      .map(
        ([n, i]) =>
          `<div class="card mat">${ic(i, "i big")}<div><b>${n}</b><span>Материалов пока нет</span></div><span class="cnt num">0</span></div>`,
      )
      .join("")}</div>
    <div class="card hint">${ic("help")}<div><b>Где брать материалы к парам</b><span>Преподаватели выкладывают сюда методические материалы и рекомендации. Файлы к конкретным заданиям лежат в карточках домашних заданий: кнопка «Файл задания».</span></div><button class="m-btn" data-page="homework">Домашние задания</button></div>`;

  VIEWS.market = () => `${sHero(P("market"), goBtn("Маркет", ic("ext") + "Открыть Маркет", true))}
    ${M.market && M.market.length ? `<div class="hwgrid">${M.market.map((x) => `<div class="card mkt">${x.img ? `<img src="${esc(x.img)}" alt="">` : ""}<b>${esc(x.name)}</b>${x.price != null ? `<span class="rw num">${x.price} <span class="${x.cur === 2 ? "gem" : "coin"}"></span></span>` : ""}</div>`).join("")}</div>` : `<p class="note">${M.market ? "Сейчас в Маркете для твоего филиала нет товаров." : ""}</p>`}
    ${cfg.mc ? `<div class="card hint nomc">${ic("help")}<div><b>Золото и изумруды</b><span>Это те же топкоины (золото) и топгемы (изумруды) журнала - включён пиксельный вид валюты. Вернуть: Настройки → Валюта → «Как в журнале»</span></div></div>` : ""}
    <div class="row r2"><div class="card kpi"><div class="lab"><span class="coin"></span>Топкоины${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.coins ?? "-"}</div><div class="sub">за посещения, сданные вовремя ДЗ и работу на паре</div></div>
    <div class="card kpi"><div class="lab"><span class="gem"></span>Топгемы${cfg.mc ? `<button class="tipb nomc" data-tip="Золото - это топкоины журнала, изумруды - топгемы.&#10;Включён пиксельный вид валюты (Настройки → Валюта)" aria-label="Что это">i</button>` : ""}</div><div class="val num">${M.user.gems ?? "-"}</div><div class="sub">за оценки</div></div></div>
    <div class="card hint">${ic("bag")}<div><b>Как купить</b><span>Товары покупаются за накопленные топкоины и топгемы. Покупки не влияют на рейтинг. Забрать товар можно в учебной части филиала.</span></div></div>`;

  const rub = (n) => (+n || 0).toLocaleString("ru-RU") + " ₽";
  VIEWS.payment = () => {
    const LP = M.pay;
    if (!LP) {
      prepareClassic("Оплата");
      return `${sHero(P("payment"), `<button class="m-btn pri" data-oclick="Оплата|скачать сч|Счёт скачивается">${ic("hw")}Скачать счёт</button>` + goBtn("Оплата", ic("ext") + "Открыть в журнале"))}<div class="card"><div class="restday"><b>Данные об оплате не пришли</b>Журнал не отдал раздел оплаты. Нажми «Обновить» вверху или открой раздел в журнале</div></div>`;
    }
    return payView(
      {
        recv: LP.recv,
        inn: LP.inn,
        bik: LP.bik,
        acc: LP.acc,
        purpose: LP.purpose,
        plan: LP.plan || [],
        hist: LP.hist || [],
      },
      LP,
    );
  };
  function payView(PAY, LP) {
    const now = new Date(),
      next = PAY.plan.find((x) => fromIso(x[0]) >= now),
      paid = PAY.hist.reduce((a, x) => a + x[2], 0),
      left = PAY.plan.reduce((a, x) => a + x[2], 0);
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
        <section class="card"><div class="hd"><h2>График платежей</h2></div><div class="tscroll"><table class="t m-t"><thead><tr><th>Оплатить до</th><th>Описание</th><th class="r">Сумма</th></tr></thead><tbody>${PAY.plan.map((x) => `<tr><td class="num">${dm(fromIso(x[0]))}.${x[0].slice(0, 4)}</td><td>${esc(x[1])}</td><td class="r num"><b>${rub(x[2])}</b>${x[3] ? ' <span class="stat-good">оплачено</span>' : ""}</td></tr>`).join("")}</tbody></table></div></section>
        <section class="card"><div class="hd"><h2>История платежей</h2></div><div class="tscroll"><table class="t m-t"><thead><tr><th>Дата</th><th>Назначение</th><th class="r">Оплачено</th></tr></thead><tbody>${PAY.hist.map((x) => `<tr><td class="num">${dm(fromIso(x[0]))}.${x[0].slice(0, 4)}</td><td>${esc(x[1]) || '<span class="soft">-</span>'}</td><td class="r num stat-good"><b>${rub(x[2])}</b></td></tr>`).join("")}</tbody></table></div></section>
      </div></div>
    <div class="btns"><button class="m-btn" data-oclick="Оплата|заявить о нарушении|Форма открыта поверх Дневника">${ic("alert")}Заявить о нарушении</button><span class="note" style="align-self:center">${LP ? `Данные журнала${LP.updated ? ", обновлены " + dm(fromIso(LP.updated)) : ""}${LP.debt ? ` · задолженность <b class="stat-bad">${rub(LP.debt)}</b>` : " · задолженности нет"}` : ""}. Счёт скачивается в журнале.</span></div>`;
  }

  VIEWS.profile = () => {
    const u = M.user,
      bd = u.birthday ? fromIso(isoOf(u.birthday)) : null,
      reg = u.registration_date ? fromIso(isoOf(u.registration_date)) : null;
    return `<section class="hero prof"><div class="hero-id">${photo("xl")}<div><div class="cap">${esc(u.group || "")}${u.stream_name ? " · " + esc(u.stream_name) : ""}</div><h2>${esc(u.name || "")}</h2>
      <div class="facts"><span>Уровень <b class="num">${u.level ?? "-"}</b></span><span>Достижений <b class="num">${u.achieves_count ?? "-"}</b></span><span>Топкоины <b class="num">${u.coins ?? "-"}</b></span><span>Топгемы <b class="num">${u.gems ?? "-"}</b></span></div></div></div></section>
    <div class="row r2">
      <section class="card"><div class="hd"><h2>Данные</h2><small>меняются через учебную часть после модерации</small></div>
        <dl class="m-kv"><dt>ФИО</dt><dd>${esc(u.name || "-")}</dd></dl>
        <dl class="m-kv"><dt>Группа</dt><dd>${esc(u.group || "-")}</dd></dl>
        ${u.stream_name ? `<dl class="m-kv"><dt>Поток</dt><dd>${esc(u.stream_name)}</dd></dl>` : ""}
        ${bd ? `<dl class="m-kv"><dt>Дата рождения</dt><dd class="num">${longDate(bd)} ${bd.getFullYear()}</dd></dl>` : ""}
        ${reg ? `<dl class="m-kv"><dt>В журнале с</dt><dd class="num">${longDate(reg)} ${reg.getFullYear()}</dd></dl>` : ""}
        ${M.prof && M.prof.phones.length ? `<dl class="m-kv"><dt>Телефон</dt><dd class="num">${M.prof.phones.map((p) => esc(p.replace(/^7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2-$3-$4"))).join(", ")}</dd></dl>` : ""}
        ${M.prof && M.prof.email ? `<dl class="m-kv"><dt>Почта</dt><dd>${esc(M.prof.email)}</dd></dl>` : ""}
        ${M.prof && M.prof.address ? `<dl class="m-kv"><dt>Город</dt><dd>${esc(M.prof.address)}</dd></dl>` : ""}
        ${M.prof && M.prof.study ? `<dl class="m-kv"><dt>Учёба</dt><dd>${esc(M.prof.study)}</dd></dl>` : ""}
        ${M.prof && M.prof.links.length ? `<dl class="m-kv"><dt>Ссылки</dt><dd>${M.prof.links.map((l) => `<a class="m-link" href="${esc(/^https?:/.test(l.value) ? l.value : "https://" + l.value)}" target="_blank" rel="noopener">${esc(l.value.replace(/^https?:\/\//, ""))}</a>`).join("<br>")}</dd></dl>` : ""}
        <dl class="m-kv"><dt>Телефон</dt><dd>${u.phoneOk === false ? '<span class="stat-bad">не подтверждён</span>' : '<span class="stat-good">подтверждён</span>'}</dd></dl>
        <dl class="m-kv"><dt>Почта</dt><dd>${u.emailOk === false ? '<span class="stat-bad">не подтверждена</span>' : '<span class="stat-good">подтверждена</span>'}</dd></dl></section>
      <section class="card"><div class="hd"><h2>Действия</h2></div>
        <div class="acts2"><button class="m-btn pri" data-form="profile">${ic("profile")}Изменить данные</button><button class="m-btn" data-form="photo">${ic("upload")}Загрузить фото</button><button class="m-btn" data-form="password">${ic("gear")}Сменить пароль</button></div>
        <div class="card hint" style="margin-top:14px;box-shadow:none">${ic("trophy")}<div><b>Профиль заполнен${M.prof && M.prof.fill != null ? " на " + M.prof.fill + "%" : ""}</b><span>${M.prof && M.prof.pending ? "Изменения ждут подтверждения учебной части." : M.prof && M.prof.fill >= 100 ? "Награда «Полностью заполненный профиль» (+5 топкоинов) уже получена." : "Заполни профиль полностью, чтобы получить +5 топкоинов."}${M.prof && M.prof.decline ? " Отклонено: " + esc(M.prof.decline) : ""}</span></div></div></section>
    </div>`;
  };

  const talk = (p, label, lines, btn, list) => `${sHero(p)}
    <div class="row r2"><section class="card"><div class="hd"><h2>Написать</h2></div>${lines.map((l) => `<div class="li2">${ic("check")}<span>${l}</span></div>`).join("")}
      <div class="btns"><button class="m-btn pri" data-form="${p.id === "requests" ? "signal" : "complaint"}">${ic("chat")}${btn}</button>${goBtn(label, ic("ext") + "Через журнал")}</div><p class="note">Письмо уходит прямо из Дневника. Если что-то пойдёт не так, откроется форма журнала.</p></section>
    <section class="card"><div class="hd"><h2>${p.id === "requests" ? "Мои обращения" : "Мои жалобы"}</h2>${list ? `<small class="num">${list.length}</small>` : ""}</div>
      ${list && list.length ? `<div class="list">${list.map((x) => `<div class="li"><div class="grow"><b>${esc(x.title)}</b><span class="num">${x.date ? dm(fromIso(x.date)) + "." + x.date.slice(0, 4) : ""}${x.days != null ? " · в работе " + x.days + " дн." : ""}</span></div>${x.status ? `<span class="tag">${esc(x.status)}</span>` : ""}</div>`).join("")}</div>` : `<div class="restday"><b>Пока пусто</b>Здесь будет статус ответа и число дней в работе</div>`}</section></div>`;
  VIEWS.requests = () =>
    talk(
      P("requests"),
      "Обращения",
      (M.sigTypes && M.sigTypes.length
        ? M.sigTypes.map((t) => "Тема: " + t)
        : ["Вопросы по учёбе, расписанию и оценкам"]
      ).concat(["Справка об обучении готовится до 3 календарных дней", "Можно отметить «Срочно»"]),
      "Написать в учебную часть",
      M.signals,
    );
  VIEWS.complaints = () =>
    talk(
      P("complaints"),
      "Жалобы",
      ["Жалоба по учебному процессу", "Нет связи с филиалом", "Нет ответа на обращения"],
      "Написать жалобу",
    );

  VIEWS.contacts = () => `${sHero(P("contacts"))}
    <div class="row r2">
      <section class="card"><div class="hd"><h2>Адрес</h2></div>
        ${M.contacts && M.contacts.address ? `<dl class="m-kv"><dt>Филиал</dt><dd>${esc(M.contacts.address)}${copyBtn(M.contacts.address)}</dd></dl>` : ""}
        <dl class="m-kv"><dt>Сайт</dt><dd><a class="m-link" href="https://top-university.ru/" target="_blank" rel="noopener">top-university.ru</a></dd></dl>
        ${((M.contacts && M.contacts.curators) || []).map((c) => `<dl class="m-kv"><dt>Учебная часть</dt><dd>${esc(c.name)}${c.mails.map((m) => `<br><span class="m-link">${esc(m)}</span>${copyBtn(m)}`).join("")}</dd></dl>`).join("")}
        <div class="btns">${M.contacts && M.contacts.address ? `<a class="m-btn" href="https://yandex.ru/maps/?text=${encodeURIComponent(M.contacts.address)}" target="_blank" rel="noopener">${ic("pin")}Яндекс Карты</a>` : goBtn("Контакты", ic("pin") + "Открыть карту")}</div></section>
      <section class="card"><div class="hd"><h2>Приёмная комиссия</h2></div><div class="li2">${ic("check")}<span>Вопросы по покупке новых курсов</span></div><div class="li2">${ic("check")}<span>Записать на обучение друзей и знакомых</span></div><div class="btns"><a class="m-btn pri" href="https://top-university.ru/" target="_blank" rel="noopener">${ic("ext")}Оставить заявку на сайте</a></div></section>
      <section class="card"><div class="hd"><h2>Учебная часть</h2></div><div class="li2">${ic("check")}<span>Общие вопросы</span></div><div class="li2">${ic("check")}<span>Вопросы по учебному процессу</span></div><div class="li2">${ic("check")}<span>Вопросы по оплате и содержанию курсов</span></div><div class="btns"><button class="m-btn pri" data-form="signal">Задать вопрос</button></div></section>
      <section class="card"><div class="hd"><h2>Претензии и разногласия</h2></div><div class="li2">${ic("check")}<span>Жалоба по учебному процессу</span></div><div class="li2">${ic("check")}<span>Нет связи с филиалом</span></div><div class="li2">${ic("check")}<span>Нет ответа по вашим вопросам</span></div><div class="btns"><button class="m-btn pri" data-form="complaint">Отправить жалобу</button></div></section>
    </div>`;

  const FAQ = [
    [
      "Доступ и вход",
      [
        [
          "Как получить или восстановить доступ?",
          "На странице входа нажмите «Забыли пароль», укажите свою почту и нажмите «Отправить». На почту придёт письмо с логином и паролем. Если письма нет - обратитесь в учебную часть.",
        ],
        [
          "Не получается войти",
          "Проверьте раскладку клавиатуры и Caps Lock. Входите по адресу journal.top-academy.ru/login/index. Если данные верные, но вход не работает - сбросьте пароль или обратитесь в учебную часть.",
        ],
        [
          "Как изменить личные данные и пароль?",
          "В личном кабинете можно поменять фото, телефон и ссылки на соцсети. Для смены пароля введите текущий пароль и дважды новый, новый пароль придёт на почту.",
        ],
        [
          "Почему не меняются личные данные?",
          "Все изменения, кроме пароля, проходят модерацию в учебной части. После подтверждения менеджером их снова можно менять.",
        ],
      ],
    ],
    [
      "Учебный процесс",
      [
        ["Когда каникулы?", "Смотрите учебный план или спросите в учебной части филиала."],
        [
          "Где ссылка на онлайн-урок?",
          "Онлайн-уроки проходят в Microsoft Teams. Установите приложение на компьютер или телефон и войдите под своей учётной записью.",
        ],
        [
          "Как попасть на дополнительные занятия?",
          "Два варианта: индивидуальные платные занятия с преподавателем под ваш запрос или бесплатная групповая отработка, где преподаватель отвечает на вопросы потока.",
        ],
      ],
    ],
    [
      "Домашние задания",
      [
        [
          "Можно ли пересдать ДЗ?",
          "Если не согласны с оценкой за ДЗ или лабораторную, нажмите «Запрос на пересдачу». За пересдачу снимается 2 топгема, новые топгемы при повышении оценки не начисляются.",
        ],
        [
          "Почему ДЗ ещё не проверено?",
          "На проверку у преподавателя в среднем 4 дня. Если срок прошёл - напишите в учебную часть через «Обращения».",
        ],
        ["Где академические долги?", "В разделе «Оценки», подраздел «Несданные экзамены»."],
        ["ДЗ не открывается или не загружается", "Обратитесь напрямую в учебную часть филиала."],
      ],
    ],
    [
      "Оценки и посещаемость",
      [
        [
          "Как считается средний балл?",
          "По сумме всех оценок за весь курс, независимо от переводов между группами. Типы оценок, которых у студента нет, не учитываются.",
        ],
        [
          "Как отмечается посещаемость?",
          "Преподаватель отмечает присутствие в первые 15 минут пары. Если пришли позже - ставится опоздание. Опоздания влияют на оценку посещаемости и успеваемость.",
        ],
        [
          "Можно перевестись в другую группу?",
          "Рассматривается индивидуально, обратитесь в учебную часть филиала.",
        ],
        [
          "Как оценить преподавателя?",
          "После пары появляется окно: поставьте оценку звёздами, отметьте кнопками и тегами, как прошло занятие, добавьте комментарий. Оценки анонимны и преподавателю не показываются.",
        ],
      ],
    ],
    [
      "Топкоины, топгемы и награды",
      [
        [
          "За что начисляются топкоины?",
          "+1 за посещение пары, +1 за своевременную сдачу ДЗ или лабораторной (за просроченное не даётся), от 1 до 5 - поощрение преподавателя за работу на уроке, +1/+2/+5 за 5/10/20 посещений подряд без пропусков, +1/+2/+3 за 5/10/20 без опозданий, +5 за заполненный профиль, +1 за футболку с логотипом, +10 за приведённого друга, +20 за опрос, +20 за отзыв в соцсетях, от 1 до 100 за конкурс.",
        ],
        [
          "Что такое достижения?",
          "Награды, которые можно получить только один раз. На баллы и рейтинг не влияют.",
        ],
        [
          "Как получить награду за конкурс, друга или футболку?",
          "Обратитесь в учебную часть филиала - начисление делают вручную.",
        ],
        [
          "Что купить в Маркете?",
          "Товары за топкоины и топгемы. На рейтинг покупки не влияют. Забрать товар - в учебной части.",
        ],
      ],
    ],
    [
      "Оплата и документы",
      [
        [
          "Какие способы оплаты?",
          "Онлайн через приложение банка или по счёту в отделении банка. Наличными не принимается.",
        ],
        [
          "Где счёт, реквизиты и график?",
          "В разделе «Оплата». QR-код для оплаты - на последней странице договора, в назначении укажите номер договора.",
        ],
        [
          "Можно перенести дату платежа?",
          "Через заявление в учебной части, не больше чем на 14 дней и при отсутствии задолженности.",
        ],
        [
          "Оплата не прошла",
          "Если прошло больше 3 дней - проверьте реквизиты и назначение платежа, затем обратитесь в учебную часть.",
        ],
        [
          "Как получить справку об обучении?",
          "В «Обращениях» нажмите «Получить справку». Срок - до 3 календарных дней.",
        ],
      ],
    ],
    [
      "Прочее",
      [
        ["Как связаться с администрацией?", "Через раздел «Контакты» или «Обращения»."],
        [
          "Где оставить отзыв об академии?",
          "На Google Картах, Яндекс Картах, Zoon или 2ГИС. Скриншот отзыва отправьте в учебную часть, чтобы получить +20.",
        ],
      ],
    ],
  ];
  VIEWS.faq = () => {
    const q = faqq;
    let n = 0;
    const blocks = FAQ.map(([sec, items]) => {
      const f = items.filter(([a, b]) => !q || norm(a + " " + b).includes(q));
      n += f.length;
      return f.length
        ? `<section class="card"><div class="hd"><h2>${sec}</h2><small class="num">${f.length}</small></div>${f.map(([a, b]) => `<details class="qa" ${q ? "open" : ""}><summary>${esc(a)}${ic("chev")}</summary><p>${esc(b)}</p></details>`).join("")}</section>`
        : "";
    }).join("");
    return `${sHero(P("faq"))}<div class="search">${ic("search")}<input id="faqq" placeholder="Поиск по вопросам: оплата, пароль, пересдача…" value="${esc(faqq)}" autocomplete="off"></div>
      ${blocks || `<div class="card"><div class="restday"><b>Ничего не найдено</b>Попробуй другое слово</div></div>`}`;
  };

  /* живая пара */
  let lastKey = "";
  let npKey = "";
  function tick() {
    if (!R) return;
    const now = new Date(),
      box = $("#now");
    const hero = R.querySelector(".hero[data-dp]");
    if (hero && hero.dataset.dp !== dayPart(now.getHours()) && !$("#dlg").open) {
      render();
      return;
    }
    const np = $("#nowpill"),
      fc = focus(now);
    if (np) {
      const { cur } = fc;
      if (cur) {
        const k = "c" + cur.day + cur.l.start;
        if (npKey !== k) {
          npKey = k;
          np.hidden = false;
          np.className = "nowpill live";
          np.title = `${cur.l.subj} · ${roomTxt(cur.l.room)}`;
          np.innerHTML = `<span class="dot"></span><span class="tx"><span class="lbl2">Сейчас</span><b>${esc(cur.l.subj)}</b><span class="num">· ${cur.l.start} - ${cur.l.end}</span></span>`;
        }
      } else if (npKey !== "-") {
        npKey = "-";
        np.hidden = true;
      }
    }
    if (box) {
      const { cur } = fc;
      if (!cur) {
        box.hidden = true;
        lastKey = "";
      } else {
        const l = cur.l,
          k = cur.day + l.start,
          pi = pairIndex()(l.start);
        if (lastKey !== k || box.hidden) {
          lastKey = k;
          box.hidden = false;
          box.innerHTML = `<div><div class="cap">Сейчас идёт${pi >= 0 ? ` · ${pi + 1} пара` : ""}</div><div class="subj">${esc(l.subj)}</div><div class="meta">${esc(roomTxt(l.room))} · ${esc(l.teacher)}</div></div>
          <div class="cd"><span class="cap">Время пары</span><b class="num tm2">${l.start} - ${l.end}</b></div>`;
        }
      }
    }
    const nt = now.getTime();
    R.querySelectorAll(".lesson[data-s]").forEach((el) => {
      const s = +el.dataset.s,
        e = +el.dataset.e,
        live = s <= nt && nt < e;
      el.classList.toggle("past", e && nt >= e);
      el.classList.toggle("live", live);
      el.querySelector(".p").style.width = live ? ((nt - s) / (e - s)) * 100 + "%" : "0";
    });
  }

  /* окна */
  function openDlg(cls, title, sub, rows, note) {
    const d = $("#dlg");
    d.innerHTML = `<div class="dlg ${cls}"><div class="dh2"><div><h3>${title}</h3><p class="num">${sub}</p></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div><dl class="num">${rows.map((r) => `<dt>${r[0]}</dt><dd>${r[1]}</dd>`).join("")}</dl>${note ? `<div class="nt">${note}</div>` : ""}</div>`;
    d.showModal();
  }
  function openLesson(key) {
    const [day, start] = key.split("|");
    const l = lessonsOn(fromIso(day)).find((x) => x.start === start);
    if (!l) return;
    const d = fromIso(day);
    openDlg("s-" + subjKey(l.subj), esc(l.subj), `${DAYS[(d.getDay() + 6) % 7]}, ${longDate(d)}`, [
      ["Время", `${l.start} - <span class="end">${l.end}</span>`],
      ["Аудитория", esc(roomTxt(l.room))],
      ["Преподаватель", esc(l.teacher)],
    ]);
  }
  function openGrade(n) {
    const v = (M.visits || []).find((x) => x.n === n);
    if (!v) return;
    const d = fromIso(v.date);
    const m = (k, cls) =>
      v[k] != null
        ? `<span class="mark5 ${cls} ${vClass(v[k])}" style="display:inline-grid">${v[k]}</span>`
        : '<span class="soft">-</span>';
    const rows = [["Дата", `${DAYS[(d.getDay() + 6) % 7]}, ${longDate(d)}`]];
    if (v.teacher) rows.push(["Преподаватель", esc(v.teacher)]);
    if (v.topic) rows.push(["Тема", esc(v.topic)]);
    rows.push([
      "Посещение",
      v.miss
        ? '<span class="stat-bad">Пропуск</span>'
        : v.late
          ? '<span class="stat-bad">Опоздание</span>'
          : '<span class="stat-good">Был на паре</span>',
    ]);
    rows.push(["Домашнее задание", m("hw", "hw")], ["Классная работа", m("cw", "cw")]);
    ["lab", "ctrl", "prac", "fin"].forEach((k) => {
      if (v[k] != null) rows.push([MK_N[k] + " работа", m(k, k)]);
    });
    openDlg("s-" + subjKey(v.subj), `Пара № ${v.n}`, esc(v.subj), rows);
  }

  /* события */
  function onClick(e) {
    if (CRYPTO && mkClick(e)) return;
    if (!e.target.closest(".dd")) closeDD();
    {
      const rt = e.target.closest("[data-rs],[data-ro],[data-rb],[data-rclose]");
      if (rt && rateClick(rt)) return;
    }
    const t = e.target.closest(
      "[data-gw],[data-am],[data-af],[data-lb],[data-act],[data-page],[data-les],[data-g],[data-day],[data-gm],[data-nf],[data-nw],[data-classic-go],[data-set],[data-tip],[data-sum],[data-gsub],[data-gt],[data-agt],[data-gper],[data-hwx],[data-copy],[data-hwf],[data-form],[data-oclick],[data-calm]",
    );
    if (!t) return;
    if (t.closest("#fdlg") && t.type === "submit") return;
    if (t.dataset.copy !== undefined) {
      const v = t.dataset.copy;
      const ok = () => {
        t.classList.add("ok");
        t.innerHTML = ic("check");
        setTimeout(() => {
          t.classList.remove("ok");
          t.innerHTML = ic("copy");
        }, 1200);
      };
      navigator.clipboard
        ? navigator.clipboard.writeText(v).then(ok, () => toast("Не удалось скопировать"))
        : toast("Не удалось скопировать");
      return;
    }
    if (t.tagName === "A" && !t.target) e.preventDefault();
    if (t.dataset.hwf !== undefined) {
      openHwForm(t.dataset.hwf);
      return;
    }
    if (t.dataset.tip) {
      toast(t.dataset.tip, true);
      return;
    }
    if (t.dataset.sum) {
      openSummary(t.dataset.sum);
      return;
    }
    if (t.dataset.gsub !== undefined) {
      const g = LS.get("goal", {});
      g.subj = t.dataset.gsub;
      g.t = null;
      LS.set("goal", g);
      render();
      return;
    }
    if (t.dataset.gper) {
      const [k, v] = t.dataset.gper.split("|");
      const g = LS.get(k, {});
      g.per = v;
      g.t = null;
      LS.set(k, g);
      render();
      return;
    }
    if (t.dataset.hwx) {
      if (!e.target.closest("a")) t.classList.toggle("open");
      return;
    }
    if (t.dataset.gt) {
      const g = LS.get("goal", {});
      g.t = +t.dataset.gt;
      LS.set("goal", g);
      render();
      return;
    }
    if (t.dataset.agt) {
      const g = LS.get("agoal", {});
      g.t = +t.dataset.agt;
      LS.set("agoal", g);
      render();
      return;
    }
    if (t.dataset.form === "lesson") {
      openLessonRate(0);
      return;
    }
    if (t.dataset.form) {
      ({
        signal: openSignalForm,
        complaint: openComplaintForm,
        profile: openProfileForm,
        password: openPasswordForm,
        photo: openPhotoForm,
      })[t.dataset.form]();
      return;
    }
    if (t.dataset.oclick) {
      const [lbl, rx, what] = t.dataset.oclick.split("|");
      origClick(lbl, new RegExp(rx, "i"), what);
      return;
    }
    if (t.dataset.classicGo) {
      const lbl = t.dataset.classicGo;
      unmount();
      showFab();
      classicGo(lbl).catch(() => {});
      return;
    }
    if (t.dataset.set) {
      let v = t.dataset.v;
      if (v === "true") v = true;
      if (v === "false") v = false;
      cfg[t.dataset.set] = v;
      saveCfg();
      if (t.dataset.set === "gfx") {
        if (v !== "lite") LS.set("gfxauto", 0);
        fpsBad = 0;
        fpsN = 0;
        applyGfx();
      }
      if (CRYPTO && t.dataset.set === "mkt") (v ? mkStart : mkStop)();
      applyRaise();
      host.style.background = resolveTheme() === "dark" ? "#0a0c10" : "#eff0f3";
      render();
      return;
    }
    if (t.dataset.page) {
      const dl = $("#dlg");
      if (dl.open) dl.close();
      if (t.dataset.page !== page) commitSeen(page);
      page = t.dataset.page;
      sessionStorage.setItem("dn2.page", page);
      host.scrollTop = 0;
      render();
      const pg = $("#page");
      pg.classList.add("enter");
      setTimeout(() => pg.classList.remove("enter"), 400);
      return;
    }
    if (t.dataset.les) {
      openLesson(t.dataset.les);
      return;
    }
    if (t.dataset.g) {
      openGrade(+t.dataset.g);
      return;
    }
    if (t.dataset.day) {
      sc.day = +t.dataset.day;
      render();
      return;
    }
    if (t.dataset.gm) {
      gf.mode = t.dataset.gm;
      R.querySelectorAll("[data-gm]").forEach((b) => b.setAttribute("aria-pressed", b === t));
      applyGF();
      return;
    }
    if (t.dataset.nf) {
      nf = t.dataset.nf;
      render();
      return;
    }
    if (t.dataset.gw) {
      const pg = R.querySelector("#gpager"),
        p = pg && pg.querySelector(`.gpage[data-w="${t.dataset.gw}"]`);
      if (p && pg._go) pg._go([...pg.children].indexOf(p));
      return;
    }
    if (t.dataset.am || t.dataset.af) {
      if (t.dataset.am) avgMode = t.dataset.am;
      else avgFocus = t.dataset.af;
      const c = R.querySelector(".avgc");
      if (c) c.outerHTML = avgChartHTML(stats());
      fitAvg();
      return;
    }
    if (t.dataset.calm) {
      const L = [...new Set((M.visits || []).map((v) => v.date.slice(0, 7)))].sort(),
        i = L.indexOf(calYm) + +t.dataset.calm;
      if (L[i]) {
        calYm = L[i];
        const sc0 = host.scrollTop;
        render();
        host.scrollTop = sc0;
      }
      return;
    }
    if (t.dataset.lb) {
      lbMode = t.dataset.lb;
      LS.set("lb", lbMode);
      render();
      return;
    }
    if (t.dataset.nw) {
      const id = isNaN(+t.dataset.nw) ? t.dataset.nw : +t.dataset.nw;
      readSet.add(id);
      LS.set("read", [...readSet]);
      markReadUI(id);
      openNews(id);
      return;
    }
    const a = t.dataset.act;
    if (a === "close") $("#dlg").close();
    if (a === "prev") {
      sc.mon = dayDate(sc.mon, -7);
      render();
    }
    if (a === "next") {
      sc.mon = dayDate(sc.mon, 7);
      render();
    }
    if (a === "cur") {
      schedGoCurrent();
      render();
    }
    if (a === "week" || a === "day") {
      sc.view = a;
      LS.set("view", a);
      render();
    }
    if (a === "readall") {
      (M.news || []).forEach((n) => readSet.add(n.id));
      LS.set("read", [...readSet]);
      render();
    }
    if (a === "reload") {
      location.reload();
      return;
    }
    if (a === "month") {
      openSummary(t.dataset.ym);
      return;
    }
    if (a === "sumpng") {
      try {
        sumPNG(t.dataset.ym);
      } catch (e) {
        toast("Не получилось сохранить картинку");
      }
      return;
    }
    if (a === "updcheck") {
      t.disabled = true;
      toast("Проверяю обновления…");
      checkUpdate(true).then(() => {
        render();
        const u = LS.get("upd", null);
        toast(
          u && verNewer(u.v, VERSION)
            ? `Доступна версия ${u.v}`
            : u
              ? "У тебя последняя версия"
              : "Не удалось проверить - нет связи с Gist",
        );
      });
      return;
    }
    if (a === "upddis") {
      LS.set("upddis", t.dataset.v);
      render();
      return;
    }
    if (a === "updgo") {
      LS.set("updAt", 0);
      toast("Открываю установку новой версии…");
      return;
    }
    if (a === "paydis") {
      LS.set("paydis", { k: t.dataset.k, t: Date.now() });
      render();
      return;
    }
    if (a === "quizdis") {
      LS.set("quizdis", { k: t.dataset.k, t: Date.now() });
      render();
      return;
    }
    if (a === "bdaydis") {
      LS.set("bdaydis", new Date().getFullYear());
      render();
      return;
    }
    if (a === "mdis") {
      const l = LS.get("mdis", []);
      l.push(t.dataset.ym);
      LS.set("mdis", l);
      render();
      return;
    }
    if (a === "sync") {
      t.classList.add("spinning");
      toast("Обновляю данные из журнала…");
      Promise.race([sync("manual").then(() => 1), sleep(20000).then(() => 0)]).then((done) => {
        t.classList.remove("spinning");
        if (!done) toast("Журнал отвечает медленно - данные обновятся, как только он ответит");
        else if (syncState === "ok") toast("Данные обновлены");
      });
    }
    if (a === "diag") copyDiag(t);
    if (a === "reset") {
      try {
        Object.keys(localStorage)
          .filter((k) => k.startsWith("dn2.model"))
          .forEach((k) => localStorage.removeItem(k));
      } catch (e) {}
      location.reload();
    }
    if (a === "off") {
      cfg.on = false;
      saveCfg();
      location.reload();
    }
    if (a === "classic") goClassic();
    if (a === "logout") askLogout();
    if (a === "logout-yes") logout();
  }
  function onChange(e) {
    if (e.target.id === "goalsel" || e.target.id === "agsel") {
      const k = e.target.id === "goalsel" ? "goal" : "agoal";
      LS.set(k, { ...LS.get(k, {}), subj: e.target.value, t: null });
      render();
      return;
    }
    if (e.target.id === "agoalin") {
      const v = parseInt(e.target.value, 10);
      const g = LS.get("agoal", {});
      g.t = v >= 50 && v <= 99 ? v : null;
      LS.set("agoal", g);
      render();
      return;
    }
    if (e.target.id === "goalin") {
      const v = parseFloat(String(e.target.value).replace(",", "."));
      const g = LS.get("goal", {});
      g.t = isFinite(v) ? v : null;
      LS.set("goal", g);
      render();
      return;
    }
    const t = e.target;
    if (t.id === "gsubj") {
      gf.subj = t.value;
      applyGF();
      return;
    }
    if (t.id === "gym") {
      gp.ym = t.value;
      gp.wk = null;
      render();
      return;
    }
    if (t.id === "hwsubj") {
      hwq = norm(t.value);
      render();
      return;
    }
    if (t.id === "faqq") return;
    if (t.dataset.hide) {
      const id = t.dataset.hide;
      cfg.hidden = t.checked ? cfg.hidden.filter((x) => x !== id) : [...new Set([...cfg.hidden, id])];
      saveCfg();
      render();
      return;
    }
  }
  function onKey(e) {
    if (e.key === "Escape" && R && R.querySelector(".dd.open")) {
      closeDD();
      e.preventDefault();
      return;
    }
    if (!host || page !== "schedule") return;
    const d = $("#dlg");
    if (d && d.open) return;
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      const dir = e.key === "ArrowRight" ? 1 : -1;
      if (sc.view === "day") {
        sc.day += dir;
        if (sc.day > 6) {
          sc.day = 0;
          sc.mon = dayDate(sc.mon, 7);
        }
        if (sc.day < 0) {
          sc.day = 6;
          sc.mon = dayDate(sc.mon, -7);
        }
      } else sc.mon = dayDate(sc.mon, 7 * dir);
      render();
    }
  }

  /* кнопка "Д" в классическом режиме + диагностика */
  let fab;
  // пустой прозрачный слой журнала (подложка меню и т.п.) поверх Дневника «съедает» нажатия - убираем его с пути
  W.addEventListener(
    "pointerdown",
    (e) => {
      if (!host || !document.documentElement.classList.contains("dn-on")) return;
      const t = e.target;
      if (!t || t.nodeType !== 1 || inHost(t) || t === document.documentElement || t === document.body)
        return;
      if (
        t.closest(
          "[data-dn-raise],.modal-content,.mat-dialog-container,.swal2-popup,[role=dialog],.cdk-overlay-pane",
        )
      )
        return;
      const cs = getComputedStyle(t),
        r = t.getBoundingClientRect(),
        clear =
          /rgba\(0, 0, 0, 0\)|transparent/.test(cs.backgroundColor) &&
          cs.backgroundImage === "none" &&
          cs.boxShadow === "none";
      if (
        clear &&
        !(t.innerText || "").trim() &&
        r.width > innerWidth * 0.5 &&
        r.height > innerHeight * 0.5
      ) {
        t.style.setProperty("pointer-events", "none", "important");
        NET.clearedLayers = (NET.clearedLayers || 0) + 1;
      }
    },
    true,
  );
  function showFab() {
    if (fab) {
      fab.style.display = "";
      return;
    }
    fab = document.createElement("div");
    fab.id = "dn-fab";
    const r = fab.attachShadow({ mode: "open" });
    r.innerHTML = `<style>
      .b{position:fixed;right:18px;bottom:18px;z-index:2147483001;height:46px;padding:0 16px 0 6px;border-radius:14px;border:0;cursor:pointer;display:flex;align-items:center;gap:10px;
        background:linear-gradient(135deg,#0f1822,#1d2d38);color:#e8cf9c;font:700 15px Calibri,Carlito,"Segoe UI",sans-serif;box-shadow:0 10px 28px -8px rgba(0,0,0,.55),inset 0 0 0 1px rgba(220,188,126,.4)}
      .b span{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:rgba(220,188,126,.12)}.b svg{width:20px;height:20px}</style>
      <button class="b"><span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" aria-hidden="true"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></span>Вернуться в Дневник</button>`;
    r.querySelector("button").onclick = () => {
      fab.style.display = "none";
      if (!cfg.on) {
        cfg.on = true;
        saveCfg();
      }
      injectDocCSS();
      if (isLoginRoute()) {
        if (isSignIn()) mountLogin();
        else fab.style.display = "";
        return;
      }
      {
        const pg = classicPage();
        if (pg && PAGES.some((x) => x.id === pg)) {
          page = pg;
          try {
            sessionStorage.setItem("dn2.page", pg);
          } catch (e) {}
        }
      }
      document.documentElement.classList.add("dn-on");
      mount();
      if (!M.live) sync("fab");
    };
    document.documentElement.appendChild(fab);
  }
  function diagnostics() {
    const ks = Object.keys(NET.status),
      okN = ks.filter((k) => NET.status[k] === 200).length;
    const lines = [`Запросы: ${okN} из ${ks.length} успешно`].concat(
      ks.filter((k) => NET.status[k] !== 200).map((k) => `  ✗ ${k}: ${NET.status[k]}`),
    );
    if (NET.viewErr) lines.push("Раздел не открылся: " + NET.viewErr);
    if (NET.clearedLayers) lines.push("Убрано прозрачных слоёв журнала: " + NET.clearedLayers);
    return (
      `# Дневник ${VERSION} · диагностика\nAPI: ${NET.base || DEFAULT_API} (${NET.base ? "найден" : "по умолчанию"}) · способ: ${NET.mode || "-"} · перехват: ${NET.hook || "unsafeWindow"}\nТокен: ${NET.token ? "найден (" + (NET.tokenSrc || "?") + ")" : "нет"} · перехват событий: ${NET.hook === "page" ? NET.hookEvents : "-"}${NET.modeNote ? " · " + NET.modeNote : ""}\nБраузер: ${navigator.userAgent}\n\n${lines.join("\n")}${NET.site401 ? "\nЖурнал получил 401: " + Math.round((Date.now() - NET.site401) / 1000) + " с назад" : ""}${NET.ddos ? "\nDDoS-Guard: да" : ""}\nОтметки оценки пар: учитель ${evTags("evaluation_lesson_teach").length}, занятие ${evTags("evaluation_lesson").length}${NET.tagPaths ? " · адреса: " + NET.tagPaths.join(", ") : ""}\n\n## Последнее окно журнала\n${NET.pop || "-"}\n\n## Отправки сайта\n${NET.writes.join("\n") || "-"}\n\n## Данные разделов журнала\n${
        Object.keys(NET.site)
          .filter((k) => !Object.values(NET.raw).some((r) => r.path.startsWith(k)))
          .map((k) => "### " + k + "\n" + NET.site[k].slice(0, 800))
          .join("\n\n") || "-"
      }\n\n` +
      Object.keys(NET.raw)
        .filter(
          (k) =>
            !/ p[2-9]\d*$/.test(k) &&
            (NET.status[k] !== 200 || /^(user|visits|hwCount|evalLessons)$/.test(k)),
        )
        .map((k) => `### ${k} (${NET.raw[k].path})\n` + JSON.stringify(NET.raw[k].data).slice(0, 500))
        .join("\n\n")
    );
  }
  // для тестов разработчика: доступно странице только при dn2.dev=1
  try {
    if (localStorage.getItem("dn2.dev") === "1") {
      W.dnevnikDiagnostics = () => diagnostics();
    }
  } catch (e) {}
  function copyDiag(btn) {
    const t = diagnostics(),
      html = btn.innerHTML,
      icon = btn.classList.contains("iconbtn");
    const ok = () => {
      btn.classList.add("ok");
      btn.innerHTML = icon ? ic("check") : ic("check") + "Скопировано";
      setTimeout(() => {
        btn.classList.remove("ok");
        btn.innerHTML = html;
      }, 1300);
    };
    const fb = () => {
      const ta = document.createElement("textarea");
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        ok();
      } catch (e) {
        toast("Не удалось скопировать");
      }
      ta.remove();
    };
    navigator.clipboard ? navigator.clipboard.writeText(t).then(ok, fb) : fb();
  }

  /* ======================= окна журнала поверх Дневника ======================= */
  const RAISE_SEL =
    ".modal.show,.modal.in,.modal[style*='block'],[role=dialog],[aria-modal=true],.cdk-overlay-container,.mat-dialog-container,.swal2-container,.ngdialog,.p-dialog-mask,.ant-modal-root,.ReactModal__Overlay,[data-dn-raise]";
  function injectDocCSS() {
    if (document.getElementById("dn-doc")) return;
    const st = document.createElement("style");
    st.id = "dn-doc";
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
    (document.head || document.documentElement).appendChild(st);
    applyRaise();
  }
  const ACC_HEX = {
    gold: ["#e8bf6a", "#b8862e"],
    sapphire: ["#6f98ff", "#3b6fe0"],
    emerald: ["#4fd6a6", "#1d9e75"],
    amethyst: ["#8f7dff", "#6c59d1"],
    rose: ["#ff79b0", "#d6437f"],
    graphite: ["#c9ccd4", "#5c5f68"],
  };
  function applyRaise() {
    const h = document.documentElement;
    h.classList.toggle("dn-raise", cfg.raise !== false);
    const dark = resolveTheme() === "dark",
      a = ACC_HEX[cfg.accent] || ACC_HEX.gold;
    const v = dark
      ? {
          bg: "#11141a",
          ink: "#eceef2",
          line: "#2a303b",
          in: "#161a21",
          acc: a[0],
          on: "#15110a",
          bord: a[0] + "66",
        }
      : {
          bg: "#ffffff",
          ink: "#141821",
          line: "#d9dce2",
          in: "#f5f6f8",
          acc: a[1],
          on: "#ffffff",
          bord: a[1] + "55",
        };
    Object.keys(v).forEach((k) => h.style.setProperty("--dnj-" + k, v[k]));
  }
  // своё окно сайта (например, опрос) без стандартных классов: поднимаем, если оно появилось по центру экрана
  let raiseWatch;
  function watchPopups() {
    if (raiseWatch || !document.body) return;
    raiseWatch = new MutationObserver((list) => {
      if (!host) return;
      try {
        quickSwallow(list);
      } catch (e) {}
      scheduleScan();
      if (cfg.raise === false) return;
      for (const m of list)
        for (const n of m.addedNodes) {
          if (n.nodeType !== 1 || inHost(n)) continue;
          requestAnimationFrame(() => {
            if (
              !n.isConnected ||
              bridging ||
              n.__dnDone ||
              n.closest(".dn-swallow") ||
              Date.now() - navAt < 3000
            )
              return;
            const s = getComputedStyle(n);
            if (s.position !== "fixed") return;
            const r = n.getBoundingClientRect();
            if (
              r.width < 200 ||
              r.height < 120 ||
              (r.width > innerWidth * 0.92 &&
                r.height > innerHeight * 0.92 &&
                !n.querySelector(
                  "[role=dialog],.modal-content,.modal-dialog,input[type=radio],input[type=checkbox],textarea,select",
                ))
            )
              return;
            const cx = innerWidth / 2,
              cy = innerHeight / 2;
            if (!(r.left < cx && r.right > cx && r.top < cy && r.bottom > cy)) return;
            if (
              (n.innerText || "").trim().length < 8 ||
              !n.querySelector("button,input,textarea,a,[role=button]")
            )
              return;
            if (NEWS_POP.test(n.innerText || "")) {
              scheduleScan();
              return;
            }
            if (RATE_POP.test(n.innerText || "")) popSnap(n);
            if (RATE_POP.test(n.innerText || "") && !n.querySelector("input[type=file]")) {
              n.setAttribute("data-dn-raise", "");
              scheduleScan();
              return;
            }
            n.setAttribute("data-dn-raise", "");
            toast && R && toast("Журнал открыл окно - оно показано поверх Дневника");
          });
        }
    });
    raiseWatch.observe(document.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["class", "style", "open"],
    });
  }
  // Окно журнала «У вас есть непрочитанные объявления» заменяем своим окном в дизайне Дневника
  const NEWS_POP = /непрочитанн\S*\s+объявлен/i;
  const POP_SEL =
    ".modal,[role=dialog],[aria-modal=true],.swal2-container,.cdk-overlay-pane,.mat-dialog-container,[class*=modal],[class*=Modal],[class*=popup],[class*=Popup],[data-dn-raise]";
  let scanT = 0;
  function scheduleScan() {
    if (scanT) return;
    scanT = setTimeout(() => {
      scanT = 0;
      try {
        scanJournal();
      } catch (e) {}
    }, 250);
  }
  const EVAL_POP = /оцените\s+(занятие|работу преподавателя)/i;
  function evalCatch(el) {
    const root = el.closest(".modal,[role=dialog],.swal2-container,.cdk-overlay-pane,[data-dn-raise]") || el;
    el.__dnDone = root.__dnDone = true;
    root.classList.add("dn-swallow");
    document
      .querySelectorAll(".modal-backdrop,.cdk-overlay-backdrop")
      .forEach((b) => b.classList.add("dn-swallow"));
    popSnap(root);
    discoverTags();
    if (evalBusy) return;
    evalBusy = true;
    api("evalLessons", "feedback/students/evaluate-lesson-list")
      .then((r) => {
        M.evalList = parseEval(r);
        LS.set("model", M);
        render();
        if (M.evalList.length)
          toast(
            `Журнал просит оценить ${M.evalList.length} ${plural(M.evalList.length, "пару", "пары", "пар")} - оценишь, когда удобно: карточка на главной`,
          );
      })
      .catch(() => {})
      .finally(() => {
        setTimeout(() => {
          evalBusy = false;
        }, 20000);
      });
  }
  // вызывается прямо из MutationObserver: textContent не требует отрисовки, поэтому окно не успевает мигнуть
  function quickSwallow(list) {
    if (!host || bridging) return;
    const seen = new Set();
    for (const m of list) {
      const attr = m.type !== "childList",
        nodes = attr ? [m.target] : [...m.addedNodes];
      for (const n of nodes) {
        const e = n.nodeType === 1 ? n : n.parentElement;
        if (!e || inHost(e)) continue;
        const cand = attr
          ? e.matches && e.matches(POP_SEL)
            ? e
            : null
          : e.closest(POP_SEL) || (e.querySelector && e.querySelector(POP_SEL));
        if (!cand || seen.has(cand) || cand.__dnDone) continue;
        seen.add(cand);
        const tx = cand.textContent || "";
        if (tx.length < 3000 && EVAL_POP.test(tx)) evalCatch(cand);
      }
    }
  }
  function scanJournal() {
    if (!host || bridging || !document.body) return;
    for (const el of document.body.querySelectorAll(POP_SEL)) {
      if (el.__dnDone || inHost(el)) continue;
      const tx0 = el.textContent || "";
      if (tx0.length > 5000 || !(EVAL_POP.test(tx0) || RATE_POP.test(tx0) || NEWS_POP.test(tx0))) continue;
      if (!vis(el)) continue;
      const tx = el.innerText || "";
      if (EVAL_POP.test(tx) && tx.length < 3000) {
        evalCatch(el);
        return;
      }
      if (
        !rate.root &&
        tx.length < 2500 &&
        RATE_POP.test(tx) &&
        !NEWS_POP.test(tx) &&
        !(el.closest(".modal,[role=dialog]") || el).querySelector("input[type=file],hw-upload-homework")
      ) {
        const root =
          el.closest(".modal,[role=dialog],.swal2-container,.cdk-overlay-pane,[data-dn-raise]") || el;
        const f = readPop(root);
        // анкета из нескольких вопросов - не пересобираем, а показываем окно журнала поверх Дневника
        const multi =
          /анкет|опрос|вопрос\s*\d|\b\d+\s*(из|\/)\s*\d+\b/i.test(tx) ||
          root.querySelectorAll("textarea").length > 1 ||
          new Set([...root.querySelectorAll("input[type=radio]")].map((i) => i.name)).size > 1 ||
          root.querySelectorAll("select").length > 0;
        if (multi) {
          el.__dnDone = root.__dnDone = true;
          root.classList.remove("dn-swallow");
          root.setAttribute("data-dn-raise", "");
          popSnap(root);
          toast("Журнал открыл анкету - она показана поверх Дневника");
          return;
        }
        if (f.stars.length || f.ta || f.opts.length) {
          el.__dnDone = root.__dnDone = true;
          popSnap(root);
          rateOpen(root);
          return;
        }
      }
      if (tx.length > 700 || !NEWS_POP.test(tx)) continue;
      el.__dnDone = true;
      swallow(el);
      newsNotice(unreadList(), true);
      if (!unreadList().length) sync("news-popup");
      return;
    }
  }
  function swallow(el) {
    const root = el.closest(".modal,[role=dialog],.swal2-container,.cdk-overlay-pane") || el;
    root.classList.add("dn-swallow");
    document
      .querySelectorAll(".modal-backdrop,.cdk-overlay-backdrop")
      .forEach((b) => b.classList.add("dn-swallow"));
    // закрываем окно кнопкой самого журнала, чтобы он считал его закрытым (кнопку «Перейти» не трогаем)
    const btn = [...root.querySelectorAll("button,[role=button],a,[class*=close]")].find((b) => {
      const t = ((b.innerText || "") + " " + (b.getAttribute("aria-label") || "")).trim();
      return (
        !/перейти/i.test(t) &&
        (/^(×|✕|x|закрыть|позже|отмена|ок|ok)$/i.test(t) ||
          /close/i.test(String(b.className || "") + " " + (b.getAttribute("aria-label") || "")))
      );
    });
    if (btn)
      try {
        btn.click();
      } catch (e) {}
    // через секунду проверяем: если журнал окно закрыл - снимаем скрытие; если нет - держим спрятанным, пока в нём это сообщение
    const check = () => {
      root.classList.remove("dn-swallow");
      const still = root.isConnected && vis(root) && NEWS_POP.test(root.innerText || "");
      if (still) {
        root.classList.add("dn-swallow");
        setTimeout(check, 3000);
      } else document.querySelectorAll(".dn-swallow").forEach((b) => b.classList.remove("dn-swallow"));
    };
    setTimeout(check, 1200);
  }

  const RATE_POP =
    /оцени\S*|оценк\S*\s+(урок|пар|заняти|преподават)|как\s+прош\S+\s+(урок|пар|заняти)|понравил\S*|опрос|анкет|отзыв о (уроке|паре|занятии)/i;
  // структура последнего окна журнала - для диагностики (без значений полей)
  function popSnap(root) {
    try {
      const out = [];
      const walk = (el, d) => {
        if (out.length > 70 || d > 7) return;
        const t = el.children.length ? "" : (el.textContent || "").trim().slice(0, 40);
        out.push(
          "  ".repeat(d) +
            el.tagName.toLowerCase() +
            (el.className && typeof el.className === "string"
              ? "." + el.className.trim().split(/\s+/).slice(0, 3).join(".")
              : "") +
            (el.type ? `[${el.type}]` : "") +
            (t ? ` "${t}"` : ""),
        );
        [...el.children].forEach((c) => walk(c, d + 1));
      };
      walk(root, 0);
      NET.pop = out.join("\n");
    } catch (e) {}
  }
  const rate = { root: null, v: 0, t: 0 };
  const cleanTx = (el) =>
    (el.innerText || el.value || el.getAttribute("aria-label") || el.title || "").replace(/\s+/g, " ").trim();
  // пока окно журнала спрятано, его размеры нулевые - читаем, на мгновение сняв скрытие
  function peek(root, fn) {
    const h = root.classList.contains("dn-swallow");
    if (h) root.classList.remove("dn-swallow");
    try {
      return fn();
    } finally {
      if (h) root.classList.add("dn-swallow");
    }
  }
  function readPop(root) {
    return peek(root, () => {
      let best = null;
      root.querySelectorAll("*").forEach((p) => {
        const ch = [...p.children].filter(vis);
        if (ch.length < 5 || ch.length > 10) return;
        const tg = ch[0].tagName;
        if (!ch.every((c) => c.tagName === tg)) return;
        if (
          ch.some((c) => {
            const r = c.getBoundingClientRect();
            return r.width > 90 || r.height > 90 || (c.innerText || "").trim().length > 3;
          })
        )
          return;
        const sc = /star|rat|звезд|fa-star/i.test(String(p.className) + " " + ch[0].outerHTML.slice(0, 300))
          ? 2
          : 1;
        if (sc < 2 && ch.length !== 5) return;
        if (!best || sc > best.sc) best = { sc, ch };
      });
      const stars = best ? best.ch : [];
      const inStars = (el) => stars.some((s) => s === el || s.contains(el) || el.contains(s));
      const title =
        cleanTx(
          root.querySelector("h1,h2,h3,h4,h5,.modal-title,[class*=title],[class*=Title]") || root,
        ).slice(0, 90) || "Оцени урок";
      const ta =
        [...root.querySelectorAll("textarea,input[type=text]:not([readonly])")].filter(vis)[0] || null;
      const opts = [...root.querySelectorAll("input[type=radio],input[type=checkbox]")]
        .filter((i) => !inStars(i))
        .map((i) => {
          const l =
            i.closest("label") ||
            (i.id && root.querySelector(`label[for="${CSS.escape(i.id)}"]`)) ||
            i.parentElement;
          return { el: i, lab: cleanTx(l).slice(0, 80), on: i.checked, radio: i.type === "radio" };
        })
        .filter((o) => o.lab);
      const btns = [...root.querySelectorAll("button,[role=button],input[type=submit],a.btn")]
        .filter((b) => vis(b) && !inStars(b) && !b.closest("label"))
        .map((b) => ({
          el: b,
          lab: cleanTx(b).slice(0, 40),
          close:
            /close|закрыть/i.test(String(b.className) + " " + (b.getAttribute("aria-label") || "")) ||
            /^(×|✕|x)$/i.test(cleanTx(b)),
          off: b.disabled,
        }))
        .filter((b) => b.lab || b.close);
      const skip = new Set([title, ...btns.map((b) => b.lab), ...opts.map((o) => o.lab)]);
      const lines = (root.innerText || "")
        .split(/\n+/)
        .map((x) => {
          x = x.trim();
          if (skip.has(x)) return "";
          skip.forEach((k) => {
            if (k && k.length < 40) x = x.split(k).join(" ");
          });
          return x.replace(/[×✕]/g, "").trim();
        })
        .filter((x) => x && x.length > 1 && !/^[★☆\d\s]+$/.test(x))
        .slice(0, 4);
      const on = stars.filter(
        (s) =>
          /active|selected|checked|filled|full|on\b/i.test(
            String(s.className) + " " + String((s.firstElementChild || {}).className || ""),
          ) ||
          (s.querySelector && s.querySelector("input:checked")) ||
          s.checked,
      ).length;
      return { title, stars, ta, opts, btns, lines, on };
    });
  }
  function rateOpen(root) {
    rate.root = root;
    rate.v = 0;
    rate.t = 0;
    root.classList.add("dn-swallow");
    document
      .querySelectorAll(".modal-backdrop,.cdk-overlay-backdrop")
      .forEach((b) => b.classList.add("dn-swallow"));
    rateRender();
  }
  function rateRender() {
    const root = rate.root,
      d = R && $("#dlg");
    if (!root || !d) return;
    if (!root.isConnected) {
      rateDone();
      return;
    }
    const f = readPop(root);
    rate.f = f;
    if (f.on && !rate.v) rate.v = f.on;
    const n = f.stars.length,
      v = rate.v;
    const WORDS = ["", "Очень плохо", "Плохо", "Нормально", "Хорошо", "Отлично"];
    const acts = f.btns.filter((b) => !b.close);
    d.classList.remove("wide");
    d.dataset.rate = "1";
    d.innerHTML = `<div class="dlg rate"><div class="dh2"><div class="jn-head"><div class="jn-ic">${ic("star", "i big")}</div><div><h3>${esc(f.title)}</h3>${f.lines[0] ? `<p>${esc(f.lines[0])}</p>` : ""}</div></div><button class="x" data-rclose aria-label="Закрыть">×</button></div>
      <div class="rt-body">${f.lines
        .slice(1)
        .map((l) => `<p class="rt-l">${esc(l)}</p>`)
        .join("")}
      ${n ? `<div class="rt-stars" role="radiogroup" aria-label="Оценка">${f.stars.map((_, i) => `<button class="rt-s ${i < v ? "on" : ""}" data-rs="${i}" role="radio" aria-checked="${i + 1 === v}" aria-label="${i + 1}"><svg viewBox="0 0 24 24"><path d="M12 3.2l2.7 5.6 6.1.8-4.5 4.2 1.1 6.1L12 17l-5.4 2.9 1.1-6.1-4.5-4.2 6.1-.8z"/></svg></button>`).join("")}</div><div class="rt-w">${v ? (n === 5 ? WORDS[v] : v + " из " + n) : "Нажми на звезду"}</div>` : ""}
      ${f.opts.length ? `<div class="rt-opts">${f.opts.map((o, i) => `<button class="rt-o ${o.on ? "on" : ""}" data-ro="${i}" aria-pressed="${o.on}"><i class="${o.radio ? "r" : "c"}"></i>${esc(o.lab)}</button>`).join("")}</div>` : ""}
      ${f.ta ? `<textarea class="m-in" id="rate-ta" rows="3" placeholder="${esc(f.ta.getAttribute("placeholder") || "Комментарий (необязательно)")}">${esc(f.ta.value || "")}</textarea>` : ""}</div>
      <div class="ffoot">${acts.map((b, i) => `<button class="m-btn ${i === acts.length - 1 ? "pri" : ""}" data-rb="${f.btns.indexOf(b)}" ${b.off ? "disabled" : ""}>${esc(b.lab)}</button>`).join("") || `<button class="m-btn" data-rclose>Закрыть</button>`}</div></div>`;
    if (!d.open) d.showModal();
  }
  function fire(el) {
    try {
      ["pointerover", "mouseover", "mouseenter", "pointerdown", "mousedown", "pointerup", "mouseup"].forEach(
        (t) => el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window })),
      );
      el.click();
    } catch (e) {}
  }
  function rateClick(t) {
    const f = rate.f;
    if (!f || !rate.root) return false;
    if (t.dataset.rs !== undefined) {
      const i = +t.dataset.rs,
        s = f.stars[i];
      if (!s) return true;
      peek(rate.root, () => {
        const inp = s.matches("input") ? s : s.querySelector("input");
        fire(inp || s.querySelector("svg,i,span") || s);
        if (!inp) fire(s);
      });
      rate.v = i + 1;
      setTimeout(rateRender, 250);
      return true;
    }
    if (t.dataset.ro !== undefined) {
      const o = f.opts[+t.dataset.ro];
      if (o) peek(rate.root, () => fire(o.el));
      setTimeout(rateRender, 250);
      return true;
    }
    if (t.dataset.rb !== undefined) {
      const b = f.btns[+t.dataset.rb];
      if (!b) return true;
      t.disabled = true;
      t.innerHTML = `<span class="spin"></span>${esc(b.lab)}`;
      peek(rate.root, () => fire(b.el));
      const sent = !/позже|пропустить|отмена|не сейчас|закрыть|нет/i.test(b.lab);
      setTimeout(() => {
        if (!rate.root) return;
        const alive = rate.root.isConnected && peek(rate.root, () => vis(rate.root));
        alive ? rateRender() : rateDone(sent);
      }, 900);
      return true;
    }
    if (t.dataset.rclose !== undefined) {
      rateDismiss();
      return true;
    }
    return false;
  }
  function rateInput(t) {
    if (t.id !== "rate-ta" || !rate.f || !rate.f.ta) return false;
    setNative(rate.f.ta, t.value);
    return true;
  }
  function rateDismiss() {
    const root = rate.root;
    if (!root) return;
    const f = rate.f || readPop(root);
    const c =
      f.btns.find((b) => b.close) ||
      f.btns.find((b) => /^(позже|пропустить|отмена|не сейчас|закрыть)$/i.test(b.lab));
    if (c) peek(root, () => fire(c.el));
    rateDone(false);
  }
  function rateDone(sent) {
    const root = rate.root;
    rate.root = null;
    rate.f = null;
    const d = R && $("#dlg");
    if (d && d.dataset.rate) {
      delete d.dataset.rate;
      if (d.open) d.close();
    }
    if (sent) toast("Спасибо! Оценка отправлена в журнал");
    // снимаем скрытие, только если журнал своё окно убрал; если оно ещё висит - прячем, пока не исчезнет
    const check = () => {
      if (root && root.isConnected && peek(root, () => vis(root))) {
        root.classList.add("dn-swallow");
        setTimeout(check, 2000);
      } else {
        if (root) root.classList.remove("dn-swallow");
        document.querySelectorAll(".dn-swallow").forEach((b) => b.classList.remove("dn-swallow"));
      }
    };
    setTimeout(check, 600);
  }

  /* ======================= выход и вход ======================= */
  function askLogout() {
    const d = $("#dlg");
    d.classList.remove("wide");
    d.innerHTML = `<div class="dlg"><div class="dh2"><div class="jn-head"><div class="jn-ic">${ic("profile", "i big")}</div><div><h3>Выйти из аккаунта?</h3><p>${esc(M.user.name || "")}</p></div></div><button class="x" data-act="close" aria-label="Закрыть">×</button></div>
      <p class="note" style="padding:14px 22px 0;margin:0">Сохранённые в браузере данные Дневника будут удалены. Войти снова можно по логину и паролю журнала.</p>
      <div class="ffoot"><button class="m-btn" data-act="close">Отмена</button><button class="m-btn pri" data-act="logout-yes">Выйти</button></div></div>`;
    if (!d.open) d.showModal();
  }
  // вход журнала: access_token/refresh_token (закодированы) и любые JWT; Дневнику после выхода они не нужны
  function clearJournalAuth() {
    for (const st of [localStorage, sessionStorage]) {
      try {
        Object.keys(st)
          .filter(
            (k) =>
              !k.startsWith("dn2.") &&
              (/token|refresh|access|auth|jwt/i.test(k) || JWT_RX.test(String(st.getItem(k) || ""))),
          )
          .forEach((k) => st.removeItem(k));
      } catch (e) {}
    }
    try {
      document.cookie
        .split(";")
        .map((x) => x.split("=")[0].trim())
        .filter((k) => /token|refresh|access|auth|jwt/i.test(k))
        .forEach((k) => {
          document.cookie = k + "=; Max-Age=0; path=/";
          document.cookie =
            k + "=; Max-Age=0; path=/; domain=." + location.hostname.split(".").slice(-2).join(".");
        });
    } catch (e) {}
    try {
      sessionStorage.setItem("dn2.out", String(Date.now()));
      localStorage.setItem("dn2.out", String(Date.now()));
    } catch (e) {}
  }
  async function logout(auto) {
    ["model", "seen", "read", "ava"].forEach((k) => {
      try {
        localStorage.removeItem("dn2." + k);
      } catch (e) {}
    });
    forgetToken();
    try {
      sessionStorage.removeItem("dn2.page");
    } catch (e) {}
    M = EMPTY();
    readSet = new Set();
    seen = null;
    fresh = {};
    NET.token = null;
    const d = R && $("#dlg");
    if (d && d.open) d.close();
    // сначала пробуем кнопку выхода самого журнала
    const b = [...document.querySelectorAll("a,button,[role=button],li,span")].filter(
      (el) =>
        !inHost(el) &&
        /^(выход|выйти|выйти из аккаунта)$/i.test((el.innerText || el.textContent || "").trim()),
    )[0];
    if (b) {
      try {
        (b.closest("a,button,[role=button]") || b).click();
      } catch (e) {}
      await sleep(1500);
      if (isLoginRoute()) {
        clearJournalAuth();
        return;
      }
    }
    // запасной путь: убираем сохранённый вход журнала и открываем страницу входа
    clearJournalAuth();
    location.href = location.origin + "/ru/auth/login/index";
  }

  const isSignIn = () => /auth\/login|\/login([\/?#]|$)/i.test(location.pathname + location.hash);
  let lhost = null,
    lR = null;
  const EYE = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  const EYE_OFF =
    '<path d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.6 6.6C3.8 8.4 2 12 2 12s3.6 7 10 7c1.9 0 3.5-.6 4.9-1.4M9.9 9.9a3 3 0 0 0 4.2 4.2"/>';
  function mountLogin() {
    dropVeil();
    forgetToken();
    NET.token = null;
    NET.tokenSrc = ""; // на странице входа старый вход недействителен
    if (lhost || !cfg.on) return;
    document.documentElement.classList.add("dn-on");
    lhost = document.createElement("div");
    lhost.id = "dn-login";
    lhost.style.cssText = "position:fixed;inset:0;z-index:2147483000;overflow:auto;background:#0a0c10";
    lR = lhost.attachShadow({ mode: "open" });
    const dp = dayPart();
    let why = "";
    try {
      why = sessionStorage.getItem("dn2.why") || "";
      sessionStorage.removeItem("dn2.why");
    } catch (e) {}
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
    const $l = (id) => lR.getElementById(id);
    $l("eyeu").addEventListener("click", () => {
      const u = $l("lu"),
        hide = !u.classList.contains("masked");
      if (CSS.supports("-webkit-text-security", "disc")) u.classList.toggle("masked", hide);
      else {
        u.type = hide ? "password" : "text";
        u.classList.toggle("masked", hide);
      }
      $l("eyeu").setAttribute("aria-label", hide ? "Показать логин" : "Скрыть логин");
      $l("eyeu").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${hide ? EYE : EYE_OFF}</svg>`;
      u.focus();
    });
    $l("eye").addEventListener("click", () => {
      const p = $l("lp"),
        show = p.type === "password";
      p.type = show ? "text" : "password";
      $l("eye").setAttribute("aria-pressed", show);
      $l("eye").setAttribute("aria-label", show ? "Скрыть пароль" : "Показать пароль");
      $l("eye").innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${show ? EYE_OFF : EYE}</svg>`;
      p.focus();
    });
    $l("lf").addEventListener("submit", (e) => {
      e.preventDefault();
      doLogin();
    });
    const view = (rec) => {
      $l("lf").hidden = rec;
      $l("rf").hidden = !rec;
      setTimeout(() => {
        try {
          $l(rec ? "re" : "lu").focus();
        } catch (e) {}
      }, 40);
    };
    $l("lforgot").addEventListener("click", () => {
      const u = $l("lu").value.trim();
      if (/@/.test(u) && !$l("re").value) $l("re").value = u;
      view(true);
    });
    $l("rback").addEventListener("click", () => {
      view(false);
      journalLink(/вернуться на страницу входа|вернуться ко входу|назад/i);
    });
    $l("rf").addEventListener("submit", (e) => {
      e.preventDefault();
      doRecover();
    });
    $l("lclassic").addEventListener("click", () => {
      unmountLogin();
      showFab();
    });
    setTimeout(() => {
      try {
        $l("lu").focus();
      } catch (e) {}
    }, 60);
  }
  // ссылка в форме журнала (под нашим окном)
  function journalLink(rx) {
    const el = [...document.querySelectorAll("a,button,span,div,p")]
      .filter(
        (x) =>
          !inHost(x) &&
          !(lhost && lhost.contains(x)) &&
          x.children.length < 2 &&
          rx.test((x.innerText || x.textContent || "").trim()),
      )
      .pop();
    if (el) {
      (el.closest("a,button") || el).click();
      return true;
    }
    return false;
  }
  const jInputs = (sel) =>
    [...document.querySelectorAll(sel)].filter(
      (el) => !inHost(el) && !(lhost && lhost.contains(el)) && vis(el),
    );
  let recovering = false;
  async function doRecover() {
    if (recovering || !lR) return;
    const $l = (id) => lR.getElementById(id),
      show = (id, t) => {
        const e = $l(id);
        if (e) {
          e.hidden = !t;
          e.textContent = t || "";
        }
      };
    const mail = $l("re").value.trim();
    show("rok", "");
    if (!/^\S+@\S+\.\S+$/.test(mail)) {
      show("rerr", "Введи почту полностью, например name@mail.ru");
      return;
    }
    recovering = true;
    show("rerr", "");
    const go = $l("rgo");
    go.disabled = true;
    go.innerHTML = `<span class="spin"></span>Отправляю…`;
    try {
      const emailIn = () =>
        jInputs("input[type=email],input[placeholder*='mail' i],input[name*='mail' i]")[0];
      let em = emailIn();
      if (!em) {
        journalLink(/^забыли пароль\??$/i);
        for (let i = 0; i < 25 && !(em = emailIn()); i++) await sleep(200);
      }
      if (!em) throw new Error("форма восстановления журнала не открылась. Попробуй «Обычный вход журнала»");
      const before = new Set(jInputs("div,span,p,small").map((x) => x.textContent.trim()));
      setVal(em, mail);
      const w = new Promise((res) => {
        const f = (ev) => {
          if (/\/g\/collect|analytics/i.test(ev.path || "")) return;
          const i = WL.indexOf(f);
          if (i >= 0) WL.splice(i, 1);
          res(ev);
        };
        WL.push(f);
        setTimeout(() => {
          const i = WL.indexOf(f);
          if (i >= 0) WL.splice(i, 1);
          res(null);
        }, 12000);
      });
      await sleep(150);
      const scope = em.closest("form") || em.parentElement.parentElement || document.body;
      const btn =
        [...scope.querySelectorAll("button,input[type=submit]")].find((b) =>
          /^(отправить|восстановить|send)$/i.test((b.innerText || b.value || "").trim()),
        ) || scope.querySelector("button[type=submit],button");
      if (!btn) throw new Error("не нашёл кнопку отправки в журнале");
      btn.click();
      const ev = await w;
      await sleep(900);
      // что журнал написал в ответ (новый текст рядом с формой)
      const said = jInputs("div,span,p,small,li")
        .filter(
          (x) =>
            x.children.length === 0 &&
            !before.has(x.textContent.trim()) &&
            /письм|отправл|почт|не найден|ошиб|невер|провер|восстанов|существ/i.test(x.textContent),
        )
        .map((x) => x.textContent.trim())
        .filter((t) => t.length < 200)[0];
      let apiMsg = "";
      try {
        const j = ev && JSON.parse(ev.text || "{}");
        apiMsg = (j && (j.message || j.error || (Array.isArray(j) && j[0] && j[0].message))) || "";
      } catch (e) {}
      if (ev && ev.status >= 400)
        throw new Error(
          said ||
            apiMsg ||
            (ev.status === 404 || ev.status === 422
              ? "Такая почта не найдена в журнале"
              : "Журнал ответил ошибкой " + ev.status),
        );
      if (!ev && !said) throw new Error("Журнал не ответил. Проверь интернет и попробуй ещё раз");
      if (said && /не найден|ошиб|невер|не существ/i.test(said)) throw new Error(said);
      show(
        "rok",
        (said ? said + ". " : "Письмо отправлено на " + mail + ". ") +
          "Проверь «Входящие» и «Спам»: логин и пароль придут в письме.",
      );
    } catch (e) {
      show("rerr", e.message.charAt(0).toUpperCase() + e.message.slice(1));
    } finally {
      recovering = false;
      const g = lR && $l("rgo");
      if (g) {
        g.disabled = false;
        g.textContent = "Отправить";
      }
    }
  }
  function unmountLogin() {
    if (!lhost) return;
    lhost.remove();
    lhost = null;
    lR = null;
  }
  let logging = false;
  async function doLogin() {
    if (logging || !lR) return;
    const $l = (id) => lR.getElementById(id),
      err = (t) => {
        const e = $l("lerr");
        if (!e) return;
        e.hidden = !t;
        e.textContent = t || "";
      };
    const u = $l("lu").value.trim(),
      pw = $l("lp").value;
    if (!u || !pw) {
      err(!u ? "Введи логин" : "Введи пароль");
      return;
    }
    logging = true;
    err("");
    try {
      localStorage.removeItem("dn2.out");
    } catch (e) {}
    const go = $l("lgo");
    go.disabled = true;
    go.innerHTML = `<span class="spin"></span>Вхожу…`;
    try {
      // поля настоящей формы журнала (она под нашим окном)
      if (!jInputs("input[type=password]").length)
        journalLink(/вернуться на страницу входа|вернуться ко входу/i);
      let pin = null,
        t0 = Date.now();
      while (
        !(pin = [...document.querySelectorAll("input[type=password]")].filter(
          (el) => !inHost(el) && !(lhost && lhost.contains(el)),
        )[0]) &&
        Date.now() - t0 < 6000
      )
        await sleep(200);
      if (!pin) throw new Error("форма входа журнала не загрузилась. Обнови страницу");
      const form = pin.closest("form") || pin.parentElement.parentElement.parentElement || document.body;
      const uin =
        [...(form.querySelectorAll ? form.querySelectorAll("input") : [])].filter(
          (el) => el !== pin && /^(text|email|)$/i.test(el.type || ""),
        )[0] ||
        [...document.querySelectorAll("input:not([type=password]):not([type=hidden])")].filter(
          (el) => !inHost(el),
        )[0];
      if (!uin) throw new Error("не нашёл поле логина журнала");
      setVal(uin, u);
      setVal(pin, pw);
      const w = new Promise((res) => {
        const f = (ev) => {
          if (/auth|login|token/i.test(ev.path || "")) {
            const i = WL.indexOf(f);
            if (i >= 0) WL.splice(i, 1);
            res(ev);
          }
        };
        WL.push(f);
        setTimeout(() => {
          const i = WL.indexOf(f);
          if (i >= 0) WL.splice(i, 1);
          res(null);
        }, 12000);
      });
      await sleep(150);
      const btn =
        [...(form.querySelectorAll ? form.querySelectorAll("button,input[type=submit]") : [])].find((b) =>
          /^(вход|войти|login|sign in)$/i.test((b.innerText || b.value || "").trim()),
        ) ||
        (form.querySelector && form.querySelector("button[type=submit],input[type=submit]"));
      if (btn) btn.click();
      else if (form.requestSubmit) form.requestSubmit();
      else throw new Error("не нашёл кнопку входа журнала");
      const ev = await w;
      for (let i = 0; i < 40 && isLoginRoute() && !(ev && ev.status >= 400 && i >= 5); i++) await sleep(200);
      if (!isLoginRoute()) return; // вошли: журнал сам перейдёт на главную, Дневник откроется
      const msg = [...document.querySelectorAll("div,span,p,small,li")]
        .filter(
          (el) =>
            !inHost(el) &&
            !(lhost && lhost.contains(el)) &&
            vis(el) &&
            el.children.length === 0 &&
            /невер|ошиб|не найден|заблок|попыт|incorrect|invalid/i.test(el.textContent || ""),
        )
        .map((el) => el.textContent.trim())[0];
      throw new Error(
        msg || (ev && ev.status >= 400 ? "Неверный логин или пароль" : "Журнал не ответил. Попробуй ещё раз"),
      );
    } catch (e) {
      err(e.message.charAt(0).toUpperCase() + e.message.slice(1));
    } finally {
      logging = false;
      const g = lR && $l("lgo");
      if (g) {
        g.disabled = false;
        g.textContent = "Войти";
      }
    }
  }

  /* ======================= запуск ======================= */
  const isLoginRoute = () =>
    /(^|[\/#])(login|auth|recover|forgot|reset-password)([\/?#]|$)/i.test(location.pathname + location.hash);
  let started = false,
    tokenWait;
  function onToken() {
    if (!(started && cfg.on && !isLoginRoute())) return;
    const again = () => {
      if (!M.live || syncState !== "ok" || (NET.okCount || 0) < (NET.totalCount || 1)) sync("token2");
    };
    if (syncing) syncing.then(again);
    else again();
  }
  // Журнал не делал запросов после нашего запуска (так бывает в Safari) - заставляем его обратиться к серверу:
  // тихо переключаем раздел под Дневником, журнал запрашивает данные, и Дневник получает вход.
  let kicks = 0;
  async function kickJournal() {
    if (kicks >= 2 || bridging || isLoginRoute() || !document.body) return;
    kicks++;
    try {
      await classicGo(kicks === 1 ? "Расписание" : "Домашние задания");
      await sleep(900);
      await classicGo("Главная");
    } catch (e) {}
  }
  // Проверка DDoS-Guard: страницу защиты нельзя закрывать Дневником - иначе она «висит» под ним
  const DDG = /ddos-guard|checking your browser|проверка браузера|проверяем ваш браузер/i;
  const isDdos = () => {
    try {
      if (DDG.test(document.title || "")) return true;
      const b = document.body;
      if (!b || b.getElementsByTagName("*").length > 150) return false;
      return DDG.test((b.textContent || "").slice(0, 6000));
    } catch (e) {
      return false;
    }
  };
  let ddgBox = null;
  function ddosMode() {
    if (ddgBox || !document.body) return;
    unmount();
    unmountLogin();
    dropVeil();
    document.documentElement.classList.remove("dn-on");
    ddgBox = document.createElement("div");
    ddgBox.style.cssText =
      "position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:2147483646;background:#11141a;color:#eceef2;border:1px solid rgba(212,177,114,.45);border-radius:14px;padding:12px 16px;font:15px Calibri,Carlito,'Segoe UI',sans-serif;display:flex;gap:12px;align-items:center;box-shadow:0 16px 40px -12px rgba(0,0,0,.6);max-width:calc(100vw - 32px)";
    ddgBox.innerHTML =
      '<span>Журнал проверяет браузер (DDoS-Guard). Дневник откроется сам после проверки</span><button style="display:none;border:0;border-radius:10px;padding:8px 12px;font:inherit;font-weight:700;background:#d4b172;color:#15110a;cursor:pointer">Перезагрузить</button>';
    const b = ddgBox.querySelector("button");
    b.onclick = () => location.reload();
    document.body.appendChild(ddgBox);
    setTimeout(() => {
      if (ddgBox && isDdos()) b.style.display = "";
    }, 10000);
    setTimeout(() => {
      if (!isDdos()) return;
      let n = 0;
      try {
        n = +sessionStorage.getItem("dn2.ddg") || 0;
        sessionStorage.setItem("dn2.ddg", String(n + 1));
      } catch (e) {}
      if (n < 1) location.reload();
    }, 25000);
  }
  function ddosCheck() {
    if (isDdos()) {
      ddosMode();
      return true;
    }
    if (ddgBox) {
      ddgBox.remove();
      ddgBox = null;
    }
    return false;
  }
  // Журнал «завис» (ни одного ответа сервера и нет данных) - одна автоматическая перезагрузка, дальше кнопка
  function hangCheck() {
    if (
      !started ||
      !cfg.on ||
      isLoginRoute() ||
      M.live ||
      ddgBox ||
      syncState === "ok" ||
      syncState === "auth"
    )
      return;
    let last = 0;
    try {
      last = +sessionStorage.getItem("dn2.rl") || 0;
    } catch (e) {}
    if (Date.now() - last < 300000) return;
    try {
      sessionStorage.setItem("dn2.rl", String(Date.now()));
    } catch (e) {}
    location.reload();
  }
  function start() {
    if (started) return;
    started = true;
    if (!cfg.on) return;
    try {
      const bg = document.createElement("style");
      bg.id = "dn-bg";
      bg.textContent =
        "html.dn-on,html.dn-on body{background:#000!important;color-scheme:dark}html.dn-on:not(.dn-raise-open),html.dn-on:not(.dn-raise-open) body{overflow:hidden!important;overscroll-behavior:none!important;height:100%!important}";
      if (W.visualViewport)
        W.visualViewport.addEventListener("scroll", () => {
          if (
            host &&
            document.documentElement.classList.contains("dn-on") &&
            (W.scrollY || W.scrollX || W.visualViewport.offsetTop)
          )
            W.scrollTo(0, 0);
        });
      (document.head || document.documentElement).appendChild(bg);
      const tc = () => {
        if (!document.head) return setTimeout(tc, 100);
        let m = document.querySelector('meta[name="theme-color"]');
        if (!m) {
          m = document.createElement("meta");
          m.name = "theme-color";
          document.head.appendChild(m);
        }
        m.content = "#000000";
      };
      tc();
    } catch (e) {}
    NET.token = NET.token || scanStorageForToken();
    computeFresh();
    W.addEventListener("pagehide", () => commitSeen(page));
    const wb = () => (document.body ? watchPopups() : setTimeout(wb, 200));
    wb();
    setInterval(
      () => {
        if (host && !document.hidden && !bridging) sync("interval");
      },
      5 * 60 * 1000,
    );
    if (CRYPTO && cfg.mkt) mkStart();
    {
      const u = LS.get("upd", null);
      setTimeout(
        () => checkUpdate(!!(u && u.v && verNewer(u.v, VERSION))),
        u && u.v && verNewer(u.v, VERSION) ? 4000 : 20000,
      );
    }
    setTimeout(() => {
      if (W.__dnDup && W.__dnDup.length && R)
        toast(
          `Установлено две копии Дневника (${W.__dnDup.join(", ")}) - удали лишнюю в Userscripts/Tampermonkey`,
        );
    }, 6000);
    setInterval(
      () => {
        if (!document.hidden) checkUpdate();
      },
      15 * 60 * 1000,
    );
    document.addEventListener("visibilitychange", () => {
      if (!document.hidden) checkUpdate();
    });
    // три лёгких запроса: счётчики разделов, счётчики ДЗ, баллы (новая оценка = новые топгемы). Изменилось - полная синхронизация
    setInterval(async () => {
      if (!host || document.hidden || bridging || syncing || !M.live || Date.now() - lastSync < 60000) return;
      try {
        const r = await Promise.allSettled([
          api("pollC", "count/page-counters"),
          api("pollH", "count/homework"),
          api("pollU", "settings/user-info"),
        ]);
        ["pollC", "pollH", "pollU"].forEach((k) => {
          delete NET.raw[k];
          delete NET.status[k];
        });
        const u = r[2].status === "fulfilled" ? userObj(r[2].value) : null;
        const sig = JSON.stringify([r[0].value || null, r[1].value || null, u ? u.gaming_points : null]);
        if (pollSig && sig !== pollSig) sync("poll");
        pollSig = sig;
      } catch (e) {}
    }, 90 * 1000);
    W.addEventListener("online", () => {
      if (host && !bridging) {
        retryN = 0;
        sync("online");
      }
    });
    // Вкладка долго висела в фоне (Safari держит старую копию страницы в памяти) - перезагружаем,
    // чтобы запустилась свежая версия Дневника и не было «старой версии» после обновления
    let hiddenAt = 0;
    document.addEventListener("visibilitychange", () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt && Date.now() - hiddenAt > 2 * 3600e3 && !isLoginRoute() && !bridging) {
        location.reload();
        return;
      }
      if (host && Date.now() - lastSync > 60 * 1000) sync("focus");
    });
    W.addEventListener("pageshow", (e) => {
      if (e.persisted && Date.now() - lastSync > 20 * 60000 && !isLoginRoute()) location.reload();
    });
    if (isLoginRoute()) {
      if (isSignIn()) mountLogin();
      else document.documentElement.classList.remove("dn-on");
      return;
    }
    if (isSurveyRoute()) {
      showFab();
      return;
    }
    try {
      mount();
    } catch (e) {
      NET.viewErr = "запуск: " + String((e && e.message) || e).slice(0, 160);
      try {
        if (host) host.remove();
      } catch (x) {}
      host = null;
      R = null;
      document.documentElement.classList.remove("dn-on");
      showFab();
      return;
    }
    const dd = () => {
      if (ddosCheck()) return;
      setTimeout(ddosCheck, 1500);
    };
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", dd) : dd();
    setTimeout(() => {
      if (
        !M.live &&
        syncState !== "ok" &&
        !Object.values(NET.status).some((x) => x === 200) &&
        !(NET.hookEvents > 3)
      )
        hangCheck();
    }, 30000);
    if (NET.token) sync("start");
    else
      tokenWait = setTimeout(() => {
        if (!NET.token) {
          sync("cookie");
          kickJournal();
        }
      }, 2500);
  }
  // Реакция на смену маршрута (выход из аккаунта, страница входа)
  // сторож: если Дневник должен быть на экране, но его нет (журнал сменил страницу раньше, чем мы успели), включаем
  setInterval(() => {
    if (!cfg.on || !started || bridging || ddosCheck() || isSurveyRoute()) return;
    if (host || lhost || (fab && fab.style.display !== "none")) return;
    if (isLoginRoute()) {
      if (isSignIn()) mountLogin();
      return;
    }
    document.documentElement.classList.add("dn-on");
    mount();
    sync("watchdog");
  }, 1500);
  // страница-анкета/опрос журнала: Дневник её не закрывает, а уступает место
  function isSurveyRoute() {
    return /survey|poll|questionnaire|quiz|anket|opros|interview/i.test(location.pathname + location.hash);
  }
  let lastRoute = location.href;
  setInterval(() => {
    if (location.href === lastRoute) return;
    lastRoute = location.href;
    if (isLoginRoute()) {
      unmount();
      onSignedOut();
      if (isSignIn() && cfg.on && started && (!fab || fab.style.display === "none")) mountLogin();
    } else if (isSurveyRoute()) {
      if (host) {
        unmount();
        showFab();
      }
    } else {
      unmountLogin();
      if (cfg.on && started && !host && (!fab || fab.style.display === "none")) {
        document.documentElement.classList.add("dn-on");
        mount();
        sync("route");
      }
    }
  }, 700);

  if (cfg.on) {
    const pre = () => {
      try {
        const v = document.createElement("div");
        v.id = "dn-veil";
        const acc =
          {
            sapphire: "#a9c6ef",
            emerald: "#9fe0c4",
            amethyst: "#cdb9f2",
            rose: "#f3bcd0",
            graphite: "#dde2e9",
          }[cfg.accent] || "#e8cf9c";
        const dark =
          cfg.theme === "light"
            ? false
            : cfg.theme === "dark"
              ? true
              : matchMedia("(prefers-color-scheme: dark)").matches;
        v.style.cssText = `position:fixed;inset:0;z-index:2147482999;display:grid;place-items:center;background:${dark ? "#0a0c10" : "#eff0f3"};transition:opacity .25s`;
        v.innerHTML =
          '<div style="width:54px;height:54px;border-radius:16px;display:grid;place-items:center;background:linear-gradient(135deg,#0f1822,#1d2d38);color:' +
          acc +
          ';box-shadow:inset 0 0 0 1px rgba(220,188,126,.35);animation:dnvp 1.4s ease-in-out infinite"><svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round"><rect x="4.5" y="3" width="15" height="18" rx="4"/><path d="M8.5 7.8h3.5M8.5 11.6h7M8.5 15.4h7"/></svg></div><style>@keyframes dnvp{50%{transform:scale(.92);opacity:.7}}</style>';
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
    else
      new MutationObserver((_, o) => {
        if (document.documentElement) {
          o.disconnect();
          pre();
        }
      }).observe(document, { childList: true });
  } else {
    const later = () => showFab();
    document.readyState === "loading" ? document.addEventListener("DOMContentLoaded", later) : later();
  }
  W.dnevnikToggle = (on) => {
    cfg.on = on !== false;
    saveCfg();
    location.reload();
  };
})();
