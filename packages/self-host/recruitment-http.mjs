import { RECRUITMENT_TOOLS } from './mcp.mjs'
import { canCallAgent, escape, html, input, send } from './store-http.mjs'
import { forbidden, invalid, missing, StoreError, storeId } from './free-download.mjs'

const render = (title, content) => html(title, content, '/recruitment-ui.js')
const login = path => `/?next=${encodeURIComponent(path)}`
const stage = new Map([
  ['submitted', '受付済み'], ['screening', '選考中'], ['selected', '採用'], ['not-selected', '見送り'],
])
const humanChanges = new Set(['save', 'verify', 'approve', 'apply', 'advance', 'finalize'])
const knownErrors = new Map([
  ['RECRUITMENT_RELEASE_STALE', new StoreError(409, 'recruitment_version_conflict')],
  ['RECRUITMENT_RELEASE_APPROVAL_REQUIRED', new StoreError(409, 'recruitment_approval_required')],
  ['RECRUITMENT_REQUEST_CONFLICT', new StoreError(409, 'recruitment_request_conflict')],
  ['RECRUITMENT_RELEASE_VERIFICATION_FAILED', new StoreError(422, 'recruitment_invalid_draft')],
])

const form = (operation, fields, label) => `<form data-recruitment-operation="${operation}">${fields}
<button>${label}</button><p role="status"></p></form>`
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${escape(value)}">`

function managePage(current) {
  if (!current) return render('採用・応募管理', `<h1>採用・応募管理</h1>${form('install', '', '採用を始める')}`)
  const { draft, release, applications, installId, canApprove } = current
  const candidate = release ? hidden('candidateId', release.candidateId) + hidden('digest', release.digest) : ''
  const releasable = release?.draftVersion === draft.version
  const apply = canApprove && release?.state === 'approved' && releasable
  const retry = canApprove && release?.state === 'applied' && release.draftVersion + 1 === draft.publishedVersion
  const publish = apply || retry ? form('apply', candidate, retry ? '公開を再試行' : '承認済みの版を公開') : ''
  const approval = canApprove && release?.state === 'verified' && releasable ? form('approve', candidate, '確認した版を承認') : ''
  return render('採用・応募管理', `<h1>採用・応募管理</h1>
${draft.publishedVersion ? `<p><a href="/recruitment/jobs/${installId}">公開中の求人を開く</a></p>` : ''}
<h2>求人原稿</h2>
${form('save', hidden('version', draft.version) +
  `<label>求人名 <input name="title" required maxlength="120" value="${escape(draft.title)}"></label>
<label>求人内容 <textarea name="description" required maxlength="3000">${escape(draft.description)}</textarea></label>`, '下書きを保存')}
${form('verify', hidden('version', draft.version), '保存した原稿を検証')}
${approval}${publish}
<h2>応募一覧</h2>
${applications.length ? applications.map(item => `<article><h3>${escape(item.jobTitle)}</h3>
<p>${stage.get(item.status)}</p><p class="description">${escape(item.note)}</p>
${item.status === 'submitted' ? form('advance', hidden('id', item.id) + hidden('version', item.version), '選考に進める') : ''}
${item.status === 'screening' ? form('finalize', hidden('id', item.id) + hidden('version', item.version) +
  '<label>選考結果 <select name="outcome"><option value="selected">採用</option><option value="not-selected">見送り</option></select></label>',
  '結果を確定') : ''}</article>`).join('') : '<p>応募はまだありません。</p>'}`)
}

function jobPage(id, job) {
  const path = '/recruitment/jobs/' + id
  return render(job.title, `<h1>${escape(job.title)}</h1><p class="description">${escape(job.description)}</p>
<h2>応募する</h2><p><a href="${login(path)}">ログイン・登録</a></p>
${form('submit', hidden('installId', id) + hidden('publishedVersion', job.version) +
  '<label>応募内容 <textarea name="note" required maxlength="2000"></textarea></label>', '応募を送る')}
<p><a href="${path}/applications">自分の応募状況を確認</a></p>`)
}

export async function handleRecruitment(req, res, { route, origin, recruitment, delegation, resolveHuman }) {
  const { pathname } = route
  const job = /^\/recruitment\/jobs\/([0-9a-f-]{36})(\/applications)?$/.exec(pathname)
  const action = /^\/api\/recruitment\/(install|save|verify|approve|apply|advance|finalize|submit)$/.exec(pathname)?.[1]
  try {
    if (req.method === 'GET' && job && !job[2]) {
      const snapshot = await recruitment.snapshot(job[1])
      if (!snapshot) throw missing()
      send(res, 200, jobPage(job[1], snapshot))
      return true
    }
    if (req.method === 'POST' && pathname === '/api/recruitment/agent') {
      if (!canCallAgent(req, delegation)) throw new StoreError(401, 'agent_unauthorized')
      const body = await input(req, 4096)
      if (!body.arguments || !storeId(body.arguments.projectId) || Object.keys(body.arguments).length !== 1) throw invalid()
      if (body.arguments.projectId !== recruitment.projectId) throw forbidden()
      const handlers = {
        app_add_recruitment: () => recruitment.install(delegation.principalId),
        recruitment_applications_list: () => recruitment.listForAgent(delegation.principalId, body.arguments),
      }
      if (!RECRUITMENT_TOOLS.some(tool => tool.name === body.name) || !Object.hasOwn(handlers, body.name)) throw forbidden()
      send(res, 200, await handlers[body.name]())
      return true
    }
    const management = req.method === 'GET' && pathname === '/recruitment'
    const history = req.method === 'GET' && job?.[2]
    const mutation = req.method === 'POST' && action
    if (!management && !history && !mutation) return false
    if (mutation && req.headers.origin !== origin) throw forbidden()
    const human = await resolveHuman()
    if (!human) {
      if (mutation) throw new StoreError(401, 'sign_in_required')
      const next = history ? '/recruitment/jobs/' + job[1] : pathname
      send(res, 401, render('ログイン', `<h1>ログインが必要です</h1><p><a href="${login(next)}">ログイン・登録</a></p>`))
      return true
    }
    const actor = human.principalId
    if (management) {
      send(res, 200, managePage(await recruitment.manage(actor)))
    } else if (history) {
      const applications = await recruitment.ownApplications(actor, job[1])
      send(res, 200, render('自分の応募状況', `<h1>自分の応募状況</h1><p><a href="/recruitment/jobs/${job[1]}">求人に戻る</a></p>
${applications.length ? `<ul>${applications.map(item => `<li>${escape(item.jobTitle)}　${stage.get(item.status)}</li>`).join('')}</ul>` : '<p>応募はまだありません。</p>'}`))
    } else {
      const fields = await input(req, 24_000)
      const operations = {
        install: () => recruitment.install(actor),
        submit: () => recruitment.submit(actor, fields.installId, fields),
      }
      const result = humanChanges.has(action) ? await recruitment.change(actor, action, fields) : await operations[action]()
      send(res, 200, result)
    }
    return true
  } catch (error) {
    throw knownErrors.get(error.message) ?? error
  }
}
