import { open, readdir, lstat, realpath } from 'node:fs/promises'
import { resolve, dirname, extname, relative, sep } from 'node:path'
import { CheckError, readPublic } from './fetch.js'
import { parsePublicHttpsUrl } from './public-url.js'
import { parseRobotsTxt, robotsAllows } from './robots.js'
import { DIAGNOSIS_FETCH_AGENT, sitemapLocation } from './public-read.js'
import { inspectChecks } from './checks.js'
import { buildReport, describeProfile } from './report.js'
import { inspectPublication, parseFacts, finishReport, finding } from './publication.js'
import { checkBusinessLinks } from './links.js'
import { compareBaseline } from './baseline.js'

export const LIMITS = Object.freeze({ html: 1024 * 1024, robots: 64 * 1024, sitemap: 256 * 1024,
  files: 100, totalBytes: 8 * 1024 * 1024, depth: 8 })
const isHtml = type => /^(?:text\/html|application\/xhtml\+xml)\b/iu.test(type ?? '')
const fatal = error => error.code === 'url.ssrf-blocked' || error.code === 'url.invalid'
  || error.code === 'url.body-too-large' || error.code === 'url.redirect-limit'
const pageOf = response => ({ url: response.url, status: response.status,
  html: response.text, server: response.headers.server ?? null,
  mitigated: response.headers['cf-mitigated'] === 'challenge', redirected: response.redirected })

// A single check is sequential and bounded; no model or hosted API is called.
export async function checkUrl(address, { now = new Date(), read = readPublic, facts } = {}) {
  facts = parseFacts(facts)
  const url = parsePublicHttpsUrl(address)
  const robotCache = new Map()
  async function robotsFor(target, signal) {
    if (robotCache.has(target.origin)) return robotCache.get(target.origin)
    let value
    try {
      const response = await read(`${target.origin}/robots.txt`, { maxBytes: LIMITS.robots, timeoutMs: 5000, accept: 'text/plain', signal })
      const good = response.text !== null && !isHtml(response.headers['content-type'])
      const absent = [404, 410].includes(response.status)
      const forbidden = [401, 403].includes(response.status)
      value = { fetched: { status: good ? response.status : absent ? 404 : response.status, text: good ? response.text : '' },
        parsed: good ? parseRobotsTxt(response.text) : null, known: good || absent, forbidden }
    } catch (error) {
      if (fatal(error)) throw error
      value = { fetched: null, parsed: null, known: false, forbidden: false }
    }
    robotCache.set(target.origin, value)
    return value
  }
  const robots = await robotsFor(url)
  async function permission(target, signal) {
    const state = await robotsFor(target, signal)
    if (state.forbidden || (state.parsed && !robotsAllows(state.parsed, DIAGNOSIS_FETCH_AGENT, `${target.pathname}${target.search}`))) {
      throw new CheckError('robots.blocked', 'robots.txt がこの頁の読み取りを止めています。')
    }
  }
  let page = null, blockedByRobots = false
  try {
    const response = await read(url.href, { beforeRequest: permission })
    if (response.text !== null && !isHtml(response.headers['content-type'])) throw new CheckError('url.not-html', '応答が HTML ではありません。')
    if (response.text === null && ![403, 429, 503].includes(response.status) && response.headers['cf-mitigated'] !== 'challenge') {
      throw new CheckError('url.unavailable', '頁の HTML を取得できませんでした。')
    }
    page = pageOf(response)
  }
  catch (error) { if (error.code === 'robots.blocked') blockedByRobots = true; else throw error }
  if (page?.html !== null && page?.html !== undefined) {
    if (page.html.length === 0) throw new CheckError('url.not-html', '空の応答は HTML として点検できません。')
  }
  const checks = page?.html ? inspectChecks(page.html, page.url) : []
  let sitemap = null
  const coverage = { html: !!page?.html, robots: robots.known, sitemap: false, languageProfiles: false }
  const profiles = []
  const variants = []
  if (page?.html) {
    const finalUrl = new URL(page.url)
    const finalRobots = await robotsFor(finalUrl)
    try {
      const response = await read(sitemapLocation(finalRobots.parsed, finalUrl.origin), {
        maxBytes: LIMITS.sitemap, timeoutMs: 5000, accept: 'application/xml,text/xml;q=0.9', beforeRequest: permission,
      })
      if (response.text !== null || [404, 410].includes(response.status)) {
        sitemap = { found: response.text !== null && !isHtml(response.headers['content-type']) && /<(?:urlset|sitemapindex)\b/iu.test(response.text.slice(0, 4096)) }
        coverage.sitemap = true
      }
    } catch (error) { if (fatal(error)) throw error }
    profiles.push(describeProfile('default', page))
    for (const [profile, language] of [['ja', 'ja'], ['en', 'en']]) {
      try {
        const response = await read(url.href, { language, beforeRequest: permission })
        if (isHtml(response.headers['content-type']) && response.text) {
          const publication = inspectPublication(response.text, response.url, facts)
          for (const evidence of [...publication.values, ...publication.facts.flatMap(fact => fact.evidence), ...publication.findings.flatMap(item => item.evidence)]) evidence.profile = profile
          for (const link of publication.links) link.profile = profile
          variants.push({ profile, url: response.url, ...publication })
        }
        profiles.push(describeProfile(profile, isHtml(response.headers['content-type']) ? pageOf(response) : null))
      } catch (error) { if (fatal(error)) throw error; profiles.push(describeProfile(profile, null)) }
    }
    coverage.languageProfiles = true
  }
  const report = buildReport({ requestedUrl: url.href, robots: robots.fetched, blockedByRobots, page, checks, sitemap, llmsTxt: null },
    { source: { kind: 'url', input: url.href }, coverage, profiles, now })
  report.factsRequested = facts
  if (page?.html) {
    report.publication = { ...inspectPublication(page.html, page.url, facts), variants }
    await checkBusinessLinks([report.publication, ...variants], { read, permission })
  }
  return finishReport(report)
}

