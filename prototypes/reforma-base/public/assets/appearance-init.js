// Aplicação ANTES dos estilos para evitar flash de tema errado no recarregamento.
// A prévia tem um único perfil FICTÍCIO, não uma sessão autenticada.
(() => {
  let theme = 'dark';
  try { if (localStorage.getItem('ienvia:appearance:v1:preview-demo') === 'light') theme = 'light'; } catch { /* Armazenamento bloqueado não pode impedir a página de abrir. */ }
  document.documentElement.dataset.theme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', theme === 'dark' ? '#101815' : '#f4f7f5');
})();
