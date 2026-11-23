import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { once } from 'node:events'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createBetterAuthAdapter, createSelfHostedAuthPool } from './auth.mjs'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { createRecruitment, recruitmentPresetDigest } from './recruitment.mjs'
import { setupProject } from './setup.mjs'
import { createSelfHostedServer } from './server.mjs'
import { sha } from './free-download.mjs'
import { businessCommand } from '../../bin/business.js'

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

function close(server) {
  return new Promise((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve())
    server.closeAllConnections?.()
  })
}

test('recruitment runs without Cloud from Agent install to candidate review and restart', { timeout: 35_000 }, async () => {
  const fixture = await startArtifactTestPostgres()
  const pool = createSelfHostedAuthPool(fixture.connection)
  const directory = await mkdtemp(join(tmpdir(), 'flap-recruitment-'))
  const projectId = randomUUID()
  const otherProjectId = randomUUID()
  const token = randomUUID() + randomUUID()
  const delegation = { tokenDigest: sha('Bearer ' + token) }
  let server, mcp
  try {
    const probe = createServer()
    const port = await listen(probe)
    await close(probe)
    const origin = 'http://127.0.0.1:' + port
    const adapter = createBetterAuthAdapter(pool, { origin, secret: randomUUID(), issuer: 'urn:flapbase:local:recruitment-test' })
    const start = async () => {
      const recruitment = await createRecruitment({ pool, projectId, directory })
      server = createSelfHostedServer({ origin, pool, adapter, recruitment, recruitmentDelegation: delegation })
      await listen(server, port)
    }
    await start()
    const get = (path, cookie) => fetch(origin + path, { headers: cookie ? { cookie } : {} })
    const post = (path, fields, cookie, sender = origin) => fetch(origin + path, {
      method: 'POST', headers: { origin: sender, 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: JSON.stringify(fields),
    })
    const result = async response => {
      assert.equal(response.status, 200, await response.clone().text())
      return response.json()
    }
    async function register(name) {
      const response = await post('/api/auth/sign-up/email', { name, email: name + '@example.test', password: randomUUID() })
      assert.equal(response.status, 204)
      const cookie = response.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token=')).split(';')[0]
      return { cookie, ...await result(await get('/auth/context', cookie)) }
    }
    const owner = await register('owner')
    const candidate = await register('candidate')
    const stranger = await register('stranger')
    await setupProject(pool, { ownerId: owner.principalId, projectId, name: '採用' })
    await setupProject(pool, { ownerId: stranger.principalId, projectId: otherProjectId, name: '別事業' })
    assert.match(await (await get('/recruitment', owner.cookie)).text(), /採用を始める/)
    assert.equal((await get('/recruitment', stranger.cookie)).status, 404)
    delegation.principalId = owner.principalId

    mcp = new Client({ name: 'recruitment-test', version: '1.0.0' })
    await mcp.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))],
      env: { FLAP_ORIGIN: origin, FLAP_RECRUITMENT_AGENT_TOKEN: token },
    }))
    const standard = await businessCommand(['inspect', 'recruitment'])
    const installTool = standard.procedures['recruitment.install'].tools[0]
    const { tools } = await mcp.listTools()
    assert.deepEqual(tools.map(tool => tool.name), [installTool, 'recruitment_applications_list'])
    const invoke = async (name, arguments_) => {
      const response = await mcp.callTool({ name, arguments: arguments_ })
      assert.ok(!response.isError, response.content[0]?.text)
      return JSON.parse(response.content[0].text)
    }
    assert.equal((await mcp.callTool({ name: installTool, arguments: { projectId: otherProjectId } })).isError, true)
    const installation = await invoke(installTool, { projectId })
    assert.deepEqual(await invoke(installTool, { projectId }), installation)
    assert.equal(installation.digest, recruitmentPresetDigest)
    const { installId } = installation
    const publicPath = '/recruitment/jobs/' + installId
    assert.equal((await get(publicPath)).status, 404)

    const manage = (operation, input, cookie = owner.cookie) => post('/api/recruitment/' + operation, input, cookie)
    const updated = await result(await manage('save', { version: 1, title: 'スタッフ募集', description: '<script>募集内容</script>' }))
    await fixture.sql.query("INSERT INTO platform.project_memberships(project_id,principal_id,member_role) VALUES($1,$2,'editor')", [projectId, stranger.principalId])
    const verified = await result(await manage('verify', { version: updated.version }, stranger.cookie))
    const pin = { candidateId: verified.candidateId, digest: verified.digest }
    assert.equal((await manage('apply', pin)).status, 409)
    assert.equal((await manage('approve', pin, stranger.cookie)).status, 403)
    await fixture.sql.query("UPDATE platform.project_memberships SET status='revoked',revoked_at=now() WHERE project_id=$1 AND principal_id=$2", [projectId, stranger.principalId])
    assert.equal((await get('/recruitment', stranger.cookie)).status, 404)
    assert.equal((await manage('approve', pin, stranger.cookie)).status, 404)
    assert.equal((await result(await manage('approve', pin))).state, 'approved')
    const published = await result(await manage('apply', pin))
    const open = await get(publicPath)
    assert.equal(open.status, 200)
    assert.match(await open.text(), /&#60;script&#62;募集内容&#60;\/script&#62;/)

    const submission = { requestId: randomUUID(), installId, publishedVersion: published.publishedVersion, note: '応募者だけの履歴' }
    assert.equal((await post('/api/recruitment/submit', submission)).status, 401)
    assert.equal((await post('/api/recruitment/submit', submission, candidate.cookie, 'https://other.example')).status, 403)
    const application = await result(await manage('submit', submission, candidate.cookie))
    assert.deepEqual(await result(await manage('submit', submission, candidate.cookie)), application)
    assert.equal((await manage('submit', { ...submission, note: '違う応募' }, candidate.cookie)).status, 409)
    const list = await invoke('recruitment_applications_list', { projectId })
    assert.deepEqual(list, { projectId, applications: [application] })
    assert.match(await (await get('/recruitment', owner.cookie)).text(), /応募者だけの履歴/)
    assert.equal((await manage('advance', { id: application.id, version: application.version }, candidate.cookie)).status, 404)

    const advanced = await result(await manage('advance', { id: application.id, version: application.version }))
    const selected = await result(await manage('finalize', { id: advanced.id, version: advanced.version, outcome: 'selected' }))
    assert.equal(selected.status, 'selected')
    assert.deepEqual(await result(await manage('finalize', { id: advanced.id, version: advanced.version, outcome: 'selected' })), selected)
    assert.equal((await manage('finalize', { id: advanced.id, version: advanced.version, outcome: 'not-selected' })).status, 409)
    assert.deepEqual(await fixture.sql.query('SELECT operation,actor_ref FROM vdb.mutation_receipts WHERE target_ref=$1 ORDER BY operation', [application.id]), [
      { operation: 'recruitment.application.advance', actor_ref: owner.principalId },
      { operation: 'recruitment.application.finalize', actor_ref: owner.principalId },
    ])
    assert.match(await (await get(publicPath + '/applications', candidate.cookie)).text(), /スタッフ募集　採用/)
    assert.doesNotMatch(await (await get(publicPath + '/applications', stranger.cookie)).text(), /スタッフ募集　採用/)

    const next = await result(await manage('save', { version: published.version, title: '次の募集', description: '第2版' }))
    const nextPin = await result(await manage('verify', { version: next.version }))
    const nextCandidate = { candidateId: nextPin.candidateId, digest: nextPin.digest }
    await result(await manage('approve', nextCandidate))
    await result(await manage('apply', nextCandidate))
    await mcp.close()
    mcp = null
    await close(server)
    server = null
    await start()
    assert.match(await (await get(publicPath)).text(), /次の募集/)
    assert.match(await (await get(publicPath + '/applications', candidate.cookie)).text(), /スタッフ募集　採用/)
    assert.deepEqual(await result(await manage('submit', submission, candidate.cookie)), application)
    assert.equal((await manage('submit', { ...submission, requestId: randomUUID() }, candidate.cookie)).status, 409)
  } finally {
    await mcp?.close()
    if (server?.listening) await close(server)
    await pool.end()
    await fixture.close()
    await rm(directory, { recursive: true, force: true })
  }
})
