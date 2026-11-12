// Service worker da Fortaleza Move.
// Estratégia: rede primeiro (o site sempre mostra a versão mais nova) e, sem internet, usa a cópia guardada.
// Não guarda nada do painel administrativo nem de outros domínios (Supabase).
var VERSAO = "fm-v10";
var BASICO = ["./", "index.html", "passageiro.html", "motorista.html", "comercio.html", "novidades.html",
  "404.html", "style.css", "site.js", "config.js", "logo.png", "icon-192.png"];

self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(VERSAO).then(function (c) { return c.addAll(BASICO); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (nomes) {
      return Promise.all(nomes.filter(function (n) { return n !== VERSAO; }).map(function (n) { return caches.delete(n); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== self.location.origin) return;                       // Supabase e CDN passam direto
  if (/\/admin(\.html|\.js)?$/.test(url.pathname)) return;               // painel nunca é guardado
  e.respondWith(
    caches.match(req).then(function (guardado) {
      // CSS, JS e imagens: sempre confere com o servidor (no-cache = revalida), para o app nunca ficar preso em versão antiga.
      var rede = (req.mode === "navigate" ? fetch(req) : fetch(req, { cache: "no-cache" })).then(function (res) {
        if (res && res.ok) { var copia = res.clone(); caches.open(VERSAO).then(function (c) { c.put(req, copia); }); }
        return res;
      });
      // Rede primeiro; com internet ruim (mais de 4 s) usa a cópia guardada em vez de travar.
      var limite = guardado ? new Promise(function (ok) { setTimeout(function () { ok(guardado); }, 4000); }) : null;
      return (limite ? Promise.race([rede, limite]) : rede).catch(function () {
        return guardado || (req.mode === "navigate" ? caches.match("index.html") : Response.error());
      });
    })
  );
});
