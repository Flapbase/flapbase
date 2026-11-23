import { LearnerError } from '../course-engine/src/learning-access.js'
import { forbidden, invalid, StoreError, storeId } from './free-download.mjs'
import { canCallAgent, input, send } from './store-http.mjs'
import { renderTraining } from './course-view.mjs'
import { COURSE_TOOLS } from './mcp.mjs'

export async function handleCourses(req, res, { route, origin, course, courseShop, purchases, delegation, resolveHuman }) {
  if (req.method === 'GET' && await renderTraining(res, route, { course, courseShop, purchases, resolveHuman })) return true
  if (route.pathname === '/api/courses/v1/agent' && req.method === 'POST') {
    if (!canCallAgent(req, delegation)) throw new StoreError(401, 'agent_unauthorized')
    const rpc = await input(req, 1024 * 1024)
    const definition = COURSE_TOOLS.find(tool => tool.name === rpc.name)
    const args = rpc.arguments
    if (!definition || args?.projectId !== course.projectId) throw forbidden()
    if (Object.keys(args).some(key => !Object.hasOwn(definition.inputSchema.properties, key))) throw invalid()
    const result = definition.annotations.readOnlyHint
      ? await course.getDraft(delegation.principalId, args)
      : await course.saveDraft(delegation.principalId, args)
    const openUrl = result.pin && '/training/drafts/' + result.pin.artifactRef + '?' +
      new URLSearchParams({ revision: String(result.pin.revision), digest: result.pin.digest })
    send(res, 200, { title: '講座', course: result, ...(openUrl && { openUrl }) })
    return true
  }
  const publishOffer = Boolean(courseShop) && route.pathname === '/api/courses/v1/offers'
  const approve = route.pathname === '/api/courses/v1/draft-approval'
  const invite = route.pathname === '/api/courses/v1/invitations'
  const accept = route.pathname === '/api/courses/v1/invitations/accept'
  const release = route.pathname === '/api/courses/v1/releases'
  const assignments = route.pathname === '/api/courses/v1/assignments'
  const learner = /^\/api\/courses\/v1\/(assignments|orders)\/([^/]+)(\/progress)?$/.exec(route.pathname)
  if (learner?.[1] === 'orders' && !purchases) return false
  if (!release && !assignments && !learner && !invite && !accept && !approve && !publishOffer) return false
  const post = req.method === 'POST'
  if (assignments ? !post && req.method !== 'GET' : req.method !== (release || invite || accept || approve || publishOffer || learner?.[3] ? 'POST' : 'GET')) {
    send(res, 405, { error: 'method_not_allowed' })
    return true
  }
  try {
    if (route.search || (learner && !storeId(learner[2]))) throw invalid()
    const human = await resolveHuman({ includeVerifiedEmail: accept })
    if (!human) throw new StoreError(401, 'sign_in_required')
    if (post && req.headers.origin !== origin) throw new StoreError(403, 'origin_not_allowed')
    if (post && req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json') throw invalid()

    const actor = human.principalId
    if (invite) {
      const token = await course.invite(actor, await input(req, 2048))
      send(res, 200, { url: origin + '/training/join#' + token })
    } else if (accept) {
      const { token } = await input(req, 2048)
      send(res, 200, await course.accept(human, token))
    } else if (publishOffer) {
      const offer = await input(req, 16_000)
      if (!storeId(offer.artifactRevisionId) ||
          Object.keys(offer).some(key => !['artifactRevisionId','listingId','title','description','amountMinor'].includes(key))) throw invalid()
      send(res, 201, await courseShop.publish(actor, offer))
    } else if (approve) send(res, 200, await course.publishDraft(actor, await input(req, 2048)))
    else if (release) send(res, 200, await course.release(actor, await input(req, 1024 * 1024)))
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
      const [, kind, id] = learner
      const provider = kind === 'orders' ? purchases : course
      send(res, 200, { [kind === 'orders' ? 'orderId' : 'assignmentId']: id, ...await provider.learn(actor, id, command) })
    }
  } catch (error) {
    if (!(error instanceof LearnerError)) throw error
    send(res, error.status, { error: error.code })
  }
  return true
}
