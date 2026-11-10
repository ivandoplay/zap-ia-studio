# Ienvia Web — frontend em modernização

Frontend Next.js isolado em relação ao painel legado.

## Desenvolvimento

Requisitos: Node.js 20 ou superior.

```bash
cd web
cp .env.example .env.local
# Edite IENVIA_BACKEND_URL com a origem real do backend Express
npm install
npm run dev
```

Abra `http://localhost:3000`.

## Variável obrigatória

- `IENVIA_BACKEND_URL`: origem HTTPS do backend Express. É uma variável exclusivamente server-side; não use prefixo `NEXT_PUBLIC_`. Não inclua caminho `/api`, credenciais, query ou fragmento.

O frontend usa a rota same-origin `/api/backend/*` como BFF. Ela encaminha apenas métodos, cabeçalhos e caminhos definidos, exige Origin same-origin e o marcador de requisição do cliente. O backend continua responsável por autenticação Bearer, tenant, permissões e regras de negócio.

## Estado da migração

- Shell responsivo e navegação: fundação inicial.
- Login: ligado a `POST /api/auth/login`.
- Visão Geral: ligada a `GET /api/dashboard/parity`; indicadores indisponíveis aparecem como indisponíveis, não como zero.
- Conexões: consulta somente leitura ligada a `GET /api/connections/summary` e `GET /api/connections/configuration`.
- Demais módulos: rotas de transição informativas, ainda sem operações conectadas.
- Painel legado: permanece no diretório `public/` e segue como interface de produção.

## Publicação de homologação

Configure um projeto Vercel separado apontando Root Directory para `web`. Defina `IENVIA_BACKEND_URL` nas variáveis server-side de Preview e Production. Não altere o projeto Vercel atual nem o `vercel.json` da raiz durante a homologação.

Antes de expor a homologação, validar login, refresh, logout, respostas 401/403/429/5xx, uploads, isolamento de tenant e headers de segurança. A sessão inicial mantém o formato da chave `zapia_cloud_auth` usado pelo painel legado. A migração para cookie HttpOnly fica fora desta primeira fundação e exige projeto e testes próprios.
