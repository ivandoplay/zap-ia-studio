# ZAP-IA Studio v4.9 Commercial SaaS Edition — Plataforma Multi-Contas, Atendimento Humanizado & Inbox 360º

Plataforma comercial pronta para venda e operação diária de atendimento autônomo **100% humano** no WhatsApp, **Central de Conversas 360º em 3 Colunas** e CRM comercial, com **Arquitetura SaaS Multi-Contas (`Vercel Cloud` + `Supabase RLS Zero-Trust` + `Motor Individual Android Termux / Windows PC`)**, construída com `@whiskeysockets/baileys` v7, `@supabase/supabase-js` e `@google/genai`.

---

## 0. Arquitetura Comercial SaaS Multi-Contas (v4.9)

1. **Clientes SaaS — Torre de Comando Master (`Aba Clientes SaaS`):**
   - Exclusiva para a conta **Admin Master (`jeffersonivan`)**; contas de clientes nunca enxergam esta aba nem dados de outras empresas.
   - **Gestão Comercial Manual:** crie contas 100% limpas para qualquer nicho, registre o WhatsApp do contratante e notas financeiras privadas, copie o **Kit de Boas-Vindas** pronto para colar no WhatsApp, acompanhe o progresso de **Setup (`0/4` a `4/4`)** e bloqueie/libere contas em 1 clique.
   - **Modo Suporte Master em 1 Clique (`Acessar Painel`):** entre no painel de qualquer cliente sem precisar da senha dele para configurar Cérebro Único, Catálogo, Áudios ou inspecionar conversas, com barra superior âmbar **`Voltar para Minha Conta Master`**.
   - **Autonomia de Senha pelo Cliente:** no menu de conta no canto superior direito (`@usuario` > **Alterar Minha Senha**), cada cliente pode trocar sua senha provisória a qualquer momento confirmando a senha atual.
   - **Isolamento Zero-Trust (`Row Level Security` + Storage Isolado):** cada conta é 100% isolada no banco (`Supabase RLS` com `InitPlan` otimizado) e no bucket de mídia (`zapia-media/<user_id>/`), impedindo qualquer leitura cruzada.

2. **Conversas & CRM — Inbox 360º em 3 Colunas + Player e Download Universal de Mídias:**
   - **Coluna 1 (Fila Inteligente):** contadores de não-lidas (`99+`), fixação no topo (`★`), arquivamento e filtros rápidos (*Ativas, Não Lidas, Com Você, Quentes, Retorno S19, Arquivadas*).
   - **Coluna 2 (Chat Multimídia Completo + Composer Pro):**
     - **Ouvir Áudios, Ver e Baixar Qualquer Arquivo do Cliente:** escute os áudios enviados pelo cliente direto na bolha (player nativo + botão **Baixar áudio**), abra e baixe fotos/comprovantes, assista vídeos MP4 e baixe qualquer documento enviado (`.pdf`, `.xlsx`, `.docx`, `.csv`, `.txt`, `.zip`, `.xml`, etc.) em **1 clique** tanto no Inbox 360º quanto no modal do Kanban (mesmo quando a IA estiver pausada);
     - **Botão de Anexo Livre (Clipe):** envie fotos, prints, vídeos MP4, PDFs, planilhas Excel, documentos Word, CSV, TXT ou ZIP avulsos direto do celular ou PC com legenda opcional;
     - **Atalhos `/` + Notas Internas + Voz OGG/Opus:** digite **`/`** para Respostas Rápidas, alterne para **Nota Interna Privada** (visível só para sua equipe), use **Sugerir IA**, grave **Nota de Voz OGG/Opus ao vivo** ou dispare **Catálogo / PIX** em 1 clique.
   - **Coluna 3 (Ficha 360º do Contato / Gaveta Inferior no Celular):** etapa do funil, agendamento rápido de retorno `S19` (`+1h`, `Amanhã 9h`), etiquetas comerciais e observações fixas.
   - **Notificações Nativas em Segundo Plano:** ative em `@usuario` > **Notificações na Tela** para receber alertas nativos do Windows/Android (com salto direto para a conversa ao clicar) quando um lead pedir atendimento humano ou vencer um retorno `S19` mesmo com a aba em 2º plano.

3. **Download da Última Versão do Motor Direto no Painel (`v4.9.0 .ZIP`):**
   - Painel online 24h em: **https://zap-ia-studio.vercel.app/** (funciona também como aplicativo instalável PWA em Modo Escuro e Modo Claro).
   - **Sempre Atualizado em 1 Clique:** clique em **`Baixar Motor (.ZIP)`** na aba **Início & Conexão** ou no menu superior da conta (`@usuario` > **Baixar Motor Atualizado (.ZIP)**) para baixar a versão mais recente do motor para Windows PC e Android Termux (clientes baixam o motor 100% limpo e sem segredos, pronto para uso).
   - **Detector Automático de Versão:** o painel identifica automaticamente a versão do motor conectado e avisa quando há atualização disponível, sem perder sua sessão WhatsApp ao atualizar.
   - Na 1ª execução do motor no **Termux (`bash 5_Iniciar_No_Termux.sh`)** ou **Windows (`2_Iniciar_Atendente_IA.bat`)**, o assistente de terminal já pede `@usuario` e `senha`, salva a sessão automaticamente e oferece gerar o **Código de 8 Dígitos do WhatsApp direto na tela do terminal**!

