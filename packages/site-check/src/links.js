import { lstat, realpath, readFile } from 'node:fs/promises'
import { resolve, relative, sep } from 'node:path'
import { finding } from './publication.js'
import { readHtml } from './html.js'

const inside = (root, path) => { const rel = relative(root, path); return rel !== '..' && !rel.startsWith(`..${sep}`) && !rel.startsWith(sep) }
export async function localDestination(link, { root, siteUrl }) {
  const url = new URL(link.destination), base = new URL(siteUrl)
  if (url.origin !== base.origin) return { status: 'unchecked', reason: 'フォルダ外の URL', finalUrl: url.href }
  let path, fragment
  try {
    const pathname = decodeURIComponent(url.pathname)
    const prefix = decodeURIComponent(base.pathname)
    fragment = decodeURIComponent(url.hash.slice(1))
    if (!pathname.startsWith(prefix)) return { status: 'unchecked', reason: '公開用ルートの外', finalUrl: url.href }
    path = resolve(root, pathname.slice(prefix.length))
  } catch { return { status: 'broken', reason: 'URL の書式', finalUrl: url.href } }
  const actualRoot = await realpath(root)
  if (!inside(root, path)) return { status: 'broken', reason: '公開用ルートの外', finalUrl: url.href }
  const candidates = url.pathname.endsWith('/') ? [resolve(path, 'index.html'), resolve(path, 'index.htm')]
    : [path, `${path}.html`, resolve(path, 'index.html'), resolve(path, 'index.htm')]
  for (const candidate of candidates) {
    try {
      const actual = await realpath(candidate)
      if (!inside(actualRoot, actual)) return { status: 'broken', reason: 'フォルダ外へのシンボリックリンク', finalUrl: url.href }
      const stat = await lstat(actual)
      if (!stat.isFile()) continue
      if (url.hash && /\.html?$/iu.test(candidate) && stat.size <= 1024 * 1024) {
        const { nodes } = readHtml(await readFile(actual, 'utf8'))
        if (!nodes.some(node => node.attrs.id === fragment || (node.tag === 'a' && node.attrs.name === fragment))) return { status: 'broken', reason: '頁内の宛先がない', finalUrl: url.href }
      }
      return { status: 'ok', reason: null, finalUrl: url.href, localPath: relative(root, candidate).split(sep).join('/') }
    } catch (error) { if (!['ENOENT', 'ENOTDIR', 'ELOOP'].includes(error.code)) throw error }
  }
  return { status: 'broken', reason: 'ファイルがない', finalUrl: url.href }
}

export async function checkBusinessLinks(publications, { root, siteUrl, read, permission, limit = 50 } = {}) {
  const cache = new Map()
  let count = 0
  for (const publication of publications) for (const link of publication.links) {
    let result
    if (!link.destination) result = { status: 'broken', reason: '宛先がないか URL の書式が不正' }
    else {
      const url = new URL(link.destination)
      if (['tel:', 'mailto:'].includes(url.protocol)) result = { status: url.pathname ? 'unchecked' : 'broken', reason: url.pathname ? '電話・メールの宛先' : '宛先がない', finalUrl: url.href }
      else if (!['https:', 'http:'].includes(url.protocol)) result = { status: 'broken', reason: 'HTTP(S) の宛先がない' }
      else if (cache.has(url.href)) result = cache.get(url.href)
      else if (count >= limit) result = { status: 'unchecked', reason: 'リンク点検の件数上限' }
      else {
        count++
        if (root) result = await localDestination(link, { root, siteUrl })
        else if (url.protocol !== 'https:') result = { status: 'broken', reason: 'HTTPS の宛先ではない', finalUrl: url.href }
        else {
          try {
            const response = await read(url.href, { beforeRequest: permission, maxBytes: 1024 * 1024, timeoutMs: 10000 })
            result = { status: response.status >= 200 && response.status < 400 ? 'ok' : 'broken', httpStatus: response.status, finalUrl: response.url, reason: response.status >= 400 ? `HTTP ${response.status}` : null }
          } catch (error) {
            result = { status: ['url.ssrf-blocked', 'url.invalid', 'url.redirect-limit'].includes(error.code) ? 'broken' : 'unchecked', reason: error.code ?? '取得失敗' }
          }
        }
        cache.set(url.href, result)
      }
    }
    Object.assign(link, result)
    if (link.kind === 'form' && [405, 501].includes(link.httpStatus)) Object.assign(link, { status: 'unchecked', reason: 'フォームの宛先は GET に応答しない' })
    if (link.status === 'broken') publication.findings.push(finding('business-link.broken', `${link.destination ?? link.target ?? link.label}:${link.reason}`,
      '予約・問い合わせ・購入の宛先に問題があります', '該当するリンクかフォームの宛先を、存在する公開先に直します。',
      [{ page: link.page, source: 'html', line: link.line, selector: link.selector, text: link.label,
        value: `${link.label}: ${link.target ?? '宛先なし'} (${link.reason})`, destination: link.destination, finalUrl: link.finalUrl,
        ...(link.profile ? { profile: link.profile } : {}) }], 6))
  }
}
