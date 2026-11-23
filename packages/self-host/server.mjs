import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fromNodeHeaders, toNodeHandler } from 'better-auth/node'
import { createBetterAuthAdapter, createHumanSessionResolver, createSelfHostedAuthPool } from './auth.mjs'

import { createFreeDownloadStore, sha, storeId, StoreError } from './free-download.mjs'
import { createStoreLifecycle } from './lifecycle.mjs'
import { createStripePayment, PaymentError } from './payment.mjs'
import { handleStore, renderProduct, sendStoreError } from './store-http.mjs'
import { createRecruitment } from './recruitment.mjs'
import { handleRecruitment } from './recruitment-http.mjs'
import { createBooking } from './booking.mjs'
import { handleBooking } from './booking-http.mjs'

const authPaths = new Set(['/api/auth/sign-up/email', '/api/auth/sign-in/email', '/api/auth/sign-out'])
const files = new Map([
  ['/', ['index.html', 'text/html; charset=utf-8']],
  ['/auth-ui.js', ['auth-ui.js', 'text/javascript; charset=utf-8']],
  ['/booking-ui.js', ['booking-ui.js', 'text/javascript; charset=utf-8']],
  ['/recruitment-ui.js', ['recruitment-ui.js', 'text/javascript; charset=utf-8']],
  ['/store-ui.js', ['store-ui.js', 'text/javascript; charset=utf-8']],
  ['/store.css', ['store.css', 'text/css; charset=utf-8']],
])

