import { randomUUID } from 'node:crypto'
import { parseDigitalProductBase } from './digital-product-base.mjs'
import { forbidden, invalid, missing, sha, storeId, StoreError } from './free-download.mjs'

const definition = { ref: 'site.own-site-sales.lifecycle', revision: '1', records: ['product_draft', 'follow_up_draft', 'lead', 'follow_up', 'support_request'] }
const digest = sha(JSON.stringify(definition))

function requiredText(value, length) {
  if (typeof value !== 'string' || !value.trim() || value.length > length || value.includes('\0')) throw invalid()
  return value.trim()
}

export function createStoreLifecycle({ store, projectId, sendEmail }) {
  async function context(client, actor, permission, initialize = false) {
    const { workspaceId, schemaId: orderSchema } = await store.scoped(client, actor, permission)
    const key = [workspaceId, definition.ref, definition.revision]
    if (initialize) {
      await client.query(`
        INSERT INTO vdb.schemas(workspace_id,blueprint_ref,blueprint_revision,blueprint_digest,allowed_access,default_access,projection_version)
        VALUES ($1,$2,$3,$4,ARRAY['project','private'],'project','1')
        ON CONFLICT(workspace_id,blueprint_ref,blueprint_revision) DO NOTHING`, [...key, digest])
    }
    const { rows: [schema] } = await client.query(`
      SELECT schema_id,blueprint_digest FROM vdb.schemas WHERE workspace_id=$1 AND blueprint_ref=$2 AND blueprint_revision=$3`, key)
    if (schema && schema.blueprint_digest !== digest) throw new StoreError(409, 'blueprint_conflict')
    return { schemaId: schema?.schema_id, orderSchema }
  }

  async function put(client, schemaId, key, data, { id = randomUUID(), owner = null, replace = false } = {}) {
    const parameters = [id, schemaId, projectId, owner ? 'private' : 'project', owner, key, data]
    const { rows: [entry] } = await client.query(`
      INSERT INTO vdb.records(record_id,schema_id,project_id,access,owner_principal_id,record_key,data)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(schema_id,record_key) DO UPDATE SET
        data=${replace ? 'EXCLUDED.data' : 'vdb.records.data'},
        version=vdb.records.version+${replace ? '1' : '0'}
      WHERE vdb.records.project_id=EXCLUDED.project_id
      RETURNING record_id, data`, parameters)
    if (!entry) throw new StoreError(409, 'record_conflict')
    return entry
  }

  async function draft(client, schemaId, kind = 'product_draft') {
    const { rows: [row] } = await client.query(`
      SELECT data FROM vdb.records WHERE schema_id=$1 AND project_id=$2 AND record_key=$3`,
    [schemaId, projectId, sha(JSON.stringify([projectId, kind]))])
    return row?.data
  }

  async function installBase(actor, definition) {
    let base
    try { base = parseDigitalProductBase(definition) } catch { throw invalid() }
    const baseDigest = sha(JSON.stringify(base))
    return store.transaction(async client => {
      const { schemaId } = await context(client, actor, 'operator', true)
      const key = kind => sha(JSON.stringify([projectId, kind]))
      // One portable installation per Project. Never change a saved product or a published listing on replay.
      const installation = await put(client, schemaId, key('installation_base'), {
        kind: 'installation_base', baseDigest, base,
      })
      if (installation.data.baseDigest !== baseDigest) throw new StoreError(409, 'base_conflict')
      const product = await put(client, schemaId, key('product_draft'), {
        kind: 'product_draft', title: base.presentation.heading, description: base.presentation.introduction,
      })
      return { projectId, installationId: installation.record_id, draftId: product.record_id, base }
    })
  }

  async function requireOrder(client, schemaId, orderId, principalId) {
    if (!storeId(orderId) || !schemaId) throw missing()
    const order = await store.get(client, schemaId, orderId, 'order')
    if (!order || (principalId && order.owner_principal_id !== principalId) || order.data.status === 'pending') throw missing()
    return order
  }

  async function registerLead({ listingId, email, consent }, principalId) {
    if (!storeId(listingId) || consent !== true) throw invalid()
    const address = requiredText(email, 254).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) throw invalid()
    return store.transaction(async client => {
      const { schemaId, orderSchema } = await context(client, null, 'buyer', true)
      if (!orderSchema || !await store.get(client, orderSchema, listingId, 'listing')) throw missing()
      await put(client, schemaId, sha(JSON.stringify([projectId, 'lead', listingId, address])), {
        kind: 'lead', listingId, email: address, consent: true,
      }, { owner: principalId })
    })
  }

  async function stopFollowUp(leadId) {
    if (!storeId(leadId)) throw missing()
    await store.transaction(async client => {
      const { schemaId } = await context(client, null, 'buyer')
      const { rowCount } = await client.query(`
        UPDATE vdb.records SET data=jsonb_set(data,'{consent}','false')
        WHERE schema_id=$1 AND project_id=$2 AND record_id=$3 AND data->>'kind'='lead'`, [schemaId, projectId, leadId])
      if (!rowCount) throw missing()
    })
  }

  async function sendFollowUp(actor, { leadId, subject, body }) {
    if (!sendEmail) throw new StoreError(503, 'email_unavailable')
    if (!storeId(leadId)) throw invalid()
    const message = { subject: requiredText(subject, 160), body: requiredText(body, 3000) }
    const pending = await store.transaction(async client => {
      const { schemaId, orderSchema } = await context(client, actor, 'operator')
      const lead = schemaId && await store.get(client, schemaId, leadId, 'lead', true)
      if (!lead?.data.consent) throw forbidden()
      if (lead.owner_principal_id) {
        const { rowCount } = await client.query(`
          SELECT 1 FROM vdb.records WHERE schema_id=$1 AND project_id=$2 AND owner_principal_id=$3
            AND data->>'kind'='order' AND data->>'listingId'=$4 AND coalesce(data->>'status','paid')='paid'
          LIMIT 1`, [orderSchema, projectId, lead.owner_principal_id, lead.data.listingId])
        if (rowCount) throw new StoreError(409, 'already_purchased')
      }
      const key = sha(JSON.stringify([projectId, 'follow_up', leadId]))
      const id = randomUUID()
      const entry = await put(client, schemaId, key, { kind: 'follow_up', leadId, status: 'sending', approvedBy: actor, approvedAt: new Date().toISOString(), ...message }, { id })
      return { id: entry.record_id, claimed: entry.record_id === id, status: entry.data.status, schemaId, lead: lead.data }
    })
    if (!pending.claimed) return { status: pending.status }
    let status = 'sent'
    try {
      await sendEmail({ id: pending.id, to: pending.lead.email, leadId, listingId: pending.lead.listingId, ...message })
    } catch {
      status = 'delivery_unknown'
    }
    await store.transaction(client => client.query(`
      UPDATE vdb.records SET data=jsonb_set(data,'{status}',to_jsonb($4::text))
      WHERE schema_id=$1 AND project_id=$2 AND record_id=$3 AND data->>'kind'='follow_up'`,
    [pending.schemaId, projectId, pending.id, status]))
    return { status }
  }

  async function openSupport(actor, { orderId, body }) {
    const message = requiredText(body, 3000)
    return store.transaction(async client => {
      const { schemaId, orderSchema } = await context(client, actor, 'buyer', true)
      await requireOrder(client, orderSchema, orderId, actor)
      const entry = await put(client, schemaId, sha(JSON.stringify([projectId, 'support_request', orderId, message])), {
        kind: 'support_request', orderId, body: message,
      }, { owner: actor })
      return { requestId: entry.record_id }
    })
  }

  async function operatorSnapshot(actor, includeEmails = false) {
    return store.transaction(async client => {
      const { schemaId, orderSchema } = await context(client, actor, 'operator')
      const { rows: leads } = await client.query(`
        SELECT record_id AS id, data->>'email' AS email, data->>'listingId' AS "listingId"
        FROM vdb.records WHERE schema_id=$1 AND project_id=$2 AND data->>'kind'='lead' AND data->>'consent'='true'
        ORDER BY created_at DESC LIMIT 100`, [schemaId, projectId])
      const { rows: requests } = await client.query(`
        SELECT record_id AS "requestId", data->>'orderId' AS "orderId", data->>'body' AS body, data->>'reply' AS reply
        FROM vdb.records WHERE schema_id=$1 AND project_id=$2 AND data->>'kind'='support_request'
        ORDER BY created_at DESC LIMIT 100`, [schemaId, projectId])
      const { rows: [counts] } = await client.query(`
        SELECT
          count(*) FILTER (WHERE schema_id=$1 AND data->>'kind'='lead')::int AS leads,
          count(*) FILTER (WHERE schema_id=$1 AND data->>'kind'='follow_up' AND data->>'status'='sent')::int AS "followUps",
          count(*) FILTER (WHERE schema_id=$3 AND data->>'kind'='order' AND coalesce(data->>'status','paid')='paid')::int AS orders,
          count(*) FILTER (WHERE schema_id=$3 AND data->>'kind'='order' AND data->>'received'='true')::int AS downloads,
          count(*) FILTER (WHERE schema_id=$1 AND data->>'kind'='support_request' AND data->>'reply' IS NULL)::int AS "supportPending"
        FROM vdb.records WHERE project_id=$2 AND schema_id IN ($1,$3)`, [schemaId, projectId, orderSchema])
      return { emailPreviewEnabled: Boolean(sendEmail), productDraft: await draft(client, schemaId), followUpDraft: await draft(client, schemaId, 'follow_up_draft'), leads: includeEmails ? leads : [], requests, counts }
    })
  }

  async function membershipDraft(client, actor) {
    const { schemaId } = await context(client, actor, 'operator')
    return draft(client, schemaId, 'membership_draft')
  }

  async function call(actor, name, args) {
    if (name === 'operations_summary') return { projectId, ...(await operatorSnapshot(actor)).counts }
    if (name === 'support_requests_list') {
      if (args.projectId === undefined && args.orderId === undefined) {
        return (await operatorSnapshot(actor)).requests.map(({ requestId, orderId, reply }) => ({ requestId, orderId, hasDraft: reply !== null }))
      }
      if (args.projectId !== projectId) throw forbidden()
      return store.transaction(async client => {
        const { schemaId, orderSchema } = await context(client, actor, 'operator')
        await requireOrder(client, orderSchema, args.orderId)
        const { rows } = await client.query(`
          SELECT record_id AS "requestId",data->>'body' AS body,data->>'reply' AS "replyDraft",
            created_at AS "createdAt",version::int
          FROM vdb.records WHERE schema_id=$1 AND project_id=$2 AND data->>'kind'='support_request'
            AND data->>'orderId'=$3 ORDER BY created_at DESC,record_id LIMIT 100`, [schemaId, projectId, args.orderId])
        return { orderId: args.orderId, requests: rows }
      })
    }
    if (name === 'product_draft_save' || name === 'follow_up_draft_save') {
      const membership = name === 'product_draft_save' && args.membershipContent !== undefined
      const data = name === 'product_draft_save'
        ? { kind: membership ? 'membership_draft' : 'product_draft', title: requiredText(args.title, 160),
          description: requiredText(args.description, 3000), ...(membership && { content: requiredText(args.membershipContent, 50_000) }) }
        : { kind: 'follow_up_draft', subject: requiredText(args.subject, 160), body: requiredText(args.body, 3000) }
      return store.transaction(async client => {
        const { schemaId } = await context(client, actor, 'operator', true)
        const entry = await put(client, schemaId, sha(JSON.stringify([projectId, data.kind])), data, { replace: true })
        return { draftId: entry.record_id, title: entry.data.title ?? entry.data.subject }
      })
    }
    if (name === 'membership_roster_list') {
      if (args.projectId !== projectId) throw forbidden()
      return store.membershipRoster(actor, { limit: args.limit, after: args.after })
    }
    if (name === 'order_support_get') {
      if (args.projectId !== projectId) throw forbidden()
      if (!storeId(args.orderId)) throw invalid()
      return store.transaction(async client => {
        const { orderSchema } = await context(client, actor, 'operator')
        const order = orderSchema && await store.get(client, orderSchema, args.orderId, 'order')
        if (!order) throw missing()
        const release = await store.get(client, orderSchema, order.data.revisionId, 'release')
        if (!release || release.data.listingId !== order.data.listingId) throw missing()
        const paymentStatus = order.data.status ?? 'paid'
        return { orderId: args.orderId, title: release.data.title, paymentStatus,
          downloadEligible: paymentStatus === 'paid' && !release.data.coursePin && !release.data.membership, purchaseInquiryId: null,
          ...(release.data.coursePin && { learningEligible: paymentStatus === 'paid' }) }
      })
    }
    if (name !== 'support_request_get' && name !== 'support_reply_draft_save') throw forbidden()
    if (!storeId(args.requestId)) throw invalid()
    const reply = name === 'support_reply_draft_save' ? requiredText(args.body, 3000) : undefined
    const versioned = args.projectId !== undefined || args.orderId !== undefined || args.expectedVersion !== undefined
    if (versioned && args.projectId !== projectId) throw forbidden()
    if (versioned && (!storeId(args.orderId) || !Number.isSafeInteger(args.expectedVersion) || args.expectedVersion < 1)) throw invalid()
    return store.transaction(async client => {
      const { schemaId, orderSchema } = await context(client, actor, 'operator')
      const request = schemaId && await store.get(client, schemaId, args.requestId, 'support_request')
      if (!request || (versioned && request.data.orderId !== args.orderId)) throw missing()
      const order = await requireOrder(client, orderSchema, request.data.orderId)
      const release = await store.get(client, orderSchema, order.data.revisionId, 'release')
      if (!release) throw missing()
      if (reply !== undefined) {
        const { rows: [updated] } = await client.query(`
          UPDATE vdb.records SET data=data||$4::jsonb,version=version+1,updated_at=clock_timestamp()
          WHERE schema_id=$1 AND project_id=$2 AND record_id=$3 AND data->>'kind'='support_request'
            AND ($5::bigint IS NULL OR version=$5) RETURNING version::int`,
        [schemaId, projectId, args.requestId, { reply, replyActorId: actor }, versioned ? args.expectedVersion : null])
        if (updated) return versioned ? { requestId: args.requestId, version: updated.version } : { requestId: args.requestId, draftSaved: true }
        const latest = await store.get(client, schemaId, args.requestId, 'support_request')
        if (latest?.data.reply === reply && latest.data.replyActorId === actor && Number(latest.version) === args.expectedVersion + 1) {
          return { requestId: args.requestId, version: Number(latest.version) }
        }
        throw new StoreError(409, 'support_version_conflict')
      }
      return { requestId: args.requestId, orderId: request.data.orderId, body: request.data.body, reply: request.data.reply ?? null,
        product: { title: release.data.title, revisionId: order.data.revisionId }, eligibleForDownload: true, received: order.data.received === true }
    })
  }

  return { membershipDraft, installBase, registerLead, stopFollowUp, sendFollowUp, openSupport, operatorSnapshot, call }
}
