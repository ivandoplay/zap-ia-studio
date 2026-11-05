#!/usr/bin/env python3
"""Inventário lexical reproduzível do commit publicado; não executa o painel/API.
Não é AST/call graph nem prova de cobertura ou equivalência operacional.
"""
import hashlib
import json
import re
import subprocess
from pathlib import Path

SHA = '7630b62b40b4518d06a157c4dc5055747fcb157e'
OUT = Path('/home/user/auditoria/implantacao-gradual/02-conversas-handlers.json')

def official(path):
    return subprocess.check_output(['git', 'show', f'{SHA}:{path}'], text=True)

def line(text, pos):
    return text.count('\n', 0, pos) + 1

html = official('public/painel.html')
app = official('public/app.js')
section_start = html.index('<section id="tab-crm"')
section_end = html.index('<section id="tab-contas"', section_start)
section = html[section_start:section_end]
# Referências inline do HTML e dos templates em app.js, intersectadas com funções
# declaradas no próprio monólito. Não considera `if` um handler.
declarations = {m.group(1): line(app, m.start()) for m in re.finditer(
    r'(?:^|\n)(?:window\.\w+\s*=\s*)?(?:async\s+)?function\s+(\w+)\s*\(', app)}
references = []
for source, text in [('public/painel.html#tab-crm', section), ('public/app.js', app)]:
    for m in re.finditer(r'\bon(?:click|input|change|submit|keydown|dragstart|drop)\s*=\s*([\"\x27])(.*?)\1', text):
        if source == 'public/app.js' and not (3100 <= line(text, m.start()) <= 5650 or line(text, m.start()) >= 8800):
            continue
        names = sorted(set(re.findall(r'\b([A-Za-z_$][\w$]*)\s*\(', m.group(2))) & declarations.keys())
        if names:
            references.append({'source': source, 'line': line(text, m.start()) + (line(html, section_start) - 1 if source.endswith('#tab-crm') else 0), 'declaredFunctions': names})
ids = set(re.findall(r'\bid="([^"]+)"', section))
listeners = []
for m in re.finditer(r"getElementById\(\s*(['\"])(.*?)\1\s*\)\s*\??\.addEventListener\(\s*(['\"])(.*?)\3", app):
    id_ = m.group(2)
    if id_ in ids or re.search(r'crm|inbox|inspector|contactsBook|funnelCoach|schedMsg|forward|quickReply|customTag|saveContact|FullBackup', id_, re.I):
        listeners.append({'id': id_, 'event': m.group(4), 'line': line(app, m.start())})
api_calls = []
for m in re.finditer(r'\b(api|apiBlobDownload|fetch)\(\s*([\"\x27`])(/api/.*?)\2', app):
    route = m.group(3)
    if not route.startswith(('/api/crm/', '/api/quick-replies', '/api/ignored-contacts', '/api/system/backup', '/api/system/restore', '/api/wa/sync-history')):
        continue
    tail = app[m.end():m.end()+350]
    method = re.search(r"\bmethod\s*:\s*['\"]([A-Z]+)['\"]", tail) if re.match(r'\s*,\s*\{', tail) else None
    api_calls.append({'routeTemplate': route, 'method': method.group(1) if method else 'GET', 'caller': m.group(1), 'line': line(app, m.start())})
# Downloads por navegação não passam pelo helper api().
for m in re.finditer(r'(?:href\s*=\s*|href=)[\"\x27`](/api/(?:crm/export\.csv|system/backup\.json)[^\"\x27`]*)', app):
    api_calls.append({'routeTemplate': m.group(1), 'method': 'GET', 'caller': 'navigation_download', 'line': line(app, m.start())})
functions = sorted({name for ref in references for name in ref['declaredFunctions']})
result = {
    'officialGitSha': SHA,
    'sourceHashes': {p: hashlib.sha256(official(p).encode()).hexdigest() for p in ['public/painel.html', 'public/app.js', 'src/server.js']},
    'status': 'lexical_inventory_plus_local_corrections_not_operational_approval',
    'scope': 'HTML oficial, handlers inline/templates, listeners diretos e chamadas CRM/auxiliares. Não AST, não todos listeners por variável/delegação, não execução.',
    'sectionIds': len(ids),
    'initialInventoryNonHandlerTokens': ['if'],
    'inlineAndTemplateReferences': references,
    'referencedDeclaredFunctions': [{'name': name, 'declarationLine': declarations[name]} for name in functions],
    'directListeners': listeners,
    'apiCallSites': api_calls,
    'counts': {'inlineAndTemplateReferences': len(references), 'referencedDeclaredFunctions': len(functions), 'directListeners': len(listeners), 'apiCallSites': len(api_calls)},
    'manuallyReviewed': ['getFilteredCrmContacts', 'renderActiveInboxConversation', 'updateInChatSearchHighlights', 'syncCrmTagDropdowns', 'applyTimedPause', 'switchCrmSubView', 'triggerFullWhatsAppHistorySync', 'fetchOlderChatMessages', 'quick_reply_keyboard_handlers', 'manual_send_and_attachment_handlers'],
    'productionWrites': False,
    'remoteRequests': False,
}
OUT.write_text(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'file': str(OUT), **result['counts']}, ensure_ascii=False))
