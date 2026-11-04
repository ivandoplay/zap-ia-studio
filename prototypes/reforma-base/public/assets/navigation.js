// Navegação do protótipo. NÃO é autorização de backend nem sessão real.
const groups = [
  { label: 'Operação', items: [
    { id: 'dashboard', label: 'Visão geral', icon: 'overview', href: '/' },
    { id: 'crm', label: 'Conversas', icon: 'chat', children: [
      { id: 'inbox', label: 'Caixa de entrada' }, { id: 'contatos', label: 'Contatos' },
      { id: 'kanban', label: 'Kanban' }, { id: 'coach', label: 'Coach' }
    ] },
    { id: 'campanhas', label: 'Campanhas', icon: 'campaign' }
  ] },
  { label: 'Atendente', items: [
    { id: 'treinamento', label: 'Treinamento', icon: 'training' },
    { id: 'audios', label: 'Áudios', icon: 'audio' },
    { id: 'catalogo', label: 'Catálogo e PIX', icon: 'catalog' },
    { id: 'simulador', label: 'Simulador', icon: 'simulator' }
  ] },
  { label: 'Configurações', items: [
    { id: 'conexoes', label: 'Conexões e motor', icon: 'connection', href: '/conexoes/' },
    { id: 'ia', label: 'Motor de IA', icon: 'spark' },
    { id: 'seguranca', label: 'Segurança', icon: 'shield' }
  ] },
  { label: 'Administração', masterOnly: true, items: [
    { id: 'contas', label: 'Contas', icon: 'users' }
  ] }
];
export function getNavigation(role = 'titular') {
  if (!['titular', 'master'].includes(role)) return [];
  return groups.filter(group => !group.masterOnly || role === 'master').map(group => ({
    ...group, items: group.items.map(item => ({ ...item, href: item.href || `/revisao/?pagina=${item.id}`, ...(item.children ? { children: item.children.map(child => ({ ...child, href: `/revisao/?pagina=${item.id}&area=${child.id}` })) } : {}) }))
  }));
}
const normalize = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase('pt-BR');
export function findPages(query, role = 'titular') {
  const term = normalize(query);
  return getNavigation(role).flatMap(group => group.items).filter(page => !term || normalize(page.label).includes(term));
}
