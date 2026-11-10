# Ienvia Web — frontend em modernização

Frontend Next.js isolado em relação ao painel legado, dentro do repositório principal `zap-ia-studio`.

## Desenvolvimento

Requisitos: Node.js 20 ou superior.

```bash
cd web
cp .env.example .env.local
# Edite IENVIA_BACKEND_URL com a origem HTTPS real do backend Express
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Variável obrigatória

- `IENVIA_BACKEND_URL`: origem do backend Express. É exclusivamente server-side; não use prefixo `NEXT_PUBLIC_`. Não inclua caminho `/api`, credenciais, query ou fragmento. Em produção, somente HTTPS é aceito.

O frontend usa a rota same-origin `/api/backend/*` como BFF. Ela restringe origem, caminhos, métodos, cabeçalhos e timeout. O BFF limita request/response a 4.500.000 bytes para evitar falhas pelo limite de 4,5 MB das Vercel Functions. O backend continua responsável por autenticação, tenant, permissões e regras de negócio.

## Módulos

As rotas incluem login, visão geral, Inbox, contatos, campanhas, inteligência artificial, treinamento, simulador, conexões, instâncias, canais, catálogo, áudios, histórico, relatórios, contas, segurança e configurações.

Campanhas já oferecem rascunhos, edição de plano/opções, prévia de importação e biblioteca privada de mídia com upload por URL assinada. Uploads grandes não devem passar pelo BFF. Outros fluxos de mídia ainda dependem de homologação e/ou migração para upload direto.

As operações disponíveis variam conforme as capacidades e permissões retornadas pelo backend. Ações operacionais de risco — como disparo/agendamento de campanhas, pareamento de dispositivos, ativação de políticas e mutações administrativas — permanecem condicionadas às capacidades e confirmações do backend.

Consulte o [status detalhado e os critérios para 100%](../docs/modernizacao-frontend/STATUS-MIGRACAO.md).

## Publicação de homologação

Configure um projeto Vercel separado apontando Root Directory para `web`. Defina `IENVIA_BACKEND_URL` como variável server-side em Preview e Production. Não altere o projeto Vercel atual nem o `vercel.json` da raiz durante a homologação.

Antes de expor a homologação, valide login, refresh, logout, respostas 401/403/409/429/5xx, uploads, isolamento de tenant e headers de segurança. A sessão inicial mantém o formato da chave `zapia_cloud_auth` usado pelo painel legado. A migração para cookie HttpOnly exige uma etapa e testes próprios.

O painel legado em `public/` permanece como interface de produção até a aprovação e publicação gradual da nova interface.
