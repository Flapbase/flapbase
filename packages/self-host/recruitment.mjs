import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { createRecruitmentPersistence } from '../apps-recruitment/src/persistence.js'
import { recruitmentAppKey, recruitmentRevision } from '../apps-recruitment/src/shared.js'
import { forbidden, invalid, missing, storeId, StoreError } from './free-download.mjs'

// This pin is shared with Cloud's fixed recruitment package.
export const recruitmentPresetDigest = 'sha256:735d9d12af976e210b4f02cebe97e273a7d860e943f1e43f79199781d1a756af'
function canonicalJson(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson).join(',') + ']'
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonicalJson(value[key])).join(',') + '}'
  }
  return JSON.stringify(value)
}
const digest = value => 'sha256:' + createHash('sha256').update(canonicalJson(value)).digest('hex')
const persistence = createRecruitmentPersistence({ sha256: digest, presetDigest: recruitmentPresetDigest })

// The persistence layer uses tagged PostgreSQL queries. A fragment is created only by this transaction.
function sqlFor(client) {
  const fragments = new WeakMap()
  const sql = (strings, ...bindings) => {
    const render = values => strings.reduce((statement, part, index) => {
      if (!index) return part
      const binding = bindings[index - 1]
      const fragment = fragments.get(binding)
      return statement + (fragment ? fragment(values) : '$' + values.push(binding)) + part
    }, '')
    const query = {
      then(resolve, reject) {
        const values = []
        return client.query(render(values), values).then(result => result.rows).then(resolve, reject)
      },
    }
    fragments.set(query, render)
    return query
  }
  sql.json = JSON.stringify
  return sql
}

const conflict = () => new StoreError(409, 'recruitment_version_conflict')
const version = value => Number.isInteger(value) && value >= 1 && value < 2_147_483_647
function clean(value, max) {
  if (typeof value !== 'string' || value.length > max || value.includes('\0')) throw invalid()
  return value.trim()
}
function pin({ candidateId, digest }) {
  if (!storeId(candidateId) || typeof digest !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(digest)) throw invalid()
  return { candidateId, digest }
}

