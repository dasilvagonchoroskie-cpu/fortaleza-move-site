(function () {
  var C = window.MOV_CONFIG;
  var D = C.DEFAULTS;
  var sb = window.supabase ? window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY) : null;
  var cfg = Object.assign({}, D);

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
      ci.innerHTML = String(cfg.cidades || "").split(",").map(function (c) { return c.trim(); }).filter(Boolean)
        .map(function (c) { return "<span>" + esc(c) + "</span>"; }).join("");
    }
  }

  async function carregarTextos() {
    if (!sb) return;
    try {
      var r = await sb.from("site_settings").select("chave,valor");
      if (r.error) throw r.error;
      (r.data || []).forEach(function (row) { if (row.valor != null && row.valor !== "") cfg[row.chave] = row.valor; });
    } catch (e) { /* mantém os textos padrão */ }
    aplicarTextos();
  }

  var postsCache = [];
  async function carregarPosts() {
    var box = document.getElementById("posts");
    if (!box) return;
    var limite = parseInt(box.getAttribute("data-limit"), 10) || 12;
    var falhou = false;
    try {
      if (!sb) throw new Error("sem biblioteca");
      var r = await sb.from("site_posts").select("*").eq("publicado", true)
        .order("destaque", { ascending: false }).order("criado_em", { ascending: false }).limit(limite);
      if (r.error) throw r.error;
      postsCache = r.data || [];
    } catch (e) { postsCache = []; falhou = true; }

    if (falhou) {
      box.innerHTML = '<div class="vazio" style="grid-column:1/-1">Não foi possível carregar as novidades agora.<br>' +
        '<button class="btn btn-sm btn-navy" type="button" id="tentar-de-novo" style="margin-top:12px">Tentar de novo</button></div>';
      var b = document.getElementById("tentar-de-novo");
      if (b) b.addEventListener("click", function () { box.innerHTML = ""; carregarPosts(); });
      return;
    }
    if (!postsCache.length) {
      box.innerHTML = '<div class="vazio" style="grid-column:1/-1">Em breve, novidades da Fortaleza Mov por aqui.</div>';
      return;
    }
    box.innerHTML = postsCache.map(function (p, i) {
      var img = safeImg(p.imagem_url);
      return '<article class="post' + (p.destaque ? " destaque" : "") + '" data-i="' + i + '" tabindex="0" role="button" aria-label="Abrir: ' + esc(p.titulo) + '">' +
        '<div class="img">' + (img ? '<img loading="lazy" decoding="async" alt="" src="' + esc(img) + '">' : "") + "</div>" +
        '<div class="body"><span class="tag">' + esc(p.categoria) + "</span>" +
        "<h3>" + esc(p.titulo) + "</h3><p>" + esc(p.resumo) + "</p>" +
        "<time>" + esc(dataBR(p.criado_em)) + "</time></div></article>";
    }).join("");
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
      '<p style="color:#8d97b3;font-size:.85rem">' + esc(dataBR(p.criado_em)) + "</p>" +
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
