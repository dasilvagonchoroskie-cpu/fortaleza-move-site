// Painel instalável como aplicativo (ficava dentro do HTML; a política de segurança não permite código embutido).
(function () {
  try { if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) navigator.serviceWorker.register("sw.js"); } catch (e) {}
  var ev = null, b = document.getElementById("btn-instalar");
  window.addEventListener("beforeinstallprompt", function (e) { e.preventDefault(); ev = e; b.hidden = false; });
  b.addEventListener("click", function () { if (!ev) return; ev.prompt(); ev.userChoice.then(function () { ev = null; b.hidden = true; }); });
  window.addEventListener("appinstalled", function () { b.hidden = true; });
})();

(function () {
  // O painel não funciona dentro da moldura de outro site (golpe de "clique roubado").
  if (window.top !== window.self) { document.body.textContent = "Por segurança, o painel não abre dentro de outra página."; return; }
  var C = window.MOV_CONFIG;
  // Endereço como chegou (antes de a biblioteca do Supabase ler e limpar o link do e-mail).
  var LINK = new URLSearchParams((location.hash || "").replace(/^#/, "") + "&" + (location.search || "").replace(/^\?/, ""));
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

  // Encerra a sessão. Sem internet o Supabase não apaga a sessão guardada no aparelho, então o painel apaga ele mesmo.
  var CHAVE_SESSAO = "sb-" + new URL(C.SUPABASE_URL).hostname.split(".")[0] + "-auth-token";
  async function encerrarSessao(escopo) {
    var falhou = true;
    try { var r = await sb.auth.signOut({ scope: escopo }); falhou = !!(r && r.error); } catch (e) {}
    if (falhou) { try { localStorage.removeItem(CHAVE_SESSAO); } catch (e) {} }
  }

  // Sessão: o painel sai sozinho depois de 30 minutos sem uso (inclusive se o aparelho ficar guardado).
  var LIMITE_PARADO = 30 * 60 * 1000, CHAVE_ATIVIDADE = "fm-painel-atividade";
  var MSG_PARADO = "Por segurança, o painel saiu depois de 30 minutos sem uso. Entre de novo.";
  var ultimaAtividade = 0, ultimaGravacao = 0, painelAberto = false;
  function marcarAtividade() {
    ultimaAtividade = ultimaGravacao = Date.now();
    try { localStorage.setItem(CHAVE_ATIVIDADE, String(ultimaAtividade)); } catch (e) {}
  }
  function paradoDemais() {
    var t = ultimaAtividade;
    try { t = Math.max(t, Number(localStorage.getItem(CHAVE_ATIVIDADE)) || 0); } catch (e) {}   // vale a aba usada por último
    return Date.now() - t > LIMITE_PARADO;
  }
  // Encerra só a sessão deste aparelho e limpa a tela (recarregar apaga tudo que estava carregado).
  async function sairPorInatividade() {
    if (!painelAberto) return;
    painelAberto = false; telas("login");
    await encerrarSessao("local");
    try { sessionStorage.setItem("fm-painel-parado", "1"); } catch (e) {}
    location.reload();
  }
  function conferirSessao() {
    if (!painelAberto) return false;
    if (paradoDemais()) { sairPorInatividade(); return true; }
    return false;
  }
  ["pointerdown", "keydown", "input", "change", "submit"].forEach(function (ev) {
    document.addEventListener(ev, function (e) {
      if (!painelAberto) return;
      if (conferirSessao()) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      if (Date.now() - ultimaGravacao > 5000) marcarAtividade();
    }, true);
  });
  setInterval(conferirSessao, 20000);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) conferirSessao(); });

  // Link de recuperação de senha ou de convite: o Supabase devolve o usuário aqui com type=recovery|invite no endereço.
  // Só digitar "#type=recovery" no endereço não abre a tela: precisa do código que vem no link do e-mail.
  var modoSenha = /^(recovery|invite)$/.test(LINK.get("type") || "") && !!LINK.get("access_token");
  // Link inválido: o Supabase devolve error_code (ex.: otp_expired = expirado, já usado ou substituído por um e-mail mais novo).
  var erroLink = LINK.get("error_code") || LINK.get("error");
  if (erroLink) {
    modoSenha = false;
    history.replaceState(null, "", location.pathname);
    setTimeout(function () {
      msg($("msg-login"), "err", /expired|otp|access_denied/i.test(erroLink + " " + (LINK.get("error_description") || ""))
        ? "Este link de recuperação expirou, já foi usado ou foi substituído por um e-mail mais novo. Peça um novo em “Esqueci a senha” e abra só o e-mail MAIS RECENTE, uma vez."
        : "O link do e-mail não pôde ser usado. Peça um novo em “Esqueci a senha”.");
    }, 0);
  }

  sb.auth.onAuthStateChange(function (ev) {
    if (ev === "PASSWORD_RECOVERY") { modoSenha = true; setTimeout(abrirTrocaDeSenha, 0); }
  });

  async function iniciar() {
    try {
      var s = await sb.auth.getSession();
      var user = s.data && s.data.session && s.data.session.user;
      if (modoSenha && user) return await abrirTrocaDeSenha();
      if (!user) { mostrarLogin(); avisarSaidaPorInatividade(); return; }
      if (paradoDemais()) {
        await encerrarSessao("local");
        mostrarLogin(); return msg($("msg-login"), "ok", MSG_PARADO);
      }
      var adm = await ehAdmin(user);
      if (adm === true) await passarPelaSegundaEtapa(mostrarPainel);
      else if (adm === null) { mostrarLogin(); msg($("msg-login"), "err", "Não foi possível confirmar seu acesso agora (sem conexão?). Tente de novo em instantes."); }
      else { await encerrarSessao("local"); mostrarLogin(); }
    } catch (e) { mostrarLogin(); msg($("msg-login"), "err", erroTxt(e, "Não foi possível iniciar o painel. Recarregue a página.")); }
  }
  function avisarSaidaPorInatividade() {
    try {
      if (!sessionStorage.getItem("fm-painel-parado")) return;
      sessionStorage.removeItem("fm-painel-parado");
      msg($("msg-login"), "ok", MSG_PARADO);
    } catch (e) {}
  }
  function telas(qual) {
    if (qual !== "painel") limparSegundaEtapa();                   // a chave do autenticador não fica na tela
    $("tela-login").style.display = qual === "login" ? "block" : "none";
    $("tela-codigo").style.display = qual === "codigo" ? "block" : "none";
    $("tela-senha").style.display = qual === "senha" ? "block" : "none";
    $("tela-painel").style.display = qual === "painel" ? "block" : "none";
    $("btn-sair").style.display = qual === "painel" ? "inline-block" : "none";
  }
  function mostrarLogin() { telas("login"); }
  function mostrarSenha() { telas("senha"); }
  function mostrarPainel() {
    marcarAtividade(); painelAberto = true;
    telas("painel");
    msg($("msg-2fa"), "", "");
    carregarPosts(); carregarTextos(); carregarApps(); carregarSegundaEtapa();
  }

  // ---------- segunda etapa: código do aplicativo autenticador ----------
  // A trava de verdade fica no banco (com um autenticador ativo, o banco só aceita a conta depois do código).
  // O painel pede o código na hora certa e nunca abre se não conseguir conferir.
  var fatorPendente = null, depoisDoCodigo = null, abrindoSenha = false;

  // { falta: id } = há um autenticador e esta sessão ainda não passou por ele; { falta: null } = pode seguir; { erro } = não deu para conferir.
  async function conferirSegundaEtapa() {
    try {
      var f = await sb.auth.mfa.listFactors();                     // pergunta ao servidor, não confia no que está guardado
      if (f.error) return { erro: f.error };
      var ativo = ((f.data && f.data.totp) || [])[0];
      if (!ativo) return { falta: null };
      var n = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (n.error) return { erro: n.error };
      return { falta: n.data && n.data.currentLevel === "aal2" ? null : ativo.id };
    } catch (e) { return { erro: e }; }
  }
  // Só segue para o destino (painel ou troca de senha) depois que a segunda etapa estiver resolvida.
  async function passarPelaSegundaEtapa(destino) {
    var s = await conferirSegundaEtapa();
    if (s.erro) {
      var st = Number(s.erro.status);
      if (st === 401 || st === 403) { await encerrarSessao("local"); mostrarLogin(); return msg($("msg-login"), "err", "Sua sessão não vale mais. Entre de novo."); }
      mostrarLogin();
      return msg($("msg-login"), "err", erroTxt(s.erro, "Não foi possível conferir a segunda etapa agora. Recarregue a página e tente de novo."));
    }
    if (!s.falta) return destino();
    fatorPendente = s.falta; depoisDoCodigo = destino;
    marcarAtividade();                   // se o celular recarregar a página enquanto ele busca o código, volta para esta tela
    mostrarCodigo();
  }
  async function abrirTrocaDeSenha() {
    if (abrindoSenha) return;
    abrindoSenha = true;
    try { await passarPelaSegundaEtapa(mostrarSenha); } finally { abrindoSenha = false; }
  }
  function mostrarCodigo() {
    var jaAberta = $("tela-codigo").style.display === "block";
    telas("codigo");
    if (!jaAberta) { $("codigo").value = ""; msg($("msg-codigo"), "", ""); try { $("codigo").focus(); } catch (e) {} }
  }
  // Aceita "123456" ou "123 456". Devolve "" se não forem exatamente 6 números.
  function lerCodigo(id) { var v = $(id).value.replace(/\s/g, ""); return /^\d{6}$/.test(v) ? v : ""; }
  function erroCodigo(err) {
    var t = String((err && err.message) || ""), st = Number(err && err.status);
    if (st === 429 || /rate limit|too many/i.test(t)) return "Muitas tentativas seguidas. Aguarde um minuto e tente de novo.";
    if (/invalid totp|verification failed/i.test(t)) return "Código incorreto ou vencido. Digite o código que está aparecendo agora no autenticador. Se continuar, confira se a hora do celular está no automático.";
    if (/factor.*not found|not found.*factor/i.test(t)) return "Esse autenticador não vale mais. Recarregue a página e comece de novo.";
    return erroTxt(err, "Não foi possível conferir o código. Tente de novo com o código atual.");
  }

  $("form-codigo").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-codigo"), c = lerCodigo("codigo");
    if (!c) return msg(m, "err", "Digite os 6 números do código.");
    if (!fatorPendente) return;
    if (paradoDemais()) {                                          // a senha foi digitada há mais de 30 minutos: começa de novo
      fatorPendente = null; depoisDoCodigo = null; modoSenha = false;
      await encerrarSessao("local"); mostrarLogin();
      return msg($("msg-login"), "ok", "Por segurança, passaram mais de 30 minutos. Entre de novo.");
    }
    await ocupado(this, async function () {
      msg(m, "ok", "Conferindo…");
      try {
        var r = await sb.auth.mfa.challengeAndVerify({ factorId: fatorPendente, code: c });
        if (r.error) { $("codigo").value = ""; return msg(m, "err", erroCodigo(r.error)); }
        var destino = depoisDoCodigo;
        if (!destino) return;                                      // desistiu (voltou ao login) enquanto conferia
        fatorPendente = null; depoisDoCodigo = null;
        $("codigo").value = ""; msg(m, "", "");
        destino();
      } catch (er) { msg(m, "err", erroCodigo(er)); }
    });
  });
  $("codigo-voltar").addEventListener("click", async function (e) {
    e.preventDefault();
    fatorPendente = null; depoisDoCodigo = null; modoSenha = false;
    $("codigo").value = ""; msg($("msg-codigo"), "", ""); msg($("msg-login"), "", "");
    await encerrarSessao("local");
    mostrarLogin();
  });

  // ---------- segunda etapa: ligar e desligar (aba Conta) ----------
  var matricula = null, fatorAtivo = null, vez2fa = 0, mexendo2fa = false;
  function limparSegundaEtapa() {
    matricula = null; vez2fa++;
    $("chave-2fa").value = ""; $("qr-2fa").removeAttribute("src"); $("detalhes-qr").open = false;
    $("codigo-ativar").value = ""; $("codigo-desativar").value = ""; $("dica-2fa-copiar").textContent = "";
    msg($("msg-2fa-ativar"), "", ""); msg($("msg-2fa-desativar"), "", "");
    $("area-2fa-ativar").hidden = true; $("form-2fa-desativar").hidden = true;
  }
  async function carregarSegundaEtapa() {
    if (matricula) return;                                         // não interrompe uma ativação em andamento
    var vez = ++vez2fa;
    $("btn-2fa-ativar").hidden = true; $("btn-2fa-desativar").hidden = true; $("btn-2fa-recarregar").hidden = true;
    $("form-2fa-desativar").hidden = true;
    $("situacao-2fa").textContent = "Conferindo…";
    var r;
    try { r = await sb.auth.mfa.listFactors(); } catch (e) { r = { error: e }; }
    if (vez !== vez2fa) return;                                    // chegou uma resposta velha
    if (r.error) {
      $("situacao-2fa").textContent = erroTxt(r.error, "Não foi possível conferir agora.");
      $("btn-2fa-recarregar").hidden = false;
      return;
    }
    var ativo = ((r.data && r.data.totp) || [])[0];
    fatorAtivo = ativo ? ativo.id : null;
    $("situacao-2fa").textContent = ativo ? "✅ ATIVADA: o painel pede o código do autenticador a cada login." : "⚠️ DESATIVADA: hoje o painel pede só e-mail e senha.";
    $("btn-2fa-ativar").hidden = !!ativo;
    $("btn-2fa-desativar").hidden = !ativo;
  }
  // O servidor manda o QR como desenho (SVG); codifica para o navegador mostrar sem erro.
  function enderecoQr(v) {
    v = String(v || "");
    var i = v.indexOf(",");
    if (v.indexOf("data:image/svg+xml") !== 0 || i < 0) return "";
    var desenho = v.slice(i + 1);
    return desenho.charAt(0) === "<" ? "data:image/svg+xml;charset=utf-8," + encodeURIComponent(desenho) : v;
  }

  $("btn-2fa-recarregar").addEventListener("click", function () { carregarSegundaEtapa(); });

  $("btn-2fa-ativar").addEventListener("click", async function () {
    if (mexendo2fa) return;
    var botao = this, m = $("msg-2fa");
    mexendo2fa = true; botao.disabled = true;
    msg(m, "ok", "Preparando…");
    try {
      var f = await sb.auth.mfa.listFactors();
      if (f.error) return msg(m, "err", erroTxt(f.error, "Não foi possível ativar agora."));
      if (f.data.totp.length) { msg(m, "ok", "A segunda etapa já está ativada."); return carregarSegundaEtapa(); }
      // apaga ativações que ficaram pela metade (não valem para nada e atrapalham a nova)
      var sobras = (f.data.all || []).filter(function (x) { return x.factor_type === "totp" && x.status !== "verified"; });
      for (var i = 0; i < sobras.length; i++) await sb.auth.mfa.unenroll({ factorId: sobras[i].id });
      var r = await sb.auth.mfa.enroll({ factorType: "totp", issuer: "Fortaleza Move", friendlyName: "Painel " + new Date().toISOString() });
      if (r.error) return msg(m, "err", erroTxt(r.error, "Não foi possível ativar agora. Tente de novo em instantes."));
      if (!painelAberto) return;                                   // saiu do painel enquanto preparava
      matricula = r.data.id; vez2fa++;
      $("chave-2fa").value = r.data.totp.secret;
      $("qr-2fa").src = enderecoQr(r.data.totp.qr_code);
      $("btn-2fa-ativar").hidden = true;
      $("area-2fa-ativar").hidden = false;
      $("situacao-2fa").textContent = "Ativação em andamento: só vale depois de confirmar o código.";
      msg(m, "", "");
    } catch (e) { msg(m, "err", erroTxt(e, "Não foi possível ativar agora.")); }
    finally { mexendo2fa = false; botao.disabled = false; }
  });

  $("btn-2fa-copiar").addEventListener("click", async function () {
    var campo = $("chave-2fa"), copiou = false;
    try { await navigator.clipboard.writeText(campo.value); copiou = true; }
    catch (e) { try { campo.focus(); campo.select(); copiou = document.execCommand("copy"); } catch (e2) {} }
    $("dica-2fa-copiar").textContent = copiou ? "Copiada." : "Não consegui copiar. Toque e segure na chave para copiar.";
  });

  $("btn-2fa-cancelar").addEventListener("click", async function () {
    var id = matricula;
    limparSegundaEtapa(); msg($("msg-2fa"), "", "");
    if (id) { try { await sb.auth.mfa.unenroll({ factorId: id }); } catch (e) {} }
    carregarSegundaEtapa();
  });

  $("form-2fa-ativar").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-2fa-ativar"), c = lerCodigo("codigo-ativar");
    if (!c) return msg(m, "err", "Digite os 6 números do código.");
    if (!matricula) return;
    await ocupado(this, async function () {
      var cancelar = $("btn-2fa-cancelar");
      cancelar.disabled = true;                                    // evita cancelar no meio da confirmação
      msg(m, "ok", "Conferindo…");
      try {
        var r = await sb.auth.mfa.challengeAndVerify({ factorId: matricula, code: c });
        if (r.error) { $("codigo-ativar").value = ""; return msg(m, "err", erroCodigo(r.error)); }
        limparSegundaEtapa();
        await carregarSegundaEtapa();
        msg($("msg-2fa"), "ok", "Pronto! A segunda etapa está ativada. A partir de agora o painel pede o código a cada login, e os outros aparelhos que estavam no painel foram desconectados.");
      } catch (er) { msg(m, "err", erroCodigo(er)); }
      finally { cancelar.disabled = false; }
    });
  });

  $("btn-2fa-desativar").addEventListener("click", function () {
    msg($("msg-2fa"), "", ""); msg($("msg-2fa-desativar"), "", "");
    this.hidden = true; $("form-2fa-desativar").hidden = false;
  });
  $("btn-2fa-manter").addEventListener("click", function () {
    $("codigo-desativar").value = ""; $("form-2fa-desativar").hidden = true; $("btn-2fa-desativar").hidden = false;
  });
  $("form-2fa-desativar").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-2fa-desativar"), c = lerCodigo("codigo-desativar");
    if (!c) return msg(m, "err", "Digite os 6 números do código.");
    if (!fatorAtivo) return;
    await ocupado(this, async function () {
      msg(m, "ok", "Conferindo…");
      try {
        var v = await sb.auth.mfa.challengeAndVerify({ factorId: fatorAtivo, code: c });
        if (v.error) { $("codigo-desativar").value = ""; return msg(m, "err", erroCodigo(v.error)); }
        var r = await sb.auth.mfa.unenroll({ factorId: fatorAtivo });
        if (r.error) return msg(m, "err", erroTxt(r.error, "O código conferiu, mas não consegui desativar. A segunda etapa continua ativada. Tente de novo."));
        $("codigo-desativar").value = ""; msg(m, "", "");
        try { await sb.auth.refreshSession(); } catch (er) {}
        await carregarSegundaEtapa();
        msg($("msg-2fa"), "ok", "Segunda etapa desativada. O painel voltou a pedir só e-mail e senha. No autenticador, apague a entrada antiga.");
      } catch (er) { msg(m, "err", erroTxt(er, "Não foi possível desativar. Confira a conexão e tente de novo.")); }
    });
  });

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
        if (adm === true) await passarPelaSegundaEtapa(mostrarPainel);
        else if (adm === null) { mostrarLogin(); msg($("msg-login"), "ok", "Senha salva. Entre com a nova senha."); }
        else { await encerrarSessao("local"); mostrarLogin(); msg($("msg-login"), "err", "Esta conta não tem acesso ao painel."); }
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
        if (!adm) { await encerrarSessao("local"); return msg($("msg-login"), "err", "Esta conta não tem acesso ao painel."); }
        $("senha").value = "";
        msg($("msg-login"), "", "");
        await passarPelaSegundaEtapa(mostrarPainel);
      } catch (e) { msg($("msg-login"), "err", erroTxt(e, "Não foi possível entrar agora. Tente de novo.")); }
    });
  });

  // Um pedido por vez e espera de 60 s: cada novo e-mail invalida o link do anterior.
  var enviandoRec = false, esperaRec = 0;
  $("esqueci").addEventListener("click", async function (e) {
    e.preventDefault();
    if (enviandoRec) return;
    if (Date.now() < esperaRec) return msg($("msg-login"), "ok", "Já enviamos um link. Aguarde " + Math.ceil((esperaRec - Date.now()) / 1000) + " s para pedir outro (cada novo e-mail cancela o anterior).");
    var em = $("email").value.trim();
    if (!em) return msg($("msg-login"), "err", "Digite seu e-mail acima e toque de novo em “Esqueci a senha”.");
    enviandoRec = true; msg($("msg-login"), "ok", "Enviando…");
    try {
      var r = await sb.auth.resetPasswordForEmail(em, { redirectTo: location.origin + location.pathname });
      if (r.error) {
        var lim = Number(r.error.status) === 429 || /rate limit/i.test(r.error.message || "");
        msg($("msg-login"), "err", lim ? "Limite de e-mails atingido (o envio gratuito do Supabase permite poucos por hora). Use o último e-mail que chegou ou tente de novo em cerca de 1 hora."
          : erroTxt(r.error, "Não foi possível enviar agora. Tente mais tarde."));
      } else {
        esperaRec = Date.now() + 60000;
        msg($("msg-login"), "ok", "Pronto. Se o e-mail estiver cadastrado, o link chega em instantes (veja também Spam). Abra só o e-mail mais recente.");
      }
    } catch (er) { msg($("msg-login"), "err", erroTxt(er, "Não foi possível enviar agora. Tente mais tarde.")); }
    finally { enviandoRec = false; }
  });

  $("btn-sair").addEventListener("click", async function () {
    painelAberto = false;
    await encerrarSessao("global");
    mostrarLogin();
  });

  document.querySelectorAll(".tabs button").forEach(function (b) {
    b.addEventListener("click", function () {
      document.querySelectorAll(".tabs button").forEach(function (x) { x.classList.remove("on"); });
      b.classList.add("on");
      $("tab-posts").style.display = b.dataset.tab === "posts" ? "block" : "none";
      $("tab-textos").style.display = b.dataset.tab === "textos" ? "block" : "none";
      $("tab-apps").style.display = b.dataset.tab === "apps" ? "block" : "none";
      if (b.dataset.tab === "apps" && !appsOk) carregarApps();           // só recarrega se a primeira carga falhou
      $("tab-conta").style.display = b.dataset.tab === "conta" ? "block" : "none";
      if (b.dataset.tab === "textos" && !textosOk) carregarTextos();
      if (b.dataset.tab === "conta") carregarSegundaEtapa();
    });
  });

  // Confere a senha atual numa conexão separada e descartável: a sessão do painel (que já passou pela segunda etapa) continua a mesma.
  async function conferirSenhaAtual(email, senha) {
    var teste = window.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: "fm-conferencia-de-senha" }
    });
    var r = await teste.auth.signInWithPassword({ email: email, password: senha });
    if (r.error) return r.error;
    try { await teste.auth.signOut({ scope: "local" }); } catch (e) {}
    return null;
  }

  $("form-conta").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-conta");
    var atual = $("c-atual").value, a = $("c-nova1").value, b = $("c-nova2").value;
    if (!atual) return msg(m, "err", "Digite a senha atual.");
    if (a.length < 10) return msg(m, "err", "Use pelo menos 10 caracteres.");
    if (a !== b) return msg(m, "err", "As duas senhas não são iguais.");
    await ocupado(this, async function () {
      try {
        var s = await sb.auth.getSession();
        var email = s.data && s.data.session && s.data.session.user && s.data.session.user.email;
        if (!email) return msg(m, "err", "Sua sessão expirou. Toque em Sair, entre de novo e repita a ação.");
        var recusa = await conferirSenhaAtual(email, atual);
        if (recusa) return msg(m, "err", Number(recusa.status) === 429 ? "Muitas tentativas seguidas. Aguarde um minuto. A senha NÃO foi trocada." : erroTxt(recusa, "A senha atual não confere. A senha NÃO foi trocada."));
        var r = await sb.auth.updateUser({ password: a });
        if (r.error) return msg(m, "err", erroTxt(r.error, "Não foi possível trocar a senha. Saia, entre de novo e tente outra vez."));
        $("c-atual").value = ""; $("c-nova1").value = ""; $("c-nova2").value = "";
        var outros = await sb.auth.signOut({ scope: "others" });
        msg(m, "ok", outros && outros.error ? "Senha trocada. Não consegui desconectar os outros aparelhos agora." : "Senha trocada. Os outros aparelhos que estavam no painel foram desconectados.");
      } catch (e) { msg(m, "err", erroTxt(e, "Não foi possível trocar a senha.")); }
    });
  });

  // ---------- fotos: limpa e reduz antes de enviar ----------
  // Toda foto é redesenhada antes do envio, mesmo a pequena: assim saem os dados escondidos no arquivo
  // (local do GPS, modelo do celular, data). Reduz para no máximo 1200 px no lado maior, sem cortar.
  // Usa WebP quando o aparelho suporta; sem WebP (ex.: iPhone), usa JPEG, ou PNG quando há transparência.
  // Se o aparelho não conseguir abrir a imagem, nada é enviado.
  function temTransparencia(ctx, w, h) {
    try {
      var d = ctx.getImageData(0, 0, w, h).data;
      for (var i = 3; i < d.length; i += 4) if (d[i] < 250) return true;
      return false;
    } catch (e) { return true; }                                 // na dúvida, trata como transparente (não estraga a imagem)
  }
  function otimizarFoto(f) {
    return new Promise(function (ok) {
      var url = URL.createObjectURL(f), im = new Image();
      im.onerror = function () { URL.revokeObjectURL(url); ok(null); };
      im.onload = function () {
        try {
          var max = 1200, w = im.naturalWidth, h = im.naturalHeight, k = Math.min(1, max / Math.max(w, h));
          var cv = document.createElement("canvas"); cv.width = Math.max(1, Math.round(w * k)); cv.height = Math.max(1, Math.round(h * k));
          var ctx = cv.getContext("2d");
          ctx.drawImage(im, 0, 0, cv.width, cv.height);
          URL.revokeObjectURL(url);
          cv.toBlob(function (b) {
            if (b && b.type === "image/webp") return ok(b);
            if (f.type !== "image/jpeg" && temTransparencia(ctx, cv.width, cv.height)) return cv.toBlob(ok, "image/png");
            cv.toBlob(ok, "image/jpeg", 0.85);
          }, "image/webp", 0.85);
        } catch (e) { ok(null); }
      };
      im.src = url;
    });
  }
  // Valida, limpa e envia uma foto para a pasta indicada. Devolve { url } ou { erro }.
  async function enviarFoto(arquivo, pasta, avisar) {
    if (!/^image\/(jpeg|png|webp)$/.test(arquivo.type)) return { erro: "Use imagem JPG, PNG ou WebP." };
    if (arquivo.size > 25 * 1024 * 1024) return { erro: "A imagem é grande demais." };
    avisar("Preparando a foto…");
    var f = await otimizarFoto(arquivo);
    if (!f) return { erro: "Não consegui abrir essa imagem." };
    if (f.size > 5 * 1024 * 1024) return { erro: "A imagem passa de 5 MB." };
    var ext = ({ "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" })[f.type];
    avisar("Enviando a foto…");
    var path = pasta + "/" + Date.now() + "-" + Math.random().toString(36).slice(2, 8) + "." + ext;
    var up = await sb.storage.from(C.BUCKET).upload(path, f, { contentType: f.type, upsert: false, cacheControl: "31536000" });
    if (up.error) return { erro: erroTxt(up.error, "Não foi possível enviar a foto.") };
    return { url: sb.storage.from(C.BUCKET).getPublicUrl(path).data.publicUrl };
  }

  // ---------- fotos: lixeira recuperável ----------
  // Foto trocada, removida ou de publicação apagada NÃO é apagada: vai para "lixeira/AAAA-MM-DD/" no mesmo depósito
  // (pode ser recuperada pelo Supabase > Storage). Só move se nenhuma outra publicação usa a mesma foto.
  var PREFIXO_FOTO = C.SUPABASE_URL.replace(/\/$/, "") + "/storage/v1/object/public/" + C.BUCKET + "/";
  async function moverParaLixeira(url, ignorarId) {
    try {
      if (!url || url.indexOf(PREFIXO_FOTO) !== 0) return true;
      var caminho = decodeURIComponent(url.slice(PREFIXO_FOTO.length).split("?")[0]);
      if (!/^(posts|apps)\/[^/]+$/.test(caminho)) return true;
      var r = await sb.from("site_posts").select("id").eq("imagem_url", url);
      if (r.error) return false;                                   // sem confirmar as referências, não mexe
      if ((r.data || []).some(function (x) { return x.id !== ignorarId; })) return true;   // ainda em uso
      var t = await sb.from("site_settings").select("chave").eq("valor", url);
      if (t.error) return false;
      if ((t.data || []).length) return true;                      // em uso num cartão de aplicativo
      var m = await sb.storage.from(C.BUCKET).move(caminho, "lixeira/" + new Date().toISOString().slice(0, 10) + "/" + caminho.split("/")[1]);
      return !m.error;
    } catch (e) { return false; }
  }
  function avisoLixeira(ok) {
    if (ok) return;
    var ml = $("msg-lista");
    ml.insertAdjacentHTML("beforeend", '<div class="msg err" role="status">A foto antiga não pôde ir para a lixeira; ela continua guardada no depósito.</div>');
  }

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
    $("foto-acoes").style.display = imagemAtual ? "flex" : "none"; $("foto-dica").textContent = "";
    msg($("msg-post"), "", "");
    $("editor").style.display = "block";
    $("editor").scrollIntoView({ behavior: "smooth" });
  }
  $("btn-nova").addEventListener("click", function () { abrirEditor(null); });
  $("btn-remover-foto").addEventListener("click", function () {
    imagemAtual = null; $("p-img").value = "";
    $("p-preview").style.display = "none";
    $("foto-dica").textContent = "A foto sai da publicação quando você tocar em Salvar.";
    this.style.display = "none";
  });
  $("p-img").addEventListener("change", function () {
    var f = this.files[0], pv = $("p-preview");
    if (!f || !/^image\/(jpeg|png|webp)$/.test(f.type)) return;
    try { pv.src = URL.createObjectURL(f); pv.style.display = "block"; } catch (e) {}
  });
  $("btn-cancelar").addEventListener("click", function () { $("editor").style.display = "none"; });

  async function apagar(id) {
    if (!confirm("Apagar esta publicação? Ela sai do site e não dá para desfazer. A foto, se houver, vai para a lixeira do depósito.")) return;
    var alvo = posts.find(function (x) { return x.id === id; }) || {};
    var ml = $("msg-lista");
    try {
      var r = await sb.from("site_posts").delete().eq("id", id).select("id");
      if (r.error) return msg(ml, "err", erroTxt(r.error, "Não foi possível apagar. A publicação continua no ar."));
      if (!r.data || !r.data.length) return msg(ml, "err", "Não foi possível apagar (sem permissão ou já removida). Recarregue a lista.");
      msg(ml, "ok", "Publicação apagada.");
    } catch (e) { return msg(ml, "err", erroTxt(e, "Não foi possível apagar.")); }
    if (alvo.imagem_url) avisoLixeira(await moverParaLixeira(alvo.imagem_url, id));
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
        var url = imagemAtual, enviada = null;
        var anterior = editandoId ? ((posts.find(function (x) { return x.id === editandoId; }) || {}).imagem_url || null) : null;
        var f = $("p-img").files[0];
        if (f) {
          var envio = await enviarFoto(f, "posts", function (t) { msg(m, "ok", t); });
          if (envio.erro) return msg(m, "err", envio.erro + " A publicação NÃO foi salva.");
          url = enviada = envio.url;
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
        var falha = r.error ? erroTxt(r.error, "Não foi possível salvar a publicação.") : (!r.data || !r.data.length) ? "A publicação não foi salva (sem permissão). Saia e entre de novo." : null;
        if (falha) { if (enviada) moverParaLixeira(enviada, null); return msg(m, "err", falha); }
        $("editor").style.display = "none";
        msg($("msg-lista"), "ok", dados.publicado ? "Publicação salva e no ar." : "Rascunho salvo (não aparece no site).");
        if (anterior && anterior !== url) avisoLixeira(await moverParaLixeira(anterior, editandoId));
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

  // ---------- aplicativos ----------
  var APPS = Object.keys(C.APPS);                                   // passageiro, motorista
  var NOMES = { passageiro: "Passageiro", motorista: "Motorista" };
  var CAMPOS = { apps_titulo: "a-titulo", apps_texto: "a-apresentacao" };
  APPS.forEach(function (k) {
    CAMPOS["app_" + k + "_texto"] = "a-" + k + "-texto";
    CAMPOS["app_" + k + "_link"] = "a-" + k + "-link";
  });
  var appsOk = false, carregandoApps = false;
  var fotoSalva = {}, fotoAtual = {};                               // endereço no banco / o que ficará ao salvar
  var previas = {};

  function pintarFotoApp(k, endereco) {
    var pv = $("a-" + k + "-preview");
    if (endereco) { pv.src = endereco; pv.hidden = false; } else { pv.removeAttribute("src"); pv.hidden = true; }
    $("a-" + k + "-remover").hidden = !endereco;
  }
  function soltarPrevia(k) { if (previas[k]) { URL.revokeObjectURL(previas[k]); previas[k] = null; } }

  APPS.forEach(function (k) {
    $("a-" + k + "-foto").addEventListener("change", function () {
      var f = this.files[0];
      soltarPrevia(k); $("a-" + k + "-dica").textContent = "";
      if (!f) return pintarFotoApp(k, fotoAtual[k]);
      if (!/^image\/(jpeg|png|webp)$/.test(f.type)) { this.value = ""; $("a-" + k + "-dica").textContent = "Use imagem JPG, PNG ou WebP."; return pintarFotoApp(k, fotoAtual[k]); }
      previas[k] = URL.createObjectURL(f);
      pintarFotoApp(k, previas[k]);
      $("a-" + k + "-dica").textContent = "A foto nova vai para o site quando você tocar em “Salvar aplicativos”.";
    });
    $("a-" + k + "-remover").addEventListener("click", function () {
      soltarPrevia(k); fotoAtual[k] = ""; $("a-" + k + "-foto").value = "";
      pintarFotoApp(k, "");
      $("a-" + k + "-dica").textContent = "A foto sai do site quando você tocar em “Salvar aplicativos”.";
    });
  });

  async function carregarApps() {
    if (carregandoApps) return;
    carregandoApps = true;
    var m = $("msg-apps"), btn = $("form-apps").querySelector("button[type=submit]");
    appsOk = false; btn.disabled = true;
    var r;
    try { r = await sb.from("site_settings").select("chave,valor"); } catch (e) { r = { error: e }; }
    carregandoApps = false;
    if (r.error) return msg(m, "err", erroTxt(r.error, "Não foi possível carregar os dados atuais.") + " O botão Salvar fica bloqueado. Abra esta aba de novo para tentar outra vez.");
    var salvo = {};
    (r.data || []).forEach(function (x) { salvo[x.chave] = x.valor; });
    Object.keys(CAMPOS).forEach(function (k) { $(CAMPOS[k]).value = salvo[k] != null ? salvo[k] : C.DEFAULTS[k] || ""; });
    APPS.forEach(function (k) {
      fotoSalva[k] = fotoAtual[k] = C.fotoOficial(salvo["app_" + k + "_foto"]);
      soltarPrevia(k); $("a-" + k + "-foto").value = ""; $("a-" + k + "-dica").textContent = "";
      pintarFotoApp(k, fotoAtual[k]);
    });
    appsOk = true; btn.disabled = false; msg(m, "", "");
  }

  $("form-apps").addEventListener("submit", async function (e) {
    e.preventDefault();
    var m = $("msg-apps");
    if (!appsOk) return msg(m, "err", "Os dados atuais não foram carregados. Abra a aba de novo antes de salvar.");
    // 1) confere os links antes de enviar qualquer coisa
    var links = {};
    for (var i = 0; i < APPS.length; i++) {
      var k = APPS[i], digitado = $("a-" + k + "-link").value.trim();
      links[k] = digitado ? C.linkOficial(k, digitado) : "";
      if (digitado && !links[k]) return msg(m, "err", "O link do App do " + NOMES[k] + " não é o do aplicativo oficial. Na Google Play, abra o app, toque em Compartilhar e cole o link aqui. Ele precisa conter: id=" + C.APPS[k] + ". Nada foi salvo.");
    }
    await ocupado(this, async function () {
      var enviadas = [];
      async function descartarEnviadas() { for (var j = 0; j < enviadas.length; j++) await moverParaLixeira(enviadas[j], null); }
      try {
        // 2) envia as fotos novas
        var fotos = {};
        for (var i = 0; i < APPS.length; i++) {
          var k = APPS[i], arquivo = $("a-" + k + "-foto").files[0];
          fotos[k] = fotoAtual[k] || "";
          if (!arquivo) continue;
          var envio = await enviarFoto(arquivo, "apps", function (t) { msg(m, "ok", t); });
          if (envio.erro) { await descartarEnviadas(); return msg(m, "err", "App do " + NOMES[k] + ": " + envio.erro + " Nada foi salvo."); }
          fotos[k] = envio.url; enviadas.push(envio.url);
        }
        // 3) grava tudo de uma vez
        APPS.forEach(function (k) { $("a-" + k + "-link").value = links[k]; });
        var agora = new Date().toISOString();
        var linhas = Object.keys(CAMPOS).map(function (c) { return { chave: c, valor: $(CAMPOS[c]).value.trim(), atualizado_em: agora }; })
          .concat(APPS.map(function (k) { return { chave: "app_" + k + "_foto", valor: fotos[k], atualizado_em: agora }; }));
        msg(m, "ok", "Salvando…");
        var r = await sb.from("site_settings").upsert(linhas, { onConflict: "chave" }).select("chave");
        if (r.error) { await descartarEnviadas(); return msg(m, "err", erroTxt(r.error, "Não foi possível salvar. Nada mudou no site.")); }
        if (!r.data || r.data.length < linhas.length) { await descartarEnviadas(); return msg(m, "err", "Não foi salvo (sem permissão). Saia e entre de novo."); }
        // 4) fotos substituídas ou removidas vão para a lixeira
        var antigas = APPS.map(function (k) { return fotoSalva[k] && fotoSalva[k] !== fotos[k] ? fotoSalva[k] : null; }).filter(Boolean);
        APPS.forEach(function (k) {
          fotoSalva[k] = fotoAtual[k] = fotos[k];
          soltarPrevia(k); $("a-" + k + "-foto").value = ""; $("a-" + k + "-dica").textContent = "";
          pintarFotoApp(k, fotos[k]);
        });
        var limpou = true;
        for (var j = 0; j < antigas.length; j++) limpou = (await moverParaLixeira(antigas[j], null)) && limpou;
        msg(m, "ok", "Salvo. O site já mostra a mudança." + (limpou ? "" : " A foto antiga continua guardada no depósito."));
      } catch (e) { await descartarEnviadas(); msg(m, "err", erroTxt(e, "Não foi possível salvar.")); }
    });
  });

  iniciar();
})();
