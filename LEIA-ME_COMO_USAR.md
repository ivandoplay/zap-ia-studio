# ZAP-IA Studio v5.0 Institutional SaaS Edition — Plataforma Multi-Contas, Atendimento Humanizado & Inbox 360º

Plataforma comercial pronta para venda e operação diária de atendimento autônomo **100% humano** no WhatsApp, **Central de Conversas 360º em 3 Colunas** e CRM comercial, com **Arquitetura SaaS Multi-Contas (`Vercel Cloud` + `Supabase RLS Zero-Trust` + `Pacote Institucional Portátil para Windows PC, Linux Desktop/VPS e Android Termux`)**, construída com `@whiskeysockets/baileys` v7, `@supabase/supabase-js` e `@google/genai`.

---

## 0. Estrutura Institucional do Pacote `.ZIP` (`v5.0.0`)

Ao baixar o motor pelo botão **`Baixar Motor (.ZIP)`** dentro do painel (`ZAP-IA-Studio-v5.0.0.zip`) e extrair, o cliente enxerga uma pasta corporativa ultra-limpa **`ZAP-IA-Studio/`** onde toda a engenharia técnica fica isolada em `sistema/`:

```text
ZAP-IA-Studio/
├── INICIAR_NO_WINDOWS.bat     (Windows 10/11 — 2 cliques, zero instalação externa)
├── INICIAR_NO_LINUX.sh        (Ubuntu, Debian, Mint, Fedora, Arch, VPS SSH — zero sudo)
├── INICIAR_NO_TERMUX.sh       (Celular Android 24h via Termux — auto-instala na 1ª vez)
├── MANUAL_OFICIAL.html        (Manual interativo offline com abas por sistema e botões Copiar)
├── LEIA-ME.txt                (Guia rápido direto ao ponto)
├── Ferramentas_Extras/        (Atalhos de Área de Trabalho e Reparo Automático)
└── sistema/                   (Motor técnico encapsulado + Node.js v22 LTS Portátil automático)
```

---

## 1. Como abrir e usar em cada sistema (Zero Instalação Externa!)

### Windows 10 ou 11 (PC / Notebook — Zero Admin)
1. Extraia o `.ZIP` baixado (`Botão direito > Extrair Tudo...`).
2. Abra a pasta **`ZAP-IA-Studio`** e dê **2 cliques em `INICIAR_NO_WINDOWS.bat`**.
   - **Na 1ª abertura:** baixa automaticamente o **Node.js v22 LTS Portátil Oficial** (com validação `SHA-256`) em `sistema\.runtime\node\`, instala as bibliotecas e já abre o painel no navegador!
   - **Nas próximas aberturas:** abre em **2 segundos**!
   - *(Opcional)* Use `Ferramentas_Extras\Windows_Criar_Atalho_Desktop.bat` para criar o atalho na Área de Trabalho.

### Linux (Desktop ou Servidor VPS SSH — Zero `sudo`)
1. Extraia o `.ZIP`, abra o terminal na pasta **`ZAP-IA-Studio`** e execute:
   ```bash
   bash INICIAR_NO_LINUX.sh
   ```
   - Suporta automaticamente **`linux-x64`**, **`linux-arm64`**, **`linux-armv7l`** e **`Alpine musl`**, baixando o **Node.js v22 LTS Portátil Oficial** em `sistema/.runtime/node/` sem exigir `sudo` nem alterar pacotes globais do sistema.
   - Em **Linux Desktop**, abre o navegador automaticamente; em **VPS via SSH**, inicia o assistente interativo no próprio terminal (`@usuario` + `senha` + **Código de 8 Dígitos do WhatsApp**).

### Android 24h via Termux (Custo R$ 0 de Servidor)
1. Instale o **Termux oficial pelo F-Droid** e desative a restrição de bateria do Android (*Configurações > Apps > Termux > Bateria > Sem restrições*).
2. Extraia o `.ZIP` na pasta `Downloads` do celular e cole no Termux:
   ```bash
   termux-setup-storage
   cp -r ~/storage/downloads/ZAP-IA-Studio ~/ZAP-IA-Studio
   cd ~/ZAP-IA-Studio
   bash INICIAR_NO_TERMUX.sh
   ```
   - Na 1ª execução, instala sozinho `nodejs-lts` + `ffmpeg`, migra sessões anteriores caso existam e abre o assistente de login + pareamento por **Código de 8 Dígitos** direto na tela!

---

## 2. Arquitetura Comercial SaaS Multi-Contas (`v5.0.0`)

1. **Clientes SaaS — Torre de Comando Master (`Aba Clientes SaaS`):**
   - Exclusiva para a conta **Admin Master (`jeffersonivan`)**; contas de clientes nunca enxergam esta aba nem dados de outras empresas.
   - **Gestão Comercial Manual:** crie contas 100% limpas para qualquer nicho, copie o **Kit de Boas-Vindas**, acompanhe o progresso de **Setup (`0/4` a `4/4`)** e bloqueie/libere contas em 1 clique.
   - **Modo Suporte Master em 1 Clique (`Acessar Painel`):** entre no painel de qualquer cliente sem precisar da senha dele, com barra superior âmbar **`Voltar para Minha Conta Master`**.
   - **Isolamento Zero-Trust (`Row Level Security` + Storage Isolado):** cada conta é 100% isolada no banco (`Supabase RLS` com `InitPlan` otimizado) e no bucket de mídia (`zapia-media/<user_id>/`).

2. **Conversas & CRM — Inbox 360º em 3 Colunas + Player e Download Universal de Mídias:**
   - **Ouvir Áudios, Ver e Baixar Qualquer Arquivo do Cliente:** escute os áudios enviados pelo cliente direto na bolha (player nativo + botão **Baixar áudio**), abra fotos/comprovantes, assista vídeos MP4 e baixe qualquer documento (`.pdf`, `.xlsx`, `.docx`, `.csv`, `.txt`, `.zip`, `.xml`, etc.) em **1 clique**.
   - **Botão de Anexo Livre (Clipe), Atalhos `/`, Notas Internas, Gravação de Voz `OGG/Opus` ao vivo e Disparo Rápido de Catálogo / PIX.**

3. **Configurar sua Chave Gratuita do Google Gemini (+ Pool e Reserva):**
   - Gere sua chave gratuita em https://aistudio.google.com/apikey e cole na aba **Configurações > Motor de IA & Chaves** usando o modelo recomendado **`gemini-3.5-flash-lite`** (+ Pool de Chaves Extras e fallback opcional Groq / OpenRouter / OpenAI).

---

## 3. Resumo dos Diferenciais Comerciais & Proteções Ativas

- **Postura 100% Humana (`Skill #1 / H25`):** conversa sempre como uma pessoa real da equipe — **jamais revela ou insinua ser IA, robô, bot ou assistente virtual**.
- **Biblioteca de Voz Humana Real (`OGG/Opus` + 64 barras de onda sonora + `/mms/ptt`):** notas de voz indistinguíveis de gravação feita na hora no celular, com transcrição automática via Gemini e envio inteligente sem repetição (`Skill S06`).
- **Dossiê Executivo de 3 Linhas (`S33`), Triagem de Sentimento (`H26`), Objeção Oculta (`S34`), Blindagem Anti-Prompt Injection (`S35`) e Coach de Funil IA (`Skill #10`)**.
- **Catálogo Multi-Mídia (até 5 arquivos por item) + QR Code PIX PNG & Copia e Cola + Anti-Ban Completo + Retorno Agendado (`S19`) + Backup `.JSON` / Exportação `.CSV`.**
