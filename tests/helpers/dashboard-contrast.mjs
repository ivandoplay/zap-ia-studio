// Auditoria básica de contraste para texto sólido visível. Não substitui auditoria WCAG completa.
export async function contrastIssues(page) {
  return page.evaluate(() => {
    const rgb = value => (value.match(/[\d.]+/g) || []).map(Number);
    const luminance = color => color.slice(0, 3).map(value => { value /= 255; return value <= .04045 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4; }).reduce((sum, value, index) => sum + value * [.2126, .7152, .0722][index], 0);
    const issues = [], walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent.trim(), element = node.parentElement;
      if (!text || !element || element.closest('.sr-only,script,style,button:disabled') || !element.getClientRects().length) continue;
      const style = getComputedStyle(element), foreground = rgb(style.color);
      const rect = element.getBoundingClientRect(), x = (rect.left + rect.right) / 2, y = (rect.top + rect.bottom) / 2;
      let ancestor = element, background;
      while (ancestor) { const color = rgb(getComputedStyle(ancestor).backgroundColor); const r = ancestor.getBoundingClientRect(); if ((color.length === 3 || color[3] === 1) && x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) { background = color; break; } ancestor = ancestor.parentElement; }
      background ||= [255, 255, 255];
      const a = luminance(foreground), b = luminance(background), ratio = (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
      const large = parseFloat(style.fontSize) >= 24 || (parseFloat(style.fontSize) >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5)) issues.push({ text: text.slice(0, 60), ratio: Number(ratio.toFixed(2)), color: style.color });
    }
    return issues;
  });
}
