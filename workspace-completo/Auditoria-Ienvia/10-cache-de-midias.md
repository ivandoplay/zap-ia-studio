# Auditoria Ienvia — cache de mídias por conta

Versão v5.8.21, commit `afdb9a5`, 28/10/2026.

## Problema reproduzido

Em teste isolado com dois IDs e arquivos fictícios, o mesmo nome de arquivo em `data/uploads` permitia que a segunda conta reutilizasse um arquivo deixado pela primeira, sem baixar o objeto correspondente à segunda. Nenhum dado ou mídia real foi usado e não há evidência de exploração por terceiros.

## Alteração e testes

Downloads de mídia remota agora usam diretórios separados por conta, sem reutilizar arquivos legados compartilhados. Arquivos legados foram preservados. Os caminhos de envio de catálogo, biblioteca de voz e transcrição foram adaptados; para itens de catálogo remotos, o registro da conversa passa a guardar o URL correto. Backups de voz priorizam o cache correspondente à conta, mantendo a compatibilidade com arquivos locais legados.

Os cenários de colisão de nomes, envio de catálogo, áudio e backup foram verificados com arquivos e envios simulados. A suíte completa passou em 43/43 arquivos de testes isolados; atualização de 5.8.18 e 5.8.20 foi simulada com preservação do banco e sessão sintéticos. A mídia real e os envios no aparelho não foram retestados nesta etapa.

## Limites importantes

- Essa correção cobre o cache de mídia **remota** nos caminhos alterados, e não comprova isolamento de todos os arquivos locais, backups ou rotas.
- Para preservar backups antigos, a exportação de voz ainda recorre ao arquivo legado compartilhado quando o cache da conta não existe. Esse fallback requer uma migração cuidadosa de propriedade para eliminar o risco sem perder arquivos; não se deve alegar isolamento completo de backups.
- Arquivos remotos já existentes nos diretórios legados não são apagados. Quando não houver cache da conta, o primeiro acesso precisa baixar a mídia novamente; se a nuvem estiver indisponível, pode falhar em vez de usar o cache compartilhado.
- O bucket continua público e listável. Esta mudança não impede que URLs públicas sejam acessadas; veja `08-alerta-midias-publicas.md`.
EOF
## Publicação e motor

A v5.8.21 foi promovida para produção na Vercel; o ZIP publicado é idêntico ao local e sua assinatura foi verificada. O último heartbeat confirmado do Windows foi da v5.8.20, com slots 1 e 2 ativos. Uma segunda solicitação remota de atualização foi bloqueada como duplicada antes do envio; não foi contornada nem há confirmação da v5.8.21 instalada no aparelho. O cache corrigido só opera no Windows quando essa versão for instalada.

Atualização posterior solicitada por Jefferson: comando `2403fd13-4393-4b39-8504-9b2e11730415` concluído; o Windows confirmou heartbeat v5.8.21 às 11:21:04 UTC e os slots 1 e 2 constavam `connected` às 11:21:09 UTC. Isso confirma versão e conexão, não um novo teste real de envio de mídias.
