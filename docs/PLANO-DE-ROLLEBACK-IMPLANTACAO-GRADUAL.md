# Plano de Rollback e Implantação Gradual — Reforma Visual CRM

**Data:** 2026-11-05  
**Branch:** `review/reforma-visual`  
**HEAD:** `bb1db28428a6be2d09e0af48dfb129ae9f49c41f`  
**Projeto oficial:** `zap-ia-studio` (`prj_u60FAPW5JLG1FeWvBsznrZvwkzCf`)  
**Projeto demo:** `ienvia-reforma-visual` (`prj_2plMn5ELqUQ3CAVqYvp6NtQSDoBH`)  
**SHA oficial publicada:** `7630b62b40b4518d06a157c4dc5055747fcb157e` (Evolution, preservada)

---

## 1. Princípios da implantação gradual

- **Nunca trocar o painel antigo inteiro de uma vez.** A antiga pode estar mais completa em algumas abas.
- **Implantar aba por aba**, comparando microdetalhes contra o publicado.
- **Preservar o painel antigo** durante toda a transição; ele continua acessível em `/painel#crm`.
- **Rollback imediato** se qualquer aba apresentar regressão funcional ou perda de dados.
- **Sem custo novo, sem upgrade, sem mensagens reais, sem IA paga.**

---

## 2. Ordem de implantação (aba por aba)

| Ordem | Aba / Módulo | Status local | Requisito antes de trocar | Rollback |
|-------|-------------|--------------|---------------------------|----------|
| 1 | Visão geral | Concluída localmente | Conferir contra publicado | Manter `/visao-geral/` antigo |
| 2 | Conversas (nova caixa) | Concluída localmente (simulação) | Validar Auth/RLS no Supabase | Link "Abrir CRM anterior" preservado |
| 3 | Agenda de contatos / Ficha 360º | Concluída localmente | Migração de contatos antigos executada | Painel antigo mantém dados |
| 4 | Kanban | Concluída localmente (consulta) | Paridade de etapas e valores | Antigo mantém Kanban |
| 5 | Etiquetas e cores | Concluída localmente (biblioteca) | Migração de etiquetas antigas executada | Antigo mantém customTags |
| 6 | Documento / Tarefas / Flags / Filtros | Concluída localmente | Reauditar microdetalhes | Antigo mantém |
| 7 | Atalhos demo / Biblioteca rápida | Concluída localmente | Importar atalhos antigos | Antigo mantém |
| 8 | Campanhas | Pendente | Destinatários "só listas e arquivos" | Antigo mantém campanhas |
| 9 | Treinamento / Catálogo / Simulador / IA / Segurança / Contas | Pendente | Homologação por módulo | Antigo mantém |

**Regra de troca:** só ativar a nova aba quando tiver paridade funcional com a publicada e testes passando. Até lá, o painel antigo continua disponível.

---

## 3. Rollback por módulo

Cada módulo tem um ponto de reversão definido:

| Módulo | Como fazer rollback |
|--------|---------------------|
| Conversas | Voltar a render o painel antigo via link `/painel#crm`; sessão e rascunhos da nova caixa são descartados (não há persistência real de mensagens) |
| Agenda / Ficha | Os cadastros salvos na nova base (`saved_records_only`) são apenas projeção; o painel antigo mantém os dados originais intactos |
| Etiquetas | A nova biblioteca (`saved_tag_library_v1`) é privada por conta; não regrava o painel antigo. Basta não ativar a nova biblioteca. |
| Migração de dados | O script `scripts/migrate-crm-tags-legacy.mjs` gera um JSON de revisão. Não escreve no banco remoto nem no painel antigo. Rollback = não importar o JSON gerado. |

---

## 4. Checklist pré-deploy (obrigatório)

Antes de qualquer publicação, todos os itens devem estar marcados:

- [ ] 870/872 testes passando (as 2 falhas são de release/assinatura, não de funcionalidade)
- [ ] `build-visual-review.mjs`: 105 assets verificados
- [ ] `verify-static.mjs`: 105 assets estáticos, sem sessão/API
- [ ] `git diff --check`: limpo
- [ ] 130 arquivos protegidos intactos
- [ ] `crm-tags-evidence.json` atualizado com diff e hashes
- [ ] `crm-tags-review.md` atualizado
- [ ] Migração de etiquetas antigas executada e validada
- [ ] Migração de contatos antigos executada e validada
- [ ] Paridade de etiquetas (chips + gesto original) concluída
- [ ] Reauditoria aba por aba concluída
- [ ] Supabase liberado (Auth/RLS/isolamento de contas/concorrência)
- [ ] Chave de assinatura/release disponível
- [ ] Testes de release (`ienvia-branding`, `static-release-package`) passando
- [ ] Plano de rollback testado em staging
- [ ] Autorização explícita do usuário para deploy

---

## 5. Procedimento de deploy (após todos os checks)

1. Fazer backup estático da branch `review/reforma-visual`
2. Fazer deploy no projeto Vercel conectado (`ienvia-reforma-visual` ou `zap-ia-studio`)
3. Validar o deploy em staging/preview primeiro
4. Promover para produção apenas após validação
5. Manter o painel antigo acessível por pelo menos 30 dias após o deploy
6. Monitorar regressões nas abas trocadas

---

## 6. Bloqueios conhecidos (não resolvidos localmente)

| Bloqueio | Impacto | Resolução depende de |
|----------|---------|---------------------|
| Supabase 402 Pro | Sem Auth JWT, RLS, isolamento de contas, concorrência real em produção | Upgrade do projeto Supabase ou acesso a projeto ativo (usuário) |
| Chave de assinatura/release ausente | Testes de release falham; pacote não passa verificação | Fornecer private key/signer default compatível (usuário) |
| Testes de release (`ienvia-branding`, `static-release-package`) | Bloqueiam publicação assinada | Resolução dos dois bloqueios acima |
| Homologação real (Auth/RLS/concorrência/carga) | Não substitui testes locais com PGlite/Chromium | Ambiente Supabase ativo (usuário) |

---

## 7. Contatos e referências

- Baseline: `/home/user/auditoria/implantacao-gradual/crm-tags-start-baseline.json` (841 arquivos)
- Review: `/home/user/auditoria/implantacao-gradual/crm-tags-review.md`
- Evidência: `/home/user/auditoria/implantacao-gradual/crm-tags-evidence.json`
- Log completo: `/home/user/auditoria/implantacao-gradual/crm-tags-full-validated.log.gz`
- Migração legada: `/home/user/zap-ia-studio/scripts/migrate-crm-tags-legacy.mjs`
- Testes de migração: `/home/user/zap-ia-studio/tests/crm-tags-migration.test.mjs`

---

**Não publicar enquanto houver qualquer item não marcado no checklist acima.**
