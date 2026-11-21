import { randomUUID } from 'node:crypto'
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import { test } from 'node:test'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { createBetterAuthAdapter, createHumanSessionResolver, createSelfHostedAuthPool } from './auth.mjs'
import { createSelfHostedServer } from './server.mjs'

async function listen(server, port = 0) {
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(port, '127.0.0.1', resolve)
    })
    return server.address().port
  } catch (error) {
    server.close()
    throw error
  }
}
const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})

test('same-origin self-host verifies session, preserves Principal and rejects revoked or untrusted sessions', { timeout: 30_000 }, async () => {
  const db = await startArtifactTestPostgres({ encoding: 'UTF8' })
  const pool = createSelfHostedAuthPool(db.connection)
  let server
  try {
    const probe = createServer()
    const port = await listen(probe)
    await close(probe)
    const origin = `http://127.0.0.1:${port}`
    const issuer = 'urn:flapbase:self-host:test'
    const adapter = createBetterAuthAdapter(pool, { origin, issuer, secret: randomUUID() })
    server = createSelfHostedServer({ origin, pool, adapter })
    await listen(server, port)
    const request = (path, init) => fetch(origin + path, init)
    const post = (path, body, cookie, sender = origin) => request('/api/auth/' + path, {
      method: 'POST', headers: { origin: sender, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(body),
    })
    const email = 'member@example.test'
    const password = randomUUID()
    const signUp = { name: '試験利用者', email, password }
    assert.equal((await request('/auth/context')).status, 401)
    assert.equal((await post('sign-up/email', signUp, null, 'https://wrong.example.test')).status, 403)
    const signedUp = await post('sign-up/email', signUp)
    assert.equal(signedUp.status, 204, await signedUp.text())
    const cookieOf = reply => {
      const session = reply.headers.getSetCookie().find(cookie => cookie.startsWith('better-auth.session_token='))
      assert.match(session ?? '', /; HttpOnly/i)
      return session.split(';')[0]
    }
    const firstCookie = cookieOf(signedUp)
    const context = cookie => request('/auth/context', { headers: { cookie } })
    const initial = await Promise.all([context(firstCookie), context(firstCookie)])
    assert.deepEqual(initial.map(response => response.status), [200, 200])
    const [human, duplicate] = await Promise.all(initial.map(response => response.json()))
    assert.deepEqual(duplicate, human)
    assert.deepEqual(Object.keys(human), ['principalId'])
    const [row] = await db.sql.query('SELECT principal_id,provider_subject FROM identity.external_identities WHERE provider=$1', [issuer])
    assert.equal(row.principal_id, human.principalId)
    assert.notEqual(row.provider_subject, human.principalId)
    assert.equal((await db.sql.query('SELECT principal_id FROM platform.workspace_members', [])).length, 0)

    assert.equal((await post('sign-out', {}, firstCookie)).status, 204)
    assert.equal((await context(firstCookie)).status, 401)
    const signedIn = await post('sign-in/email', { email, password })
    assert.equal(signedIn.status, 204)
    const secondCookie = cookieOf(signedIn)
    assert.deepEqual(await (await context(secondCookie)).json(), human)

    const replacement = createHumanSessionResolver(pool, {
      verify: async () => ({ issuer: 'urn:flapbase:self-host:replacement', subject: row.provider_subject }),
    })
    await db.sql.query('INSERT INTO identity.external_identities(principal_id,provider,provider_subject) VALUES($1,$2,$3)',
      [human.principalId, 'urn:flapbase:self-host:replacement', row.provider_subject])
    assert.deepEqual(await replacement(new Headers()), human)
    await db.sql.query("UPDATE identity.external_identities SET status='retired' WHERE provider=$1", [issuer])
    assert.equal((await context(secondCookie)).status, 401)
    assert.equal((await db.sql.query('SELECT principal_id FROM identity.principals', [])).length, 1)
    assert.equal((await request('/api/auth/get-session', { headers: { cookie: secondCookie } })).status, 404)
  } finally {
    if (server) await close(server)
    await pool.end()
    await db.close()
  }
})
