import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { createSelfHostedAuthPool } from './auth.mjs'
import { storeId } from './free-download.mjs'

const schemaFiles = [
  'schema/000_schema-identity.sql', 'schema/010_principals-identity.sql', 'schema/020_external_identities-identity.sql',
  'schema/000_schema-platform.sql', 'schema/020_workspaces-platform.sql',
  'schema/021_workspace_members-platform.sql', 'schema/050_projects-platform.sql',
  'schema/060_project_memberships-platform.sql', 'schema/080_app_installs-platform.sql', 'schema/090_app_revision_locks-platform.sql',
  'schema/069_workflows-platform.sql',
  'schema/025_workspace_reviewer_invitations-platform.sql',
  'schema/000_schema-artifact.sql', 'schema/010_artifacts-artifact.sql', 'schema/020_revisions-artifact.sql',
  'schema/000_schema-vdb.sql', 'schema/010_schemas-vdb.sql', 'schema/020_records-vdb.sql', 'schema/040_mutation_receipts-vdb.sql',
  'schema/000_schema-runtime.sql', 'schema/010_runs-runtime.sql', 'schema/050_idempotency-runtime.sql', 'auth-schema.sql',
]

export async function transaction(pool, run) {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    const result = await run(client)
    await client.query('COMMIT')
    return result
  } catch (error) {
    await client.query('ROLLBACK')
    throw error
  } finally { client.release() }
}

export const setupSchema = pool => transaction(pool, async client => {
  for (const file of schemaFiles) await client.query(await readFile(new URL(file, import.meta.url), 'utf8'))
})

export const setupBookingSchema = pool => transaction(pool, async client => {
  await client.query(await readFile(new URL('schema/091_bookings-platform.sql', import.meta.url), 'utf8'))
})

export const setupCaseSchema = pool => transaction(pool, async client => {
  await client.query(await readFile(new URL('schema/087_cases-platform.sql', import.meta.url), 'utf8'))
})

export const setupProject = (pool, { ownerId, projectId, name = '無料資料' }) => transaction(pool, async client => {
  if (!storeId(ownerId) || !storeId(projectId) || !name.trim()) throw new Error('Valid owner and Project IDs are required')
  const owner = await client.query("SELECT 1 FROM identity.principals WHERE principal_id=$1 AND principal_kind='human' AND status='active'", [ownerId])
  if (!owner.rowCount) throw new Error('Sign in once and use the principal ID from /auth/context')
  const existing = await client.query('SELECT created_by_principal_id FROM platform.projects WHERE project_id=$1', [projectId])
  if (existing.rowCount) {
    if (existing.rows[0].created_by_principal_id !== ownerId) throw new Error('Project already exists')
    await client.query("INSERT INTO platform.project_memberships(project_id,principal_id,member_role) VALUES($1,$2,'owner') ON CONFLICT DO NOTHING", [projectId, ownerId])
    return projectId
  }
  const workspace = randomUUID()
  await client.query('INSERT INTO platform.workspaces(workspace_id,workspace_key,name,created_by_principal_id,product_key) VALUES($1,$2,$3,$4,$5)',
    [workspace, 'store-' + workspace, name, ownerId, 'flapbase'])
  await client.query("INSERT INTO platform.workspace_members(workspace_id,principal_id,member_role) VALUES($1,$2,'owner')", [workspace, ownerId])
  await client.query('INSERT INTO platform.projects(project_id,workspace_id,name,slug,created_by_principal_id) VALUES($1,$2,$3,$4,$5)',
    [projectId, workspace, name, 'downloads', ownerId])
  await client.query("INSERT INTO platform.project_memberships(project_id,principal_id,member_role) VALUES($1,$2,'owner')", [projectId, ownerId])
  return projectId
})

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const pool = createSelfHostedAuthPool(process.env.FLAP_AUTH_DATABASE_URL)
  try {
    if (process.argv[2] === 'project') {
      const id = await setupProject(pool, {ownerId:process.env.FLAP_STORE_OWNER_ID,projectId:process.env.FLAP_STORE_PROJECT_ID ?? process.env.FLAP_RECRUITMENT_PROJECT_ID ?? process.env.FLAP_BOOKING_PROJECT_ID ?? process.env.FLAP_CASES_PROJECT_ID ?? process.env.FLAP_COURSE_PROJECT_ID,
        name:process.env.FLAP_PROJECT_NAME})
      console.log('Project: ' + id)
    } else {
      if (process.argv[2] === 'booking') await setupBookingSchema(pool)
      else if (process.argv[2] === 'cases') await setupCaseSchema(pool)
      else await setupSchema(pool)
      console.log('PostgreSQL schema is ready.')
    }
  } finally { await pool.end() }
}
