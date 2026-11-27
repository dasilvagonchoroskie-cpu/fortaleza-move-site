# Fortaleza Move — site

Site institucional da Fortaleza Move (corridas de carro, mototáxi e encomendas), publicado em
https://move.fortalezadigitalsecurity.com.br pelo GitHub Pages.

- Páginas públicas: `index.html`, `passageiro.html`, `motorista.html`, `comercio.html`, `novidades.html`, `404.html`.
- Painel administrativo: `admin.html` + `admin.js` (sem link nas páginas públicas).
- Dois aplicativos instaláveis (PWA): `manifest.webmanifest` (site) e `admin.webmanifest` (painel); `sw.js` é o service worker.
- Conteúdo dinâmico (novidades, textos, cidades, fotos) vem do Supabase. `config.js` contém só a chave **pública** (anon); as permissões são garantidas por RLS no banco.
- Ao mudar arquivos, aumente a versão `VERSAO` em `sw.js`.

## Aplicativos
A área "Baixe os aplicativos" (página inicial) é editada no painel, aba **Aplicativos**: textos, link e foto de cada app.
O site e o painel só aceitam o link da página do aplicativo oficial na Google Play (pacotes em `config.js`).

## Segurança
- As permissões de gravação são conferidas no banco (RLS); a chave em `config.js` é a pública.
- Todas as páginas têm Content-Security-Policy. **Não use `<script>` embutido nem `onclick=`/`onerror=` no HTML.**
  Ao trocar a versão do supabase-js, atualize o caminho na política e o `integrity` em todas as páginas.
- Painel: sai sozinho após 30 min sem uso, troca de senha pede a senha atual, não abre dentro de moldura.
- Verificação em duas etapas (TOTP do Supabase Auth), ligada e desligada no painel, aba **Conta**. Com um
  autenticador confirmado, o banco só aceita a conta depois do código: `site_is_admin()` chama
  `seguranca.segunda_etapa_ok()`, e essa trava vale para textos, publicações e fotos. A tela do painel é só a
  porta; **não troque a trava do banco por verificação no navegador**. Sem autenticador, o login continua só com senha.
- Autenticador perdido e sem a chave anotada: o responsável remove o fator do usuário direto no Supabase (Auth).
- Toda foto é redesenhada antes do envio (remove localização GPS e dados do aparelho).
