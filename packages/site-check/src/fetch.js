import { Resolver } from 'node:dns/promises'
import { request as httpsRequest } from 'node:https'
import { isIP, BlockList } from 'node:net'
import { parsePublicHttpsUrl, isNonPublicAddress } from './public-url.js'

export class CheckError extends Error {
  constructor(code, message) { super(message); this.name = 'CheckError'; this.code = code }
}
const fail = (code, message) => new CheckError(code, message)
const timeout = () => fail('url.timeout', '取得の時間上限を超えました。')
const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')
const excludedV6 = new BlockList()
excludedV6.addSubnet('2002::', 16, 'ipv6')
excludedV6.addSubnet('3fff::', 20, 'ipv6')
export const isBlockedDestination = address => isNonPublicAddress(address)
  || (isIP(address) === 6 && (!globalV6.check(address, 'ipv6') || excludedV6.check(address, 'ipv6')))

async function dnsLookup(host, { signal }) {
  const resolver = new Resolver({ timeout: 3000, tries: 1 })
  const cancel = () => resolver.cancel()
  signal.addEventListener('abort', cancel, { once: true })
  try {
    const answers = await Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)])
    // An absent record is expected; a failed family is unknown, so do not connect.
    for (const result of answers) if (result.status === 'rejected' && !['ENODATA', 'ENOTFOUND'].includes(result.reason.code)) throw result.reason
    return answers.flatMap((result, i) => result.status === 'fulfilled'
      ? result.value.map(address => ({ address, family: i === 0 ? 4 : 6 })) : [])
  } finally { signal.removeEventListener('abort', cancel) }
}

// Each response and DNS lookup shares one wall-clock deadline, including redirects.
async function until(promise, signal) {
  signal.throwIfAborted()
  let abort
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      abort = () => reject(signal.reason)
      signal.addEventListener('abort', abort, { once: true })
    })])
  } finally { signal.removeEventListener('abort', abort) }
}

function receive(url, addresses, { maxBytes, agent, language, accept, signal }, request) {
  return new Promise((resolve, reject) => {
    // Keep the DNS name for Host, SNI and certificate verification. Only lookup is pinned.
    const selected = addresses[0]
    const req = request(url, {
      method: 'GET', agent: false, signal, autoSelectFamily: false,
      family: selected.family, maxHeaderSize: 16 * 1024,
      lookup(_host, options, callback) {
        if (options?.all) callback(null, [selected])
        else callback(null, selected.address, selected.family)
      },
      headers: { Accept: accept, 'Accept-Encoding': 'identity', 'User-Agent': agent,
        ...(language ? { 'Accept-Language': language } : {}) },
    }, (res) => {
      const status = res.statusCode ?? 0
      const headers = res.headers
      const base = { url: url.href, status, headers, text: null }
      res.on('error', reject)
      res.on('aborted', () => reject(fail('url.unavailable', '取得が途中で終わりました。')))
      // Do not consume redirect/error bodies, cookies, or authentication challenges.
      if (status < 200 || status >= 300) { resolve(base); res.destroy(); return }
      const length = headers['content-length']
      if (length !== undefined && (!/^\d+$/u.test(length) || Number(length) > maxBytes)) {
        reject(fail('url.body-too-large', '応答が大きさの上限を超えました。')); res.destroy(); return
      }
      if (headers['content-encoding'] && headers['content-encoding'] !== 'identity') {
        reject(fail('url.encoding-blocked', '圧縮しない応答で取得できませんでした。')); res.destroy(); return
      }
      const chunks = []
      let size = 0
      res.on('data', (chunk) => {
        size += chunk.length
        if (size > maxBytes) {
          reject(fail('url.body-too-large', '応答が大きさの上限を超えました。')); res.destroy(); return
        }
        chunks.push(chunk)
      })
      res.on('end', () => resolve({ ...base, text: Buffer.concat(chunks).toString('utf8') }))
    })
    req.on('error', reject)
    req.end()
  })
}

// Test seams are kept in this module; the public check() API never accepts a transport.
export function createPublicReader({ lookup = dnsLookup, request = httpsRequest } = {}) {
  return async function read(address, {
    maxBytes = 1024 * 1024, timeoutMs = 10_000,
    agent = 'Flapbase-Site-Diagnosis', language = null,
    accept = 'text/html,application/xhtml+xml;q=0.9', beforeRequest, signal: parentSignal,
  } = {}) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(timeout()), timeoutMs)
    const signal = controller.signal
    const cancel = () => controller.abort(parentSignal.reason)
    if (parentSignal?.aborted) cancel()
    else parentSignal?.addEventListener('abort', cancel, { once: true })
    try {
      let url = parsePublicHttpsUrl(address)
      for (let hop = 0; ; hop++) {
        signal.throwIfAborted()
        if (beforeRequest) await until(Promise.resolve(beforeRequest(url, signal)), signal)
        const answers = await until(lookup(url.hostname, { all: true, verbatim: true, signal }), signal)
        if (!Array.isArray(answers) || answers.length === 0 || answers.length > 64 || answers.some(
          item => ![4, 6].includes(item.family) || isIP(item.address) !== item.family || isBlockedDestination(item.address),
        )) throw fail('url.ssrf-blocked', '内部の住所や私的ネットワークへの接続を拒否しました。')
        const response = await until(receive(url, answers, { maxBytes, agent, language, accept, signal }, request), signal)
        if (response.status >= 300 && response.status < 400) {
          if (!response.headers.location || hop >= 3) throw fail('url.redirect-limit', '転送先を確かめられませんでした。')
          url = parsePublicHttpsUrl(new URL(response.headers.location, url).href)
          continue
        }
        return { ...response, redirected: hop > 0 }
      }
    } catch (error) {
      if (signal.aborted) throw signal.reason
      if (error.code?.startsWith('url.') || error.code === 'robots.blocked') throw error
      throw fail('url.unavailable', '公開 URL を取得できませんでした。')
    } finally { clearTimeout(timer); parentSignal?.removeEventListener('abort', cancel) }
  }
}

export const readPublic = createPublicReader()
