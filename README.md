# Fortaleza Move — site

Site institucional da Fortaleza Move (corridas de carro, mototáxi e encomendas), publicado em
https://move.fortalezadigitalsecurity.com.br pelo GitHub Pages.

- Páginas públicas: `index.html`, `passageiro.html`, `motorista.html`, `comercio.html`, `novidades.html`, `404.html`.
- Painel administrativo: `admin.html` + `admin.js` (sem link nas páginas públicas).
- Dois aplicativos instaláveis (PWA): `manifest.webmanifest` (site) e `admin.webmanifest` (painel); `sw.js` é o service worker.
- Conteúdo dinâmico (novidades, textos, cidades, fotos) vem do Supabase. `config.js` contém só a chave **pública** (anon); as permissões são garantidas por RLS no banco.
- Ao mudar arquivos, aumente a versão `VERSAO` em `sw.js`.
