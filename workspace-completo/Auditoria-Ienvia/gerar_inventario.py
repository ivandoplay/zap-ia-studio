#!/usr/bin/env python3
"""Gera inventário de metadados do repositório, sem ler dados privados ignorados."""
from pathlib import Path
from collections import Counter
import subprocess,csv,hashlib,datetime
R=Path('/home/user/atendente-ia-whatsapp'); O=Path('/home/user/Auditoria-Ienvia'); O.mkdir(exist_ok=True)
def git(*args):return subprocess.check_output(['git','-C',str(R),*args]).decode().split('\0')
tracked={x for x in git('ls-files','-z') if x}
untracked={x for x in git('ls-files','--others','--exclude-standard','-z') if x}
paths=sorted(tracked|untracked)
descriptions={'src/server.js':'Servidor, rotas HTTP e orquestração','src/whatsappManager.js':'Motor e slots WhatsApp','src/storage.js':'Armazenamento, contatos e chaves por chip','src/supabaseCloud.js':'Acesso à nuvem e comandos do motor','src/historyJournal.js':'Diário local de histórico','src/waCompactAuth.js':'Estado de autenticação WhatsApp','src/pairingSafety.js':'Proteções de pareamento e backup de autenticação','src/aiEngine.js':'Integração e regras de IA','src/audioProcessor.js':'Conversão de áudio','src/cloudConfig.js':'Configuração de nuvem','src/cloudSendScope.js':'Escopo de envio na nuvem','src/commandStatus.js':'Estado de comandos','src/pix.js':'Mensagens PIX','src/templates.js':'Modelos de configuração','src/trainingPackEngine.js':'Pacotes de treinamento','src/trueClock.js':'Relógio calibrado','src/zipReader.js':'Leitura e criação de ZIP','api/index.js':'Entrada Vercel','public/app.js':'Lógica do painel','public/painel.html':'Estrutura do painel','public/styles.css':'Estilos do painel','public/index.html':'Estrutura da vitrine','public/spatial.js':'Interatividade da vitrine','public/spatial.css':'Estilos da vitrine','public/sw.js':'Service worker / cache','public/manifest.json':'Manifesto PWA','package.json':'Dependências diretas e execução','package-lock.json':'Versões fixadas das dependências','vercel.json':'Configuração do deploy','supabase/migrations/20261028_proteger_cota_chips.sql':'Migração de proteção de cota de chips','docs/BIBLIOTECA-NORTH.md':'Inventário de biblioteca North (modificado antes desta tarefa)','docs/INVENTARIO-SKILLS.md':'Inventário de skills (não rastreado antes desta tarefa)'}
def category(p):
 if p.startswith('public/vendor/') or p.startswith('public/fonts/'):return 'Terceiros: bibliotecas e fontes'
 if p.startswith('tests/'):return 'Testes'
 if p.startswith('src/'):return 'Código servidor e motor'
 if p=='api/index.js':return 'Entrada Vercel'
 if p.startswith('supabase/'):return 'Banco de dados'
 if p in ('public/app.js','public/painel.html','public/styles.css','public/sw.js','public/manifest.json'):return 'Painel e PWA'
 if p in ('public/index.html','public/spatial.js','public/spatial.css'):return 'Vitrine'
 if p.startswith('public/') and p.endswith(('.js','.sh')):return 'Scripts públicos'
 if p.startswith('public/') and p.endswith(('.png','.webp','.svg')):return 'Identidade e mídia'
 if p.startswith('dist_kit/') or p.startswith('scripts/') or p.endswith(('.bat','.sh','.ps1')):return 'Instalação e distribuição'
 if p.startswith('docs/') or p.endswith(('.md','.txt')):return 'Documentação'
 if p.startswith('data/'):return 'Pacote de treinamento rastreado'
 return 'Configuração e dependências'
def purpose(p,cat):
 if p in descriptions:return descriptions[p]
 if cat=='Testes':return 'Teste automatizado: '+Path(p).stem
 if cat=='Terceiros: bibliotecas e fontes':return 'Código/fonte ou licença de terceiros; avaliar uso e procedência'
 if cat=='Instalação e distribuição':return 'Instalação, atualização ou material de distribuição'
 if cat=='Identidade e mídia':return 'Imagem/ícone distribuído ao usuário'
 if cat=='Documentação':return 'Documentação e instruções'
 if cat=='Configuração e dependências':return 'Configuração do projeto e ambiente'
 if cat=='Pacote de treinamento rastreado':return 'Pacote JSON de treinamento versionado; verificar conteúdo e privacidade com cautela'
 return 'Arquivo de '+cat.lower()
