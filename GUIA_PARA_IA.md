# Guia para a IA — Atendente IA WhatsApp (Zap IA Studio)

Este guia ensina como mexer no sistema, as credenciais necessárias, e como manter tudo seguro.

---

## 1. Repositório e Branch

- **Repositório:** `https://github.com/ivandoplay/zap-ia-studio`
- **Branch principal:** `main`
- **Branch local:** `master`
- **Caminho local:** `/home/user/atendente-ia-whatsapp`

### Como clonar / atualizar
```bash
git clone https://github.com/ivandoplay/zap-ia-studio.git
cd zap-ia-studio
git pull origin main
```

### Como pushar commits
```bash
git add <arquivos>
git commit -m "mensagem do commit"
git push origin master:main
```

---

## 2. Credenciais

### Token GitHub (para push)
- **Token:** <REMOVIDO — use o token do seu ambiente, não commitar secrets>
- **Usuário:** `ivandoplay`
- **Como usar no push:**
```bash
git push -u https://ivandoplay:$GITHUB_TOKEN@github.com/ivandoplay/zap-ia-studio.git master:main
```
- **Autor dos commits:** `ivandoplay` / `ivandoplay@users.noreply.github.com`

### Evolution API (API WhatsApp na nuvem)
- **URL:** `https://pool-evolution-go-025.cloud2.pageup.dev.br`
- **Chave Evolution API:** configurar somente como segredo na Vercel; não registrar aqui.
- **Documentação:** `https://doc.evolution-api.com`
- **Documentação webhooks:** `https://docs.evolutionfoundation.com.br/evolution-go/webhooks`

### Supabase
- **SUPABASE_URL** e **SUPABASE_SERVICE_ROLE_KEY** — definidos em `.env` (não revelar publicamente)

### Produção (Vercel)
- **URL:** `https://zap-ia-studio.vercel.app`
- **Painel:** `https://zap-ia-studio.vercel.app/painel`

---

## 3. Como Manter Seguro

1. **Nunca expor o token GitHub em código público.** Usar apenas no push via URL com token, ou em `.env` (que não é commitado).
2. **Nunca commitar `.env` com secrets.** O `.env` deve estar no `.gitignore`.
3. **Usar o token GitHub apenas para push, não para clone público.**
4. **As senhas do painel são do usuário, não compartilhar publicamente.**
- **Chave Evolution API:** configurar somente como segredo na Vercel; não registrar aqui.
6. **Fazer commits com autor `ivandoplay`** (configurar `git config user.name "ivandoplay"`).

---

## 4. Como Rodar o Servidor Local

```bash
cd /home/user/atendente-ia-whatsapp
npm install --production
npm start
```
- **Porta:** 3000
- **URL local:** `http://localhost:3000`
- **Painel local:** `http://localhost:3000/painel`

### Dependências
- `dotenv` — installado via `npm install --production`
- O `node_modules` não persiste entre sessões do sandbox — rodar `npm install --production` sempre que necessário.

---

## 5. Como Testar

### Testar endpoints locais
```bash
curl http://localhost:3000/api/evolution-cloud/status
curl -X POST http://localhost:3000/api/evolution-cloud/connect -H 'Content-Type: application/json' -d '{"slotId":"slot_1","pairingPhone":"5586981303979"}'
```

### Testar na produção
```bash
curl https://zap-ia-studio.vercel.app/api/evolution-cloud/status
```

### Testar login
```bash
curl -X POST https://zap-ia-studio.vercel.app/api/auth/login -H 'Content-Type: application/json' -d '{"username":"jeffersonivan","password":"Davi32ivan@#"}'
```

### Testar webhook (sem auth, como a Evolution API envia)
```bash
curl -X POST https://zap-ia-studio.vercel.app/api/evolution-webhook/webhook -H 'Content-Type: application/json' -d '{"event":"MESSAGE","instance":"zap-ia-slot_1","data":{"key":{"remoteJid":"...","fromMe":false,"id":"..."},"message":{"conversation":"Olá"},"messageType":"text"}}'
```

---

## 6. Como Fazer Deploy

1. **Commitar e pushar para o `main`.**
2. **O Vercel faz o deploy automático** ao receber o push no `main`.
3. **Aguardar ~15 segundos** para o deploy concluir.
4. **Verificar a produção** com um curl no endpoint.

---

## 7. Checklist de Segurança

- [ ] Token GitHub não em código público
- [ ] `.env` não commitado
- [ ] Commits com autor `ivandoplay`
- [ ] Senhas do painel não compartilhadas
- [ ] Chaves API tratadas como secret

---

## 8. Atenção

- **O workspace é compartilhado** entre você (IA) e o usuário.
- **Os arquivos sob `/home/user/atendente-ia-whatsapp` são o repositório.**
- **A produção é o Vercel** — qualquer push no `main` faz deploy automático.
- **Se algo quebrar, verificar a syntax com `node --check <arquivo>` antes de commitar.**
