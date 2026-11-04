import { mountShell } from './shell.js';
mountShell({ pageId: 'dashboard', title: 'Visão geral' });
const formatter = new Intl.NumberFormat('pt-BR');
document.querySelectorAll('[data-number]').forEach(element => { element.textContent = formatter.format(Number(element.dataset.number)); });
const demo = [{ day: 'Seg', value: 84 }, { day: 'Ter', value: 112 }, { day: 'Qua', value: 96 }, { day: 'Qui', value: 140 }, { day: 'Sex', value: 128 }, { day: 'Sáb', value: 82 }, { day: 'Dom', value: 104 }];
for (const item of demo) {
  const li = document.createElement('li');
  const column = document.createElement('div'); column.className = `bar-column${item.day === 'Sex' ? ' is-highlighted' : ''}`;
  const bar = document.createElement('span'); bar.className = 'bar'; bar.style.height = `${item.value / 160 * 100}%`; bar.setAttribute('aria-hidden', 'true');
  const value = document.createElement('span'); value.className = 'bar-value'; value.textContent = formatter.format(item.value); value.setAttribute('aria-hidden', 'true');
  bar.append(value); column.append(bar);
  const label = document.createElement('span'); label.className = 'bar-label'; label.textContent = item.day; label.setAttribute('aria-hidden', 'true');
  const description = document.createElement('span'); description.className = 'sr-only'; description.textContent = `${item.day}: ${formatter.format(item.value)} conversas de exemplo.`;
  li.append(column, label, description); document.querySelector('#chart-bars').append(li);
}
