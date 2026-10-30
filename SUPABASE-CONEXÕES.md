# Conexões Supabase — MUITOATENÇÃO AQUI

> ⚠️ **DUAS CONEXÕES EXISTEM. NUNCA CONFUNDA.**
> - A **expressão EXTENSAO** é só pra eu testar e ver tela. Não é do sistema.
> - A **expressão SISTEMA** é do zap-ia-studio, do painel mesmo.

---

## 1. SISTEMA (zap-ia-studio) — DO PAINEL

Essa é a conexão que o painel usa. Não mexe.

- **URL**: `https://iuysmojhaxplnhfrxqkv.supabase.co`
- **user_id**: `28f17e53-1ab8-4ec7-8556-666df0d4add6`
- **Login painel**: `jeffersonivan`
- **Uso**: painel, CRM, treinamento, logs, waState, etc.

---

## 2. EXTENSAO (apenas testes + ver tela)

> ⛔ Essa conexão serve **SOMENTE** para eu testar a extensão que captura a tela do seu navegador.
> NUNCA misturar dados dela com dados do sistema (CRM, treinamento, waState, etc.).

*ATENDER: quando o usuário mandar o prompt da extensão, registrar aqui abaixo.*

### Info da extensão (a preencher quando o usuário mandar):

- **Nome da extensão**: "Agente de Página" (browser extension)
- **URL Supabase da extensão**: `https://iuysmojhaxplnhfrxqkv.supabase.co` (MESMO projeto do sistema, mas tabelas separadas)
- **Tabela onde grava**: `public.pag_observacoes` (o que o navegador vê) + `public.pag_comandos` (fila de comandos para controlar o navegador)
- **Formato dos dados**:
  - tipo 'leitura' → markdown da página em `conteudo`
  - tipo 'screenshot' → dataURL JPEG em `conteudo->>'imagem'`
- **Endpoint/método de envio**: via SQL (INSERT/UPDATE/SELECT nas tabelas públicas acima)

### SESSÃO ATUAL

- **Sessao_id do prompt**: `2164b5aa-2dd0-4c3b-96cb-d58dcc6452e8` (sem dados ainda)
- **Sessao_id com dados**: `0ceabe3c-8b38-4446-9d5f-92ddcc846540` (última atividade: 2026-10-28)
- **Observação**: a extensão grava observações automaticamente ao navegar. Pode haver mais de uma sessão ativa.

### Comandos rápidos

**Ver o navegador:**
```sql
select tipo, url, titulo, conteudo, criado_em
  from public.pag_observacoes
  where sessao_id = '2164b5aa-2dd0-4c3b-96cb-d58dcc6452e8'
  order by criado_em desc limit 5;
```

**Controlar o navegador:**
```sql
-- insere comando
insert into public.pag_comandos (sessao_id, ferramenta, argumentos, origem)
values ('2164b5aa-2dd0-4c3b-96cb-d58dcc6452e8', 'ler_pagina', '{"modo":"markdown","maxChars":6000}'::jsonb, 'ia');

-- espera ~3s e confere resultado
select id, status, resultado, erro from public.pag_comandos
  where sessao_id = '2164b5aa-2dd0-4c3b-96cb-d58dcc6452e8' order by id desc limit 1;
```

### Ferramentas disponíveis

abrir_url · listar_abas · info_pagina · ler_pagina · listar_links · buscar_elementos · estrutura_pagina · esperar_elemento · clicar · digitar · pressionar_tecla · rolar · executar_js · requisicao_http · capturar_tela · rodar_fluxo

### Regra de ouro (extensão)

Mesmo projeto Supabase, mas tabelas EXCLUSIVAMENTE da extensão (pag_observacoes/pag_comandos).
Nunca confundir com tabelas do sistema (CRM, treinamento, waState, etc.).

---

## Regra de ouro

Sempre que for trabalhar com dados da extensão, verificar que o arquivo/tabela/URL é da **extensa**. Nunca alterar dados do sistema baseado em algo que veio da extensão.
