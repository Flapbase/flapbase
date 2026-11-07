// A bounded static HTML reader. It reads source markup, including mobile menus.
export const decode = value => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/giu, (all, key) => {
  if (key[0] !== '#') return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' })[key.toLowerCase()]
  const code = key[1].toLowerCase() === 'x' ? parseInt(key.slice(2), 16) : Number(key.slice(1))
  return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : all
})
export const compact = value => value.replace(/\s+/gu, ' ').trim()
export function attributes(tag) {
  const attrs = Object.create(null)
  for (const m of tag.replace(/^<[^\s/>]+/u, '').matchAll(/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/gu)) {
    attrs[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '')
  }
  return attrs
}
export function readHtml(html) {
  const nodes = [], stack = []
  const voids = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr'])
  const tokens = /<!--[\s\S]*?-->|<(script|style|textarea|title)\b(?:"[^"]*"|'[^']*'|[^'">])*?>[\s\S]*?<\/\1\s*>|<\/?[a-z](?:"[^"]*"|'[^']*'|[^'">])*?>|[^<]+|</giu
  let heading = ''
  for (const m of html.matchAll(tokens)) {
    const raw = m[0]
    if (raw.startsWith('<!--')) continue
    if (raw.startsWith('</')) {
      const name = /^<\/([^\s>]+)/u.exec(raw)?.[1].toLowerCase()
      const index = stack.findLastIndex(node => node.tag === name)
      if (index >= 0) {
        if (/^h[1-6]$/u.test(name)) heading = name === 'h1' ? '' : compact(stack[index].text)
        stack.splice(index)
      }
    } else if (/^<[a-z]/iu.test(raw)) {
      if (nodes.length >= 20000 || stack.length >= 128) throw Object.assign(new Error('HTML の要素数か深さが上限を超えました。'), { code: 'file.html-complex' })
      const tag = /^<([^\s/>]+)/u.exec(raw)[1].toLowerCase()
      const openTag = /^<(?:"[^"]*"|'[^']*'|[^'">])*>/u.exec(raw)[0]
      const attrs = attributes(openTag)
      const node = { tag, attrs, parent: stack.at(-1) ?? null, text: '', offset: m.index, heading,
        hidden: !!stack.at(-1)?.hidden || ['head', 'script', 'style', 'template', 'noscript'].includes(tag)
          || Object.hasOwn(attrs, 'hidden') || attrs['aria-hidden'] === 'true' || /(?:display\s*:\s*none|visibility\s*:\s*hidden)/iu.test(attrs.style ?? '') }
      nodes.push(node)
      if (tag === 'img' && attrs.alt && !node.hidden) for (const ancestor of stack) ancestor.text += ' ' + attrs.alt
      if (m[1]) {
        node.text = raw.slice(openTag.length).replace(/<\/[^>]+>$/u, '')
        if (!node.hidden) for (const ancestor of stack) ancestor.text += ' ' + decode(node.text)
      } else if (!voids.has(tag) && !raw.endsWith('/>')) stack.push(node)
    } else {
      const text = decode(raw)
      // Keep hidden text for button labels, but exclude it from visible facts.
      for (const node of stack) if (!stack.at(-1)?.hidden || node.hidden) node.text += ' ' + text
    }
  }
  for (const node of nodes) if (node.tag !== 'script') node.text = compact(node.text)
  const lineStarts = [0]
  for (let i = 0; i < html.length; i++) if (html[i] === '\n') lineStarts.push(i + 1)
  const location = node => {
    let lo = 0, hi = lineStarts.length
    while (lo + 1 < hi) { const mid = (lo + hi) >> 1; if (lineStarts[mid] <= node.offset) lo = mid; else hi = mid }
    return { line: lo + 1, selector: node.tag + (node.attrs.id ? `#${node.attrs.id}` : ''), text: (node.text || node.attrs.content || node.attrs.href || node.attrs.src || '').slice(0, 240) }
  }
  return { nodes, location }
}
