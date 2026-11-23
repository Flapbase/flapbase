import { executeLearningAccess, LearnerError } from '../course-engine/src/learning-access.js'
import { missing, storeId } from './free-download.mjs'

const blueprint = 'vdb.flap.course.progress'
const blueprintDigest = 'f85399d40310fb80069a98d9c2b2315d45384100bc521cabf3604da369390c9a'
const row = async (db, sql, values) => (await db.query(sql, values)).rows[0]
const conflict = () => new LearnerError('progress_conflict', 409)

export function createPurchasedCourse({ store, course }) {
  const projectId = course.projectId

  async function access(db, buyerId, orderId) {
    const { workspaceId, order, release } = await store.paidOrder(db, buyerId, orderId, true)
    if (order.data.status !== 'paid' || !order.data.amountMinor || !release.coursePin || order.data.refundedMinor > 0) throw missing()
    const { document, pin } = await course.readPinned(db, workspaceId, release.coursePin)
    const grantedAt = Date.parse(order.data.paidAt)
    if (!Number.isFinite(grantedAt) || document.course.courseId !== pin.artifactRef || document.revision !== pin.revision) throw missing()
    return { id: orderId, workspaceId, learnerId: buyerId, grantedAt, document, digest: pin.digest }
  }

  function learn(buyerId, orderId, command, now = Date.now()) {
    if (!storeId(orderId)) throw missing()
    return store.transaction(db => executeLearningAccess({
      access: () => access(db, buyerId, orderId),
      async progress(order) {
        const entry = await row(db, `
          SELECT r.data,r.version::int FROM vdb.records r JOIN vdb.schemas s USING(schema_id)
          WHERE s.workspace_id=$1 AND r.project_id=$2 AND r.record_key=$3
            AND r.owner_principal_id=$4 AND r.access='private'
            AND s.blueprint_ref=$5 AND s.blueprint_revision='1' AND s.blueprint_digest=$6
        `, [order.workspaceId, projectId, orderId, buyerId, blueprint, blueprintDigest])
        if (!entry) return { version: 0, progress: [] }
        const data = entry.data
        if (data.orderId !== orderId || data.courseId !== order.document.course.courseId ||
            data.revision !== order.document.revision || data.digest !== order.digest) throw conflict()
        return { version: entry.version, progress: data.progress, lastMutation: data.lastMutation }
      },
      async save(order, prior, next) {
        await db.query(`
          INSERT INTO vdb.schemas(workspace_id,blueprint_ref,blueprint_revision,blueprint_digest,allowed_access,default_access,projection_version)
          VALUES($1,$2,'1',$3,ARRAY['private'],'private','1') ON CONFLICT DO NOTHING
        `, [order.workspaceId, blueprint, blueprintDigest])
        const schema = await row(db, `
          SELECT schema_id FROM vdb.schemas WHERE workspace_id=$1 AND blueprint_ref=$2
            AND blueprint_revision='1' AND blueprint_digest=$3
        `, [order.workspaceId, blueprint, blueprintDigest])
        if (!schema) throw conflict()
        const data = { orderId, courseId: order.document.course.courseId, revision: order.document.revision, digest: order.digest,
          progress: next.progress, lastMutation: next.lastMutation }
        const key = [schema.schema_id, projectId, orderId, buyerId, data]
        const result = prior.version === 0
          ? await db.query(`
              INSERT INTO vdb.records(schema_id,project_id,record_key,owner_principal_id,data,access)
              VALUES($1,$2,$3,$4,$5,'private') ON CONFLICT DO NOTHING
            `, key)
          : await db.query(`
              UPDATE vdb.records SET data=$5,version=version+1,updated_at=clock_timestamp()
              WHERE schema_id=$1 AND project_id=$2 AND record_key=$3 AND owner_principal_id=$4 AND access='private' AND version=$6
            `, [...key, prior.version])
        return result.rowCount === 1
      },
    }, buyerId, orderId, command, now))
  }

  return { learn }
}
