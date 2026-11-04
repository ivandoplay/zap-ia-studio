# Ienvia — primeira prévia da base modular

Protótipo isolado para revisão visual e de navegação. **Não é o painel de produção e não implementa autenticação real.**

## Decisões do usuário

- Página própria de Conexões e Motor local.
- Escuro como padrão, com botão para mudar para claro. A escolha substitui o visual inicial de páginas claras.
- Desenvolvimento por página, com discussão, testes e prints.

## Incluído

- Base compartilhada de navegação desktop/mobile.
- Alternância de aparência, preferência local da demonstração, sincronização entre abas e tolerância a armazenamento bloqueado.
- Documentos e módulos distintos para Visão geral e Conexões.
- Busca de páginas, diálogo de informações e submenus do CRM.
- Cenários fictícios de Evolution e Motor local, com seleção na URL.
- Indicação explícita de revisão para áreas ainda não migradas.
- Fonte local Manrope e ícone já existente da marca; origem/licença da fonte em `public/assets/`.

## Não incluído

- Login, sessão real ou autorização de backend.
- Consulta ao Supabase, Evolution, Baileys ou outro serviço real.
- Envio de mensagens, reconexão, QR, campanhas ou alterações de banco.
- Migração do produto completo, benchmark comparável ao painel antigo ou auditoria integral de acessibilidade.

A preferência desta prévia é salva somente neste navegador sob `preview-demo`. O módulo permite chaves por usuário e preserva o operador em suporte, mas ainda não recebe uma sessão autenticada nem sincroniza uma preferência no servidor.

O perfil master é **fictício**, usado para mostrar todos os itens do menu. O filtro visual de navegação não é uma implementação de segurança.

## Executar

Na raiz deste diretório:

```sh
node server.mjs
```

Porta padrão: 4173; escuta em `0.0.0.0`. `PORT` permite escolher outra porta. O servidor serve somente `public/`, rejeita operações de escrita e não importa o backend nem carrega `.env`.

A política de frames é permissiva **somente nesta prévia sem dados ou ações reais**, para permitir o visualizador. Ela não deve substituir a política da aplicação autenticada.

## Testar

A partir da raiz do projeto, com as dependências de desenvolvimento e Chromium disponíveis:

```sh
PREVIEW_ARTIFACTS=/home/user/auditoria/arquitetura-v2/previews/escuro-padrao node --test --test-concurrency=1 prototypes/reforma-base/tests/*.test.mjs
```

Os testes iniciam um servidor estático próprio em porta efêmera e bloqueiam requisições de navegador para origens externas. `PREVIEW_ARTIFACTS` permite escolher a pasta das capturas.

As capturas atuais, com o comando acima, ficam em `/home/user/auditoria/arquitetura-v2/previews/escuro-padrao/`. Rodada atual: 49/49 testes aprovados. Há verificação em 320, 375, 390, 768, 1024 e 1440 px.

## Organização

```text
public/index.html                # Visão geral fictícia
public/conexoes/index.html       # Cenários de conexão fictícios
public/revisao/index.html        # Área ainda não implementada
public/assets/shared.css        # Tokens e base visual
public/assets/shell.js          # Navegação e interações compartilhadas
public/assets/appearance.*      # Estilos e interação de aparência
public/assets/appearance-init.js # Preferência antes da pintura inicial
public/assets/appearance-preferences.js # Preferências por sujeito, sem autenticação
public/assets/navigation.js     # Definição única dos menus
public/assets/dashboard.*       # Somente Visão geral
public/assets/conexoes.*         # Somente Conexões
server.mjs                      # Servidor estático, sem integrações
tests/                          # Navegação e navegador
```

Os arquivos `public/app.js`, `public/painel.html` e os serviços de produção existentes não são utilizados nem substituídos por esta prévia.

## Próximo passo

Visual escuro aprovado. Corrigir os contratos de status/resumo apontados na auditoria e depois integrar a base aos contratos legítimos de sessão/PIN e permissões, preservando os modos suportados e o acesso às funcionalidades antigas enquanto as páginas são migradas. A lógica completa de Conexões será outra entrega, com testes próprios; não deve ser considerada pronta porque a interface já existe.
