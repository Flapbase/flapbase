import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { createServer } from 'node:net'
import { once } from 'node:events'
import { test } from 'node:test'
import { createBetterAuthAdapter, createSelfHostedAuthPool } from './auth.mjs'
import { createCourseService } from './course.mjs'
import { startArtifactTestPostgres } from './postgres-fixture.mjs'
import { setupProject } from './setup.mjs'
import { createSelfHostedServer } from './server.mjs'

async function listen(server, port = 0) {
  server.listen(port, '127.0.0.1')
  await once(server, 'listening')
  return server.address().port
}

const close = server => new Promise(resolve => {
  server.close(resolve)
  server.closeAllConnections?.()
})

test('private training pins the published revision, protects progress, and stops revoked access', { timeout: 20_000 }, async () => {
  const fixture = await startArtifactTestPostgres()
  const pool = createSelfHostedAuthPool(fixture.connection)
  let server
  try {
    const probe = createServer()
    const port = await listen(probe)
    await close(probe)
    const origin = 'http://127.0.0.1:' + port
    const adapter = createBetterAuthAdapter(pool, { origin, issuer: 'urn:flapbase:self-host:course-test', secret: randomUUID() })
    const projectId = randomUUID(), otherProjectId = randomUUID()
    const training = createCourseService({ pool, projectId })
    server = createSelfHostedServer({ origin, pool, adapter, course: training })
    await listen(server, port)
    const request = (path, cookie, body, extra = {}) => fetch(origin + path, {
      method: body ? 'POST' : 'GET',
      headers: { ...(cookie && { cookie }), ...(body && { origin, 'content-type': 'application/json' }), ...extra },
      ...(body && { body: JSON.stringify(body) }),
    })
    async function account(name) {
      const signUp = await request('/api/auth/sign-up/email', null, { name, email: name + '@example.test', password: randomUUID() })
      assert.equal(signUp.status, 204)
      const cookie = signUp.headers.getSetCookie().find(value => value.startsWith('better-auth.session_token=')).split(';')[0]
      const identity = await request('/auth/context', cookie)
      assert.equal(identity.status, 200)
      return { cookie, id: (await identity.json()).principalId }
    }
    const manager = await account('owner'), member = await account('learner')
    const owner = manager.id, learner = member.id
    const [next, stranger] = (await fixture.sql.query(
      `INSERT INTO identity.principals(principal_kind,email,created_by)
       VALUES('human','next@example.test','local-course-test'),('human','other@example.test','local-course-test') RETURNING principal_id`,
    )).map(person => person.principal_id)
    await setupProject(pool, { ownerId: owner, projectId })
    const [{ workspace_id: tenantId }] = await fixture.sql.query('SELECT workspace_id FROM platform.projects WHERE project_id=$1', [projectId])
    await fixture.sql.query(`INSERT INTO platform.projects(project_id,workspace_id,name,slug,created_by_principal_id,visibility)
      VALUES($1,$2,'Other','other',$3,'private')`, [otherProjectId, tenantId, owner])
    await fixture.sql.query(`INSERT INTO platform.project_memberships(project_id, principal_id, member_role) VALUES
      ($1,$2,'member'),($1,$3,'member'),($4,$5,'owner'),($4,$2,'member')`, [projectId, learner, next, otherProjectId, owner])

    const chapterId = randomUUID(), lessonId = randomUUID(), courseId = randomUUID()
    const course = { tenantId, courseId, creatorId: owner, title: '研修', description: '基礎研修', status: 'published',
      opening: { kind: 'immediate' }, chapters: [{ id: chapterId, title: 'はじめに', order: 1 }],
      lessons: [{ id: lessonId, chapterId, title: '教材', order: 1, kind: 'material', status: 'published', materials: [],
        required: true, requirePrevious: false, delayDays: 0 }], assignments: [] }
    const first = { contractVersion: 'course-document/v1', revision: 1, course, lessonBodies: [{ lessonId, markdown: '初版の教材' }] }
    const second = { ...first, revision: 2, lessonBodies: [{ lessonId, markdown: '改訂した教材' }] }
    const other = createCourseService({ pool, projectId: otherProjectId })
    await assert.rejects(training.release(learner, first), { status: 404 })
    const releases = '/api/courses/v1/releases'
    const assignments = '/api/courses/v1/assignments'
    assert.equal((await request(releases, manager.cookie, first, { origin: 'https://other.example.test' })).status, 403)
    const releasedResponse = await request(releases, manager.cookie, first)
    assert.equal(releasedResponse.status, 200, await releasedResponse.clone().text())
    const released = await releasedResponse.json()
    assert.deepEqual(await training.release(owner, first), released)
    await assert.rejects(other.release(owner, first), { status: 409 })

    const assignmentId = randomUUID()
    const assignment = { assignmentId, learnerId: learner, artifactRevisionId: released.artifactRevisionId }
    const assigned = await request(assignments, manager.cookie, assignment)
    assert.equal(assigned.status, 200)
    assert.deepEqual(await assigned.json(), assignment)
    assert.deepEqual(await training.assign(owner, assignment), assignment)
    await assert.rejects(training.assign(owner, { ...assignment, learnerId: next }), { status: 409 })
    await assert.rejects(training.assign(owner, { ...assignment, learnerId: stranger }), { status: 404 })
    await assert.rejects(other.assign(owner, assignment), { status: 404 })

    const updated = await training.release(owner, second)
    const nextAssignment = await training.assign(owner, { assignmentId: randomUUID(), learnerId: next, artifactRevisionId: updated.artifactRevisionId })
    const read = { kind: 'read' }
    const command = { kind: 'progress', lessonId, key: randomUUID(), expectedVersion: 1, completed: true }
    const learnerPath = assignments + '/' + assignmentId
    assert.equal((await request(learnerPath)).status, 401)
    assert.equal((await request(learnerPath, manager.cookie)).status, 404)
    const posted = await request(learnerPath + '/progress', member.cookie, { lessonId, expectedVersion: 1, completed: true }, { 'idempotency-key': command.key })
    assert.equal(posted.status, 200, await posted.clone().text())
    const { assignmentId: returnedId, ...completed } = await posted.json()
    assert.equal(returnedId, assignmentId)
    assert.deepEqual(completed.completedLessonIds, [lessonId])
    assert.equal(completed.pin.revision, 1)
    assert.equal(completed.document.lessonBodies[0].markdown, '初版の教材')
    assert.deepEqual(await training.learn(learner, assignmentId, command), completed)
    await assert.rejects(training.learn(learner, assignmentId, { ...command, completed: false }), { status: 409 })
    await assert.rejects(training.learn(learner, assignmentId, { ...command, key: randomUUID() }), { status: 409 })
    assert.equal((await training.learn(next, nextAssignment.assignmentId, read)).document.lessonBodies[0].markdown, '改訂した教材')
    const listed = await request(assignments, manager.cookie)
    assert.equal((await listed.json()).assignments.find(item => item.assignmentId === assignmentId).completed, 1)
    await assert.rejects(training.assignments(learner), { status: 404 })
    await assert.rejects(other.learn(learner, assignmentId, read), { status: 404 })
    await assert.rejects(training.learn(next, assignmentId, read), { status: 404 })
    await fixture.sql.query("UPDATE platform.project_memberships SET status='revoked',revoked_at=now() WHERE project_id=$1 AND principal_id=$2", [projectId, learner])
    await assert.rejects(training.learn(learner, assignmentId, read), { status: 404 })
  } finally {
    if (server) await close(server)
    await pool.end()
    await fixture.close()
  }
})
