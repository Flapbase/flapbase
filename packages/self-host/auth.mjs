import { betterAuth } from 'better-auth'
import { Pool } from 'pg'

export function createSelfHostedAuthPool(connectionString) {
  if (!connectionString) throw new Error('FLAP_AUTH_DATABASE_URL is required')
  return new Pool({ connectionString, max: 1, options: '-c search_path=flap_auth,pg_catalog' })
}

export function selfHostedAuthOptions(pool, { origin, secret }) {
  return {
    database: pool,
    secret,
    baseURL: origin,
    trustedOrigins: [origin],
    telemetry: { enabled: false },
    advanced: { ipAddress: { ipAddressHeaders: ['x-flap-loopback-client-ip'] } },
    emailAndPassword: { enabled: true },
    account: { accountLinking: { enabled: false } },
    session: { cookieCache: { enabled: false }, disableSessionRefresh: true },
    rateLimit: { enabled: true },
  }
}

/** The adapter returns a server-verified (issuer, subject) pair. Keep the issuer stable across host moves. */
export function createBetterAuthAdapter(pool, { origin, issuer, secret }) {
  if (!issuer || !secret || secret.length < 32) throw new Error('A stable issuer and at least 32 characters of session secret are required')
  const auth = betterAuth(selfHostedAuthOptions(pool, { origin, secret }))
  return {
    async verify(headers) {
      const session = await auth.api.getSession({ headers })
      return session ? { issuer, subject: session.user.id } : null
    },
    async handle(request) {
      const response = await auth.handler(request)
      if (!response.ok) return response
      // Sign-in/sign-up can return the raw session token in JSON. Only the HTTP-only cookie crosses this boundary.
      const headers = new Headers({ 'cache-control': 'no-store' })
      for (const cookie of response.headers.getSetCookie()) headers.append('set-cookie', cookie)
      return new Response(null, { status: 204, headers })
    },
  }
}

const select = `
  SELECT p.principal_id, p.principal_kind, p.status, i.status AS link_status
  FROM identity.external_identities i
  JOIN identity.principals p USING (principal_id)
  WHERE i.provider=$1 AND i.provider_subject=$2`
const activeHuman = row => row?.principal_kind === 'human' && row.status === 'active' && row.link_status === 'active'
  ? { principalId: row.principal_id } : null

export function createHumanSessionResolver(pool, adapter) {
  return async headers => {
    const identity = await adapter.verify(headers)
    if (!identity) return null
    const { issuer, subject } = identity
    if (typeof issuer !== 'string' || typeof subject !== 'string' || !issuer.trim() || !subject.trim()
        || issuer.length > 512 || subject.length > 512) return null
    const client = await pool.connect()
    try {
      const scope = [issuer, subject]
      const existing = (await client.query(select, scope)).rows[0]
      if (existing) return activeHuman(existing)

      await client.query('BEGIN')
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))", scope)
        const concurrent = (await client.query(select, scope)).rows[0]
        let human = activeHuman(concurrent)
        if (!concurrent) {
          // A new sign-in creates a Human without membership. Only an explicit verified link may reuse an existing Human.
          const { rows: [principal] } = await client.query(
            "INSERT INTO identity.principals(principal_kind,created_by) VALUES('human','self-host-auth') RETURNING principal_id",
          )
          await client.query(
            'INSERT INTO identity.external_identities(principal_id,provider,provider_subject) VALUES($1,$2,$3)',
            [principal.principal_id, ...scope],
          )
          human = { principalId: principal.principal_id }
        }
        await client.query('COMMIT')
        return human
      } catch (error) {
        await client.query('ROLLBACK')
        throw error
      }
    } finally {
      client.release()
    }
  }
}
