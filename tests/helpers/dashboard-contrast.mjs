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
      const rect = element.getBoundingClientRect();
      // Texto em listas roláveis pode ter retângulo, mas estar fora da área visível.
      // Audite a interseção efetivamente pintada, não um ponto atrás do rodapé/viewport.
      let left=Math.max(0,rect.left),right=Math.min(innerWidth,rect.right),top=Math.max(0,rect.top),bottom=Math.min(innerHeight,rect.bottom);
      for(let parent=element.parentElement;parent;parent=parent.parentElement){const ps=getComputedStyle(parent),pr=parent.getBoundingClientRect();if(/auto|scroll|hidden|clip/.test(ps.overflowX)){left=Math.max(left,pr.left);right=Math.min(right,pr.right);}if(/auto|scroll|hidden|clip/.test(ps.overflowY)){top=Math.max(top,pr.top);bottom=Math.min(bottom,pr.bottom);}}
      if(left>=right||top>=bottom)continue;
      const x=(left+right)/2,y=(top+bottom)/2;
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
