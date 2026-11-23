import { KNOWLEDGE_ANSWER_INSTRUCTION, selectKnowledgeExcerpts } from '../course-engine/src/knowledge.js'
import { maskPersonalData } from '../course-engine/src/personal-data-mask.js'
import { invalid, missing, sha, StoreError, storeId } from './free-download.mjs'

const workflow = 'flapbase.member-form/v1'
const memberRequest = 'member-ai.ask'
const unanswered = Object.freeze({ outcome: 'no-evidence' })
const active = () => new StoreError(409, 'question_running')
const providerUnavailable = () => new StoreError(503, 'course_ai_unavailable')
const row = async (db, sql, values) => (await db.query(sql, values)).rows[0]

export function createLocalCourseGenerator({ endpoint, model, fetchImpl = fetch }) {
  const url = new URL(endpoint)
  if (url.protocol !== 'http:' || !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
      url.pathname !== '/v1/chat/completions' || url.search || url.hash || url.username || url.password ||
      typeof model !== 'string' || !model.trim() || model.length > 150) throw Error('Set a local course AI endpoint and model')
  return async (question, passages) => {
    const references = passages.map(({ title, excerpt }) => ({ title, excerpt }))
    const response = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' },
      redirect: 'error', signal: AbortSignal.timeout(30_000),
      body: JSON.stringify({ model, messages: [
        { role: 'system', content: KNOWLEDGE_ANSWER_INSTRUCTION + ' If the question cannot be answered, return only NO_EVIDENCE.' },
        { role: 'user', content: JSON.stringify({ input: question, references }) },
      ], max_tokens: 768, stream: false }) })
    if (!response.ok) throw providerUnavailable()
    const text = (await response.json())?.choices?.[0]?.message?.content
    if (typeof text !== 'string' || !text.trim() || text.length > 4000) throw providerUnavailable()
    return text.trim() === 'NO_EVIDENCE' ? null : maskPersonalData(text.trim())
  }
}

function retrieve(learning, question) {
  const titles = new Map(learning.document.course.lessons.map(lesson => [lesson.id, lesson.title]))
  return learning.document.lessonBodies.flatMap(({ lessonId, markdown }) => {
    const title = titles.get(lessonId)
    if (!title) return []
    return selectKnowledgeExcerpts(question, { title, body: markdown.slice(0, 32_000) }).map(entry => ({
      lessonId, title: maskPersonalData(title), score: entry.score, excerpt: maskPersonalData(entry.excerpt),
    }))
  }).sort((a, b) => b.score - a.score).slice(0, 6)
}

export function createCourseKnowledge({ store, purchases, generate }) {
  const projectId = store.projectId
  async function ask(buyerId, orderId, { requestId, text }) {
    if (!storeId(requestId) || !storeId(orderId) || typeof text !== 'string' || !text.trim() || text.length > 4000 || text.includes('\0')) throw invalid()
    if (!generate) throw providerUnavailable()
    const actor = 'human:' + buyerId
    const question = maskPersonalData(text.trim())
    const digest = sha(JSON.stringify([orderId, text.trim()]))
    const reservation = await purchases.withRead(buyerId, orderId, async (db, { workspaceId, learning }) => {
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [workflow + ':' + projectId + ':' + buyerId])
      const prior = await row(db, `
        SELECT run_id,input_digest,status,metadata FROM runtime.runs WHERE workspace_id=$1 AND project_id=$2
          AND actor_ref=$3 AND workflow_ref=$4 AND metadata->>'requestId'=$5 AND metadata->>'entry'=$6
      `, [workspaceId, projectId, actor, workflow, requestId, memberRequest])
      if (prior) {
        if (prior.input_digest !== digest) throw new StoreError(409, 'submission_conflict')
        if (prior.status === 'running') throw active()
        if (prior.status === 'failed') throw providerUnavailable()
        if (prior.metadata.sources?.some(source => !learning.availableLessonIds.includes(source.lessonId))) throw missing()
        return { result: prior.metadata.draftFailure ? unanswered : {
          outcome: 'answer', text: prior.metadata.answer, sources: prior.metadata.sources,
        } }
      }
      const passages = retrieve(learning, question)
      const run = passages.length > 0
      // Local runs charge their admission before calling the provider, including uncertain failures.
      const daily = await row(db, `
        SELECT count(*)::int AS count FROM runtime.runs WHERE workspace_id=$1 AND project_id=$2
          AND actor_ref=$3 AND workflow_ref=$4 AND metadata->>'entry'=$5
          AND started_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
      `, [workspaceId, projectId, actor, workflow, memberRequest])
      if (daily.count >= 20) throw new StoreError(429, 'course_ai_daily_limit')
      const { run_id: runId } = await row(db, `
        INSERT INTO runtime.runs(workspace_id,project_id,actor_ref,workflow_ref,status,input_digest,started_at,finished_at,metadata)
        VALUES($1,$2,$3,$4,$5,$6,now(),CASE WHEN $5='succeeded' THEN now() END,$7) RETURNING run_id
      `, [workspaceId, projectId, actor, workflow, run ? 'running' : 'succeeded', digest, {
        entry: memberRequest, requestId, orderId, revision: learning.pin.revision, courseDigest: learning.pin.digest,
        ...(!run && { draftFailure: 'no-evidence', formInput: question }),
      }])
      return run ? { runId, passages, pin: learning.pin } : { result: unanswered }
    })
    if (reservation.result) return reservation.result

    const { runId, passages, pin } = reservation
    let answer
    try { answer = await generate(question, passages) } catch {
      await store.transaction(db => db.query(`
        UPDATE runtime.runs SET status='failed',finished_at=now()
        WHERE run_id=$1 AND project_id=$2 AND actor_ref=$3 AND workflow_ref=$4 AND status='running'
      `, [runId, projectId, actor, workflow]))
      throw providerUnavailable()
    }
    return purchases.withRead(buyerId, orderId, async (db, { learning }) => {
      if (pin.digest !== learning.pin.digest || passages.some(value => !learning.availableLessonIds.includes(value.lessonId))) throw missing()
      const sources = [...new Map(passages.map(({ lessonId, title }) => [lessonId, { lessonId, title }])).values()]
      const metadata = answer === null
        ? { draftFailure: 'no-evidence', formInput: question }
        : { answer, sources }
      const result = await db.query(`
        UPDATE runtime.runs SET status='succeeded',finished_at=now(),metadata=metadata || $5::jsonb
        WHERE run_id=$1 AND project_id=$2 AND actor_ref=$3 AND workflow_ref=$4 AND status='running'
      `, [runId, projectId, actor, workflow, metadata])
      if (result.rowCount !== 1) throw active()
      return answer === null ? unanswered : { outcome: 'answer', text: answer, sources }
    })
  }

  function reviews(actorId, includeText = false) {
    return store.transaction(async db => {
      const { workspaceId } = await store.scoped(db, actorId, 'operator')
      const { rows } = await db.query(`
        SELECT run_id AS id,started_at::text AS "receivedAt",metadata->>'draftFailure' AS reason
          ${includeText ? ",metadata->>'formInput' AS text" : ''}
        FROM runtime.runs WHERE workspace_id=$1 AND project_id=$2 AND workflow_ref=$3
          AND metadata->>'entry'=$4 AND metadata->>'draftFailure'='no-evidence'
        ORDER BY started_at DESC,run_id DESC LIMIT 50
      `, [workspaceId, projectId, workflow, memberRequest])
      return { reviews: rows }
    })
  }

  return { ask, reviews, enabled: Boolean(generate) }
}
