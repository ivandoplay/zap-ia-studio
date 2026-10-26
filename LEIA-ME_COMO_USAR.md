# ZAP-IA Studio v3.0 — Plataforma Cloud Multi-Contas & Atendimento Inteligente no WhatsApp

Sistema completo de atendimento autônomo 100% humano no WhatsApp, CRM comercial e prospecção segura, agora com **Arquitetura Cloud Multi-Contas (`Vercel` + `Supabase RLS` + `Motor Individual Termux/PC`)**, desenvolvido com `@whiskeysockets/baileys` v7, `@supabase/supabase-js` e `@google/genai`.

---

## 0. Como funciona o Modo Nuvem Multi-Contas (v3.0)

1. **Acesso Global pelo Navegador (Vercel Cloud):**
   - Abra o link do seu projeto na **Vercel** de qualquer celular ou computador do mundo e entre com seu **Usuário** e **Senha**.
   - **Sem cadastro público:** apenas a conta **👑 Admin Master (`jeffersonivan`)** possui a aba **`👑 Contas & Usuários`** para criar logins e senhas para outras contas.
   - **Isolamento Total (`Row Level Security`):** a conta principal (`jeffersonivan`) já vem com o treinamento **`Alavancagem de Vendas — Lizandro Celestino (lizandro-v-turbo)`**; cada nova conta criada nasce **100% limpa** para qualquer nicho, com seu próprio WhatsApp, treinamento, áudios, catálogo, PIX e CRM completamente separados!
   - **Painel 100% Autônomo na Nuvem:** Simulador, Treinamento, Upload de Áudios (`Supabase Storage`), Catálogo, PIX, CRM e Raio-X Coach IA funcionam direto na Vercel mesmo quando o celular/PC está desligado.
2. **Motor Individual do WhatsApp (Termux no Android ou Windows PC):**
   - Cada dono de conta abre o motor no próprio aparelho (`bash 5_Iniciar_No_Termux.sh` ou `2_Iniciar_Atendente_IA.bat`) e entra com **seu próprio Usuário e Senha**.
   - Assim que o motor liga, o topo do painel na Vercel muda para **`🟢 Motor Online`** e sincroniza QR Code, Código de 8 Dígitos, mensagens e áudios em tempo real (`<200ms`)!

---

## 1. Como abrir e usar no seu PC Windows

### Passo 1: Instalar o Node.js (apenas na 1ª vez)
1. Caso ainda não tenha o Node.js instalado, baixe a versão **LTS (Gratuita)** em: https://nodejs.org/pt
2. Dê **2 cliques** em **`1_Instalar_No_Windows.bat`**. Ele instala todas as bibliotecas automaticamente.
3. *(Opcional)* Dê **2 cliques** em **`3_Criar_Atalho_Area_de_Trabalho.bat`** para criar o ícone **ZAP-IA Studio** na Área de Trabalho.

### Passo 2: Iniciar em Modo Aplicativo
1. Dê **2 cliques** em **`2_Iniciar_Atendente_IA.bat`** (ou no atalho da Área de Trabalho).
2. O painel abrirá em **janela própria limpa de programa** (Edge/Chrome `--app`).

### Passo 3: Configurar sua Chave Gratuita do Google Gemini (+ Pool e Reserva)
1. Gere sua chave gratuita em: https://aistudio.google.com/apikey
2. No menu **Motor de IA (Gemini+)**, cole sua chave em `GEMINI_API_KEY` e mantenha o modelo recomendado para chave grátis: **`gemini-3.5-flash-lite`** (responde em ~1,3s e escuta áudios + lê imagens/PDFs nativamente!).
3. **Dica Extra (Cota Multiplicada):** você pode colar chaves extras de outras contas Google no campo **Pool de Chaves Gemini Extras** (1 por linha) — se uma chave atingir o limite gratuito do minuto/dia, o sistema pula sozinho para a próxima!
4. **Provedor Reserva (Auto-Fallback):** se quiser redundância total, deixe também uma chave gratuita da **Groq** cadastrada como reserva automática.

---

## 2. Como rodar 24h num Celular Android pelo Termux (Custo R$ 0 + App PWA)

Como o sistema é 100% leve (~60 MB de RAM, zero dependências C++ pesadas), ele roda direto no seu Android mesmo com a tela apagada:

1. Instale o **Termux oficial pelo F-Droid** e desative a restrição de bateria do Android para o Termux (*Configurações > Apps > Termux > Bateria > Sem restrições*).
2. Extraia o `ZAP-IA-Studio-Windows.zip` na pasta Downloads do celular e execute no Termux:
   ```bash
   termux-setup-storage
   cp -r ~/storage/downloads/ZAP-IA-Studio ~/ZAP-IA-Studio
   cd ~/ZAP-IA-Studio
   bash 4_Instalar_No_Termux.sh
   bash 5_Iniciar_No_Termux.sh
   ```
3. O script ativa o **`termux-wake-lock`** automaticamente e abre **`http://localhost:3000`** no Chrome.
4. **Instalar como Aplicativo (PWA):** no topo do painel (ou menu do Chrome), toque em **Instalar App / Adicionar à tela inicial** para usar em tela cheia com barra inferior nativa!
5. **Conectar no mesmo celular (Sem câmera):** na aba *Conexão & Painel*, digite seu número com `55 + DDD` em **Código de 8 dígitos** e cole o código nas notificações do WhatsApp.

