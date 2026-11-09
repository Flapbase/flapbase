import { localizeReport, translate } from './language.js'
import { runPublicDiagnosis, organizationNames, DIAGNOSIS_CRAWLERS, CRAWLERS_VERSION } from './public-read.js'
import { parseRobotsTxt, robotsAllows } from './robots.js'
import { readInitialHtml } from './initial-html.js'
import { groupFindings, legacyFindings } from './publication.js'

export const RESULT_VERSION = 'flapbase.site-check/v1'
const langOf = html => /<html\b[^>]*\slang\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/iu.exec(html)?.slice(1).find(Boolean)?.toLowerCase() ?? null
const profileLabel = key => ({ default: '言語の指定なし', ja: '日本語の指定', en: '英語の指定' })[key] ?? key
const languageLabel = language => language ? ({ ja: '日本語', en: '英語', zh: '中国語', ko: '韓国語', fr: 'フランス語', de: 'ドイツ語', es: 'スペイン語' })[language.split('-')[0]] ?? language : '未確認'

export function describeProfile(profile, page) {
  return { profile, url: page?.url ?? null, status: page?.status ?? null,
    language: page?.html ? langOf(page.html) : null,
    visibleTextLength: page?.html ? readInitialHtml(page.html, page.url).visibleTextLength : null }
}

export function buildReport(fetched, { source, coverage, profiles = [], now = new Date() }) {
  const diagnosis = runPublicDiagnosis(fetched, now)
  let rows = diagnosis.rows.filter(row => row.stage === 'read')
  const issues = diagnosis.issues.filter(issue => issue.stage === 'read')
  // A missing observation must never be presented as an observed pass.
  if (!coverage.robots) rows = rows.map(row => ['robots', 'search-crawlers', 'training-crawlers'].includes(row.key)
    ? { ...row, value: '未確認', tone: 'na' } : row)
  rows = rows.map(row => row.key === 'language' && !coverage.languageProfiles
    ? { ...row, value: '未確認', tone: 'na' } : row)
  const html = fetched.page?.html
  if (html !== null && html !== undefined) {
    const org = organizationNames(html)
    rows.push({ key: 'organization', stage: 'read', part: 'ai', label: '運営の構造化データ',
      value: org.found ? 'ある' : 'ない', tone: org.found ? 'ok' : 'mid' })
    if (!org.found) issues.push({ key: 'organization-missing', stage: 'read', part: 'ai', ai: true,
      title: 'だれが運営しているかの構造化データがありません',
      why: '構造化データに、会社やお店（Organization・LocalBusiness）がありません。',
      fix: '会社名・お店の名前・所在地・連絡の方法を、ページに書いてあるのと同じ書き方で、JSON-LD に足します。' })
  }
  if (!coverage.sitemap) rows.push({ key: 'sitemap', stage: 'read', part: 'site', label: 'sitemap.xml', value: '未確認', tone: 'na' })
  if (profiles.length) {
    const baseline = profiles.find(item => item.profile === 'default')
    const japanese = profiles.find(item => item.profile === 'ja')
    const different = baseline?.language && profiles.some(item => item.language && item.language !== baseline.language)
    const incomplete = profiles.some(item => !item.language)
    rows = rows.map(row => row.key === 'language' ? { ...row,
      value: different ? '言語の指定で変わる' : incomplete ? '一部未確認' : '同じ言語が返る',
      tone: different ? 'mid' : incomplete ? 'na' : 'ok' } : row)
    if (baseline?.language && japanese?.language && baseline.language !== japanese.language && !issues.some(issue => issue.key === 'language-redirect')) {
      const at = issues.findIndex(issue => ['initial-html', 'page-basics', 'page-technical', 'jsonld-unreadable', 'sitemap-missing', 'organization-missing'].includes(issue.key))
      const issue = { key: 'language-variants', stage: 'read', part: 'ai', ai: true,
        title: '言語の指定で、返すページの言語が変わります',
        why: profiles.map(item => `${profileLabel(item.profile)}: ${languageLabel(item.language)}`).join('、'),
        fix: '言語を指定しない読み手に返すページを確認し、伝えたい内容をその HTML に入れます。' }
      issues.splice(at < 0 ? issues.length : at, 0, issue)
    }
  }
  const parsed = coverage.robots && fetched.robots && fetched.robots.status >= 200 && fetched.robots.status < 300
    ? parseRobotsTxt(fetched.robots.text) : null
  const path = new URL(fetched.requestedUrl)
  const crawlers = DIAGNOSIS_CRAWLERS.map(item => ({ ...item,
    allowed: coverage.robots ? (!parsed || robotsAllows(parsed, item.name, `${path.pathname}${path.search}`)) : null }))
  return { version: RESULT_VERSION, ruleSetVersion: 'web-publication-seo/v1', crawlersVersion: CRAWLERS_VERSION,
    source, url: diagnosis.url, checkedAt: diagnosis.checkedAt, coverage,
    checks: fetched.checks, issues: issues.map((issue, i) => ({ ...issue, priority: i + 1 })), rows, crawlers, profiles }
}

