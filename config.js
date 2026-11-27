// Configuração pública do site (a chave "anon" é pública por padrão; a segurança fica nas regras RLS do banco).
window.MOV_CONFIG = {
  SUPABASE_URL: "https://dluphbekvokxdanrkmqx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsdXBoYmVrdm9reGRhbnJrbXF4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTE1NDcwMDQsImV4cCI6MjEwNzEyMzAwNH0.efXkFMdRZTffams6Y4Sh7AdfcRPCZBa0bRHpQ1Xt-eE",
  BUCKET: "site-fortaleza-move",
  // Aplicativos oficiais (nome do pacote na Google Play). Só o link destes pacotes é aceito.
  APPS: {
    passageiro: "br.com.fortalezadigitalsecurity.move.passageiro",
    motorista: "br.com.fortalezadigitalsecurity.move.motorista"
  },
  // Aceita o link copiado da loja (com ou sem "&hl=...") e devolve o endereço oficial limpo.
  // Outro site, outro aplicativo ou endereço adulterado devolve "".
  linkOficial: function (app, texto) {
    var pacote = this.APPS[app];
    try {
      var u = new URL(String(texto || "").trim());
      var ids = u.searchParams.getAll("id");
      if (!pacote || u.protocol !== "https:" || u.host !== "play.google.com" || u.username || u.password) return "";
      if (u.pathname !== "/store/apps/details" || ids.length !== 1 || ids[0] !== pacote) return "";
      return "https://play.google.com/store/apps/details?id=" + pacote;
    } catch (e) { return ""; }
  },
  // Foto de aplicativo só vale se estiver na pasta "apps/" do depósito do próprio site.
  fotoOficial: function (url) {
    var base = this.SUPABASE_URL + "/storage/v1/object/public/" + this.BUCKET + "/apps/";
    url = String(url || "");
    return url.indexOf(base) === 0 && /^[A-Za-z0-9._-]+\.(jpg|png|webp)$/.test(url.slice(base.length)) ? url : "";
  },
  // Textos padrão: usados enquanto o painel não tiver salvo nada.
  DEFAULTS: {
    hero_titulo: "Corridas e encomendas, do jeito da nossa cidade",
    hero_subtitulo: "Transporte de passageiros por aplicativo, mototáxi e entrega de encomendas por moto ou carro. Rápido, seguro e feito para quem mora aqui.",
    whatsapp: "5564996472794",
    aviso_topo: "",
    cidades: "",
    apps_titulo: "Baixe os aplicativos",
    apps_texto: "Baixe somente pelos botões oficiais desta página, direto da Google Play.",
    app_passageiro_texto: "Peça corridas e envie encomendas.",
    app_passageiro_link: "",
    app_passageiro_foto: "",
    app_motorista_texto: "Receba corridas e entregas.",
    app_motorista_link: "",
    app_motorista_foto: ""
  }
};
