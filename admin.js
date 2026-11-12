(function () {
  var C = window.MOV_CONFIG;
  var sb = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY);
  var $ = function (id) { return document.getElementById(id); };
  var editandoId = null;
  var imagemAtual = null;
  var posts = [];

  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function msg(el, tipo, texto) {
    el.innerHTML = texto ? '<div class="msg ' + tipo + '">' + esc(texto) + "</div>" : "";
  }

  async function ehAdmin(user) {
    var r = await sb.from("site_admins").select("user_id").eq("user_id", user.id).maybeSingle();
    return !r.error && !!r.data;
  }

  // Link de recuperação de senha ou de convite: o Supabase devolve o usuário aqui com type=recovery|invite no endereço.
  var modoSenha = /type=(recovery|invite)/.test(location.hash);

  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "PASSWORD_RECOVERY") { modoSenha = true; mostrarSenha(); }
  });

  async function iniciar() {
    var s = await sb.auth.getSession();
    var user = s.data && s.data.session && s.data.session.user;
    if (modoSenha && user) return mostrarSenha();
    if (user && (await ehAdmin(user))) mostrarPainel();
    else { if (user) await sb.auth.signOut(); mostrarLogin(); }
  }
  function telas(qual) {
    $("tela-login").style.display = qual === "login" ? "block" : "none";
    $("tela-senha").style.display = qual === "senha" ? "block" : "none";
    $("tela-painel").style.display = qual === "painel" ? "block" : "none";
    $("btn-sair").style.display = qual === "painel" ? "inline-block" : "none";
  }
  function mostrarLogin() { telas("login"); }
  function mostrarSenha() { telas("senha"); }
  function mostrarPainel() {
    telas("painel");
    carregarPosts(); carregarTextos();
  }

  $("form-senha").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-senha");
    var a = $("nova1").value, b = $("nova2").value;
    if (a.length < 10) return msg(m, "err", "Use pelo menos 10 caracteres.");
    if (a !== b) return msg(m, "err", "As duas senhas não são iguais.");
    var r = await sb.auth.updateUser({ password: a });
    if (r.error) return msg(m, "err", "Não foi possível salvar a senha. Peça um novo link e tente de novo.");
    $("nova1").value = ""; $("nova2").value = "";
    modoSenha = false;
    history.replaceState(null, "", location.pathname);
    var u = r.data && r.data.user;
    if (u && (await ehAdmin(u))) mostrarPainel();
    else { await sb.auth.signOut(); mostrarLogin(); msg($("msg-login"), "err", "Esta conta não tem acesso ao painel."); }
  });

  $("form-login").addEventListener("submit", async function (e) {
    e.preventDefault();
    msg($("msg-login"), "ok", "Entrando…");
    var r = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("senha").value });
    if (r.error) return msg($("msg-login"), "err", "E-mail ou senha incorretos.");
    if (!(await ehAdmin(r.data.user))) {
      await sb.auth.signOut();
      return msg($("msg-login"), "err", "Esta conta não tem acesso ao painel.");
    }
    $("senha").value = "";
    msg($("msg-login"), "", "");
    mostrarPainel();
  });

  $("esqueci").addEventListener("click", async function (e) {
    e.preventDefault();
    var em = $("email").value.trim();
    if (!em) return msg($("msg-login"), "err", "Digite seu e-mail acima e toque de novo em “Esqueci a senha”.");
    var r = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
    msg($("msg-login"), r.error ? "err" : "ok", r.error ? "Não foi possível enviar agora. Tente mais tarde." : "Se o e-mail estiver cadastrado, você receberá o link de recuperação.");
  });

  $("btn-sair").addEventListener("click", async function () { await sb.auth.signOut(); mostrarLogin(); });

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tabs button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      $("tab-posts").style.display = b.dataset.tab === "posts" ? "block" : "none";
      $("tab-textos").style.display = b.dataset.tab === "textos" ? "block" : "none";
    });
  });

  // ---------- publicações ----------
  async function carregarPosts() {
    var r = await sb.from("site_posts").select("*").order("criado_em", { ascending: false });
    posts = r.data || [];
    var box = $("lista-posts");
    if (!posts.length) { box.innerHTML = '<div class="vazio" style="margin-top:10px">Nenhuma publicação ainda. Toque em “Nova publicação”.</div>'; return; }
    box.innerHTML = posts.map(function (p) {
      return '<div class="lista-item"><div><div class="t">' + esc(p.titulo) +
        '<span class="badge ' + (p.publicado ? "on" : "off") + '">' + (p.publicado ? "NO AR" : "RASCUNHO") + "</span>" +
        (p.destaque ? '<span class="badge on">DESTAQUE</span>' : "") + "</div>" +
        '<div class="m">' + esc(p.categoria) + " · " + esc(new Date(p.criado_em).toLocaleDateString("pt-BR")) + "</div></div>" +
        '<div class="acoes"><button class="btn btn-sm btn-ghost" data-ed="' + esc(p.id) + '">Editar</button>' +
        '<button class="btn btn-sm btn-danger" data-del="' + esc(p.id) + '">Apagar</button></div></div>';
    }).join("");
    box.querySelectorAll("[data-ed]").forEach(function (b) { b.addEventListener("click", function () { abrirEditor(b.dataset.ed); }); });
    box.querySelectorAll("[data-del]").forEach(function (b) { b.addEventListener("click", function () { apagar(b.dataset.del); }); });
  }

  function abrirEditor(id) {
    var p = posts.find(function (x) { return x.id === id; }) || null;
    editandoId = p ? p.id : null;
    imagemAtual = p ? p.imagem_url : null;
    $("editor-titulo").textContent = p ? "Editar publicação" : "Nova publicação";
    $("p-titulo").value = p ? p.titulo : "";
    $("p-resumo").value = p ? p.resumo || "" : "";
    $("p-corpo").value = p ? p.corpo || "" : "";
    $("p-cat").value = p ? p.categoria : "Novidades";
    $("p-pub").checked = p ? p.publicado : true;
    $("p-dest").checked = p ? p.destaque : false;
    $("p-img").value = "";
    var pv = $("p-preview");
    if (imagemAtual && /^https:\/\//.test(imagemAtual)) { pv.src = imagemAtual; pv.style.display = "block"; } else pv.style.display = "none";
    msg($("msg-post"), "", "");
    $("editor").style.display = "block";
    $("editor").scrollIntoView({ behavior: "smooth" });
  }
  $("btn-nova").addEventListener("click", function () { abrirEditor(null); });
  $("btn-cancelar").addEventListener("click", function () { $("editor").style.display = "none"; });

  async function apagar(id) {
    if (!confirm("Apagar esta publicação? Não dá para desfazer.")) return;
    var r = await sb.from("site_posts").delete().eq("id", id);
    if (r.error) return alert("Não foi possível apagar.");
    carregarPosts();
  }

  $("form-post").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-post");
    msg(m, "ok", "Salvando…");
    var url = imagemAtual;
    var f = $("p-img").files[0];
    if (f) {
      if (f.size > 5 * 1024 * 1024) return msg(m, "err", "A imagem passa de 5 MB.");
      var ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[f.type];
      if (!ext) return msg(m, "err", "Use imagem JPG, PNG ou WebP.");
      var path = "posts/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
      var up = await sb.storage.from(C.BUCKET).upload(path, f, { contentType: f.type, upsert: false });
      if (up.error) return msg(m, "err", "Não foi possível enviar a imagem.");
      url = sb.storage.from(C.BUCKET).getPublicUrl(path).data.publicUrl;
    }
    var dados = {
      titulo: $("p-titulo").value.trim(),
      resumo: $("p-resumo").value.trim(),
      corpo: $("p-corpo").value.trim(),
      categoria: $("p-cat").value,
      imagem_url: url || null,
      publicado: $("p-pub").checked,
      destaque: $("p-dest").checked,
      atualizado_em: new Date().toISOString()
    };
    var r = editandoId ? await sb.from("site_posts").update(dados).eq("id", editandoId) : await sb.from("site_posts").insert(dados);
    if (r.error) return msg(m, "err", "Não foi possível salvar.");
    $("editor").style.display = "none";
    carregarPosts();
  });

  // ---------- textos ----------
  var CHAVES = { aviso_topo: "t-aviso", hero_titulo: "t-titulo", hero_subtitulo: "t-sub", whatsapp: "t-wa", cidades: "t-cidades" };

  async function carregarTextos() {
    var r = await sb.from("site_settings").select("chave,valor");
    var salvo = {};
    (r.data || []).forEach(function (x) { salvo[x.chave] = x.valor; });
    Object.keys(CHAVES).forEach(function (k) {
      $(CHAVES[k]).value = salvo[k] != null ? salvo[k] : C.DEFAULTS[k] || "";
    });
  }

  $("form-textos").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-textos");
    var wa = $("t-wa").value.replace(/\D/g, "");
    if (wa && (wa.length < 12 || wa.length > 13)) return msg(m, "err", "WhatsApp: use 55 + DDD + número (ex.: 5564999999999).");
    $("t-wa").value = wa;
    var linhas = Object.keys(CHAVES).map(function (k) {
      return { chave: k, valor: $(CHAVES[k]).value.trim(), atualizado_em: new Date().toISOString() };
    });
    var r = await sb.from("site_settings").upsert(linhas, { onConflict: "chave" });
    msg(m, r.error ? "err" : "ok", r.error ? "Não foi possível salvar." : "Textos salvos. O site já mostra a mudança.");
  });

  iniciar();
})();
