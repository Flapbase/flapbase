import { randomUUID } from 'node:crypto'
import { validateCourseDocument } from '../course-engine/src/document.js'
import { executeLearningAccess } from '../course-engine/src/learning-access.js'
import { invalid, missing, sha, StoreError, storeId } from './free-download.mjs'
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

  function release(actorId, input) {
    let document
    try { document = validateCourseDocument(input) } catch { throw invalid() }
    if (document.course.status !== 'published') throw invalid()
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      if (document.course.tenantId !== workspaceId) throw missing()
      const courseId = document.course.courseId
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [courseId])
      await db.query(`
        INSERT INTO artifact.artifacts(artifact_id,workspace_id,artifact_key,project_id,opaque_ref,media_type)
        VALUES($1,$2,$1::uuid::text,$3,$1::uuid::text,'application/json') ON CONFLICT DO NOTHING
      `, [courseId, workspaceId, projectId])
      const artifact = await row(db, `
        SELECT artifact_id FROM artifact.artifacts WHERE artifact_id=$1 AND workspace_id=$2 AND project_id=$3
      `, [courseId, workspaceId, projectId])
      if (!artifact) throw conflict()
      const digest = sha(JSON.stringify(document))
      const previous = await row(db, `
        SELECT artifact_revision_id,revision_number,content_digest FROM artifact.artifact_revisions
        WHERE artifact_id=$1 ORDER BY revision_number DESC LIMIT 1
      `, [courseId])
      if (Number(previous?.revision_number) === document.revision && previous.content_digest === digest) {
        return { artifactRevisionId: previous.artifact_revision_id, digest, revision: document.revision }
      }
      if (document.revision !== Number(previous?.revision_number ?? 0) + 1) throw conflict()
      const artifactRevisionId = randomUUID()
      await db.query(`
        INSERT INTO artifact.artifact_revisions(artifact_revision_id,artifact_id,revision_number,opaque_ref,content_digest,metadata)
        VALUES($1,$2,$3,$1::uuid::text,$4,$5)
      `, [artifactRevisionId, courseId, document.revision, digest, {
        owner: { projectRef: projectId }, profile: { ref: 'course-document', version: '1' }, payload: { document },
      }])
      return { artifactRevisionId, digest, revision: document.revision }
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

  function assignments(actorId) {
    return run(async db => {
      const workspaceId = await membership(db, actorId, true)
      const { rows } = await db.query(`
        SELECT r.record_id AS "assignmentId",r.owner_principal_id AS "learnerId",human.display_name AS "learnerName",
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
    })
  }

  return { release, assign, learn, assignments }
}
