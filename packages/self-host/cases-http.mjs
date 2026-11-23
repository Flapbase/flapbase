import { randomUUID } from 'node:crypto'
import { canCallAgent, escape, html, input, send } from './store-http.mjs'
import { CASE_TOOLS } from './mcp.mjs'
import { forbidden, invalid, missing, StoreError } from './free-download.mjs'

const field = (name, value) => `<input type="hidden" name="${name}" value="${escape(value)}">`
const key = () => field('idempotencyKey', randomUUID())
const page = (title, content) => html(title, '<h1>' + escape(title) + '</h1>' + content, '/cases-ui.js')
const form = (action, body, button) => `<form data-case-operation="${action}">${body}<button>${button}</button><p role="status"></p></form>`
const link = (href, title) => `<a href="${escape(href)}">${escape(title)}</a>`
const caseLink = id => '/cases/' + id
const customerLink = id => '/service/portal/' + id
const labels = {
  received:'受付', estimating:'見積中', ordered:'受注', in_progress:'作業中', delivered:'納品済み',
  invoiced:'請求済み', completed:'完了', lost:'失注', draft:'下書き', sent:'送付済み',
  accepted:'承認済み', declined:'辞退済み', superseded:'差し替え済み', open:'回答待ち',
  answered:'回答済み', opened:'回答待ち',
}
const status = value => escape(labels[value] ?? value)
const paragraph = content => '<p>' + content + '</p>'
const caseSelect = current => '<select name="status">' + Object.entries(labels).slice(0,8)
  .map(([value, label]) => `<option value="${value}"${value===current?' selected':''}>${label}</option>`).join('') + '</select>'

function management(queue, draft, publication, profile) {
  const heading = draft?.heading ?? profile.definition.title
  const introduction = draft?.introduction ?? profile.definition.purpose
  const inquiries = queue.inquiries.map(item => '<article>' + paragraph(escape(item.name)) + paragraph(escape(item.message ?? '')) +
    form('convert', field('inquiryId', item.id) + key() + '<label>案件名 <input name="title" required></label>', '案件にする') + '</article>').join('')
  const cases = queue.cases.map(item => '<li>' + link(caseLink(item.id), item.title) + ' · ' + status(item.status) + '</li>').join('')
  return page('案件と顧客対応', form('draft', `<label>受付名 <input name="heading" required maxlength="120" value="${escape(heading)}"></label>
<label>紹介文 <textarea name="introduction" maxlength="2000">${escape(introduction)}</textarea></label>`, '下書きを保存') +
    (draft && draft.digest !== publication?.digest ? form('publish', field('digest', draft.digest), '確認した版を公開') : '') +
    (publication ? paragraph(link('/service', '公開した受付を開く')) : '') +
    '<h2>問い合わせ</h2>' + (inquiries || '<p>未対応の問い合わせはありません。</p>') +
    '<h2>案件</h2>' + (cases ? '<ul>' + cases + '</ul>' : '<p>案件はまだありません。</p>'))
}

function intake(publication) {
  return page(publication.heading, paragraph(escape(publication.introduction)) +
    form('intake', key() + '<label>お名前 <input name="name" required maxlength="200"></label>' +
      '<label>メールアドレス <input name="email" type="email" required maxlength="254"></label>' +
      '<label>お問い合わせ <textarea name="message" required maxlength="3000"></textarea></label>', '送信する'))
}

