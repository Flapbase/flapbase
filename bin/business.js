import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'

const path = new URL('../packages/business-workflows/.base/business-workflows.json', import.meta.url)
const endpoint = 'https://mcp.flapbase.com/mcp'
const localWorkflows = {
  'free-resource': 'flapbase:resource-distribution',
  'digital-product-sales': 'flapbase:resource-distribution',
  'customer-support': 'flapbase:customer-support',
}
const localLaunch = {
  'paid-membership': { path: '/membership', configuration: 'FLAP_STORE_PROJECT_ID', tools: ['product_draft_save', 'membership_roster_list'] },
  'member-ai-course': { path: '/training', configuration: 'FLAP_COURSE_PROJECT_ID' },
  'organization-training': { path: '/training', configuration: 'FLAP_COURSE_PROJECT_ID' },
  'standard-service': { path: '/cases', configuration: 'FLAP_CASES_PROJECT_ID', businessKey: 'standard-service' },
  'customer-sales': { path: '/cases', configuration: 'FLAP_CASES_PROJECT_ID', businessKey: 'customer-sales' },
  recruitment: { path: '/recruitment', configuration: 'FLAP_RECRUITMENT_PROJECT_ID' },
  'booking-service': { path: '/booking', configuration: 'FLAP_BOOKING_PROJECT_ID' },
  'event-registration': { path: '/booking', configuration: 'FLAP_BOOKING_PROJECT_ID' },
}
const uuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
const own = (source, key) => object(source) && Object.hasOwn(source, key) ? source[key] : undefined

export async function loadBusinessCatalog() {
  const bytes = await readFile(path)
  return { definition: JSON.parse(bytes), definitionDigest: 'sha256:' + createHash('sha256').update(bytes).digest('hex') }
}

export function inspectBusiness(catalog, businessKey) {
  const { definition, definitionDigest } = catalog
  const business = own(definition.businesses, businessKey)
  if (!business) throw new Error('登録された事業キーを指定してください。')
  const keys = new Set(business.workflows.flatMap(key => own(definition.executionsByWorkflow, key) ?? []))
  const shared = Object.fromEntries([...keys].map(key => [key, definition.sharedExecutions[key]]))
  return {
    businessKey, ...business, version: definition.version, definitionDigest,
    localWorkflow: own(localWorkflows, businessKey) ?? null,
    ...(own(localLaunch, businessKey) && { localLaunch: localLaunch[businessKey] }),
    workflows: Object.fromEntries(business.workflows.map(key => [key, definition.workflows[key]])),
    procedures: Object.fromEntries([...new Set(business.workflows.flatMap(key => definition.workflows[key].flatMap(step => step.procedures)))]
      .map(key => [key, definition.procedures[key]])),
    settings: own(definition.settings, businessKey) ?? {},
    executions: { ...shared, ...own(definition.executions, businessKey) },
  }
}

export function businessStepInput(catalog, businessKey, executionKey, values) {
  const business = inspectBusiness(catalog, businessKey)
  const execution = own(business.executions, executionKey)
  if (!execution) throw new Error('その事業に登録された実行キーを指定してください。')
  if (!object(values) || Object.keys(values).some(key => !['projectId', 'stepKey', 'parameters', 'results'].includes(key)) ||
      !object(values.parameters) || (values.results !== undefined && !object(values.results))) {
    throw new Error('入力には projectId、stepKey、parameters、results を指定できます。parameters は必須です。')
  }
  const step = values.stepKey === undefined ? execution.steps[0] : execution.steps.find(step => step.key === values.stepKey)
  if (!step) throw new Error('実行定義にある工程キーを指定してください。')
  if (values.projectId !== undefined && (typeof values.projectId !== 'string' ||
      !uuid.test(values.projectId))) {
    throw new Error('Project IDはUUIDを指定してください。')
  }
  const parameters = new Set(execution.steps.flatMap(item => Object.values(item.inputs).flatMap(binding =>
    Object.hasOwn(binding, 'parameter') ? [binding.parameter] : [])))
  const earlier = new Set(execution.steps.slice(0, execution.steps.indexOf(step)).map(item => item.key))
  if (Object.keys(values.parameters).some(key => !parameters.has(key)) || Object.keys(values.results ?? {}).some(key => !earlier.has(key))) {
    throw new Error('定義にあるパラメーターと先行工程の結果だけを指定してください。')
  }
  return { ...values, businessKey, executionKey, stepKey: step.key, version: business.version, definitionDigest: business.definitionDigest }
}