export function createSelfHostedServer({ origin, pool, adapter, store, lifecycle, payment, delegation, recruitment, recruitmentDelegation, booking, bookingDelegation }) {
  const url = new URL(origin)
  if (url.origin !== origin || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('The password reference server requires an HTTP loopback origin')
  }
  const resolveHuman = createHumanSessionResolver(pool, adapter)
  const handleAuth = toNodeHandler(adapter.handle)
  return createServer(async (req, res) => {
    res.setHeader('cache-control', 'no-store')
    try {
      const route = new URL(req.url ?? '/', origin)
      if (req.headers.host !== url.host || route.origin !== origin) {
        res.writeHead(403).end()
        return
      }
      const sendVerification = adapter.emailVerification && route.pathname === '/api/auth/send-verification-email' && req.method === 'POST'
      const verifyEmail = adapter.emailVerification && route.pathname === '/api/auth/verify-email' && req.method === 'GET'
      if (authPaths.has(route.pathname) && req.method === 'POST' || sendVerification || verifyEmail) {
        if (!verifyEmail && req.headers.origin !== origin) {
          res.writeHead(403).end()
          return
        }
        req.headers['x-flap-loopback-client-ip'] = req.socket.remoteAddress
        await handleAuth(req, res)
        return
      }
      if (route.pathname === '/auth/context' && req.method === 'GET') {
        const human = await resolveHuman(fromNodeHeaders(req.headers))
        res.writeHead(human ? 200 : 401, { 'content-type': 'application/json' }).end(JSON.stringify(human ?? { error: 'sign_in_required' }))
        return
      }
      if (store && await handleStore(req, res, { route, origin, store, lifecycle, payment, delegation, resolveHuman: () => resolveHuman(fromNodeHeaders(req.headers)) })) return
      if (recruitment && await handleRecruitment(req, res, {
        route, origin, recruitment, delegation: recruitmentDelegation,
        resolveHuman: () => resolveHuman(fromNodeHeaders(req.headers)),
      })) return
      if (booking && await handleBooking(req, res, {
        route, origin, booking, delegation: bookingDelegation, resolveHuman: () => resolveHuman(fromNodeHeaders(req.headers)),
      })) return
      const file = req.method === 'GET' ? files.get(route.pathname) : undefined
      if (!file) {
        res.writeHead(404).end()
        return
      }
      const body = await readFile(new URL('./' + file[0], import.meta.url))
      res.writeHead(200, {
        'content-type': file[1],
        'content-security-policy': "default-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      }).end(body)
    } catch (error) {
      if ((error instanceof StoreError || error instanceof PaymentError) && !res.headersSent) {
        sendStoreError(res, error)
        return
      }
      console.error('self_host_request_failed', error instanceof Error ? error.name : 'unknown')
      if (res.headersSent) res.destroy()
      else res.writeHead(503).end()
    }
  })
}

async function start() {
  const port = Number(process.env.FLAP_PORT ?? 5264)
  const origin = process.env.FLAP_ORIGIN ?? `http://127.0.0.1:${port}`
  const pool = createSelfHostedAuthPool(process.env.FLAP_AUTH_DATABASE_URL)
  try {
    const bookingProject = process.env.FLAP_BOOKING_PROJECT_ID
    const bookingDirectory = process.env.FLAP_BOOKING_DATA_DIR
    const bookingToken = process.env.FLAP_BOOKING_AGENT_TOKEN
    const bookingPrincipal = process.env.FLAP_BOOKING_AGENT_PRINCIPAL_ID
    if ((bookingToken || bookingPrincipal) && (!bookingProject || !storeId(bookingPrincipal) || !/^[!-~]{32,}$/.test(bookingToken ?? ''))) {
      throw new Error('Set the booking Project, operator principal and an agent token of at least 32 characters')
    }
    const bookingDelegation = bookingToken ? { principalId: bookingPrincipal, tokenDigest: sha('Bearer ' + bookingToken) } : undefined
    let booking, sendVerificationEmail
    if (bookingProject || bookingDirectory) {
      if (!bookingDirectory) throw new Error('Set FLAP_BOOKING_DATA_DIR for booking publications and verification previews')
      booking = createBooking({ pool, projectId: bookingProject, directory: bookingDirectory })
      const preview = join(bookingDirectory, bookingProject, 'verification-preview')
      await mkdir(preview, { recursive: true, mode: 0o700 })
      sendVerificationEmail = ({ user, url }) => writeFile(join(preview, randomUUID() + '.json'),
        JSON.stringify({ to: user.email, url }), { mode: 0o600, flag: 'wx' })
    }
    const adapter = createBetterAuthAdapter(pool, { origin, issuer: process.env.FLAP_AUTH_ISSUER, secret: process.env.FLAP_AUTH_SECRET, sendVerificationEmail })
    const projectId = process.env.FLAP_STORE_PROJECT_ID
    const directory = process.env.FLAP_STORE_DATA_DIR
    const token = process.env.FLAP_STORE_AGENT_TOKEN
    const principalId = process.env.FLAP_STORE_AGENT_PRINCIPAL_ID
    if ((token || principalId) && (!projectId || !storeId(principalId) || !/^[!-~]{32,}$/.test(token ?? ''))) {
      throw new Error('Set the store Project, operator principal and an agent token of at least 32 characters')
    }
    const delegation = token ? { principalId, tokenDigest: sha('Bearer ' + token) } : undefined
    const payment = process.env.FLAP_STORE_STRIPE_KEY || process.env.FLAP_STORE_STRIPE_WEBHOOK_SECRET
      ? createStripePayment({ secretKey: process.env.FLAP_STORE_STRIPE_KEY, webhookSecret: process.env.FLAP_STORE_STRIPE_WEBHOOK_SECRET, origin })
      : undefined
    const store = projectId || directory
      ? await createFreeDownloadStore({ pool, projectId, directory, renderProduct: product => renderProduct({ ...product, leadEnabled: true }) })
      : undefined
    let sendEmail
    if (store && process.env.FLAP_STORE_EMAIL_PREVIEW === '1') {
      const preview = join(directory, projectId, 'email-preview')
      await mkdir(preview, { recursive: true, mode: 0o700 })
      sendEmail = message => writeFile(join(preview, message.id + '.json'),
        JSON.stringify({ ...message, unsubscribeUrl: origin + '/unsubscribe?lead=' + message.leadId }), { mode: 0o600, flag: 'wx' })
    }
    const lifecycle = store && createStoreLifecycle({ store, projectId, sendEmail })
    const recruitmentProject = process.env.FLAP_RECRUITMENT_PROJECT_ID
    const recruitmentDirectory = process.env.FLAP_RECRUITMENT_DATA_DIR
    const recruitmentToken = process.env.FLAP_RECRUITMENT_AGENT_TOKEN
    const recruitmentPrincipal = process.env.FLAP_RECRUITMENT_AGENT_PRINCIPAL_ID
    if ((recruitmentToken || recruitmentPrincipal) && (!recruitmentProject || !storeId(recruitmentPrincipal) || !/^[!-~]{32,}$/.test(recruitmentToken ?? ''))) {
      throw new Error('Set the recruitment Project, operator principal and an agent token of at least 32 characters')
    }
    const recruitmentDelegation = recruitmentToken ? { principalId: recruitmentPrincipal, tokenDigest: sha('Bearer ' + recruitmentToken) } : undefined
    const recruitment = recruitmentProject || recruitmentDirectory
      ? await createRecruitment({ pool, projectId: recruitmentProject, directory: recruitmentDirectory })
      : undefined
    const server = createSelfHostedServer({ origin, pool, adapter, store, lifecycle, payment, delegation, recruitment, recruitmentDelegation, booking, bookingDelegation })
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    const close = () => {
      server.close(() => void pool.end())
      server.closeAllConnections()
    }
    process.once('SIGINT', close)
    process.once('SIGTERM', close)
    console.log(`Flapbase セルフホスト認証 ${origin}`)
  } catch (error) {
    await pool.end()
    throw error
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await start()
