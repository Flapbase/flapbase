import { randomBytes, randomUUID } from 'node:crypto'
import { validateCourseDocument } from '../course-engine/src/document.js'
import { executeLearningAccess } from '../course-engine/src/learning-access.js'
import { forbidden, invalid, missing, sha, StoreError, storeId } from './free-download.mjs'
import { transaction } from './setup.mjs'

const blueprint = 'vdb.flap.course.training-assignment'
const blueprintDigest = 'fcbb1fb8b2e9885d45b69d54255e845de9a60a0c7ea080cbc5c2045bf693eac1'
const conflict = () => new StoreError(409, 'course_conflict')
const row = async (db, sql, values) => (await db.query(sql, values)).rows[0]
function uuid(value) {
  if (!storeId(value)) throw invalid()
  return value.toLowerCase()
}

const projectMember = `
  JOIN platform.project_memberships m ON m.project_id=p.project_id AND m.principal_id=$2 AND m.status='active'
  JOIN identity.principals human ON human.principal_id=m.principal_id AND human.status='active' AND human.principal_kind='human'
`
const activePrivateProject = `
  p.project_id=$1 AND p.visibility='private' AND p.status='active' AND w.status='active'
  AND NOT EXISTS (SELECT 1 FROM platform.workspace_members wm
    WHERE wm.workspace_id=p.workspace_id AND wm.principal_id=m.principal_id AND wm.status<>'active')
`
const courseProfile = `
  ar.metadata #>> '{profile,ref}'='course-document' AND ar.metadata #>> '{profile,version}'='1'
`

