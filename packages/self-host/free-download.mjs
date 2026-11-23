import { createHash, randomUUID } from 'node:crypto'
import { link, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const blueprint = Object.freeze({
  ref: 'site.own-site-sales', revision: '1',
  records: {
    listing: ['currentRevisionId'],
    release: ['listingId', 'title', 'description', 'fileName', 'digest'],
    order: ['listingId', 'revisionId'],
  },
})
export const sha = value => createHash('sha256').update(value).digest('hex')
const blueprintDigest = sha(JSON.stringify(blueprint))
export const storeId = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
export class StoreError extends Error {
  constructor(status, code) {
    super(code)
    this.status = status
  }
}
export const invalid = () => new StoreError(400, 'invalid_request')
export const missing = () => new StoreError(404, 'not_found')
export const forbidden = () => new StoreError(403, 'forbidden')

export async function createFreeDownloadStore({ pool, projectId, directory, renderProduct, course }) {
  if (!storeId(projectId) || !directory) throw invalid()
  const pages = join(directory, projectId, 'public-products')
  const blobs = join(directory, projectId, 'protected-files')
  await Promise.all([mkdir(pages, { recursive: true, mode: 0o700 }), mkdir(blobs, { recursive: true, mode: 0o700 })])

  async function scoped(client, principalId, permissions) {
    const { rows: [project] } = await client.query(`
      SELECT p.workspace_id, EXISTS (
        SELECT 1 FROM platform.workspace_members m JOIN identity.principals actor ON actor.principal_id=m.principal_id
        WHERE actor.status='active' AND actor.principal_kind='human' AND m.workspace_id=p.workspace_id AND m.principal_id=$2::uuid
          AND m.member_role IN ('owner','admin') AND m.status='active' AND m.revoked_at IS NULL
      ) AS operator
      FROM platform.projects p JOIN platform.workspaces w USING (workspace_id)
      WHERE p.project_id=$1::uuid AND p.status='active' AND w.status='active'`, [projectId, principalId])
    if (!project || (permissions !== 'buyer' && !project.operator)) throw forbidden()
    const key = [project.workspace_id, blueprint.ref, blueprint.revision]
    if (permissions === 'publish') {
      await client.query(`
        INSERT INTO vdb.schemas(workspace_id,blueprint_ref,blueprint_revision,blueprint_digest,allowed_access,default_access,projection_version)
        VALUES ($1,$2,$3,$4,ARRAY['project','private'],'project','1')
        ON CONFLICT (workspace_id,blueprint_ref,blueprint_revision) DO NOTHING`, [...key, blueprintDigest])
    }
    const { rows: [schema] } = await client.query(`
      SELECT schema_id,blueprint_digest FROM vdb.schemas WHERE workspace_id=$1 AND blueprint_ref=$2 AND blueprint_revision=$3`, key)
    if (schema && schema.blueprint_digest !== blueprintDigest) throw new StoreError(409, 'blueprint_conflict')
    return { workspaceId: project.workspace_id, schemaId: schema?.schema_id }
  }

  async function get(client, schemaId, id, kind, lock = false) {
    const { rows } = await client.query(`
      SELECT record_id,data,owner_principal_id,created_at,version FROM vdb.records
      WHERE schema_id=$1 AND project_id=$2 AND record_id=$3 AND data->>'kind'=$4 ${lock ? 'FOR SHARE' : ''}`,
      [schemaId, projectId, id, kind])
    return rows[0]
  }

  async function transaction(run) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await run(client)
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function publish(principalId, input) {
    const { listingId = randomUUID(), title, description, fileName, bytes, amountMinor = 0, artifactRevisionId } = input
    const isCourse = artifactRevisionId !== undefined
    if (!Number.isSafeInteger(amountMinor) || amountMinor < 0 || (amountMinor > 0 && amountMinor < 50) || amountMinor > 10_000_000 || !storeId(listingId) || typeof title !== 'string' || !title.trim() || title.length > 160 || title.includes('\0')
        || typeof description !== 'string' || description.length > 3000 || description.includes('\0')) throw invalid()
    if (isCourse ? (!course || course.projectId !== projectId || !storeId(artifactRevisionId) || !amountMinor)
      : (typeof fileName !== 'string' || !fileName || fileName.length > 160 || !fileName.isWellFormed() || /[\\/\u0000-\u001f\u007f]/u.test(fileName)
        || !Buffer.isBuffer(bytes) || !bytes.length || bytes.length > 5_242_880)) throw invalid()

    const revisionId = randomUUID()
    const digest = isCourse ? null : sha(bytes)
    const finalPage = join(pages, listingId + '.html')
    const tempFile = isCourse ? null : join(blobs, revisionId + '.tmp')
    const tempPage = join(pages, revisionId + '.tmp')
    const client = await pool.connect()
    try {
      // Keep the DB release and the atomic static-page swap in publication order.
      await client.query('SELECT pg_advisory_lock(hashtext($1),hashtext($2))', [projectId, listingId])
      try {
        await client.query('BEGIN')
        try {
          const { schemaId, workspaceId } = await scoped(client, principalId, 'publish')
          const prior = await get(client, schemaId, listingId, 'listing')
          if (!prior && input.listingId !== undefined) throw missing()
          if (prior) {
            const priorRelease = await get(client, schemaId, prior.data.currentRevisionId, 'release')
            if (!priorRelease || Boolean(priorRelease.data.coursePin) !== isCourse) throw invalid()
          }
          const delivery = isCourse
            ? { coursePin: await course.offerPin(client, principalId, workspaceId, artifactRevisionId) }
            : { fileName, digest }
          const release = { kind: 'release', listingId, title: title.trim(), description, ...delivery, ...(amountMinor ? { amountMinor } : {}) }
          if (tempFile) {
            await writeFile(tempFile, bytes, { mode: 0o600, flag: 'wx' })
            await link(tempFile, join(blobs, digest)).catch(error => {
              if (error.code !== 'EEXIST') throw error
            })
          }
          await writeFile(tempPage, renderProduct({ listingId, revisionId, title: release.title, description, amountMinor }), { mode: 0o600, flag: 'wx' })
          if (prior) {
            await client.query(`
              UPDATE vdb.records SET data=$4,version=version+1,updated_at=now()
              WHERE schema_id=$1 AND project_id=$2 AND record_id=$3`,
              [schemaId, projectId, listingId, { kind: 'listing', currentRevisionId: revisionId }])
          } else {
            await client.query(`
              INSERT INTO vdb.records(record_id,schema_id,project_id,access,record_key,data)
              VALUES ($1::uuid,$2,$3,'project',$1::uuid::text,$4)`,
              [listingId, schemaId, projectId, { kind: 'listing', currentRevisionId: revisionId }])
          }
          await client.query(`
            INSERT INTO vdb.records(record_id,schema_id,project_id,access,record_key,data)
            VALUES ($1::uuid,$2,$3,'project',$1::uuid::text,$4)`, [revisionId, schemaId, projectId, release])
          await client.query('COMMIT')
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
        await rename(tempPage, finalPage)
      } finally {
        await client.query('SELECT pg_advisory_unlock(hashtext($1),hashtext($2))', [projectId, listingId])
      }
      return { listingId, listingRevisionId: revisionId, purchaseUrl: '/products/' + listingId }
    } finally {
      client.release()
      await Promise.all([rm(tempPage, { force: true }), ...(tempFile ? [rm(tempFile, { force: true })] : [])])
    }
  }

  async function checkout(principalId, listingId, revisionId, allowPaid) {
    if (!storeId(listingId) || !storeId(revisionId)) throw invalid()
    const recordKey = sha(JSON.stringify([projectId, principalId, revisionId]))
    return transaction(async client => {
      const { schemaId } = await scoped(client, principalId, 'buyer')
      if (!schemaId) throw missing()
      const release = await get(client, schemaId, revisionId, 'release')
      if (!release || release.data.listingId !== listingId) throw missing()
      const amountMinor = release.data.amountMinor ?? 0
      if (amountMinor && !allowPaid) throw new StoreError(503, 'payment_unavailable')
      const purchase = order => ({ orderId: order.record_id, amountMinor, title: release.data.title, paid: order.data.status !== 'pending' })
      // Return an already accepted order even after the item has a new published revision.
      const { rows: [prior] } = await client.query(`
        SELECT record_id,data FROM vdb.records WHERE schema_id=$1 AND project_id=$2 AND record_key=$3
          AND owner_principal_id=$4 AND data->>'kind'='order'`, [schemaId, projectId, recordKey, principalId])
      if (prior) return purchase(prior)
      const listing = await get(client, schemaId, listingId, 'listing', true)
      if (!listing || listing.data.currentRevisionId !== revisionId) throw new StoreError(409, 'revision_changed')
      const { rows: [order] } = await client.query(`
        INSERT INTO vdb.records(schema_id,project_id,access,owner_principal_id,record_key,data)
        VALUES ($1,$2,'private',$3,$4,$5)
        ON CONFLICT (schema_id,record_key) DO UPDATE SET record_key=EXCLUDED.record_key
        WHERE vdb.records.project_id=$2 AND vdb.records.owner_principal_id=$3 AND vdb.records.data->>'kind'='order'
        RETURNING record_id,data`, [schemaId, projectId, principalId, recordKey, {
        kind: 'order', listingId, revisionId, ...(amountMinor ? { status: 'pending', amountMinor } : {}),
      }])
      if (!order) throw new StoreError(409, 'order_conflict')
      return purchase(order)
    })
  }

  async function attachSession(principalId, orderId, sessionId) {
    return transaction(async client => {
      const { schemaId } = await scoped(client, principalId, 'buyer')
      const { rowCount } = await client.query(`
        UPDATE vdb.records SET data=jsonb_set(data,'{paymentSession}',to_jsonb($5::text))
        WHERE schema_id=$1 AND project_id=$2 AND record_id=$3 AND owner_principal_id=$4
          AND data->>'kind'='order' AND data->>'status'='pending'
          AND (data->>'paymentSession' IS NULL OR data->>'paymentSession'=$5)`,
      [schemaId, projectId, orderId, principalId, sessionId])
      if (rowCount !== 1) throw new StoreError(409, 'checkout_conflict')
    })
  }

  async function confirmPayment({ orderId, sessionId, amountMinor, currency }) {
    if (!storeId(orderId) || currency !== 'jpy') throw new StoreError(409, 'payment_mismatch')
    return transaction(async client => {
      const { schemaId } = await scoped(client, null, 'buyer')
      const { rowCount } = await client.query(`
        UPDATE vdb.records SET data=data || jsonb_build_object('status','paid','paidAt',coalesce(data->'paidAt',to_jsonb(now())))
        WHERE schema_id=$1 AND project_id=$2 AND record_id=$3 AND data->>'kind'='order'
          AND data->>'paymentSession'=$4 AND data->>'amountMinor'=$5
          AND data->>'status' IN ('pending','paid')`, [schemaId, projectId, orderId, sessionId, String(amountMinor)])
      if (rowCount !== 1) throw new StoreError(409, 'payment_mismatch')
    })
  }

  async function paidOrder(client, principalId, orderId, lock = false) {
    if (!storeId(orderId)) throw missing()
    const { schemaId, workspaceId } = await scoped(client, principalId, 'buyer')
    const order = schemaId && await get(client, schemaId, orderId, 'order', lock)
    if (!order || order.owner_principal_id !== principalId) throw missing()
    if (order.data.status === 'pending') throw new StoreError(409, 'payment_pending')
    if (order.data.status !== undefined && order.data.status !== 'paid') throw missing()
    const release = await get(client, schemaId, order.data.revisionId, 'release')
    if (!release || release.data.listingId !== order.data.listingId) throw missing()
    return { schemaId, workspaceId, order, release: release.data }
  }

  async function receive(principalId, orderId, downloaded = false) {
    return transaction(async client => {
      const { schemaId, order, release } = await paidOrder(client, principalId, orderId)
      if (release.coursePin && !downloaded) return release
      if (release.coursePin || !/^[0-9a-f]{64}$/.test(release.digest)) throw missing()
      if (downloaded && order.data.received !== true) {
        await client.query(`
          UPDATE vdb.records SET data=jsonb_set(data,'{received}','true')
          WHERE schema_id=$1 AND project_id=$2 AND record_id=$3 AND owner_principal_id=$4`, [schemaId, projectId, orderId, principalId])
      }
      return { ...release, path: join(blobs, release.digest) }
    })
  }

  async function dashboard(principalId) {
    return transaction(async client => {
      const { schemaId } = await scoped(client, principalId, 'operator')
      const { rows } = await client.query(`
        SELECT o.record_id AS order_id,r.record_id AS listing_revision_id,
          r.data->>'title' AS title,o.created_at, o.owner_principal_id AS buyer_principal_id,
          o.data->>'listingId' AS listing_id, o.project_id,
          coalesce(o.data->>'status','paid') AS status, coalesce(o.data->>'amountMinor','0') AS amount_minor
        FROM vdb.records o JOIN vdb.records r
          ON r.record_id::text=o.data->>'revisionId' AND r.schema_id=o.schema_id AND r.project_id=o.project_id AND r.data->>'kind'='release'
        WHERE o.schema_id=$1 AND o.project_id=$2 AND o.access='private' AND o.data->>'kind'='order'
        ORDER BY o.created_at DESC,o.record_id LIMIT 100`, [schemaId,projectId])
      const { rows: products } = await client.query(`
        SELECT l.record_id AS listing_id, r.data->>'title' AS title, r.data ? 'coursePin' AS "isCourse"
        FROM vdb.records l JOIN vdb.records r
          ON r.record_id::text=l.data->>'currentRevisionId' AND r.schema_id=l.schema_id AND r.project_id=l.project_id AND r.data->>'kind'='release'
        WHERE l.schema_id=$1 AND l.project_id=$2 AND l.data->>'kind'='listing'
        ORDER BY l.updated_at DESC,l.record_id`, [schemaId, projectId])
      return { orders: rows, products }
    })
  }

  const page = listingId => {
    if (!storeId(listingId)) throw missing()
    return readFile(join(pages, listingId + '.html')).catch(error => {
      if (error.code === 'ENOENT') throw missing()
      throw error
    })
  }

  return { projectId, publish, checkout, attachSession, confirmPayment, receive, dashboard, page, paidOrder, transaction, scoped, get }
}
