import test from 'node:test'
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { createPublicReader, isBlockedDestination } from '../packages/site-check/src/fetch.js'
import { parsePublicHttpsUrl, isNonPublicAddress } from '../packages/site-check/src/public-url.js'
import { checkBusinessLinks } from '../packages/site-check/src/links.js'
import { inspectPublication } from '../packages/site-check/src/publication.js'

const publicIp = { address: '8.8.8.8', family: 4 }
function setup(responses, lookup = async () => [publicIp]) {
  const calls = [], destroyed = []
  const request = (url, options, callback) => {
    const req = new EventEmitter()
    req.end = () => queueMicrotask(() => {
      if (!responses.length) return
      const response = responses.shift()
      const res = new EventEmitter()
      res.statusCode = response.status ?? 200
      res.headers = response.headers ?? { 'content-type': 'text/html' }
      res.destroy = () => { destroyed.push(res); res.destroyed = true }
      callback(res)
      for (const chunk of response.chunks ?? [Buffer.from(response.text ?? '<html></html>')]) if (!res.destroyed) res.emit('data', chunk)
      if (!res.destroyed && !response.hang) res.emit('end')
    })
    options.signal.addEventListener('abort', () => req.emit('error', options.signal.reason), { once: true })
    calls.push({ url, options })
    return req
  }
  return { read: createPublicReader({ lookup, request }), calls, destroyed }
}
for (const address of ['http://example.com', 'https://localhost', 'https://localhost.', 'https://metadata.google.internal',
  'https://127.0.0.1', 'https://2130706433', 'https://0x7f000001', 'https://[::1]', 'https://user:pass@example.com',
  'https://example.com:8443', 'https://example.com/?token=value', 'file:///tmp/site.html', 'https://example.com/\n']) {
  test(`危険な URL を拒否: ${address.trim()}`, () => assert.throws(() => parsePublicHttpsUrl(address)))
}
for (const address of ['0.0.0.0', '10.1.1.1', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.0.1',
  '100.64.0.1', '192.0.0.1', '192.0.2.1', '198.18.0.1', '198.51.100.1', '203.0.113.1', '224.0.0.1',
  '::', '::1', 'fc00::1', 'fe80::1', 'ff02::1', '2001:db8::1', '::ffff:127.0.0.1', '64:ff9b::a00:1',
  '2002:7f00:1::', '2001:0::1', 'bad']) {
  test(`非公開の IP を拒否: ${address}`, () => assert.equal(isNonPublicAddress(address), true))
}
test('公開 IPv4 と IPv6 を通す', () => {
  assert.equal(isNonPublicAddress('8.8.8.8'), false)
  assert.equal(isNonPublicAddress('2606:4700:4700::1111'), false)
})
test('Node の接続では IPv6 の変換用・文書用アドレスも拒否する', () => {
  for (const address of ['::ffff:8.8.8.8', '64:ff9b::808:808', '64:ff9b:1::808:808', '2002:808:808::', '3fff::1']) {
    assert.equal(isBlockedDestination(address), true)
  }
  assert.equal(isBlockedDestination('2606:4700:4700::1111'), false)
})
test('DNS の返す値を全件検査し、私的 IP が混ざると接続しない', async () => {
  const { read, calls } = setup([], async () => [publicIp, { address: '10.0.0.1', family: 4 }])
  await assert.rejects(read('https://example.com'), { code: 'url.ssrf-blocked' })
  assert.equal(calls.length, 0)
})
test('確認した IP だけに固定し、元の Host と TLS 検証を保つ', async () => {
  let lookups = 0
  const { read, calls } = setup([{}], async () => { lookups++; return [publicIp] })
  await read('https://example.com')
  const call = calls[0]
  assert.equal(call.url.hostname, 'example.com')
  assert.equal(call.options.agent, false)
  assert.equal(call.options.autoSelectFamily, false)
  assert.equal(call.options.rejectUnauthorized, undefined)
  for (let i = 0; i < 2; i++) await new Promise((resolve, reject) => call.options.lookup('example.com', {}, (err, address, family) => {
    if (err) return reject(err)
    assert.equal(address, publicIp.address); assert.equal(family, 4); resolve()
  }))
  assert.equal(lookups, 1)
  assert.equal(call.options.headers['Accept-Language'], undefined)
  assert.equal(call.options.headers.Cookie, undefined)
})
test('内部への転送先には接続しない', async () => {
  const { read, calls, destroyed } = setup([{ status: 302, headers: { location: 'https://127.0.0.1/' } }])
  await assert.rejects(read('https://example.com'), { code: 'url.ssrf-blocked' })
  assert.equal(calls.length, 1); assert.equal(destroyed.length, 1)
})
test('転送先の DNS を再検査して rebinding を拒否する', async () => {
  let count = 0
  const { read, calls } = setup([{ status: 302, headers: { location: '/next' } }], async () => ++count === 1 ? [publicIp] : [{ address: '127.0.0.1', family: 4 }])
  await assert.rejects(read('https://example.com'), { code: 'url.ssrf-blocked' })
  assert.equal(calls.length, 1)
})
test('公開の転送と各 hop の許可を確認する', async () => {
  const visited = []
  const { read } = setup([{ status: 302, headers: { location: '/next' } }, {}])
  const result = await read('https://example.com', { beforeRequest: url => visited.push(url.href) })
  assert.equal(result.redirected, true)
  assert.deepEqual(visited, ['https://example.com/', 'https://example.com/next'])
})
test('予約リンクの転送を実際の reader で追い、最終 URL と各 hop の許可を返す', async () => {
  const publication = inspectPublication('<a href="/booking">予約する</a>', 'https://example.com/')
  const visited = []
  const { read, calls } = setup([{ status: 302, headers: { location: '/booking-final' } }, {}])
  await checkBusinessLinks([publication], { read, permission: target => visited.push(target.href) })
  assert.equal(publication.links[0].status, 'ok')
  assert.equal(publication.links[0].finalUrl, 'https://example.com/booking-final')
  assert.equal(calls.length, 2)
  assert.deepEqual(visited, ['https://example.com/booking', 'https://example.com/booking-final'])
})
test('HTTP への転送は拒否する', async () => {
  const { read } = setup([{ status: 302, headers: { location: 'http://example.com/' } }])
  await assert.rejects(read('https://example.com'), { code: 'url.invalid' })
})
test('転送は3回を上限にする', async () => {
  const { read, calls } = setup(Array.from({ length: 4 }, () => ({ status: 302, headers: { location: '/next' } })))
  await assert.rejects(read('https://example.com'), { code: 'url.redirect-limit' })
  assert.equal(calls.length, 4)
})
test('Content-Length で大容量を拒否する', async () => {
  const { read, destroyed } = setup([{ headers: { 'content-length': '500' } }])
  await assert.rejects(read('https://example.com', { maxBytes: 10 }), { code: 'url.body-too-large' })
  assert.equal(destroyed.length, 1)
})
test('長さのない stream も途中で上限を超えたら破棄する', async () => {
  const { read, destroyed } = setup([{ chunks: [Buffer.alloc(8), Buffer.alloc(8)] }])
  await assert.rejects(read('https://example.com', { maxBytes: 10 }), { code: 'url.body-too-large' })
  assert.equal(destroyed.length, 1)
})
test('圧縮による上限の回避を拒否する', async () => {
  const { read } = setup([{ headers: { 'content-encoding': 'gzip' } }])
  await assert.rejects(read('https://example.com'), { code: 'url.encoding-blocked' })
})
test('DNS が終わらなくても時間上限で終わる', async () => {
  const { read } = setup([], () => new Promise(() => {}))
  await assert.rejects(read('https://example.com', { timeoutMs: 20 }), { code: 'url.timeout' })
})
test('応答が来なくても中止し、接続へ signal を渡す', async () => {
  const { read, calls } = setup([])
  await assert.rejects(read('https://example.com', { timeoutMs: 20 }), { code: 'url.timeout' })
  assert.equal(calls[0].options.signal.aborted, true)
})
test('本文が終わらない応答も時間上限で中止する', async () => {
  const { read, calls } = setup([{ text: '<html>', hang: true }])
  await assert.rejects(read('https://example.com', { timeoutMs: 20 }), { code: 'url.timeout' })
  assert.equal(calls[0].options.signal.aborted, true)
})
test('親の中止を DNS と接続に引き継ぐ', async () => {
  const parent = new AbortController()
  const { read, calls } = setup([])
  const result = read('https://example.com', { signal: parent.signal })
  setTimeout(() => parent.abort(Object.assign(new Error('中止'), { code: 'url.timeout' })), 10)
  await assert.rejects(result, { code: 'url.timeout' })
  assert.equal(calls[0].options.signal.aborted, true)
})
test('転送先の許可が中止されたら、次の接続を始めない', async () => {
  const { read, calls } = setup([{ status: 302, headers: { location: 'https://other.example.com/' } }])
  let count = 0
  let nestedSignal
  await assert.rejects(read('https://example.com', { timeoutMs: 20, beforeRequest: (_url, signal) => {
    if (++count === 2) { nestedSignal = signal; return new Promise(() => {}) }
  } }), { code: 'url.timeout' })
  assert.equal(nestedSignal.aborted, true)
  assert.equal(calls.length, 1)
})