export function createCourseService({ pool, projectId }) {
  projectId = uuid(projectId)
  const run = operation => transaction(pool, operation)
  async function membership(db, actorId, manage = false) {
    const member = await row(db, `
      SELECT p.workspace_id,m.member_role FROM platform.projects p JOIN platform.workspaces w USING(workspace_id)
      ${projectMember}
      WHERE ${activePrivateProject}
      FOR SHARE OF p,w,m,human
    `, [projectId, uuid(actorId)])
    if (!member || (manage && !['owner','editor'].includes(member.member_role))) throw missing()
    return member.workspace_id
  }

  const revisionConflict = () => new StoreError(409, 'REVISION_CONFLICT')
  const digestPattern = /^sha256:[0-9a-f]{64}$/
  const positive = value => Number.isSafeInteger(value) && value > 0
  const asPin = (artifactRef, entry) => ({ artifactRef, revision: Number(entry.revision_number), digest: 'sha256:' + entry.content_digest })
  function assertPin(pin, artifactRef) {
    if (!pin || pin.artifactRef !== artifactRef || !positive(pin.revision) ||
        typeof pin.digest !== 'string' || !digestPattern.test(pin.digest)) throw invalid()
  }

  async function lockCourse(db, workspaceId, artifactRef) {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [artifactRef])
    await db.query(`
      INSERT INTO artifact.artifacts(artifact_id,workspace_id,artifact_key,project_id,opaque_ref,media_type)
      VALUES($1,$2,$1::uuid::text,$3,$1::uuid::text,'application/json') ON CONFLICT DO NOTHING
    `, [artifactRef, workspaceId, projectId])
    if (!await row(db, 'SELECT 1 FROM artifact.artifacts WHERE artifact_id=$1 AND workspace_id=$2 AND project_id=$3',
      [artifactRef, workspaceId, projectId])) throw conflict()
    return row(db, `
      SELECT ar.artifact_revision_id,ar.revision_number,ar.content_digest,
        ar.metadata #>> '{payload,document,course,status}' AS status,
        ar.metadata #>> '{payload,document,course,creatorId}' AS creator_id,
        ar.metadata #>> '{provenance,approvedDigest}' AS approved_digest
      FROM artifact.artifact_revisions ar WHERE ar.artifact_id=$1 AND ${courseProfile}
        AND ar.metadata #>> '{owner,projectRef}'=$2
      ORDER BY ar.revision_number DESC LIMIT 1
    `, [artifactRef, projectId])
  }

  async function append(db, { actorId, artifactRef, workspaceId, document, provenance = {}, digest = sha(JSON.stringify(document)) }) {
    const artifactRevisionId = randomUUID()
    await db.query(`
      INSERT INTO artifact.artifact_revisions(artifact_revision_id,artifact_id,revision_number,opaque_ref,content_digest,metadata)
      VALUES($1,$2,$3,$1::uuid::text,$4,$5)
    `, [artifactRevisionId, artifactRef, document.revision, digest, {
      owner: { projectRef: projectId, workspaceRef: workspaceId, createdByActorRef: actorId },
      profile: { ref: 'course-document', version: '1' }, payload: { document }, provenance,
    }])
    return { artifactRevisionId, digest, revision: document.revision }
  }

  function validate(input, status) {
    let document
    try { document = validateCourseDocument(input) } catch { throw invalid() }
    if (document.course.status !== status) throw invalid()
    return document
  }

  function release(actorId, input) {
    const document = validate(input, 'published')
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      if (document.course.tenantId !== workspaceId) throw missing()
      const artifactRef = document.course.courseId
      const previous = await lockCourse(db, workspaceId, artifactRef)
      const digest = sha(JSON.stringify(document))
      if (Number(previous?.revision_number) === document.revision && previous.content_digest === digest) {
        return { artifactRevisionId: previous.artifact_revision_id, digest, revision: document.revision }
      }
      if (previous?.status === 'draft' || document.revision !== Number(previous?.revision_number ?? 0) + 1) throw conflict()
      return append(db, { actorId, artifactRef, workspaceId, document, digest })
    })
  }

  async function readPinned(db, workspaceId, pin) {
    const entry = await row(db, `
      SELECT ar.artifact_revision_id,ar.metadata #> '{payload,document}' AS document
      FROM artifact.artifact_revisions ar JOIN artifact.artifacts a USING(artifact_id)
      WHERE a.artifact_id=$1 AND a.workspace_id=$2 AND a.project_id=$3
        AND ${courseProfile} AND ar.metadata #>> '{owner,projectRef}'=$3::uuid::text
        AND ar.revision_number=$4 AND ar.content_digest=$5
    `, [pin.artifactRef, workspaceId, projectId, pin.revision, pin.digest.slice(7)])
    if (!entry) throw missing()
    return { pin, artifactRevisionId: entry.artifact_revision_id, document: entry.document }
  }

  function getDraft(actorId, { artifactRef, revision, digest, beforeRevision }) {
    artifactRef = uuid(artifactRef)
    const pinned = revision !== undefined || digest !== undefined
    const pin = { artifactRef, revision, digest }
    if (pinned) assertPin(pin, artifactRef)
    if (beforeRevision !== undefined && (pinned || !positive(beforeRevision))) throw invalid()
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      if (pinned) return readPinned(db, workspaceId, pin)
      const { rows } = await db.query(`
        SELECT ar.revision_number,ar.content_digest,ar.created_at,ar.metadata->'owner' AS owner,
          ar.metadata->'provenance' AS provenance
        FROM artifact.artifact_revisions ar JOIN artifact.artifacts a USING(artifact_id)
        WHERE a.artifact_id=$1 AND a.workspace_id=$2 AND a.project_id=$3
          AND ${courseProfile} AND ar.metadata #>> '{owner,projectRef}'=$3::uuid::text
          AND ($4::bigint IS NULL OR ar.revision_number < $4)
        ORDER BY ar.revision_number DESC LIMIT 21
      `, [artifactRef, workspaceId, projectId, beforeRevision ?? null])
      return {
        revisions: rows.slice(0, 20).map(entry => ({ pin: asPin(artifactRef, entry), createdAt: entry.created_at.toISOString(),
          owner: { workspaceRef: workspaceId, projectRef: projectId, createdByActorRef: entry.owner?.createdByActorRef ?? actorId },
          provenance: entry.provenance ?? {} })),
        nextBeforeRevision: rows.length > 20 ? Number(rows[19].revision_number) : null,
      }
    })
  }

  function saveDraft(actorId, { artifactRef, document: input, prior, idempotencyKey }) {
    artifactRef = uuid(artifactRef)
    if (prior !== undefined) assertPin(prior, artifactRef)
    if (!input || !input.course || input.course.courseId !== artifactRef ||
        typeof idempotencyKey !== 'string' || !/^[^\u0000-\u0020\u007f]{1,128}$/.test(idempotencyKey)) throw invalid()
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      const document = validate({ ...input, course: { ...input.course,
        tenantId: input.course.tenantId ?? workspaceId,
        creatorId: input.course.creatorId ?? (prior === undefined ? actorId : undefined),
      } }, 'draft')
      if (document.course.tenantId !== workspaceId) throw missing()
      const key = 'course-draft:' + sha(JSON.stringify([projectId, actorId, idempotencyKey]))
      const requestDigest = sha(JSON.stringify([artifactRef, document, prior]))
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [key])
      const receipt = await row(db, 'SELECT request_digest,response FROM runtime.idempotency_keys WHERE workspace_id=$1 AND idempotency_key=$2', [workspaceId, key])
      if (receipt) {
        if (receipt.request_digest !== requestDigest) throw new StoreError(409, 'IDEMPOTENCY_CONFLICT')
        return receipt.response
      }
      const previous = await lockCourse(db, workspaceId, artifactRef)
      if (previous ? (!prior || prior.revision !== Number(previous.revision_number) ||
          prior.digest !== 'sha256:' + previous.content_digest || document.course.creatorId !== previous.creator_id)
        : (prior || document.course.creatorId !== actorId)) throw revisionConflict()
      if (document.revision !== Number(previous?.revision_number ?? 0) + 1) throw revisionConflict()
      const saved = await append(db, { actorId, artifactRef, workspaceId, document, provenance: { source: 'mcp' } })
      const response = { pin: { artifactRef, revision: saved.revision, digest: 'sha256:' + saved.digest },
        artifactRevisionId: saved.artifactRevisionId, receiptRef: randomUUID() }
      await db.query(`
        INSERT INTO runtime.idempotency_keys(workspace_id,idempotency_key,request_digest,response_digest,response)
        VALUES($1,$2,$3,$4,$5)
      `, [workspaceId, key, requestDigest, sha(JSON.stringify(response)), response])
      return response
    })
  }

  function publishDraft(actorId, pin) {
    const artifactRef = uuid(pin?.artifactRef)
    assertPin(pin, artifactRef)
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      const { document: draft } = await readPinned(db, workspaceId, pin)
      if (draft.course.status !== 'draft') throw invalid()
      const previous = await lockCourse(db, workspaceId, artifactRef)
      if (previous?.status === 'published' && Number(previous.revision_number) === pin.revision + 1 &&
          previous.approved_digest === pin.digest) {
        return { artifactRevisionId: previous.artifact_revision_id, digest: previous.content_digest, revision: Number(previous.revision_number) }
      }
      if (previous?.status !== 'draft' || pin.revision !== Number(previous.revision_number) ||
          pin.digest !== 'sha256:' + previous.content_digest) throw revisionConflict()
      const document = validate({ ...draft, revision: pin.revision + 1, course: { ...draft.course, status: 'published' } }, 'published')
      return append(db, { actorId, artifactRef, workspaceId, document, provenance: { approvedDigest: pin.digest } })
    })
  }

  function assign(actorId, { learnerId, artifactRevisionId, assignmentId }) {
    learnerId = uuid(learnerId)
    artifactRevisionId = uuid(artifactRevisionId)
    assignmentId = uuid(assignmentId)
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      await membership(db, learnerId)
      const revision = await row(db, `
        SELECT ar.content_digest FROM artifact.artifact_revisions ar JOIN artifact.artifacts a USING(artifact_id)
        WHERE ar.artifact_revision_id=$1 AND a.workspace_id=$2 AND a.project_id=$3
          AND ${courseProfile} AND ar.metadata #>> '{owner,projectRef}'=$3::uuid::text
          AND ar.metadata #>> '{payload,document,course,status}'='published'
      `, [artifactRevisionId, workspaceId, projectId])
      if (!revision) throw missing()
      await db.query(`
        INSERT INTO vdb.schemas(workspace_id,blueprint_ref,blueprint_revision,blueprint_digest,allowed_access,default_access,projection_version)
        VALUES($1,$2,'1',$3,ARRAY['private'],'private','1') ON CONFLICT DO NOTHING
      `, [workspaceId, blueprint, blueprintDigest])
      const schema = await row(db, `
        SELECT schema_id FROM vdb.schemas WHERE workspace_id=$1 AND blueprint_ref=$2
          AND blueprint_revision='1' AND blueprint_digest=$3
      `, [workspaceId, blueprint, blueprintDigest])
      if (!schema) throw conflict()
      const data = { artifactRevisionId, digest: revision.content_digest, grantedBy: actorId, progress: [] }
      const created = await db.query(`
        INSERT INTO vdb.records(record_id,schema_id,project_id,record_key,access,owner_principal_id,data)
        VALUES($1,$2,$3,$1::uuid::text,'private',$4,$5) ON CONFLICT DO NOTHING
      `, [assignmentId, schema.schema_id, projectId, learnerId, data])
      if (!created.rowCount && !await row(db, `
        SELECT 1 FROM vdb.records WHERE record_id=$1 AND schema_id=$2 AND project_id=$3 AND access='private'
          AND owner_principal_id=$4 AND data->>'artifactRevisionId'=$5 AND data->>'digest'=$6
      `, [assignmentId, schema.schema_id, projectId, learnerId, artifactRevisionId, revision.content_digest])) throw conflict()
      return { assignmentId, learnerId, artifactRevisionId }
    })
  }

  function learn(actorId, assignmentId, command, now = Date.now()) {
    actorId = uuid(actorId)
    assignmentId = uuid(assignmentId)
    return run(db => executeLearningAccess({
      async access() {
        const entry = await row(db, `
          SELECT p.workspace_id,r.created_at,r.version::int,r.data,ar.content_digest,a.artifact_key,ar.revision_number::int,
            ar.metadata #> '{payload,document}' AS document
          FROM platform.projects p JOIN platform.workspaces w USING(workspace_id)
          ${projectMember}
          JOIN vdb.records r ON r.project_id=p.project_id AND r.owner_principal_id=m.principal_id AND r.access='private'
          JOIN vdb.schemas s ON s.schema_id=r.schema_id AND s.workspace_id=p.workspace_id
          JOIN artifact.artifact_revisions ar ON ar.artifact_revision_id=(r.data->>'artifactRevisionId')::uuid
            AND ar.content_digest=r.data->>'digest'
          JOIN artifact.artifacts a ON a.artifact_id=ar.artifact_id AND a.workspace_id=p.workspace_id AND a.project_id=p.project_id
          WHERE ${activePrivateProject} AND r.record_id=$3 AND s.blueprint_ref=$4
            AND s.blueprint_revision='1' AND s.blueprint_digest=$5
            AND ${courseProfile} AND ar.metadata #>> '{owner,projectRef}'=p.project_id::text
          FOR SHARE OF p,w,m,human
        `, [projectId, actorId, assignmentId, blueprint, blueprintDigest])
        if (!entry || entry.document?.course?.courseId !== entry.artifact_key ||
            entry.document?.revision !== entry.revision_number) return null
        return { id: assignmentId, learnerId: actorId, workspaceId: entry.workspace_id, grantedAt: entry.created_at.getTime(),
          document: entry.document, digest: 'sha256:' + entry.content_digest, data: entry.data, version: entry.version }
      },
      async progress(access) {
        return { version: access.version, progress: access.data.progress, lastMutation: access.data.lastMutation }
      },
      async save(access, prior, next) {
        const result = await db.query(`
          UPDATE vdb.records SET data=$1,version=version+1,updated_at=clock_timestamp()
          WHERE record_id=$2 AND project_id=$3 AND owner_principal_id=$4 AND version=$5
        `, [{ ...access.data, progress: next.progress, lastMutation: next.lastMutation }, assignmentId, projectId, actorId, prior.version])
        return result.rowCount === 1
      },
    }, actorId, assignmentId, command, now))
  }

  async function listAssignments(db, workspaceId) {
      const { rows } = await db.query(`
        SELECT r.record_id AS "assignmentId",r.owner_principal_id AS "learnerId",coalesce(human.display_name, human.email) AS "learnerName",
          ar.metadata #>> '{payload,document,course,title}' AS title,
          ar.artifact_revision_id AS "artifactRevisionId",ar.revision_number::int AS "courseRevision",r.version::int,
          (SELECT count(*)::int FROM jsonb_array_elements(r.data->'progress') entry WHERE entry->>'completed'='true') AS completed,
          (SELECT count(*)::int FROM jsonb_array_elements(ar.metadata#>'{payload,document,course,lessons}') lesson
            WHERE lesson->>'status'='published') AS total
        FROM vdb.records r JOIN vdb.schemas s USING(schema_id)
        JOIN identity.principals human ON human.principal_id=r.owner_principal_id
        JOIN artifact.artifact_revisions ar ON ar.artifact_revision_id=(r.data->>'artifactRevisionId')::uuid
          AND ar.content_digest=r.data->>'digest'
        JOIN artifact.artifacts a ON a.artifact_id=ar.artifact_id AND a.workspace_id=s.workspace_id AND a.project_id=r.project_id
        WHERE s.workspace_id=$1 AND r.project_id=$2 AND r.access='private' AND s.blueprint_ref=$3
          AND s.blueprint_revision='1' AND s.blueprint_digest=$4
          AND ${courseProfile} AND ar.metadata #>> '{owner,projectRef}'=r.project_id::text
        ORDER BY r.created_at DESC LIMIT 50
      `, [workspaceId, projectId, blueprint, blueprintDigest])
      return rows
  }

  function assignments(actorId) {
    return run(async db => listAssignments(db, await membership(db, actorId, true)))
  }

  function dashboard(actorId) {
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      const courses = (await db.query(`
        SELECT latest.artifact_revision_id AS id,latest.revision_number::int AS revision,
          latest.metadata #>> '{payload,document,course,title}' AS title
        FROM artifact.artifacts a
        JOIN LATERAL (
          SELECT ar.artifact_revision_id,ar.revision_number,ar.metadata
          FROM artifact.artifact_revisions ar WHERE ar.artifact_id=a.artifact_id
            AND ${courseProfile} AND ar.metadata #>> '{owner,projectRef}'=a.project_id::text
            AND ar.metadata #>> '{payload,document,course,status}'='published'
          ORDER BY ar.revision_number DESC LIMIT 1
        ) latest ON true
        WHERE a.workspace_id=$1 AND a.project_id=$2 AND latest.metadata #>> '{payload,document,course,status}'='published'
        ORDER BY a.created_at DESC LIMIT 50
      `, [workspaceId, projectId])).rows
      const learners = (await db.query(`
        SELECT m.principal_id AS id,coalesce(human.display_name,human.email,m.principal_id::text) AS name
        FROM platform.project_memberships m
        JOIN identity.principals human ON human.principal_id=m.principal_id AND human.principal_kind='human' AND human.status='active'
        WHERE m.project_id=$1 AND m.status='active'
          AND NOT EXISTS (SELECT 1 FROM platform.workspace_members wm
            WHERE wm.workspace_id=$2 AND wm.principal_id=m.principal_id AND wm.status<>'active')
        ORDER BY m.joined_at DESC LIMIT 50
      `, [projectId, workspaceId])).rows
      const drafts = (await db.query(`
        SELECT a.artifact_id AS "artifactRef",latest.revision_number::int AS revision,
          'sha256:' || latest.content_digest AS digest,latest.metadata #>> '{payload,document,course,title}' AS title
        FROM artifact.artifacts a
        JOIN LATERAL (
          SELECT ar.revision_number,ar.content_digest,ar.metadata FROM artifact.artifact_revisions ar
          WHERE ar.artifact_id=a.artifact_id AND ${courseProfile}
            AND ar.metadata #>> '{owner,projectRef}'=a.project_id::text
          ORDER BY ar.revision_number DESC LIMIT 1
        ) latest ON true
        WHERE a.workspace_id=$1 AND a.project_id=$2 AND latest.metadata #>> '{payload,document,course,status}'='draft'
        ORDER BY a.created_at DESC LIMIT 50
      `, [workspaceId, projectId])).rows
      return { workspaceId, courses, drafts, learners, assignments: await listAssignments(db, workspaceId) }
    })
  }

  function learnerHome(actorId) {
    return run(async db => {
      const workspaceId = await membership(db, actorId)
      const { rows } = await db.query(`
        SELECT r.record_id AS id,ar.metadata #>> '{payload,document,course,title}' AS title
        FROM vdb.records r JOIN vdb.schemas s USING(schema_id)
        JOIN artifact.artifact_revisions ar ON ar.artifact_revision_id=(r.data->>'artifactRevisionId')::uuid
          AND ar.content_digest=r.data->>'digest'
        JOIN artifact.artifacts a ON a.artifact_id=ar.artifact_id AND a.workspace_id=s.workspace_id AND a.project_id=r.project_id
        WHERE s.workspace_id=$1 AND r.project_id=$2 AND r.owner_principal_id=$3 AND r.access='private'
          AND s.blueprint_ref=$4 AND s.blueprint_revision='1' AND s.blueprint_digest=$5
          AND ${courseProfile} AND ar.metadata #>> '{owner,projectRef}'=r.project_id::text
        ORDER BY r.created_at DESC LIMIT 50
      `, [workspaceId, projectId, actorId, blueprint, blueprintDigest])
      return rows
    })
  }

  function invite(actorId, { email, name }) {
    if (typeof email !== 'string' || typeof name !== 'string') throw invalid()
    email = email.trim().toLowerCase()
    name = name.trim()
    if (!/^[^@\s]+@[^@\s]+$/.test(email) || email.length > 320 || !name || name.length > 80 || /[\x00-\x1f]/.test(name + email)) throw invalid()
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [workspaceId + ':' + email])
      const pending = await row(db, `
        SELECT invitation_id,invite_role,project_ids,content_edit FROM platform.workspace_reviewer_invitations
        WHERE workspace_id=$1 AND email=$2 AND status='pending' FOR UPDATE
      `, [workspaceId, email])
      if (pending) {
        if (pending.invite_role !== 'viewer' || pending.content_edit ||
            pending.project_ids.length !== 1 || pending.project_ids[0] !== projectId) throw conflict()
        await db.query(`
          UPDATE platform.workspace_reviewer_invitations SET status='revoked',revoked_by=$2,revoked_at=now()
          WHERE invitation_id=$1
        `, [pending.invitation_id, actorId])
      }
      const token = randomBytes(32).toString('base64url')
      await db.query(`
        INSERT INTO platform.workspace_reviewer_invitations(workspace_id,email,display_name,token_hash,invited_by,
          expires_at,invite_role,project_ids)
        VALUES($1,$2,$3,$4,$5,now()+interval '7 days','viewer',ARRAY[$6::uuid])
      `, [workspaceId, email, name, 'sha256:' + sha(token), actorId, projectId])
      return token
    })
  }

  function accept({ principalId, verifiedEmail }, token) {
    if (typeof token !== 'string' || !/^[a-zA-Z0-9_-]{43}$/.test(token)) throw invalid()
    if (!verifiedEmail) throw new StoreError(403, 'email_verification_required')
    return run(async db => {
      const invitation = await row(db, `
        SELECT i.invitation_id,i.email,i.status,i.accepted_by,i.invited_by,i.expires_at > now() AS valid
        FROM platform.workspace_reviewer_invitations i
        JOIN platform.projects p ON p.workspace_id=i.workspace_id AND p.project_id=$1
        JOIN identity.principals human ON human.principal_id=$2 AND human.status='active' AND human.principal_kind='human'
        WHERE i.token_hash=$3 AND i.invite_role='viewer' AND NOT i.content_edit AND i.project_ids=ARRAY[p.project_id]
          AND NOT EXISTS(SELECT 1 FROM platform.workspace_members wm WHERE wm.workspace_id=p.workspace_id
            AND wm.principal_id=human.principal_id AND wm.status<>'active')
        FOR UPDATE OF i
      `, [projectId, principalId, 'sha256:' + sha(token)])
      if (!invitation || invitation.status === 'revoked') throw new StoreError(410, 'invitation_unavailable')
      if (invitation.email !== verifiedEmail) throw forbidden()
      if (invitation.status === 'accepted') {
        if (invitation.accepted_by !== principalId) throw forbidden()
        await membership(db, principalId)
        return { state: 'joined' }
      }
      if (!invitation.valid) throw new StoreError(410, 'invitation_unavailable')
      try { await membership(db, invitation.invited_by, true) } catch (error) {
        if (error instanceof StoreError && error.status === 404) throw new StoreError(410, 'invitation_unavailable')
        throw error
      }
      const member = await row(db, `
        INSERT INTO platform.project_memberships(project_id,principal_id,member_role)
        VALUES($1,$2,'viewer') ON CONFLICT DO NOTHING RETURNING principal_id
      `, [projectId, principalId])
      if (!member) await membership(db, principalId)
      await db.query(`
        UPDATE platform.workspace_reviewer_invitations SET status='accepted',accepted_by=$2,accepted_at=now()
        WHERE invitation_id=$1
      `, [invitation.invitation_id, principalId])
      return { state: 'joined' }
    })
  }

  return { projectId, release, saveDraft, getDraft, publishDraft, assign, learn, assignments, dashboard, learnerHome, invite, accept }
}