---

## 1. Como abrir e usar no PC Windows (Zero Instalação Externa — 100% Portátil!)

Você **não precisa instalar Node.js nem nenhum programa por fora** no seu computador e **não precisa de senha de Administrador**:

1. Baixe o `.ZIP` direto pelo botão **`Baixar Motor (.ZIP)`** dentro do painel, clique com o botão direito nele e escolha **`Extrair Tudo...`**.
2. Abra a pasta `atendente-ia-whatsapp` e dê **2 cliques direto em `2_Iniciar_Atendente_IA.bat`**!
   - **Na 1ª abertura:** o próprio sistema baixa automaticamente o **Node.js v22 LTS Portátil Oficial** (com validação de integridade SHA-256) para dentro da subpasta `.runtime\node\`, configura as bibliotecas em 20 a 40 segundos e já abre o aplicativo!
   - **Nas próximas aberturas:** pula toda a preparação e abre em **2 segundos**!
3. *(Opcional)* Dê **2 cliques** em **`3_Criar_Atalho_Area_de_Trabalho.bat`** para criar o ícone **ZAP-IA Studio (WhatsApp)** na sua Área de Trabalho.
4. Na primeira vez que a janela abrir, faça login com seu `@usuario` e `senha` para vincular o PC à sua conta na nuvem.

---

## 2. Como rodar 24h no Celular Android pelo Termux (Custo R$ 0)

1. Instale o **Termux oficial pelo F-Droid** e desative a restrição de bateria do Android (*Configurações > Apps > Termux > Bateria > Sem restrições*).
2. Extraia o `ZAP-IA-Studio-Windows.zip` na pasta Downloads do celular e execute no Termux:
   ```bash
   termux-setup-storage
   cp -r ~/storage/downloads/ZAP-IA-Studio ~/ZAP-IA-Studio
   cd ~/ZAP-IA-Studio
   bash 4_Instalar_No_Termux.sh
   bash 5_Iniciar_No_Termux.sh
   ```
3. **Na 1ª abertura no Termux:** digite seu `@usuario` e `senha` quando solicitado na tela e, se desejar conectar o WhatsApp do próprio aparelho na hora, informe seu `DDD + Número` para receber o **Código de 8 Dígitos** ali mesmo no terminal!
4. Depois disso, você pode gerenciar tudo de qualquer lugar em **https://zap-ia-studio.vercel.app/** (toque em **Instalar Aplicativo na Tela** no menu da conta para usar como App nativo com barra inferior de 5 hubs!).

---

## 3. Configurar sua Chave Gratuita do Google Gemini (+ Pool e Reserva)

1. Gere sua chave gratuita em: https://aistudio.google.com/apikey
2. Na aba **Configurações > Motor de IA & Chaves**, cole sua chave em `GEMINI_API_KEY` e mantenha o modelo recomendado para chave grátis: **`gemini-3.5-flash-lite`** (responde rápido e escuta áudios + lê imagens/PDFs nativamente).
3. **Pool de Chaves Gemini Extras:** cole chaves adicionais (1 por linha) para multiplicar sua cota gratuita diária com rotação automática.
4. **Provedor Reserva (Auto-Fallback):** opcionalmente cadastre uma chave gratuita da **Groq**, **OpenRouter** ou **OpenAI** como contingência automática.

---

## 4. Resumo dos Diferenciais Comerciais & Proteções Ativas

- **Postura 100% Humana (`Skill #1 / H25`):** conversa sempre como uma pessoa real da equipe — **jamais revela ou insinua ser IA, robô, bot ou assistente virtual**.
- **Biblioteca de Voz Humana Real (`OGG/Opus` + 64 barras de onda sonora + `/mms/ptt`):** notas de voz indistinguíveis de gravação feita na hora no celular, com transcrição automática via Gemini e envio inteligente sem repetição (`Skill S06`).
- **Dossiê Executivo de 3 Linhas (`S33`), Triagem de Sentimento (`H26`), Objeção Oculta (`S34`), Blindagem Anti-Prompt Injection (`S35`) e Coach de Funil IA (`Skill #10`)**.
- **Catálogo Multi-Mídia (até 5 arquivos por item) + QR Code PIX PNG & Copia e Cola**.
- **Anti-Ban Completo:** leitura humanizada, presença proporcional de digitação/gravação, pausa automática ao responder pelo celular (`fromMe`), fila cadenciada e lembrete de retorno agendado (`Skill S19`) direto no seu WhatsApp pessoal.
- **Backup Portátil (`.JSON`) e Exportação de Leads (`.CSV`)** disponíveis no botão `⋯` da Central de Conversas.