// Escape terminal controls in all remote values; JSON keeps the original evidence.
const safe = value => String(value).replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/gu, '')
export function formatReport(report, { lang = 'ja' } = {}) {
  report = localizeReport({ ...report, findings: report.findings ?? groupFindings(legacyFindings(report)) }, lang)
  const en = lang === 'en'
  const t = text => en ? translate(text) : text
  const findings = report.findings
  const lines = [en ? `Problems to fix before publishing: ${findings.length}` : `公開前に直すべき問題が ${findings.length} 件`]
  const summary = item => en ? `${item.title} (${item.pageCount} ${item.pageCount === 1 ? 'page' : 'pages'}: ${item.pages.join(', ')}). Fix: ${item.fix}` : `${item.title}（${item.pageCount}ページ: ${item.pages.join('、')}）。直す所: ${item.fix}`
  for (const item of findings) lines.push(`${item.priority}. ${summary(item)}`)
  if (report.difference) {
    lines.push('', en ? 'Changes since the last check' : '再点検の差分')
    for (const [key, label] of [['fixed', '直った所'], ['introduced', '新しく壊れた所'], ['continuing', '続いている所']]) {
      lines.push(en ? `${({ fixed: 'Fixed', introduced: 'New', continuing: 'Still present' })[key]}: ${report.difference[key].length}` : `${label}: ${report.difference[key].length} 件`)
      for (const item of report.difference[key]) lines.push(`  ${summary(item)}`)
    }
  }
  lines.push('', en ? 'Evidence' : '問題の根拠')
  for (const item of findings) for (const evidence of item.evidence) {
    lines.push(`${item.priority}. ${evidence.page}:${evidence.line} ${evidence.selector}${evidence.profile ? ` [${evidence.profile}]` : ''} [${evidence.source}] ${evidence.value}`)
  }
  const reports = report.reports ?? [report]
  for (const page of reports) {
    lines.push('', `${en ? 'Page' : 'ページ'}: ${page.pagePath ?? page.url}`)
    for (const publication of page.publication ? [page.publication, ...(page.publication.variants ?? [])] : []) {
      if (publication.profile) lines.push(`${en ? 'Requested language' : '言語の指定'}: ${publication.profile}`)
      for (const fact of publication.facts) {
        lines.push(`${fact.label}: ${fact.found ? fact.evidence.map(evidence => `${evidence.source} ${evidence.selector}:${evidence.line} ${evidence.value}`).join(' / ') : en ? 'missing from the initial HTML' : '初めの HTML に欠けている'}`)
      }
      for (const link of publication.links) {
        const status = t(({ ok: '確認済み', broken: '要修正', unchecked: '未確認' })[link.status])
        lines.push(en ? `Link from ${link.page}:${link.line} ${link.selector} “${link.label}”, target ${link.target ?? 'none'}, final ${link.finalUrl ?? 'unchecked'}, ${status}${link.reason ? ` (${link.reason})` : ''}`
          : `リンク元 ${link.page}:${link.line} ${link.selector}「${link.label}」、宛先 ${link.target ?? 'なし'}、最終 ${link.finalUrl ?? '未確認'}、${status}${link.reason ? ` (${link.reason})` : ''}`)
      }
    }
    lines.push(en ? '11 basic checks' : '基本の11項目')
    for (const check of page.checks) lines.push(`${check.label}: ${t(check.pass ? '確認済み' : '要修正')}`)
    if (!page.checks.length) lines.push(t('未確認'))
    for (const row of page.rows) lines.push(`${row.label}: ${row.value}`)
    const kind = en ? { search: 'search', user: 'answers', training: 'training' } : { search: '検索用', user: '質問への回答用', training: '学習用' }
    for (const crawler of page.crawlers) lines.push(`${crawler.name}${en ? '(' : '（'}${kind[crawler.kind]}${en ? ')' : '）'}: ${en ? crawler.allowed === null ? 'unchecked' : crawler.allowed ? 'allowed' : 'blocked' : crawler.allowed === null ? '未確認' : crawler.allowed ? '許可' : '拒否'}`)
  }
  return lines.map(safe).join('\n') + '\n'
}
