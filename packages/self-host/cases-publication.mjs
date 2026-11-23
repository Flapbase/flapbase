import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { inspectBusiness, loadBusinessCatalog } from '../../bin/business.js'
import { invalid, missing, sha, StoreError } from './free-download.mjs'

export async function createCasesPublication({ service, directory, businessKey }) {
  if (!directory || !['standard-service', 'customer-sales'].includes(businessKey)) throw invalid()
  const catalog = await loadBusinessCatalog()
  const definition = inspectBusiness(catalog, businessKey)
  const location = join(directory, service.projectId, 'case-publication', businessKey)
  async function get(name) {
    try { return JSON.parse(await readFile(join(location, name + '.json'), 'utf8')) }
    catch (error) {
      if (error.code === 'ENOENT') return null
      throw error
    }
  }

  let pending = Promise.resolve()
  function exclusive(run) {
    const result = pending.then(run)
    pending = result.catch(() => {})
    return result
  }

  async function put(name, snapshot) {
    await mkdir(location, { recursive: true, mode: 0o700 })
    const path = join(location, name + '.json')
    const candidate = path + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(candidate, JSON.stringify(snapshot), { mode: 0o600, flag: 'wx' })
      await rename(candidate, path)
    } finally {
      await rm(candidate, { force: true })
    }
  }

  async function save(actor, { heading, introduction }) {
    await service.authorizePublication(actor)
    if (typeof heading !== 'string' || !heading.trim() || heading.length > 120 ||
        typeof introduction !== 'string' || introduction.length > 2000) throw invalid()
    const page = {
      businessKey, version: definition.version, definitionDigest: definition.definitionDigest,
      heading: heading.trim(), introduction: introduction.trim(),
      ...(definition.settings.appBase && { appBase: definition.settings.appBase }),
    }
    const draft = { ...page, digest: sha(JSON.stringify(page)) }
    await exclusive(() => put('draft', draft))
    return draft
  }

  async function publish(actor, digest) {
    await service.authorizePublication(actor)
    return exclusive(async () => {
      const draft = await get('draft')
      if (!draft) throw missing()
      if (draft.digest !== digest) throw new StoreError(409, 'case_publication_stale')
      await put('public', draft)
      return draft
    })
  }

  return { service, businessKey, definition, drafts: () => get('draft'), published: () => get('public'), save, publish }
}
