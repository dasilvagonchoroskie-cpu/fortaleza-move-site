(function () {
  var C = window.MOV_CONFIG;
  var D = C.DEFAULTS;
  var sb = window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  var cfg = Object.assign({}, D);

  // Cópia local (só dados públicos) para o site continuar útil se o Supabase ou a internet falharem.
  var CHAVE_CACHE = "fm-dados-v1";
  function lerCache() { try { return JSON.parse(localStorage.getItem(CHAVE_CACHE) || "{}") || {}; } catch (e) { return {}; } }
  function gravarCache(parte) { try { var c = lerCache(); Object.assign(c, parte); localStorage.setItem(CHAVE_CACHE, JSON.stringify(c)); } catch (e) {} }
  function mesclar(lista) { (lista || []).forEach(function (row) { if (row && row.valor != null && row.valor !== "") cfg[row.chave] = row.valor; }); }
  mesclar(lerCache().textos);

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function wa(texto) {
    var n = String(cfg.whatsapp || D.whatsapp).replace(/\D/g, "");
    return "https://wa.me/" + n + (texto ? "?text=" + encodeURIComponent(texto) : "");
  }
  function safeImg(u) { return /^https:\/\//i.test(u || "") ? u : ""; }
  function dataBR(iso) {
    try { return new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" }); }
    catch (e) { return ""; }
  }
  function paragrafos(t) {
    return String(t || "").split(/\n+/).filter(Boolean).map(function (p) { return "<p>" + esc(p) + "</p>"; }).join("");
  }

  function aplicarTextos() {
    var set = function (id, v) { var el = document.getElementById(id); if (el) el.textContent = v; };
    set("hero-titulo", cfg.hero_titulo);
    set("hero-sub", cfg.hero_subtitulo);
    document.querySelectorAll("[data-wa]").forEach(function (a) {
      a.href = wa(a.getAttribute("data-wa"));
      a.target = "_blank"; a.rel = "noopener";
    });
    var av = document.getElementById("aviso");
    if (av) {
      if (cfg.aviso_topo && cfg.aviso_topo.trim()) { av.textContent = cfg.aviso_topo; av.style.display = "block"; }
      else av.style.display = "none";
    }
    var ci = document.getElementById("cidades-lista");
    if (ci) {
      var lista = String(cfg.cidades || "").split(",").map(function (c) { return c.trim(); }).filter(Boolean);
      var sec = ci.closest("section");
      ci.innerHTML = lista.map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("");
      if (sec) sec.style.display = lista.length ? "" : "none";   // sem cidades cadastradas, a seção some
    }
  }

  async function carregarTextos() {
    if (!sb) return;
    try {
      var r = await sb.from("site_settings").select("chave,valor");
      if (r.error) throw r.error;
      cfg = Object.assign({}, D);                 // o que veio do servidor vale (inclui cidades removidas)
      mesclar(r.data);
      gravarCache({ textos: r.data || [] });
    } catch (e) { /* mantém a última cópia salva ou os textos padrão */ }
    aplicarTextos();
  }

  var postsCache = [];
  async function carregarPosts() {
    var box = document.getElementById("posts");
    if (!box) return;
    var limite = parseInt(box.getAttribute("data-limit"), 10) || 12;
    var falhou = false, daCopia = false;
    try {
      if (!sb) throw new Error("sem biblioteca");
      var r = await sb.from("site_posts").select("*").eq("publicado", true)
        .order("destaque", { ascending: false }).order("criado_em", { ascending: false }).limit(limite);
      if (r.error) throw r.error;
      postsCache = r.data || [];
      var guarda = {}; guarda["posts_" + limite] = postsCache; gravarCache(guarda);
    } catch (e) {
      falhou = true;
      var c = lerCache(), copia = c["posts_" + limite] || c.posts_24 || c.posts_3 || null;
      postsCache = copia ? copia.slice(0, limite) : [];
      daCopia = !!(copia && copia.length);
    }

    var tentar = function (txt) {
      return '<div class="vazio aviso-copia" style="grid-column:1/-1">' + txt +
        ' <button class="btn btn-sm btn-navy" type="button" id="tentar-de-novo">Tentar de novo</button></div>';
    };
    if (falhou && !daCopia) {
      box.innerHTML = tentar("Não foi possível carregar as novidades agora.<br>");
      var b = document.getElementById("tentar-de-novo");
      if (b) b.addEventListener("click", function () { box.innerHTML = ""; carregarPosts(); });
      return;
    }
    if (!postsCache.length) {
      box.innerHTML = '<div class="vazio" style="grid-column:1/-1">Em breve, novidades da Fortaleza Move por aqui.</div>';
      return;
    }
    box.innerHTML = postsCache.map(function (p, i) {
      var img = safeImg(p.imagem_url);
      return '<article class="post' + (p.destaque ? " destaque" : "") + '" data-i="' + i + '" tabindex="0" role="button" aria-label="Abrir: ' + esc(p.titulo) + '">' +
        '<div class="img">' + (img ? '<img loading="lazy" decoding="async" alt="" src="' + esc(img) + '">' : "") + "</div>" +
        '<div class="body"><span class="tag">' + esc(p.categoria) + "</span>" +
        "<h3>" + esc(p.titulo) + "</h3><p>" + esc(p.resumo) + "</p>" +
        "<time>" + esc(dataBR(p.criado_em)) + "</time></div></article>";
    }).join("") + (daCopia ? tentar("Sem conexão no momento: mostrando as últimas novidades salvas neste aparelho.") : "");
    if (daCopia) document.getElementById("tentar-de-novo").addEventListener("click", function () { box.innerHTML = ""; carregarPosts(); });
    box.querySelectorAll(".post img").forEach(function (im) {
      im.addEventListener("error", function () { im.remove(); });   // foto que não carrega some, fica o fundo azul
    });
    box.querySelectorAll(".post").forEach(function (el) {
      var abrirEste = function () { abrir(postsCache[Number(el.getAttribute("data-i"))]); };
      el.addEventListener("click", abrirEste);
      el.addEventListener("keydown", function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); abrirEste(); } });
    });
  }

  var modal = document.getElementById("modal");
  function fechar() { if (modal) modal.classList.remove("on"); }
  function abrir(p) {
    if (!p || !modal) return;
    var img = safeImg(p.imagem_url);
    modal.querySelector(".box").innerHTML =
      (img ? '<div class="img"><img alt="" src="' + esc(img) + '"></div>' : "") +
      '<div class="in"><button class="x" type="button" aria-label="Fechar">×</button>' +
      '<span class="tag">' + esc(p.categoria) + "</span><h3>" + esc(p.titulo) + "</h3>" +
      '<p class="data">' + esc(dataBR(p.criado_em)) + "</p>" +
      paragrafos(p.corpo || p.resumo) + "</div>";
    modal.classList.add("on");
    var x = modal.querySelector(".x");
    x.addEventListener("click", fechar);
    x.focus();
  }
  if (modal) modal.addEventListener("click", function (e) { if (e.target === modal) fechar(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") fechar(); });

  var ano = document.getElementById("ano");
  if (ano) ano.textContent = new Date().getFullYear();

  // ---- aplicativo instalável (PWA) ----
  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", function () { navigator.serviceWorker.register("sw.js").catch(function () {}); });
  }
  var btnInst = document.getElementById("btn-instalar");
  var eventoInstalar = null;
  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault(); eventoInstalar = e;
    if (btnInst) btnInst.hidden = false;
  });
  if (btnInst) btnInst.addEventListener("click", async function () {
    if (!eventoInstalar) return;
    eventoInstalar.prompt();
    try { await eventoInstalar.userChoice; } catch (e) {}
    eventoInstalar = null; btnInst.hidden = true;
  });
  window.addEventListener("appinstalled", function () { if (btnInst) btnInst.hidden = true; });

  aplicarTextos();
  carregarTextos();
  carregarPosts();
})();

