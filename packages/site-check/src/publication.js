import { createHash } from 'node:crypto'
import { readHtml, compact } from './html.js'

export const DEFAULT_FACTS = ['price', 'area', 'booking']
export const FACT_LABELS = { price: '料金', area: '対応地域', booking: '予約方法' }
const FIELD_LABELS = { price: '料金', days: '営業日', address: '住所', phone: '電話' }
const action = /予約|申し込|問い合わせ|問合せ|購入|買う|カート|\b(?:book(?:ing)?|reserv\w*|contact|buy|purchase|checkout)\b/iu
const fieldWords = {
  price: /料金|価格|宿泊費|(?:price|rate|cost)/iu,
  area: /対応地域|対象地域|サービスエリア|所在地|住所|アクセス|(?:area served|service area|location|address)/iu,
  booking: /予約|申し込|(?:book(?:ing)?|reserv\w*)/iu,
  days: /営業日|定休日|営業曜日|(?:opening days|opening hours|closed on|open on)/iu,
  address: /所在地|住所|(?:address|location)/iu,
  phone: /電話|(?:phone|telephone|tel\b)/iu,
}
const hash = value => createHash('sha256').update(value).digest('hex').slice(0, 20)
export const finding = (code, cause, title, fix, evidence, rank = 30) => ({ code, cause, title, fix, evidence, rank })
const ev = (page, location, value, source = 'html', field, subject) => ({ page, source, ...location, value, ...(field ? { field, subject: subject ?? 'business' } : {}) })
const normalize = (field, value) => {
  const text = compact(String(value).normalize('NFKC'))
  if (field === 'price') return String(Number(text.replace(/[^\d.]/gu, '')))
  if (field === 'phone') return text.replace(/^\+81[ -]?/u, '0').replace(/[^\d]/gu, '')
  if (field === 'address') return text.replace(/^(?:日本|Japan|JP)[,、\s]*/iu, '').replace(/〒?\d{3}-\d{4}/gu, '').replace(/[\s,、]/gu, '')
  if (field === 'days') {
    const days = ['月', '火', '水', '木', '金', '土', '日']
    const closed = /定休日|closed/iu.test(text)
    let result = text.replace(fieldWords.days, '').replace(/Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|\bMo\b|\bTu\b|\bWe\b|\bTh\b|\bFr\b|\bSa\b|\bSu\b/giu,
      word => days[({ mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6 })[word.slice(0, 2).toLowerCase()]])
    result = result.replace(/([月火水木金土日])(?:曜日)?\s*[〜～–-]\s*([月火水木金土日])(?:曜日)?/gu, (_, a, b) => {
      const start = days.indexOf(a), end = days.indexOf(b)
      return Array.from({ length: (end - start + 7) % 7 + 1 }, (__, i) => days[(start + i) % 7]).join('')
    })
    const found = days.filter(day => result.includes(day)).join('')
    return found ? days.filter(day => closed ? !found.includes(day) : found.includes(day)).join('') : text
  }
  return text
}
const yen = text => [...text.normalize('NFKC').matchAll(/(?:[¥￥]\s*([\d,]+(?:\.\d+)?)|([\d,]+(?:\.\d+)?)\s*円)/gu)].map(m => m[1] ?? m[2])

export function parseFacts(value = DEFAULT_FACTS) {
  const facts = typeof value === 'string' ? value.split(',').map(item => item.trim()) : value
  if (!Array.isArray(facts) || !facts.length || facts.some(key => !Object.hasOwn(FACT_LABELS, key))) {
    throw new Error('--facts は price,area,booking から指定してください。')
  }
  return [...new Set(facts)]
}

