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
    el.innerHTML = texto ? '<div class="msg ' + tipo + '" role="' + (tipo === "err" ? "alert" : "status") + '">' + esc(texto) + "</div>" : "";
  }
  // Traduz erros técnicos em mensagens claras (conexão, sessão, permissão).
  function erroTxt(err, padrao) {
    var t = String((err && err.message) || err || ""), st = Number(err && (err.status || err.statusCode));
    if (!navigator.onLine || /failed to fetch|networkerror|network request|load failed|fetch failed/i.test(t)) return "Sem conexão com a internet. Confira o sinal e tente de novo. Nada foi alterado.";
    if (st === 401 || /jwt|token is expired|not authenticated|invalid claim/i.test(t)) return "Sua sessão expirou. Toque em Sair, entre de novo e repita a ação.";
    if (st === 413 || /too large|payload/i.test(t)) return "A imagem é grande demais. Use uma de até 5 MB.";
    if (st === 403 || /row-level security|not authorized|permission denied/i.test(t)) return "Esta conta não tem permissão para esta ação. Entre com a conta de administrador.";
    return padrao;
  }
  // Desativa o botão de envio enquanto a operação roda (evita duplo toque e envio repetido).
  async function ocupado(form, fn) {
    var b = form.querySelector("button[type=submit]");
    if (b) b.disabled = true;
    try { await fn(); } finally { if (b) b.disabled = false; }
  }

  // true = administrador, false = não é, null = não foi possível verificar (erro de conexão); nunca desloga por falha de rede.
  async function ehAdmin(user) {
    try {
      var r = await sb.from("site_admins").select("user_id").eq("user_id", user.id).maybeSingle();
      if (r.error) return null;
      return !!r.data;
    } catch (e) { return null; }
  }

  // Link de recuperação de senha ou de convite: o Supabase devolve o usuário aqui com type=recovery|invite no endereço.
  var modoSenha = /type=(recovery|invite)/.test(location.hash);

  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "PASSWORD_RECOVERY") { modoSenha = true; mostrarSenha(); }
  });

  async function iniciar() {
    try {
      var s = await sb.auth.getSession();
      var user = s.data && s.data.session && s.data.session.user;
      if (modoSenha && user) return mostrarSenha();
      if (!user) return mostrarLogin();
      var adm = await ehAdmin(user);
      if (adm === true) mostrarPainel();
      else if (adm === null) { mostrarLogin(); msg($("msg-login"), "err", "Não foi possível confirmar seu acesso agora (sem conexão?). Tente de novo em instantes."); }
      else { await sb.auth.signOut(); mostrarLogin(); }
    } catch (e) { mostrarLogin(); msg($("msg-login"), "err", erroTxt(e, "Não foi possível iniciar o painel. Recarregue a página.")); }
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
    await ocupado(this, async function () {
      try {
        var r = await sb.auth.updateUser({ password: a });
        if (r.error) return msg(m, "err", erroTxt(r.error, "Não foi possível salvar a senha. Peça um novo link e tente de novo."));
        $("nova1").value = ""; $("nova2").value = "";
        modoSenha = false;
        history.replaceState(null, "", location.pathname);
        var u = r.data && r.data.user;
        var adm = u ? await ehAdmin(u) : false;
        if (adm === true) mostrarPainel();
        else if (adm === null) { mostrarLogin(); msg($("msg-login"), "ok", "Senha salva. Entre com a nova senha."); }
        else { await sb.auth.signOut(); mostrarLogin(); msg($("msg-login"), "err", "Esta conta não tem acesso ao painel."); }
      } catch (e) { msg(m, "err", erroTxt(e, "Não foi possível salvar a senha.")); }
    });
  });

  $("form-login").addEventListener("submit", async function (e) {
    e.preventDefault();
    msg($("msg-login"), "ok", "Entrando…");
    await ocupado(this, async function () {
      try {
        var r = await sb.auth.signInWithPassword({ email: $("email").value.trim(), password: $("senha").value });
        if (r.error) {
          var net = erroTxt(r.error, "");
          return msg($("msg-login"), "err", net || "E-mail ou senha incorretos.");
        }
        var adm = await ehAdmin(r.data.user);
        if (adm === null) return msg($("msg-login"), "err", "Não foi possível confirmar seu acesso agora (sem conexão?). Tente de novo.");
        if (!adm) { await sb.auth.signOut(); return msg($("msg-login"), "err", "Esta conta não tem acesso ao painel."); }
        $("senha").value = "";
        msg($("msg-login"), "", "");
        mostrarPainel();
      } catch (e) { msg($("msg-login"), "err", erroTxt(e, "Não foi possível entrar agora. Tente de novo.")); }
    });
  });

  $("esqueci").addEventListener("click", async function (e) {
    e.preventDefault();
    var em = $("email").value.trim();
    if (!em) return msg($("msg-login"), "err", "Digite seu e-mail acima e toque de novo em “Esqueci a senha”.");
    try {
      var r = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
      msg($("msg-login"), r.error ? "err" : "ok", r.error ? erroTxt(r.error, "Não foi possível enviar agora. Tente mais tarde.") : "Se o e-mail estiver cadastrado, você receberá o link de recuperação.");
    } catch (er) { msg($("msg-login"), "err", erroTxt(er, "Não foi possível enviar agora. Tente mais tarde.")); }
  });

  $("btn-sair").addEventListener("click", async function () {
    try { await sb.auth.signOut(); } catch (e) { /* mesmo sem rede, a sessão local é encerrada */ }
    mostrarLogin();
  });

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tabs button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      $("tab-posts").style.display = b.dataset.tab === "posts" ? "block" : "none";
      $("tab-textos").style.display = b.dataset.tab === "textos" ? "block" : "none";
      $("tab-conta").style.display = b.dataset.tab === "conta" ? "block" : "none";
      if (b.dataset.tab === "textos" && !textosOk) carregarTextos();
    });
  });

  $("form-conta").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-conta");
    var a = $("c-nova1").value, b = $("c-nova2").value;
    if (a.length < 10) return msg(m, "err", "Use pelo menos 10 caracteres.");
    if (a !== b) return msg(m, "err", "As duas senhas não são iguais.");
    await ocupado(this, async function () {
      try {
        var r = await sb.auth.updateUser({ password: a });
        if (r.error) return msg(m, "err", erroTxt(r.error, "Não foi possível trocar a senha. Saia, entre de novo e tente outra vez."));
        $("c-nova1").value = ""; $("c-nova2").value = "";
        msg(m, "ok", "Senha trocada com sucesso.");
      } catch (e) { msg(m, "err", erroTxt(e, "Não foi possível trocar a senha.")); }
    });
  });

  // ---------- publicações ----------
  async function carregarPosts() {
    var box = $("lista-posts");
    var r;
    try { r = await sb.from("site_posts").select("*").order("criado_em", { ascending: false }); }
    catch (e) { r = { error: e }; }
    if (r.error) {
      posts = [];
      box.innerHTML = '<div class="msg err" role="alert">' + esc(erroTxt(r.error, "Não foi possível carregar as publicações.")) +
        ' <button class="btn btn-sm btn-navy" type="button" id="recarregar-posts" style="margin-left:8px">Tentar de novo</button></div>';
      $("recarregar-posts").addEventListener("click", carregarPosts);
      return;
    }
    posts = r.data || [];
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
    var ml = $("msg-lista");
    try {
      var r = await sb.from("site_posts").delete().eq("id", id).select("id");
      if (r.error) return msg(ml, "err", erroTxt(r.error, "Não foi possível apagar. A publicação continua no ar."));
      if (!r.data || !r.data.length) return msg(ml, "err", "Não foi possível apagar (sem permissão ou já removida). Recarregue a lista.");
      msg(ml, "ok", "Publicação apagada.");
    } catch (e) { return msg(ml, "err", erroTxt(e, "Não foi possível apagar.")); }
    carregarPosts();
  }

  $("form-post").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-post");
    var titulo = $("p-titulo").value.trim();
    if (!titulo) return msg(m, "err", "Escreva o título da publicação.");
    await ocupado(this, async function () {
      msg(m, "ok", "Salvando…");
      try {
        var url = imagemAtual;
        var f = $("p-img").files[0];
        if (f) {
          if (f.size > 5 * 1024 * 1024) return msg(m, "err", "A imagem passa de 5 MB. Nada foi salvo.");
          var ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[f.type];
          if (!ext) return msg(m, "err", "Use imagem JPG, PNG ou WebP. Nada foi salvo.");
          msg(m, "ok", "Enviando a foto…");
          var path = "posts/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
          var up = await sb.storage.from(C.BUCKET).upload(path, f, { contentType: f.type, upsert: false });
          if (up.error) return msg(m, "err", erroTxt(up.error, "Não foi possível enviar a foto. A publicação NÃO foi salva.") );
          url = sb.storage.from(C.BUCKET).getPublicUrl(path).data.publicUrl;
        }
        var dados = {
          titulo: titulo,
          resumo: $("p-resumo").value.trim(),
          corpo: $("p-corpo").value.trim(),
          categoria: $("p-cat").value,
          imagem_url: url || null,
          publicado: $("p-pub").checked,
          destaque: $("p-dest").checked,
          atualizado_em: new Date().toISOString()
        };
        var q = editandoId ? sb.from("site_posts").update(dados).eq("id", editandoId) : sb.from("site_posts").insert(dados);
        var r = await q.select("id");
        if (r.error) return msg(m, "err", erroTxt(r.error, "Não foi possível salvar a publicação."));
        if (!r.data || !r.data.length) return msg(m, "err", "A publicação não foi salva (sem permissão). Saia e entre de novo.");
        $("editor").style.display = "none";
        msg($("msg-lista"), "ok", dados.publicado ? "Publicação salva e no ar." : "Rascunho salvo (não aparece no site).");
        carregarPosts();
      } catch (er) { msg(m, "err", erroTxt(er, "Não foi possível salvar. Tente de novo.")); }
    });
  });

  // ---------- textos ----------
  var CHAVES = { aviso_topo: "t-aviso", hero_titulo: "t-titulo", hero_subtitulo: "t-sub", whatsapp: "t-wa", cidades: "t-cidades" };

  function cidades() { return $("t-cidades").value.split(",").map(function (c) { return c.trim(); }).filter(Boolean); }
  function pintarCidades() {
    var box = $("cid-chips"); box.innerHTML = "";
    var l = cidades();
    if (!l.length) { box.innerHTML = '<span class="vazio">Nenhuma cidade ainda. A seção está escondida no site.</span>'; return; }
    l.forEach(function (c, i) {
      var s = document.createElement("span"); s.textContent = c;
      var b = document.createElement("button"); b.type = "button"; b.textContent = "×"; b.setAttribute("aria-label", "Remover " + c);
      b.addEventListener("click", function () { var x = cidades(); x.splice(i, 1); $("t-cidades").value = x.join(", "); pintarCidades(); });
      s.appendChild(b); box.appendChild(s);
    });
  }
  function addCidade() {
    var v = $("nova-cidade").value.replace(/,/g, " ").trim();
    if (!v) return;
    var x = cidades();
    if (!x.some(function (c) { return c.toLowerCase() === v.toLowerCase(); })) x.push(v);
    $("t-cidades").value = x.join(", "); $("nova-cidade").value = ""; pintarCidades();
  }
  $("btn-cid-add").addEventListener("click", addCidade);
  $("nova-cidade").addEventListener("keydown", function (e) { if (e.key === "Enter") { e.preventDefault(); addCidade(); } });

  var textosOk = false;
  async function carregarTextos() {
    var m = $("msg-textos"), btn = $("form-textos").querySelector("button[type=submit]");
    var r;
    try { r = await sb.from("site_settings").select("chave,valor"); } catch (e) { r = { error: e }; }
    if (r.error) {
      textosOk = false; btn.disabled = true;
      return msg(m, "err", erroTxt(r.error, "Não foi possível carregar os textos atuais.") + " O botão Salvar fica bloqueado para não apagar o que já existe. Abra esta aba de novo para tentar outra vez.");
    }
    textosOk = true; btn.disabled = false; msg(m, "", "");
    var salvo = {};
    (r.data || []).forEach(function (x) { salvo[x.chave] = x.valor; });
    Object.keys(CHAVES).forEach(function (k) {
      $(CHAVES[k]).value = salvo[k] != null ? salvo[k] : C.DEFAULTS[k] || "";
    });
    pintarCidades();
  }

  $("form-textos").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-textos");
    if (!textosOk) return msg(m, "err", "Os textos atuais não foram carregados. Abra a aba de novo antes de salvar.");
    addCidade();
    var wa = $("t-wa").value.replace(/\D/g, "");
    if (wa && (wa.length < 12 || wa.length > 13)) return msg(m, "err", "WhatsApp: use 55 + DDD + número (ex.: 5564999999999).");
    $("t-wa").value = wa;
    var linhas = Object.keys(CHAVES).map(function (k) {
      return { chave: k, valor: $(CHAVES[k]).value.trim(), atualizado_em: new Date().toISOString() };
    });
    await ocupado(this, async function () {
      try {
        var r = await sb.from("site_settings").upsert(linhas, { onConflict: "chave" }).select("chave");
        if (r.error) return msg(m, "err", erroTxt(r.error, "Não foi possível salvar os textos."));
        if (!r.data || r.data.length < linhas.length) return msg(m, "err", "Os textos não foram salvos (sem permissão). Saia e entre de novo.");
        msg(m, "ok", "Textos salvos. O site já mostra a mudança.");
      } catch (e) { msg(m, "err", erroTxt(e, "Não foi possível salvar os textos.")); }
    });
  });

  iniciar();
})();