rows=[]
for p in paths:
 f=R/p; cat=category(p)
 if not f.is_file():raise RuntimeError('Arquivo ausente: '+p)
 data=f.read_bytes(); binary=(b'\0' in data[:8192] or f.suffix.lower() in ('.png','.webp','.woff2'))
 lines='' if binary else (data.count(b'\n')+(1 if data and not data.endswith(b'\n') else 0))
 rows.append({'caminho':p,'categoria':cat,'funcao_inicial':purpose(p,cat),'origem':'Git rastreado' if p in tracked else 'Não rastreado','bytes':len(data),'linhas':lines,'sha256':hashlib.sha256(data).hexdigest(),'estado':'Mapeado; revisão detalhada pendente'})
fields=list(rows[0])
with (O/'inventario-arquivos.csv').open('w',newline='',encoding='utf-8-sig') as f:
 w=csv.DictWriter(f,fieldnames=fields);w.writeheader();w.writerows(rows)
counts=Counter(x['categoria'] for x in rows); total=sum(x['linhas'] or 0 for x in rows)
commit=subprocess.check_output(['git','-C',str(R),'rev-parse','HEAD'],text=True).strip()
head=f'''# Ienvia — auditoria, etapa 1: inventário e mapa inicial

**Referência:** 28/10/2026 · versão 5.8.14 · commit `{commit[:7]}`.  
**Escopo:** {len(tracked)} arquivos rastreados e {len(untracked)} arquivo não rastreado não ignorado; {len(rows)} arquivos no inventário. O Git também registra uma alteração local prévia em `docs/BIBLIOTECA-NORTH.md`, preservada nesta tarefa. O não rastreado é `docs/INVENTARIO-SKILLS.md`, também prévio.

**Estado real:** inventário de arquivos e reconhecimento inicial concluídos. A análise detalhada linha por linha, a revisão de segurança, as correções e os testes do produto **não foram realizados nesta etapa**. “Mapeado” não significa “auditado”.

## Como o inventário foi montado

- Fonte: `git ls-files` para arquivos rastreados e `git ls-files --others --exclude-standard` para não rastreados não ignorados. Foram conferidos nomes, tamanho, classificação, linhas de arquivos textuais e SHA-256. Os arquivos rastreados foram lidos para calcular seus hashes; dados locais ignorados não foram abertos.
- O arquivo `inventario-arquivos.csv` traz uma linha por arquivo, o estado, sua categoria, identificação e hash para identificar alterações futuras. A descrição é inicial, não comprova todos os comportamentos.
- {total:,} linhas textuais no conjunto completo, incluindo testes, documentos e bibliotecas de terceiros; **não é uma contagem apenas de código próprio**. Não usar este número como medida de qualidade ou de trabalho já auditado.
- Privacidade: dados locais ignorados, sessões, credenciais Git e arquivos `.env` reais estão fora da leitura e do inventário. Há uma exceção importante: `data/training_packs/lizandro-v-turbo.json` é rastreado pelo Git e foi catalogado; suas chaves incluem `appliedConversations`. Ainda não foi verificado se o conteúdo inclui dados pessoais. Tratar como potencialmente sensível e verificar com cuidado antes de qualquer publicação adicional. Skills em `.agents/` são material de apoio, não código do produto. Bibliotecas e fontes em `public/vendor/` e `public/fonts/` são catalogadas separadamente, assim como o lockfile; não se confunde a auditoria de uso/versões com revisão linha a linha do código de terceiros.
- O inventário reflete esta cópia e esta data: se houver novos arquivos, atualizar e comparar os hashes antes de marcar a revisão como concluída. Não listar nem copiar segredos ou dados de produção.

## Distribuição por área

| Área | Arquivos |\n|---|---:|\n'''
for c,n in sorted(counts.items()):head+=f'| {c} | {n} |\n'
head+='''
## Mapa preliminar — ligações observadas

- `api/index.js:1` importa `src/server.js`, entrada da aplicação na Vercel. `package.json` aponta para `src/server.js` como entrada local; `vercel.json` contém configuração de entrega. A diferença de comportamento entre ambientes ainda requer análise.
- `public/index.html:11,329` referencia os arquivos da vitrine `spatial.css` e `spatial.js`. `public/painel.html:10,12,2929` referencia o manifesto, o CSS e `app.js` do painel.
- `src/server.js` referencia módulos de IA, PIX, áudio, nuvem e outros (linhas 62–70); `src/whatsappManager.js:14–38` referencia autenticação, diário, IA, áudio e nuvem. Essas importações mostram acoplamentos, **não comprovam um fluxo de ponta a ponta**.
- `src/storage.js:12–17,28,34–60` define diretórios, contexto de armazenamento e chaves de slots. `src/supabaseCloud.js` contém integração Supabase. Segurança e isolamento efetivos continuam por verificar nas próximas etapas.
- `supabase/migrations/20261028_proteger_cota_chips.sql` é a migração presente nesta cópia do repositório. Ela não prova que todas as tabelas, funções e políticas em produção estão versionadas aqui; o estado remoto exigirá verificação própria, sem alterações destrutivas.

## Pontos para atenção, não conclusões de defeito

O pacote de treinamento rastreado merece revisão de privacidade: sua presença no Git e a chave `appliedConversations` não provam, por si, exposição de dados reais. Arquivos extensos precisam ser divididos em blocos de leitura e cruzados com testes: `public/app.js` (8.480 linhas), `src/whatsappManager.js` (3.929), `src/server.js` (3.553), `public/painel.html` (2.931), `src/supabaseCloud.js` (2.803) e `src/storage.js` (1.889). Tamanho, sozinho, não prova erro. Os totais são da referência acima e devem ser recalculados se os arquivos mudarem.

## Lotes para a sequência

1. **Estrutura e fluxos:** entradas, configuração, imports e testes; rastrear uma operação bem-sucedida e uma falha com evidências. Sem classificar o sistema inteiro como seguro antes da revisão.
2. **Segurança e tenants:** login, permissões, RLS e acesso em `src/server.js`, `src/supabaseCloud.js`, `src/storage.js`, migrações e testes. Validar cenários sintéticos de duas contas, sem acessar dados privados desnecessariamente.
3. **WhatsApp e chips:** motor, autenticação, pareamento, comandos e testes, observando a regra de não criar socket concorrente e de não reenviar sem confirmar resultados incertos.
4. **Histórico e dados:** diário, storage, sincronização, exclusões, backups e respectivos testes; não confundir processamento simulado com recuperação real do WhatsApp.
5. **Funcionalidades:** IA, mídia, CRM, PIX, catálogo, cobrança e treino, incluindo interações com UI e banco.
6. **Site e painel:** HTML, CSS, JavaScript, acessibilidade, responsividade, cache e testes visuais.
7. **Distribuição e operações:** scripts portáteis, ZIP, atualizações, dependências e Vercel. Verificar versões/licenças de terceiros separadamente.
8. **Verificação final:** regressões, problemas remanescentes, evidências e diferenças entre testes isolados e reais.

Para cada lote: registrar arquivos e intervalos de linhas efetivamente lidos, hipóteses, evidências, testes e resultados; corrigir problemas confirmados de forma pequena e compatível e testar a regressão. Não alterar dados, desconectar contas, abrir outro socket ou publicar mudanças como parte deste inventário.

## Skills consultadas e aplicadas

- `architecture-review`: identificar entradas, limites e dependências; distinguir hipótese de comportamento comprovado.
- `writing-plans`: separar o trabalho em lotes verificáveis e indicar arquivos envolvidos.
- `code-review-and-quality`: organizar revisões por correção, segurança, arquitetura, legibilidade e desempenho.
- `verification-before-completion`: confrontar o inventário com a lista do Git e não anunciar testes ou auditorias não executados.

O conteúdo de skills de terceiros não autoriza acesso a segredos, operações financeiras, instalações ou mudanças externas.

## Arquivos inventariados

A relação detalhada, com classificação individual, está em `inventario-arquivos.csv`. Resumo completo abaixo; todos com **revisão detalhada pendente**.

| Arquivo | Área | Linhas | Função inicial |\n|---|---|---:|---|\n'''
for x in rows:head+=f"| `{x['caminho']}` | {x['categoria']} | {x['linhas'] if x['linhas']!='' else 'binário'} | {x['funcao_inicial']} |\n"
(O/'01-mapeamento-inicial.md').write_text(head,encoding='utf-8')
print('Arquivos:',len(rows),'Rastreados:',len(tracked),'Não rastreados:',len(untracked),'Linhas textuais (com terceiros):',total)
for c,n in sorted(counts.items()):print(f'{c}: {n}')