export function createCloudToolCaller(token, send = fetch) {
  if (typeof token !== 'string' || !/^[!-~]+$/.test(token)) throw new Error('認可済みのFlapbase Cloudトークンを指定してください。')
  let id = 0
  return async (name, args) => {
    const requestId = ++id
    const response = await send(endpoint, {
      method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30_000),
      headers: { Authorization: 'Bearer ' + token, Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: requestId, method: 'tools/call', params: { name, arguments: args } }),
    })
    if (response.status === 401 || response.status === 403) throw new Error('Flapbase Cloudの認可とProjectへの権限を確認してください。')
    if (!response.ok) throw new Error('Flapbase CloudがHTTP ' + response.status + ' を返しました。')
    const text = await response.text()
    const replies = response.headers.get('content-type')?.includes('text/event-stream')
      ? text.split(/\r?\n\r?\n/).map(event => event.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n')).filter(Boolean)
      : [text]
    let reply
    try {
      reply = replies.map(body => JSON.parse(body)).find(message => message?.id === requestId)
    } catch {
      throw new Error('Flapbase Cloudの応答を読み取れませんでした。')
    }
    if (!reply || reply.error || !object(reply.result)) throw new Error('Flapbase Cloudから操作の結果を取得できませんでした。')
    if (reply.result.isError) {
      const code = reply.result.structuredContent?.error?.code
      throw new Error('Flapbase Cloudが操作を拒否しました' + (typeof code === 'string' && /^[a-z0-9_]+$/.test(code) ? '（' + code + '）' : '。'))
    }
    if (!object(reply.result.structuredContent)) throw new Error('Flapbase Cloudの応答形式を確認してください。')
    return reply.result.structuredContent
  }
}

export async function checkBusinessCloud(catalog, call) {
  const template = await call('app_template_get', { templateId: 'business-app' })
  const remote = template.workflowCatalog
  if (!remote || remote.version !== catalog.definition.version || remote.source?.digest !== catalog.definitionDigest) {
    throw new Error('Flapbase Cloudと手元の事業定義が一致しません。公開版を確認してください。')
  }
  for (const key of Object.keys(catalog.definition.businesses)) {
    const business = inspectBusiness(catalog, key)
    const executions = own(remote.executions, key)
    if (!own(remote.businesses, key) || !object(executions) || Object.keys(business.executions).some(key => !Object.hasOwn(executions, key))) {
      throw new Error('Flapbase Cloudに同じ事業の実行定義がありません。')
    }
  }
  return { version: remote.version, definitionDigest: remote.source.digest, businesses: Object.keys(catalog.definition.businesses) }
}

export async function runBusinessStep(catalog, call, businessKey, executionKey, values) {
  const input = businessStepInput(catalog, businessKey, executionKey, values)
  const outcome = await call('business_workflow_step_run', input)
  if (outcome.businessKey !== input.businessKey || outcome.executionKey !== input.executionKey ||
      outcome.stepKey !== input.stepKey || outcome.version !== input.version || outcome.definitionDigest !== input.definitionDigest ||
      !object(outcome.result) || typeof outcome.projectId !== 'string' || !uuid.test(outcome.projectId) ||
      (input.projectId && outcome.projectId.toLowerCase() !== input.projectId.toLowerCase())) {
    throw new Error('Flapbase Cloudから実行対象と一致する結果を取得できませんでした。')
  }
  return outcome
}

export async function businessCommand(args, { token, send, read = readFile } = {}) {
  const [action, businessKey, executionKey, inputPath] = args
  const catalog = await loadBusinessCatalog()
  if (action === 'list' && args.length === 1) {
    return Object.keys(catalog.definition.businesses).map(key => {
      const { businessKey, title, status, templateId, localWorkflow, localLaunch, executions } = inspectBusiness(catalog, key)
      return { businessKey, title, status, templateId, localWorkflow, ...(localLaunch && { localLaunch }), executions: Object.keys(executions) }
    })
  }
  if (action === 'inspect' && args.length === 2) return inspectBusiness(catalog, businessKey)
  if (action === 'local-base' && args.length === 2) {
    const business = inspectBusiness(catalog, businessKey)
    if (business.businessKey === 'recruitment') throw new Error('採用の導入は /recruitment または app_add_recruitment から行います。')
    if (business.localLaunch) throw new Error('この事業は ' + business.localLaunch.path + ' から公開します。')
    if (!business.localWorkflow) throw new Error('この事業のセルフホスト実行は未対応です。')
    return {
      version: 1, package: 'member-resources', packageVersion: 1,
      presentation: { heading: business.title, introduction: business.purpose, layout: 'standard' },
      settings: { workflow: business.localWorkflow, support: 'buyer-order' },
    }
  }
  if (action === 'check-cloud' && args.length === 1) return checkBusinessCloud(catalog, createCloudToolCaller(token, send))
  if (['prepare', 'run'].includes(action) && args.length === 4) {
    const raw = await read(inputPath, 'utf8')
    let input
    try { input = JSON.parse(raw) } catch { throw new Error('入力ファイルをJSONとして読み取れませんでした。') }
    if (action === 'prepare') return { name: 'business_workflow_step_run', arguments: businessStepInput(catalog, businessKey, executionKey, input) }
    return runBusinessStep(catalog, createCloudToolCaller(token, send), businessKey, executionKey, input)
  }
  throw new Error('使い方は flap business list、inspect|local-base <事業キー>、prepare|run <事業キー> <実行キー> <入力JSON>、check-cloud です。')
}