// WhatsApp: abre o aplicativo sem passar pela página intermediária do wa.me (que deixava a tela em branco).
//  - Android no Chrome: "intent" do Chrome (sem o app, o próprio Chrome abre o wa.me).
//  - App instalado (Android ou iPhone): esquema whatsapp://; se nada acontecer em 2 s, abre o wa.me.
//  - Safari no iPhone, computador e navegadores embutidos (Instagram, Facebook): link normal do wa.me.
(function () {
  var ua = navigator.userAgent, android = /Android/i.test(ua), ios = /iPhone|iPad|iPod/i.test(ua);
  var instalado = (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  var webview = /; wv\)|FBAN|FBAV|Instagram|Line\//i.test(ua);   // navegador embutido em outros apps: "intent" pode não funcionar
  if (webview || !(android || (ios && instalado))) return;  // Safari, computador e navegadores embutidos: link normal do wa.me
  var ocupado = false;
  function disparar(url) {
    var l = document.createElement("a");
    l.href = url; l.style.display = "none";
    document.body.appendChild(l); l.click();
    setTimeout(function () { l.remove(); }, 500);
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest("a[href*='wa.me/']");
    if (!a) return;
    var m = a.href.match(/wa\.me\/(\d+)(?:\?text=([^&#]*))?/);
    if (!m) return;
    e.preventDefault();
    if (ocupado) return;                                  // evita toque duplo abrir duas vezes
    ocupado = true; setTimeout(function () { ocupado = false; }, 2500);
    var q = "phone=" + m[1] + (m[2] ? "&text=" + m[2] : "");
    if (android && !instalado) {
      disparar("intent://send?" + q + "#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=" + encodeURIComponent(a.href) + ";end");
      return;
    }
    // app instalado: só cai para o wa.me se a página continuar à vista e em primeiro plano
    var saiu = false, marca = function () { saiu = true; };
    window.addEventListener("pagehide", marca, { once: true });
    window.addEventListener("blur", marca, { once: true });
    document.addEventListener("visibilitychange", marca, { once: true });
    disparar("whatsapp://send?" + q);
    setTimeout(function () {
      window.removeEventListener("pagehide", marca); window.removeEventListener("blur", marca); document.removeEventListener("visibilitychange", marca);
      if (!saiu && !document.hidden && document.hasFocus()) window.open(a.href, "_blank", "noopener");
    }, 2000);
  });
})();
