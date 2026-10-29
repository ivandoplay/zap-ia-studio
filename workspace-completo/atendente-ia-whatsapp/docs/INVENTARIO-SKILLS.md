# Quantidade de skills no ambiente local

Contagem histórica em 28/10/2026: **228 arquivos `SKILL.md`** após a primeira limpeza: 128 em `.agents/skills/` e 100 na Biblioteca North extraída. Na limpeza posterior do workspace, a coleção North extraída foi removida após verificação byte a byte contra o ZIP íntegro `/home/user/Biblioteca-North-ZAP-IA.zip`; a coleção `.agents/skills/` permanece extraída. A tabela abaixo mantém as quantidades históricas, não a quantidade atualmente extraída. Os arquivos não garantem carregamento automático nem uso efetivo e `.agents/` não integra o deploy por padrão.

## Separação por assunto principal

Cada arquivo foi contado uma única vez, no assunto predominante. Existem competências que atravessam categorias: por exemplo, segurança também aparece em arquitetura e Supabase.

| Categoria | Quantidade |
|---|---:|
| 3D, animação e ilustração | 52 |
| Marketing, vendas e negócios | 47 |
| Produtividade, planejamento e documentação | 39 |
| Frontend, interface e UX | 31 |
| Testes, qualidade e desempenho | 21 |
| Backend, banco e arquitetura | 18 |
| Deploy e ferramentas de desenvolvimento | 9 |
| IA e WhatsApp | 7 |
| Segurança | 4 |
| **Total** | **228** |

A contagem é por arquivo, não por nome: há duas skills diferentes chamadas `prototype`, uma em cada coleção. Não há arquivos `SKILL.md` com conteúdo integral idêntico entre os 228 restantes.

## Limpeza realizada

A contagem original era de 242 arquivos. Foram removidos **14 arquivos** do ambiente local:

- 11 skills financeiras de day trade, sem relação direta com o projeto;
- 2 automações específicas de triagem e rotulagem de pull requests do projeto externo `vercel-labs/skills`;
- 1 arquivo `impeccable` que continha apenas um exemplo (`fixture`), preservando a skill completa de design `impeccable`.

Nenhum código, dado, conversa ou funcionalidade do ZAP-IA Studio foi removido. O arquivo `Biblioteca-North-ZAP-IA.zip`, gerado antes da limpeza no diretório do usuário, é um arquivo histórico separado e ainda pode conter as skills removidas. `BIBLIOTECA-NORTH.md` preserva o catálogo original de 113 arquivos para consulta de origem.

As coleções incluem ferramentas para tecnologias não usadas no produto atual, como React Native e Swift. Foram mantidas por poderem ser úteis em trabalhos futuros; não significam que o produto já use essas tecnologias.