---

## 3. Principais Recursos da Versão 2.5

- **Postura 100% Humana + Anti-"Sotaque de IA" (`Skill #1 / H25`):** o atendimento conversa sempre como uma pessoa real da equipe comercial do negócio — **jamais diz ou insinua ser IA, robô, bot ou atendimento automático** (com blindagem no prompt, no pacote de treinamento e filtro de saída em tempo real), eliminando clichês robóticos de IA.
- **Central "💬 Todas as Conversas" ao Vivo + Quadro Kanban + Raio-X Coach IA (`Aba CRM`):**
  - **Todas as Conversas (Inbox estilo WhatsApp Web):** veja **todas as conversas** em lista lateral com busca por nome/telefone/conteúdo, escute áudios enviados/recebidos, mude etapa, assuma/retome conversa, envie Áudios Estratégicos ou responda por texto em tempo real;
  - **Dossiê Executivo de 3 Linhas (`Skill #2 / S33`):** toda passagem humana gera automaticamente `1. Cenário`, `2. Gatilho` e `3. Próxima jogada` no CRM e no seu WhatsApp pessoal;
  - **Triagem de Sentimento, Pressa e Irritação (`Skill #3 / H26`) & Objeção Oculta (`Skill #4 / S34`):** etiquetas vivas (`⚡ Com Pressa`, `😟 Desconfiado`, `🔥 Quente`, `🚨 Crítico`) que ajustam automaticamente o tamanho e o tom da resposta;
  - **Raio-X do Funil & Coach IA (`Skill #10`):** analisa suas conversas reais no CRM em 1 clique, apontando gargalos, objeções recorrentes e 3 ajustes práticos de melhoria.
- **Cérebro Único Blindado + Tripwire 2026 (`Skill #8 / S35`):** edite visualmente `M01–M13` e todas as Skills (`S01–S35` / `H01–H26`), exporte/importe `.ZIP` completo (incluindo áudios `.ogg`) e bloqueie tentativas de concorrentes ou falsa autoridade administrativa.
- **Disparador Individual & Fila Segura Anti-Ban (`Aba 1` e `Aba 6`):** aborde lojistas usando `M01–M13` individualmente ou em fila cadenciada (`45s` a `120s` aleatórios entre envios + teto diário automático), já deixando a IA pronta para qualificar quem responder.
- **Simulador com Microfone ao Vivo, Raio-X & Ensino em 1 Clique (`Aba 2`):** grave sua voz no navegador para testar a escuta do Gemini, abra o **Raio-X** para ver quais Skills e Personas atuaram e clique em **Corrigir resposta** para ensinar a IA na hora.
- **Biblioteca de Áudios Estratégicos — Voz Humana Real (`Aba Áudios Estratégicos`):**
  - Grave pelo microfone ou suba qualquer formato (`.mp3`, `.m4a`, `.wav`, `.ogg`, `.opus`): o motor interno converte tudo automaticamente para o **único formato nativo de gravação real do WhatsApp** (`OGG/Opus Mono 16kHz VoIP`, sem tags/capítulos, vendor `WhatsApp`, upload `/mms/ptt` + **64 barras reais de onda sonora** + tempo proporcional de *"gravando áudio..."*);
  - Clique em **`✨ Transcrever Automaticamente com IA`** para o Gemini preencher a transcrição em 2 segundos;
  - **Modo Puro / Híbrido sem repetição:** a IA envia só o áudio quando ele responde tudo, ou complementa em 1 frase curta sem repetir o que sua voz já fala; **nunca repete o mesmo áudio para o mesmo cliente** e respeita automaticamente caso o cliente diga que não pode ouvir áudio (`Skill S06`).
- **Catálogo Multi-Mídia (Fotos, PDFs e Notas de Voz `S06`) + QR Code PIX:** cadastre até 5 anexos por item e gere **QR Code PIX em imagem PNG + Copia e Cola** automático.
- **CRM Kanban Rico + Alerta Automático de Retorno `Skill S19` (`Aba 7`):**
  - Unifica automaticamente conversas `@s.whatsapp.net` e `@lid` do mesmo telefone em um único card;
  - Etiquetas coloridas (*Quente*, *Pediu Valor*, *Lojista*), envio direto de `M01–M13`, Catálogo, PIX e **Gravação de Nota de Voz ao vivo** dentro da ficha;
  - **Lembrete `Skill S19`:** ao agendar data/hora de retorno na ficha do cliente, quando chega o horário combinado o sistema **envia um alerta direto no seu WhatsApp pessoal** com link `wa.me/` (sem disparar mensagem automática invasiva para o cliente).
- **Segurança & Migração Fácil (`Aba 6` e `Aba 7`):** bloqueio opcional do painel por **PIN** no Wi-Fi local + botões **Backup Geral (`.JSON`)** e **Restaurar (`.JSON`)** para levar todos os seus clientes do CRM, conversas e configurações do PC para o celular em 1 clique.
