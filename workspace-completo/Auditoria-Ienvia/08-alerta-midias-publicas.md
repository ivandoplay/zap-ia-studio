# Auditoria Ienvia — alerta de acesso às mídias

Referência: 28/10/2026. Informação sensível: não reproduzir nomes de objetos nem seu conteúdo neste relatório.

## Achado confirmado: listagem anônima e bucket público

O bucket `zapia-media` está público. Existe uma política SELECT para o papel `public` sem restrição por conta. Em transação de leitura sob `anon`, o banco contou 47 objetos listáveis; a API de listagem respondeu HTTP 200 sem login. Nenhum conteúdo de mídia ou nome de arquivo foi baixado para esta verificação. Não foi comprovado que terceiros acessaram os dados.

Segundo a documentação do Supabase, buckets públicos permitem que qualquer pessoa com o URL recupere o arquivo; a RLS de leitura não protege esse download público. Portanto, mesmo que a listagem seja restrita, **URLs já conhecidas permanecerão acessíveis** enquanto o bucket for público. Mídias potencialmente privadas devem ser tratadas como expostas por URL.

O sistema atual usa `getPublicUrl` e o endpoint público do Storage. Tornar o bucket privado imediatamente quebraria fluxos existentes de mídia, inclusive áudio e imagens. A correção completa requer adaptar todos os leitores, links e cache do motor para autenticação ou URLs temporárias, testar compatibilidade e então alterar o bucket. Revogação de URLs antigas e efeito de cache também precisam ser avaliados.

## Tentativa de mitigação de listagem

Foi preparado um ajuste para limitar a listagem a cada usuário autenticado e ativo, sem alterar o bucket público. Um ensaio com rollback retornou sucesso, mas não comprova que a política temporária foi efetivamente aplicada. Tanto a tentativa de migração quanto a execução administrativa direta foram rejeitadas com `42501: must be owner of table objects`; a política em produção continua inalterada. A tabela pertence a `supabase_storage_admin`, e `postgres` não é membro do papel proprietário. Nenhuma outra tentativa de alterar a política foi feita.

O arquivo `pendente-politica-listagem-storage.sql` registra a proposta não aplicada; o ensaio está em `ensaio-listagem-storage.sql`. Ambas as operações precisam de revisão e execução pelo mecanismo autorizado de administração do Storage. A mitigação de listagem NÃO fecha a exposição por URLs públicas.

## Outros pontos de mídia sob investigação

Em testes sintéticos, download e encaminhamento aceitavam URLs internas arbitrárias. A v5.8.20 bloqueia URLs fora do Storage da própria conta, redirecionamentos e downloads maiores que 35 MiB nesses caminhos. Também foi reproduzida a reutilização de arquivos de cache legados entre contas; a v5.8.21 isola o cache de mídias remotas nos caminhos alterados. O fallback de arquivos legados no backup de voz e outros caminhos locais ainda precisam de revisão; veja `10-cache-de-midias.md`. Não foi testado nenhum acesso real à rede interna ou envio real. Essas alterações não resolvem a exposição do bucket público.

Fonte: https://supabase.com/docs/guides/storage/buckets/fundamentals
