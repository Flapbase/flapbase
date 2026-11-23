import { LearnerError } from '../course-engine/src/learning-access.js'
import { invalid, StoreError, storeId } from './free-download.mjs'
import { input, send } from './store-http.mjs'

export async function handleCourses(req, res, { route, origin, course, resolveHuman }) {
  const release = route.pathname === '/api/courses/v1/releases'
  const assignments = route.pathname === '/api/courses/v1/assignments'
  const learner = /^\/api\/courses\/v1\/assignments\/([^/]+)(\/progress)?$/.exec(route.pathname)
  if (!release && !assignments && !learner) return false
  const post = req.method === 'POST'
  if (assignments ? !post && req.method !== 'GET' : req.method !== (release || learner[2] ? 'POST' : 'GET')) {
    send(res, 405, { error: 'method_not_allowed' })
    return true
  }
  try {
    if (route.search || (learner && !storeId(learner[1]))) throw invalid()
    const human = await resolveHuman()
    if (!human) throw new StoreError(401, 'sign_in_required')
    if (post && req.headers.origin !== origin) throw new StoreError(403, 'origin_not_allowed')
    if (post && req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw invalid()

    const actor = human.principalId
    if (release) send(res, 200, await course.release(actor, await input(req, 1024 * 1024)))
    else if (assignments) send(res, 200, post ? await course.assign(actor, await input(req, 2048)) : { assignments: await course.assignments(actor) })
    else {
      let command = { kind: 'read' }
      if (post) {
        const body = await input(req, 2048)
        const key = req.headers['idempotency-key']
        if (typeof key !== 'string' || !/^[A-Za-z0-9_-]{8,128}$/.test(key) ||
            !storeId(body.lessonId) || typeof body.completed !== 'boolean' ||
            !Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0 ||
            Object.keys(body).sort().join(',') !== 'completed,expectedVersion,lessonId') throw invalid()
        command = { kind: 'progress', ...body, key }
      }
      send(res, 200, { assignmentId: learner[1], ...await course.learn(actor, learner[1], command) })
    }
  } catch (error) {
    if (!(error instanceof LearnerError)) throw error
    send(res, error.status, { error: error.code })
  }
  return true
}
