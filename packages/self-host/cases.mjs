import { transaction } from './setup.mjs'
import { invalid, missing, sha, StoreError, storeId } from './free-download.mjs'

const protectedReceipt = 'site.inquiry.body'
const receiptDigest = sha(JSON.stringify({ ref: protectedReceipt, revision: '1', fields: ['message', 'fingerprint'], access: 'private' }))
const conflict = () => new StoreError(409, 'case_conflict')
const errors = new Map([
  ['42501', missing], ['22023', invalid], ['23505', conflict], ['40001', conflict], ['55000', conflict],
])
const digest = values => sha(JSON.stringify(values))
function id(value) {
  if (!storeId(value)) throw invalid()
  return value
}
function text(value, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw invalid()
  return value.trim()
}
const rows = async (db, sql, values) => (await db.query(sql, values)).rows
const result = async (db, sql, values) => (await rows(db, sql, values))[0]?.result

export function createCaseService({ pool, projectId }) {
  id(projectId)
  const run = fn => transaction(pool, fn).catch(error => {
    if (errors.has(error.code)) throw errors.get(error.code)()
    throw error
  })

  async function project(db, actor, write = false) {
    const [scope] = await rows(db, `
      SELECT p.workspace_id,p.created_by_principal_id
      FROM platform.projects p JOIN platform.workspaces w USING (workspace_id)
      WHERE p.project_id=$1 AND p.status='active' AND w.status='active'
        AND ($2::uuid IS NULL OR platform.case_project_access($2,p.workspace_id,p.project_id,$3))
    `, [projectId, actor, write])
    if (!scope) throw missing()
    return scope
  }

  async function receive({ name, email, message, idempotencyKey }) {
    const contact = { name: text(name, 200), email: text(email, 254).toLowerCase() }
    const body = text(message, 3000)
    id(idempotencyKey)
    const sourceRef = 'site-form:' + digest([projectId, idempotencyKey])
    const fingerprint = digest([contact, body])
    return run(async db => {
      const scope = await project(db, null)
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [sourceRef])
      const existing = await result(db, `
        SELECT r.data->>'fingerprint' AS result FROM vdb.records r JOIN vdb.schemas s USING(schema_id)
        WHERE r.project_id=$1 AND r.record_key=$2 AND s.blueprint_ref=$3 AND s.blueprint_digest=$4
      `, [projectId, sourceRef, protectedReceipt, receiptDigest])
      if (existing && existing !== fingerprint) throw conflict()
      const { workspace_id: workspaceId, created_by_principal_id: owner } = scope
      await result(db, 'SELECT platform.record_outcome_event($1::jsonb) AS result', [{
        workspaceId, projectId, sourceRef, idempotencyKey: sourceRef, kind: 'stage', stage: 'inquiry', decidedBy: 'rule', contact,
      }])
      const [inquiry] = await rows(db, 'SELECT inquiry_id AS id FROM platform.inquiries WHERE workspace_id=$1 AND project_id=$2 AND source_ref=$3',
        [workspaceId, projectId, sourceRef])
      if (!inquiry) throw missing()
      if (!existing) {
        await db.query(`
          INSERT INTO vdb.schemas(workspace_id,blueprint_ref,blueprint_revision,blueprint_digest,allowed_access,default_access,projection_version)
          VALUES($1,$2,'1',$3,ARRAY['private'],'private','1') ON CONFLICT(workspace_id,blueprint_ref,blueprint_revision) DO NOTHING
        `, [workspaceId, protectedReceipt, receiptDigest])
        const { rowCount } = await db.query(`
          INSERT INTO vdb.records(schema_id,project_id,record_key,access,owner_principal_id,data)
          SELECT schema_id,$1,$2,'private',$3,$4 FROM vdb.schemas
          WHERE workspace_id=$5 AND blueprint_ref=$6 AND blueprint_revision='1' AND blueprint_digest=$7
        `, [projectId, sourceRef, owner, { message: body, fingerprint }, workspaceId, protectedReceipt, receiptDigest])
        if (!rowCount) throw conflict()
      }
      return { inquiryId: inquiry.id }
    })
  }

  async function convert(actor, { inquiryId, title, idempotencyKey }) {
    id(inquiryId)
    id(idempotencyKey)
    return run(async db => {
      const { workspace_id: workspace } = await project(db, actor, true)
      if (!await result(db, 'SELECT platform.case_inquiry_access($1,$2,$3,$4,NULL) AS result', [actor, workspace, inquiryId, projectId])) throw missing()
      return result(db, 'SELECT platform.case_from_inquiry($1,$2,$3,$4::jsonb) AS result', [actor, workspace, inquiryId, {
        title: text(title, 200), projectId, idempotencyKey: digest([projectId, actor, idempotencyKey]),
      }])
    })
  }

  async function caseScope(db, actor, caseId, write) {
    const { workspace_id: workspace } = await project(db, actor, write)
    if (!await result(db, 'SELECT platform.case_record_access($1,$2,$3,$4,$5) AS result', [actor, workspace, id(caseId), write, projectId])) throw missing()
    return workspace
  }

  function read(actor, caseId) {
    return run(async db => {
      const workspace = await caseScope(db, actor, caseId, false)
      return result(db, `
        SELECT platform.read_case($1,$2,$3) || jsonb_build_object('version',version,'nextAction',next_action) AS result
        FROM platform.cases WHERE case_id=$3 AND project_id=$4
      `, [actor, workspace, caseId, projectId])
    })
  }

  function update(actor, { caseId, expectedVersion, values, idempotencyKey }) {
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1 || !values ||
        Object.keys(values).some(key => !['status', 'nextAction', 'assigneeId', 'dueOn'].includes(key))) throw invalid()
    id(idempotencyKey)
    return run(async db => {
      const workspace = await caseScope(db, actor, caseId, true)
      const key = digest(['case.update', projectId, actor, idempotencyKey])
      const fingerprint = digest([caseId, expectedVersion, Object.entries(values).sort()])
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
      const [prior] = await rows(db, 'SELECT request_digest,response FROM runtime.idempotency_keys WHERE workspace_id=$1 AND idempotency_key=$2', [workspace, key])
      if (prior) {
        if (prior.request_digest !== fingerprint) throw conflict()
        return prior.response
      }
      const updated = await result(db, 'SELECT platform.save_case_record($1,$2,$3,$4,$5::jsonb) AS result',
        [actor, workspace, caseId, expectedVersion, values])
      const [current] = await rows(db, 'SELECT version::int,next_action AS "nextAction" FROM platform.cases WHERE case_id=$1', [caseId])
      const response = { ...updated, ...current }
      await db.query('INSERT INTO runtime.idempotency_keys(workspace_id,idempotency_key,request_digest,response_digest,response) VALUES($1,$2,$3,$4,$5)',
        [workspace, key, fingerprint, digest(response), response])
      return response
    })
  }

  function queue(actor) {
    return run(async db => {
      const { workspace_id: workspace } = await project(db, actor)
      const inquiries = await rows(db, `
        SELECT i.inquiry_id AS id,c.display_name AS name,c.stage,r.data->>'message' AS message
        FROM platform.inquiries i JOIN platform.contacts c ON c.contact_id=i.contact_id AND c.erased_at IS NULL
        LEFT JOIN vdb.records r ON r.project_id=i.project_id AND r.record_key=i.source_ref
          AND EXISTS(SELECT 1 FROM vdb.schemas s WHERE s.schema_id=r.schema_id AND s.blueprint_ref=$3 AND s.blueprint_digest=$4)
        WHERE i.workspace_id=$1 AND i.project_id=$2 AND NOT EXISTS(SELECT 1 FROM platform.cases d WHERE d.source_inquiry_id=i.inquiry_id)
        ORDER BY i.received_at DESC LIMIT 100
      `, [workspace, projectId, protectedReceipt, receiptDigest])
      return { inquiries, cases: await result(db, 'SELECT platform.list_cases($1,$2,NULL,false,$3) AS result', [actor, workspace, projectId]) }
    })
  }

  function saveQuote(actor, caseId, { lines, validUntil, note, idempotencyKey }) {
    id(idempotencyKey)
    return run(async db => {
      const workspace = await caseScope(db, actor, caseId, true)
      return result(db, 'SELECT platform.case_quote_save($1,$2,$3,$4::jsonb) AS result', [actor, workspace, caseId, {
        lines, validUntil, note, idempotencyKey: digest([projectId, actor, idempotencyKey]),
      }])
    })
  }

  function sendQuote(actor, caseId, quoteId) {
    return run(async db => {
      const workspace = await caseScope(db, actor, caseId, true)
      if (!(await rows(db, 'SELECT 1 FROM platform.case_quotes WHERE quote_id=$1 AND case_id=$2', [id(quoteId), caseId])).length) throw missing()
      return result(db, 'SELECT platform.case_quote_send($1,$2,$3) AS result', [actor, workspace, quoteId])
    })
  }

  async function contactScope(db, actor, caseId) {
    const [contact] = await rows(db, `
      SELECT p.portal_key FROM platform.cases c JOIN platform.customer_portals p USING(workspace_id)
      JOIN platform.customer_portal_contacts($1,p.portal_key) q ON q.workspace_id=c.workspace_id AND q.contact_id=c.contact_id
      WHERE c.project_id=$2 AND c.case_id=$3 AND c.archived_at IS NULL
    `, [actor, projectId, id(caseId)])
    if (!contact) throw missing()
    return contact.portal_key
  }

  function answerQuote(actor, caseId, quoteId, decision) {
    return run(async db => {
      const portal = await contactScope(db, actor, caseId)
      if (!(await rows(db, 'SELECT 1 FROM platform.case_quotes WHERE quote_id=$1 AND case_id=$2', [id(quoteId), caseId])).length) throw missing()
      return result(db, "SELECT platform.customer_quote_answer($1,$2,$3,$4,'') AS result", [actor, portal, quoteId, decision])
    })
  }

  function deliver(actor, caseId, { title, notice, idempotencyKey }) {
    id(idempotencyKey)
    return run(async db => {
      const workspace = await caseScope(db, actor, caseId, true)
      await result(db, 'SELECT platform.ensure_customer_portal($1,$2) AS result', [actor, workspace])
      return result(db, 'SELECT platform.case_action_create($1,$2,$3,$4::jsonb) AS result', [actor, workspace, caseId, {
        kind: 'deliverable', title: text(title, 200), body: { note: text(notice, 3000) },
        idempotencyKey: digest([projectId, actor, idempotencyKey]),
      }])
    })
  }

  function receiveDelivery(actor, caseId, actionId) {
    return run(async db => {
      const portal = await contactScope(db, actor, caseId)
      if (!(await rows(db, "SELECT 1 FROM platform.case_actions WHERE action_id=$1 AND case_id=$2 AND kind='deliverable'", [id(actionId), caseId])).length) throw missing()
      return result(db, "SELECT platform.customer_case_action_decide($1,$2,$3,'receive','') AS result", [actor, portal, actionId])
    })
  }

  return { projectId, receive, convert, read, update, queue, saveQuote, sendQuote, answerQuote, deliver, receiveDelivery }
}