function showCase({ entry, quotes, actions, requests }, { businessKey }, actorId) {
  const fields = field('caseId', entry.id)
  const section = businessKey === 'standard-service'
    ? '<h2>見積</h2>' + quotes.map(quote => paragraph(status(quote.status) + ' · ' + escape(quote.total) + '円') +
      (quote.status === 'draft' ? form('send-quote', fields + field('quoteId', quote.id), '見積を送る') : '')).join('') +
      form('quote', fields + key() + '<label>品名 <input name="title" required maxlength="200"></label><label>金額（税抜） <input name="amount" type="number" min="0" step="1" required></label>', '見積を保存') +
      '<h2>依頼</h2>' + requests.map(item => paragraph(escape(item.title) + ' · ' + status(item.status)) + (item.answer?.values?.reply ? paragraph(escape(item.answer.values.reply)) : '')).join('') +
      form('ask', fields + key() + '<label>顧客に確認すること <input name="title" required></label>', '回答を依頼') +
      '<h2>納品</h2>' + actions.filter(item => item.kind === 'deliverable').map(item => paragraph(escape(item.title) + ' · ' + (item.status === 'received' ? '受領済み' : status(item.status)))).join('') +
      form('deliver', fields + key() + '<label>納品名 <input name="title" required></label><label>納品内容 <textarea name="notice" required></textarea></label>', '納品を登録') +
      paragraph(link(customerLink(entry.id), '顧客用リンク'))
    : ''
  return page(entry.title, paragraph(link('/cases', '案件と顧客対応へ')) +
    form('update', fields + field('expectedVersion', entry.version) + key() +
      '<label>状態 ' + caseSelect(entry.status) + '</label>' +
      `<label>期限 <input name="dueOn" type="date" value="${escape(entry.dueOn ?? '')}"></label>` +
      `<label>次の対応 <input name="nextAction" value="${escape(entry.nextAction ?? '')}"></label>` +
      `<label>担当者 <select name="assigneeId"><option value="">未設定</option><option value="${actorId}"${actorId===entry.assigneeId?' selected':''}>自分</option>${entry.assigneeId && entry.assigneeId!==actorId?'<option value="'+escape(entry.assigneeId)+'" selected>現在の担当者</option>':''}</select></label>`, '変更を保存') +
    '<h2>状態の履歴</h2>' + entry.history.map(item => paragraph(status(item.to))).join('') + section)
}

function portal({ entry, quotes, deliveries, requests }, caseId, publication) {
  const fields = field('caseId', caseId)
  const sections = new Set(publication.appBase.modules.find(item => item.kind === 'customer-portal').sections)
  return page(publication.appBase.presentation.heading,
    paragraph(escape(publication.appBase.presentation.introduction)) +
    (sections.has('cases') ? '<h2>' + escape(entry.title) + '</h2>' + paragraph(status(entry.status)) : '') +
    (sections.has('quotes') ? '<h2>見積</h2>' + quotes.map(item => paragraph(escape(item.total) + '円 · ' + status(item.status)) +
      (item.status === 'sent' ? form('answer-quote', fields + field('quoteId', item.id) +
        '<label>見積への回答 <select name="decision"><option value="accept">承認</option><option value="decline">辞退</option></select></label>', '回答を送る') : '')).join('') : '') +
    (sections.has('requests') ? '<h2>依頼</h2>' + requests.map(item => paragraph(escape(item.title) + ' · ' + status(item.status)) +
      (item.status === 'open' ? form('answer-request', fields + field('requestId', item.id) + '<label>回答 <textarea name="reply" required></textarea></label>', '回答する') : '')).join('') : '') +
    (sections.has('deliverables') ? '<h2>納品</h2>' + deliveries.map(item => paragraph(escape(item.title) + ' · ' + (item.status === 'received' ? '受領済み' : status(item.status))) +
      paragraph(escape(item.note ?? '')) + (item.status === 'received' ? '' : form('receive', fields + field('actionId', item.id), '受取を確認'))).join('') : ''))
}

const customerOperations = new Set(['answer-quote','answer-request','receive'])
const operations = new Set(['draft','publish','convert','update','quote','send-quote','ask','deliver','answer-quote','answer-request','receive'])
const deal = record => ({ id:record.id, status:record.status, version:record.version, dueOn:record.dueOn, updatedAt:record.updatedAt })