export function inspectPublication(html, address, facts = DEFAULT_FACTS, page = address) {
  facts = parseFacts(facts)
  const { nodes, location } = readHtml(html)
  const values = [], factEvidence = { price: [], area: [], booking: [] }, links = [], findings = []
  const addValue = (field, value, node, source = 'html', subject) => {
    const item = ev(page, location(node), String(value), source, field, subject)
    item.normalized = normalize(field, value)
    values.push(item)
    if (field === 'price') factEvidence.price.push(item)
    return item
  }
  const bodyNodes = nodes.filter(node => !node.hidden)
  const blockTags = new Set(['p', 'li', 'td', 'dd', 'dt', 'address', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'div', 'section'])
  const withBlocks = new Set()
  for (const node of bodyNodes) if (blockTags.has(node.tag)) {
    let parent = node.parent
    while (parent) { withBlocks.add(parent); parent = parent.parent }
  }
  const bookingStatement = /予約(?:方法|は|受付|フォーム)|(?:電話|フォーム|メール|オンライン|ウェブ)[^。.!?]{0,40}(?:予約|申し込)|(?:予約|申し込)[^。.!?]{0,40}(?:電話|フォーム|メール|オンライン|ウェブ)|how to book|book(?:ing)? (?:by|online|via)|reserv\w* (?:by|online|via)/iu
  for (const node of bodyNodes) {
    const label = `${node.attrs['data-fact'] ?? ''} ${node.heading} ${node.text}`
    // Leaf blocks and explicitly marked facts keep evidence close to its source.
    const explicit = !!node.attrs['data-fact']
    if ((!blockTags.has(node.tag) || withBlocks.has(node)) && !explicit) continue
    let owner = node
    while (owner && !owner.attrs['data-subject']) owner = owner.parent
    const subject = owner?.attrs['data-subject'] ?? 'business'
    for (const amount of yen(node.text)) addValue('price', amount, node, 'html', subject)
    for (const field of ['area', 'booking']) {
      const matches = field === 'booking' ? bookingStatement.test(node.text) || /予約方法|how to book|booking method/iu.test(node.heading) : fieldWords[field].test(label)
      if ((node.attrs['data-fact'] === field || matches) && node.text.replace(fieldWords[field], '').replace(/[\s:：]/gu, '')) {
        factEvidence[field].push(ev(page, location(node), node.text))
      }
    }
    for (const field of ['days', 'address', 'phone']) {
      const explicit = node.attrs['data-fact'] === field
      if (!explicit && !fieldWords[field].test(label)) continue
      if (field === 'phone') {
        for (const m of node.text.matchAll(/(?:\+81[ -]?|0)\d{1,4}[ -]?\d{1,4}[ -]?\d{3,4}/gu)) addValue(field, m[0], node, 'html', subject)
      } else {
        const value = field === 'days' ? node.text : node.text.replace(fieldWords[field], '').replace(/^\s*[:：]\s*/u, '').trim()
        if (value) addValue(field, value, node, 'html', subject)
      }
    }
  }
  for (const node of nodes.filter(node => node.tag === 'script' && node.attrs.type?.toLowerCase() === 'application/ld+json')) {
    let json
    try { json = JSON.parse(node.text) } catch { continue }
    const queue = [{ value: json, subject: 'business' }]
    for (let i = 0; i < queue.length && i < 20000; i++) {
      const { value, subject } = queue[i]
      if (!value || typeof value !== 'object') continue
      const types = [value['@type']].flat()
      const scope = types.some(type => ['Product', 'Service', 'Offer'].includes(type)) ? value.name ?? subject : subject
      if (['number', 'string'].includes(typeof value.price) && /^\d[\d,]*(?:\.\d+)?$/u.test(String(value.price)) && (!value.priceCurrency || value.priceCurrency === 'JPY')) addValue('price', value.price, node, 'jsonld', scope)
      if (value.telephone) addValue('phone', value.telephone, node, 'jsonld')
      if (value.address) {
        const a = value.address
        const address = typeof a === 'string' ? a : [a.addressRegion, a.addressLocality, a.streetAddress].filter(Boolean).join('')
        if (address) { addValue('address', address, node, 'jsonld'); factEvidence.area.push(ev(page, location(node), address, 'jsonld')) }
      }
      for (const key of ['areaServed', 'serviceArea']) if (value[key]) {
        for (const area of [value[key]].flat()) {
          const text = typeof area === 'string' ? area : area?.name
          if (text) factEvidence.area.push(ev(page, location(node), text, 'jsonld'))
        }
      }
      if (value.dayOfWeek) {
        const days = [value.dayOfWeek].flat().map(day => String(day).replace(/^.*\//u, '')).join(', ')
        addValue('days', days, node, 'jsonld')
      }
      if (typeof value.openingHours === 'string') addValue('days', value.openingHours.replace(/\s+\d.*$/u, ''), node, 'jsonld')
      if (types.includes('ReserveAction')) {
        const target = value.target ?? value.url
        const destination = typeof target === 'string' ? target : target?.urlTemplate ?? target?.url
        if (destination) factEvidence.booking.push(ev(page, location(node), String(destination), 'jsonld'))
      }
      for (const child of Object.values(value)) if (child && typeof child === 'object') queue.push({ value: child, subject: scope })
    }
  }
  let base = address
  const baseNode = nodes.find(node => node.tag === 'base' && node.attrs.href)
  if (baseNode) { try { base = new URL(baseNode.attrs.href, address).href } catch { /* Keep the page URL. */ } }
  for (const node of nodes) {
    if (node.tag === 'a' && !node.hidden && node.attrs.href?.startsWith('tel:')) addValue('phone', node.text.match(/(?:\+81[ -]?|0)\d[\d -]+/u)?.[0] ?? node.attrs.href.slice(4), node)
    if (!['a', 'button', 'form', 'input'].includes(node.tag)) continue
    const label = compact(node.attrs['aria-label'] || node.text || node.attrs.value || node.attrs.alt || '')
    const form = node.tag === 'form' ? node : node.attrs.form ? nodes.find(candidate => candidate.tag === 'form' && candidate.attrs.id === node.attrs.form)
      : (() => { let parent = node.parent; while (parent && parent.tag !== 'form') parent = parent.parent; return parent })()
    if (node.tag !== 'form' && !action.test(label)) continue
    if (node.tag === 'input' && !['submit', 'button', 'image'].includes(node.attrs.type)) continue
    const target = node.attrs.formaction ?? (node.tag === 'a' ? node.attrs.href : form?.attrs.action)
    // A form with no action submits to its own URL. A button without a target needs review.
    const href = target ?? (form ? address : null)
    let destination = null
    try { if (href !== null) destination = new URL(href, base).href } catch { /* Report invalid markup as a broken destination. */ }
    const link = { page, ...location(node), label: label || 'フォーム', target: href, destination, finalUrl: null, status: 'unchecked', httpStatus: null, reason: null, kind: node.tag === 'a' ? 'link' : 'form' }
    links.push(link)
    if (!node.hidden && destination && /^https?:/iu.test(destination) && fieldWords.booking.test(label)) factEvidence.booking.push(ev(page, location(node), `${label} (${href})`))
  }
  if (new URL(address).protocol === 'https:') {
    const resources = new Set(['script', 'img', 'iframe', 'audio', 'video', 'source', 'embed', 'object', 'input'])
    for (const node of nodes) {
      const targets = []
      if (resources.has(node.tag)) targets.push(node.attrs.src, node.attrs.data, node.attrs.poster)
      if (['img', 'source'].includes(node.tag) && node.attrs.srcset) targets.push(...node.attrs.srcset.split(',').map(part => part.trim().split(/\s/u)[0]))
      if (node.tag === 'link' && /stylesheet|preload|modulepreload|icon/iu.test(node.attrs.rel ?? '')) targets.push(node.attrs.href)
      for (const match of `${node.attrs.style ?? ''} ${node.tag === 'style' ? node.text : ''}`.matchAll(/(?:url\(\s*["']?|@import\s+["'])(http:\/\/[^\s)'";]+)/giu)) targets.push(match[1])
      for (const target of targets.filter(Boolean)) {
        let resource
        try { resource = new URL(target, base).href } catch { continue }
        if (resource.startsWith('http:')) findings.push(finding('publication.mixed-content', resource, 'HTTPS の頁が HTTP の資源を読んでいます', '資源の URL を HTTPS に直します。', [ev(page, location(node), resource)], 2))
      }
    }
  }
  const resultFacts = facts.map(key => ({ key, label: FACT_LABELS[key], found: factEvidence[key].length > 0, evidence: factEvidence[key] }))
  for (const fact of resultFacts) if (!fact.found) findings.push(finding(`fact.${fact.key}.missing`, fact.key, `初めの HTML に${fact.label}がありません`, `${fact.label}を本文か JSON-LD に入れます。`, [ev(page, { line: 1, selector: 'html', text: '' }, '欠けている')], 20))
  const htmlLocations = {}
  const tags = { doctype: 'html', html: 'html', charset: 'meta', viewport: 'meta', title: 'title', description: 'meta', canonical: 'link', h1: 'h1', jsonld: 'script', 'initial-html': 'body', robots: 'meta' }
  for (const [key, tag] of Object.entries(tags)) {
    const node = nodes.find(node => node.tag === tag && (key === 'robots' ? ['robots', 'googlebot'].includes(node.attrs.name?.toLowerCase())
      : key === 'charset' ? Object.hasOwn(node.attrs, 'charset') : ['viewport', 'description'].includes(key) ? node.attrs.name === key
        : key === 'canonical' ? node.attrs.rel === 'canonical' : key === 'jsonld' ? node.attrs.type === 'application/ld+json' : true))
    if (node) htmlLocations[key] = location(node)
  }
  return { facts: resultFacts, links, values, findings, htmlLocations }
}

export function legacyFindings(report) {
  const page = report.pagePath ?? (report.source.kind === 'file' ? report.source.input : report.url)
  const details = []
  for (const check of report.checks) for (const item of check.findings) {
    const code = `html.${item.code}`
    const cause = item.code === 'robots.noindex' ? 'meta robots noindex'
      : item.code.startsWith('canonical.') ? `${item.code}:${report.publication?.htmlLocations.canonical?.text ?? item.message}` : item.message
    details.push(finding(code, cause,
      item.message, ({ robots: '共通の head にある noindex を外します。', title: 'title を1つにし、8〜70文字で頁の内容を書きます。', description: 'meta description を1つにし、30〜160文字で頁の内容を書きます。', h1: 'h1 を1つにして頁の見出しを書きます。', canonical: 'canonical にこの頁の公開 URL を書きます。', jsonld: 'JSON-LD の型と JSON の書式を直します。' })[check.key] ?? `共通の HTML の ${check.label} を直します。`,
      [ev(page, report.publication?.htmlLocations[check.key] ?? { line: 1, selector: check.key === 'robots' ? 'meta[name=robots]' : check.key, text: '' }, item.message)], check.key === 'robots' ? 5 : 15))
  }
  for (const issue of report.issues) {
    if (['noindex', 'initial-html', 'page-basics', 'page-technical', 'jsonld-unreadable'].includes(issue.key) && details.length) continue
    details.push(finding(issue.key, issue.why, issue.title, issue.fix, [ev(page, { line: 1, selector: 'html', text: '' }, issue.why)], 10))
  }
  return details
}

export function compareValues(publications) {
  const groups = new Map(), findings = []
  for (const publication of publications) for (const value of publication.values) {
    const key = `${value.field}:${value.subject}`
    if (!groups.has(key)) groups.set(key, new Map())
    const sources = groups.get(key), source = `${value.page}:${value.profile ?? ''}:${value.source}`
    if (!sources.has(source)) sources.set(source, [])
    if (!sources.get(source).some(item => item.normalized === value.normalized)) sources.get(source).push(value)
  }
  for (const [key, sources] of groups) {
    const sets = [...sources.values()]
    if (sets.length < 2) continue
    const signatures = sets.map(items => JSON.stringify(items.map(item => item.normalized).sort()))
    if (new Set(signatures).size > 1) {
      const field = sets[0][0].field
      findings.push(finding(`consistency.${field}`, key, `${FIELD_LABELS[field]}が食い違っています`, '同じ対象の記載を確認し、本文・別言語の頁・JSON-LD をそろえます。', sets.flat(), 8))
    }
  }
  return findings
}

export function groupFindings(items) {
  const groups = new Map()
  for (const item of items) {
    const id = `${item.code}:${hash(item.cause)}`
    if (!groups.has(id)) groups.set(id, { id, ...item, evidence: [] })
    const group = groups.get(id)
    for (const evidence of item.evidence) if (!group.evidence.some(previous => JSON.stringify(previous) === JSON.stringify(evidence))) group.evidence.push(evidence)
  }
  return [...groups.values()].sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id)).map((item, index) => {
    const pages = [...new Set(item.evidence.map(evidence => evidence.page))].sort()
    return { ...item, priority: index + 1, pageCount: pages.length, pages }
  })
}

export function finishReport(report, extra = []) {
  const reports = report.reports ?? [report]
  const publications = reports.flatMap(item => item.publication ? [item.publication, ...(item.publication.variants ?? [])] : [])
  report.findings = groupFindings([...reports.flatMap(legacyFindings),
    ...publications.flatMap(item => item.findings), ...compareValues(publications), ...extra])
  return report
}