export async function createRecruitment({ pool, projectId, directory }) {
  if (!storeId(projectId) || !directory) throw new TypeError('Recruitment requires a Project and a data directory')
  const publications = join(directory, projectId, 'recruitment')
  await mkdir(publications, { recursive: true, mode: 0o700 })
  let pending = Promise.resolve()

  async function transaction(run) {
    const client = await pool.connect()
    try {
      await client.query('BEGIN')
      const result = await run(sqlFor(client))
      await client.query('COMMIT')
      return result
    } catch (error) {
      await client.query('ROLLBACK')
      throw error
    } finally {
      client.release()
    }
  }

  async function project(tx, actorId, operator) {
    const [scope] = await tx`
      SELECT p.workspace_id AS "workspaceId", p.project_id AS "projectId",
        (p.created_by_principal_id = h.principal_id OR coalesce(m.member_role = 'owner', false)) AS "canApprove"
      FROM platform.projects p JOIN platform.workspaces w USING (workspace_id)
      JOIN identity.principals h ON h.principal_id = ${actorId}::uuid AND h.status = 'active' AND h.principal_kind = 'human'
      LEFT JOIN platform.project_memberships m ON m.project_id = p.project_id AND m.principal_id = h.principal_id
        AND m.status = 'active' AND m.revoked_at IS NULL
      WHERE p.project_id = ${projectId}::uuid AND p.status = 'active' AND w.status = 'active'
        AND (NOT ${operator} OR p.created_by_principal_id = h.principal_id OR m.member_role IN ('owner','editor'))
    `
    if (!scope) throw missing()
    return scope
  }

  async function bound(tx, actorId, operator, installId, allowUninstalled = false) {
    const scope = await project(tx, actorId, operator)
    const [row] = await tx`
      SELECT i.app_install_id AS "installId"
      FROM platform.app_installs i JOIN platform.app_revision_locks l
        ON l.app_install_id = i.app_install_id AND l.app_key = i.app_key AND l.app_revision = i.app_revision
      WHERE i.project_id = ${projectId}::uuid AND i.app_key = ${recruitmentAppKey}
        AND i.app_revision = ${recruitmentRevision} AND l.resolved_digest = ${recruitmentPresetDigest.slice(7)}
        AND i.status = 'active' AND (${installId}::uuid IS NULL OR i.app_install_id = ${installId}::uuid)
    `
    if (!row && !allowUninstalled) throw missing()
    return { ...scope, ...row }
  }

  async function install(actorId) {
    return transaction(async tx => {
      const scope = await project(tx, actorId, true)
      await tx`SELECT pg_advisory_xact_lock(hashtextextended(${recruitmentAppKey}, hashtextextended(${projectId}, 0)))`
      const [newInstall] = await tx`
        INSERT INTO platform.app_installs (project_id, app_key, app_revision, install_config, installed_by_principal_id)
        VALUES (${projectId}, ${recruitmentAppKey}, ${recruitmentRevision},
          ${tx.json({ package_id: recruitmentAppKey, package_version: recruitmentRevision, package_digest: recruitmentPresetDigest })}::jsonb, ${actorId})
        ON CONFLICT (project_id, app_key) DO NOTHING RETURNING app_install_id AS "installId"
      `
      if (newInstall) {
        await tx`
          INSERT INTO platform.app_revision_locks (app_install_id, app_key, app_revision, resolved_digest)
          VALUES (${newInstall.installId}, ${recruitmentAppKey}, ${recruitmentRevision}, ${recruitmentPresetDigest.slice(7)})
        `
        await persistence.initializeRecruitment(tx, { ...scope, ...newInstall })
      }
      const binding = await bound(tx, actorId, true, null)
      return { projectId, installId: binding.installId, revision: recruitmentRevision, digest: recruitmentPresetDigest }
    })
  }

  async function snapshot(installId) {
    if (!storeId(installId)) throw invalid()
    try {
      return JSON.parse(await readFile(join(publications, installId + '.json'), 'utf8'))
    } catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  function publish(installId, job) {
    const write = pending.then(async () => {
      if ((await snapshot(installId))?.version >= job.version) return
      const target = join(publications, installId + '.json')
      const staging = target + '.' + randomUUID() + '.tmp'
      try {
        await writeFile(staging, JSON.stringify(job), { mode: 0o600, flag: 'wx' })
        await rename(staging, target)
      } finally {
        await rm(staging, { force: true })
      }
    })
    pending = write.catch(() => {})
    return write
  }

  async function manage(actorId) {
    return transaction(async tx => {
      const binding = await bound(tx, actorId, true, null, true)
      if (!binding.installId) return null
      return { installId: binding.installId, canApprove: binding.canApprove,
        draft: await persistence.readRecruitmentDraft(tx, binding),
        release: await persistence.readRecruitmentRelease(tx, binding),
        applications: await persistence.listRecruitmentApplications(tx, binding),
      }
    })
  }

  async function recordSelection(tx, binding, actor, operation, input, execute) {
    const { id, version, outcome } = input
    const key = digest(['recruitment', binding.installId, actor, operation, id, version, outcome ?? null])
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`
    const [prior] = await tx`
      SELECT response FROM runtime.idempotency_keys
      WHERE workspace_id = ${binding.workspaceId}::uuid AND idempotency_key = ${key}
    `
    if (prior) return prior.response
    const application = await execute(tx, binding, input)
    if (!application) return null
    const resultDigest = digest(application)
    await tx`
      INSERT INTO runtime.idempotency_keys (workspace_id, idempotency_key, request_digest, response_digest, response)
      VALUES (${binding.workspaceId}::uuid, ${key}, ${key}, ${resultDigest}, ${tx.json(application)}::jsonb)
    `
    await tx`
      INSERT INTO vdb.mutation_receipts (workspace_id, actor_ref, operation, target_ref, request_digest, result_digest)
      VALUES (${binding.workspaceId}::uuid, ${actor}, ${operation}, ${id}, ${key}, ${resultDigest})
    `
    return application
  }

  const changes = {
    save: async (tx, binding, _actor, input) => {
      if (!version(input.version)) throw invalid()
      const draft = await persistence.saveRecruitmentDraft(tx, binding, {
        version: input.version, title: clean(input.title, 120), description: clean(input.description, 3000),
      })
      if (!draft) throw conflict()
      return draft
    },
    verify: (tx, binding, actor, input) => {
      if (!version(input.version)) throw invalid()
      return persistence.verifyRecruitmentRelease(tx, binding, actor, input.version)
    },
    approve: (tx, binding, actor, input) => {
      if (!binding.canApprove) throw forbidden()
      return persistence.approveRecruitmentRelease(tx, binding, actor, pin(input))
    },
    apply: (tx, binding, actor, input) => {
      if (!binding.canApprove) throw forbidden()
      return persistence.applyRecruitmentRelease(tx, binding, actor, pin(input))
    },
    advance: (tx, binding, actor, input) =>
      recordSelection(tx, binding, actor, 'recruitment.application.advance', input, persistence.advanceRecruitmentApplication),
    finalize: (tx, binding, actor, input) =>
      recordSelection(tx, binding, actor, 'recruitment.application.finalize', input, persistence.finalizeRecruitmentApplication),
  }

  async function change(actorId, operation, input) {
    if (!Object.hasOwn(changes, operation)) throw missing()
    if (operation === 'advance' || operation === 'finalize') {
      if (!storeId(input.id) || !version(input.version)) throw invalid()
      if (operation === 'finalize' && !['selected', 'not-selected'].includes(input.outcome)) throw invalid()
    }
    const { result, installId } = await transaction(async tx => {
      const binding = await bound(tx, actorId, true, null)
      return { installId: binding.installId, result: await changes[operation](tx, binding, actorId, input) }
    })
    if (!result) throw conflict()
    if (operation === 'apply') {
      await publish(installId, result.job)
      return result.draft
    }
    return result
  }

  async function submit(actorId, installId, input) {
    if (!storeId(input.requestId) || !version(input.publishedVersion)) throw invalid()
    const job = await snapshot(installId)
    const note = clean(input.note, 2000)
    return transaction(async tx => {
      const binding = await bound(tx, actorId, false, installId)
      const application = await persistence.submitRecruitmentApplication(tx, binding, actorId, { ...input, note }, job)
      if (!application) throw conflict()
      return application
    })
  }

  async function ownApplications(actorId, installId) {
    return transaction(async tx => persistence.listOwnApplications(tx, await bound(tx, actorId, false, installId), actorId))
  }

  async function listForAgent(actorId, input) {
    if (input.projectId !== projectId) throw forbidden()
    const applications = await transaction(async tx =>
      persistence.listRecruitmentApplications(tx, await bound(tx, actorId, true, null), false))
    return { projectId, applications }
  }

  return { projectId, install, manage, change, snapshot, submit, ownApplications, listForAgent }
}