export async function handleCases(req, res, { route, origin, profile, delegation, resolveHuman }) {
  const path = route.pathname
  const service = profile.service
  const operation = req.method === 'POST' && /^\/api\/cases\/([a-z-]+)$/.exec(path)?.[1]
  const publication = await (path === '/service' || path === '/api/cases/intake' || path.startsWith('/service/portal/') ||
    customerOperations.has(operation) ? profile.published() : null)
  const get = req.method === 'GET'
  const post = req.method === 'POST'
  if (get && path === '/service') {
    if (!publication) throw missing()
    send(res, 200, intake(publication))
    return true
  }
  if (post && path === '/api/cases/intake') {
    if (!publication) throw missing()
    if (req.headers.origin !== origin) throw forbidden()
    send(res, 201, await service.receive(await input(req, 12_000)))
    return true
  }
  if (post && path === '/api/cases/agent') {
    if (!canCallAgent(req, delegation)) throw new StoreError(401, 'agent_unauthorized')
    const rpc = await input(req, 12_000)
    const args = rpc.arguments
    const spec = CASE_TOOLS.find(item => item.name === rpc.name)
    if (!spec || args?.projectId !== service.projectId) throw forbidden()
    if (Object.keys(args).some(key => !Object.hasOwn(spec.inputSchema.properties, key)) ||
        spec.inputSchema.required.some(key => !Object.hasOwn(args,key))) throw invalid()
    const actor = delegation.principalId
    const handlers = {
      inbox_list: async () => ({ inquiries: await service.inbox(actor,null,args.entrance ?? null) }),
      customer_get: async () => ({ contactId: args.contactId, inquiries: await service.inbox(actor,args.contactId) }),
      deal_create_from_inquiry: () => service.convert(actor, { ...args, title: '問い合わせ対応' }),
      deal_get: async () => ({ deal: deal(await service.read(actor,args.caseId)) }),
      deal_status_update: async () => ({ deal: deal(await service.update(actor,{...args,values:{ status: args.status }})) }),
    }
    if (!Object.hasOwn(handlers, rpc.name)) throw forbidden()
    send(res, 200, await handlers[rpc.name]())
    return true
  }

  const managementPath = get && path === '/cases'
  const manageId = get && /^\/cases\/([0-9a-f-]{36})$/.exec(path)?.[1]
  const portalId = get && /^\/service\/portal\/([0-9a-f-]{36})$/.exec(path)?.[1]
  if (!managementPath && !manageId && !portalId && !operations.has(operation)) return false
  if (operation && req.headers.origin !== origin) throw forbidden()
  if ((portalId || customerOperations.has(operation)) && !publication?.appBase) throw missing()
  const human = await resolveHuman()
  if (!human) {
    if (operation) throw new StoreError(401, 'sign_in_required')
    send(res, 401, page('ログインが必要です', paragraph(link('/?next=' + encodeURIComponent(path), 'ログイン・登録'))))
    return true
  }
  const actor = human.principalId
  if (managementPath) {
    send(res,200,management(await service.queue(actor),await profile.drafts(),await profile.published(),profile))
  } else if (manageId) {
    send(res,200,showCase(await service.operatorCase(actor,manageId),profile,actor))
  } else if (portalId) {
    try {
      send(res,200,portal(await service.customerCase(actor,portalId),portalId,publication))
    } catch (error) {
      if (error.status !== 404) throw error
      send(res,404,page('案件を確認できません',paragraph('最初に申込時のメールアドレスを確認してください。') +
        form('verify-email', `<label>メールアドレス <input name="email" type="email" required></label>`, '確認用リンクを発行')))
    }
  } else {
    const fields = await input(req, 16_384)
    const { caseId } = fields
    const actions = {
      draft: () => profile.save(actor, fields),
      publish: () => profile.publish(actor, fields.digest),
      convert: () => service.convert(actor, fields),
      update: () => service.update(actor, { ...fields, values: {
        status: fields.status, dueOn: fields.dueOn || null, nextAction: fields.nextAction, assigneeId: fields.assigneeId || null,
      } }),
      quote: () => service.saveQuote(actor,caseId,{...fields,lines:[{name:fields.title,quantity:1,unitPrice:fields.amount,taxRate:10}]}),
      'send-quote': () => service.sendQuote(actor,caseId,fields.quoteId),
      ask: () => service.askCustomer(actor,caseId,fields),
      deliver: () => service.deliver(actor,caseId,fields),
      'answer-quote': () => service.answerQuote(actor,caseId,fields.quoteId,fields.decision),
      'answer-request': () => service.answerRequest(actor,caseId,fields.requestId,fields.reply),
      receive: () => service.receiveDelivery(actor,caseId,fields.actionId),
    }
    send(res,200,await actions[operation]())
  }
  return true
}