async function readFileCapped(path, maxBytes) {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new CheckError('file.invalid', '通常のファイルを指定してください。')
  if (info.size > maxBytes) throw new CheckError('file.too-large', 'ファイルが大きさの上限を超えました。')
  const handle = await open(path, 'r')
  try {
    const buffer = Buffer.alloc(maxBytes + 1)
    let size = 0
    for (;;) {
      const { bytesRead } = await handle.read(buffer, size, buffer.length - size, null)
      size += bytesRead
      if (size > maxBytes) throw new CheckError('file.too-large', 'ファイルが大きさの上限を超えました。')
      if (!bytesRead) return buffer.subarray(0, size).toString('utf8')
    }
  } finally { await handle.close() }
}
async function optionalFile(path, max) {
  try { return await readFileCapped(path, max) } catch (error) { if (error.code === 'ENOENT') return null; throw error }
}
function canonicalOf(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/giu)) {
    const attr = name => new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'iu').exec(match[0])?.slice(1).find(Boolean)
    if (attr('rel')?.toLowerCase() === 'canonical') {
      try { const url = new URL(attr('href')); if (['https:', 'http:'].includes(url.protocol)) return url.href } catch { /* Use the local reference URL. */ }
    }
  }
  return null
}
export async function checkFile(path, { root = dirname(resolve(path)), rootIsSite = false, baseUrl, now = new Date(), facts, baseline } = {}) {
  facts = parseFacts(facts)
  const full = resolve(path)
  const html = await readFileCapped(full, LIMITS.html)
  const rel = relative(root, full).split(sep).map(encodeURIComponent).join('/')
  const route = rel.replace(/index\.html?$/iu, '')
  const url = baseUrl ? new URL(route, baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`).href : canonicalOf(html) ?? `https://example.com/${route}`
  const robotsText = await optionalFile(resolve(root, 'robots.txt'), LIMITS.robots)
  const parsed = robotsText !== null ? parseRobotsTxt(robotsText) : null
  const location = new URL(sitemapLocation(parsed, new URL(url).origin))
  let sitemapText = null
  // Resolve only paths inside the chosen folder; never follow remote sitemap URLs.
  const sitemapPath = resolve(root, '.' + decodeURIComponent(location.pathname))
  const relSitemap = relative(root, sitemapPath)
  if (!relSitemap.startsWith(`..${sep}`) && relSitemap !== '..') {
    const actualRoot = await realpath(root)
    try {
      const actualSitemap = await realpath(sitemapPath)
      const relActual = relative(actualRoot, actualSitemap)
      if (!relActual.startsWith(`..${sep}`) && relActual !== '..') sitemapText = await optionalFile(sitemapPath, LIMITS.sitemap)
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  const report = buildReport({ requestedUrl: url, robots: robotsText === null ? (rootIsSite ? { status: 404, text: '' } : null) : { status: 200, text: robotsText },
    blockedByRobots: false, page: { url, status: 200, html, server: null, mitigated: false, redirected: false },
    checks: inspectChecks(html, url), sitemap: sitemapText === null ? (rootIsSite ? { found: false } : null) : { found: /<(?:urlset|sitemapindex)\b/iu.test(sitemapText.slice(0, 4096)) }, llmsTxt: null },
  { source: { kind: 'file', input: full }, coverage: { html: true, robots: robotsText !== null || rootIsSite, sitemap: sitemapText !== null || rootIsSite, languageProfiles: false }, now })
  report.pagePath = relative(root, full).split(sep).join('/')
  report.factsRequested = facts
  report.publication = inspectPublication(html, url, facts, report.pagePath)
  // The base URL names the public root. With canonical-only input, derive the root from the file route.
  const siteUrl = baseUrl ? (baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`)
    : route && new URL(url).pathname.endsWith(route) ? new URL(url).href.slice(0, -route.length)
      : new URL('.', url).href
  await checkBusinessLinks([report.publication], { root: resolve(root), siteUrl })
  finishReport(report)
  if (baseline) report.difference = compareBaseline(report, baseline)
  return report
}

export async function check(input, { baseUrl, now = new Date(), facts, baseline } = {}) {
  facts = parseFacts(facts)
  const complete = report => {
    if (baseline) report.difference = compareBaseline(report, baseline)
    return report
  }
  if (/^[a-z][a-z0-9+.-]*:\/\//iu.test(input)) return complete(await checkUrl(input, { now, facts }))
  const full = resolve(input)
  const info = await lstat(full)
  if (info.isSymbolicLink()) throw new CheckError('file.invalid', 'シンボリックリンクは点検できません。')
  if (info.isFile()) return complete(await checkFile(full, { baseUrl, now, facts }))
  if (!info.isDirectory()) throw new CheckError('file.invalid', 'HTML ファイルかフォルダを指定してください。')
  const files = []
  const accidents = []
  let bytes = 0, entriesSeen = 0, scannedBytes = 0
  const accident = (path, code, title, fix) => {
    const page = relative(full, path).split(sep).join('/')
    accidents.push(finding(code, code, title, fix, [{ page, source: 'file', line: 1, selector: 'file', text: '', value: page }], 1))
  }
  async function walk(dir, depth) {
    if (depth > LIMITS.depth) throw new CheckError('folder.too-deep', 'フォルダの深さが上限を超えました。')
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries.sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
      if (++entriesSeen > 5000) throw new CheckError('folder.too-large', 'フォルダの項目数が上限を超えました。')
      const path = resolve(dir, entry.name)
      if (/^\.env(?:\.|$)/iu.test(entry.name)) accident(path, 'publication.env', '公開用フォルダに .env が混ざっています', '.env を公開用フォルダから外します。')
      if (entry.name === '.git') accident(path, 'publication.git', '公開用フォルダに .git が混ざっています', '.git を公開用フォルダから外します。')
      if (/\.(?:pem|key|p12|pfx)$/iu.test(entry.name) || /^id_(?:rsa|dsa|ecdsa|ed25519)$/u.test(entry.name)) accident(path, 'publication.private-key', '公開用フォルダに秘密鍵らしきファイルがあります', '鍵のファイルを公開用フォルダから外します。')
      if (entry.isSymbolicLink()) continue
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      if (entry.isDirectory()) await walk(path, depth + 1)
      else if (entry.isFile()) {
        const handle = await open(path, 'r')
        try {
          const buffer = Buffer.alloc(8192)
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0)
          scannedBytes += bytesRead
          if (scannedBytes > LIMITS.totalBytes) throw new CheckError('folder.too-large', '公開用ファイルの点検量が上限を超えました。')
          if (new RegExp('-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE' + ' KEY-----', 'u').test(buffer.subarray(0, bytesRead).toString('utf8'))) accident(path, 'publication.private-key', '公開用フォルダに秘密鍵らしきファイルがあります', '鍵のファイルを公開用フォルダから外します。')
        } finally { await handle.close() }
        if (!['.html', '.htm'].includes(extname(entry.name).toLowerCase())) continue
        files.push(path); bytes += (await lstat(path)).size
        if (files.length > LIMITS.files || bytes > LIMITS.totalBytes) throw new CheckError('folder.too-large', 'フォルダのファイル数か大きさが上限を超えました。')
      }
    }
  }
  await walk(full, 0)
  if (!files.length) throw new CheckError('folder.empty', 'HTML ファイルが見つかりません。')
  const reports = []
  for (const file of files) reports.push(await checkFile(file, { root: full, rootIsSite: true, baseUrl, now, facts }))
  return complete(finishReport({ version: 'flapbase.site-check-collection/v1', source: { kind: 'folder', input: full }, factsRequested: facts, reports }, accidents))
}
