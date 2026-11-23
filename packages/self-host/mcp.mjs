import { pathToFileURL } from 'node:url'
import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const text = maxLength => ({ type: 'string', minLength: 1, maxLength })
const requestId = { type: 'string', format: 'uuid' }

function tool(name, description, readOnlyHint, properties = {}, required = Object.keys(properties)) {
  return {
    name,
    description,
    inputSchema: { type: 'object', properties, required, additionalProperties: false },
    annotations: { readOnlyHint, destructiveHint: false, openWorldHint: false },
  }
}

export const DIGITAL_PRODUCT_TOOLS = [
  tool('product_draft_save', '公開前の商品と告知ページのタイトル・紹介文を保存します。公開は運営画面で確認できます。', false, {
    title: text(160), description: text(3000),
  }),
  tool('follow_up_draft_save', '見込客へのEmail案内を下書きします。対象の同意と送信は運営画面で確認します。', false, {
    subject: text(160), body: text(3000),
  }),
  tool('operations_summary', 'この事業の見込客・案内・注文・受取・未対応問い合わせの件数を確認します。', true),
  tool('order_support_get', '指定した注文の商品名・支払状態・受取可否を確認します。連絡先や受取リンクは返しません。', true, {
    projectId: requestId, orderId: requestId,
  }),
  tool('support_requests_list', '購入者から届いた問い合わせを確認します。注文を指定する場合は、Project IDと注文IDを一緒に渡します。', true, {
    projectId: requestId, orderId: requestId,
  }, []),
  tool('support_request_get', '問い合わせの内容と、関連する注文・受取状況を確認します。', true, { requestId }),
  tool('support_reply_draft_save', '注文に関連する問い合わせに返信の下書きを保存します。送信は運営画面で確認できます。', false, {
    requestId, body: text(3000), projectId: requestId, orderId: requestId, expectedVersion: { type: 'integer', minimum: 1 },
  }, ['requestId', 'body']),
]

export const RECRUITMENT_TOOLS = [
  tool('app_add_recruitment', 'このProjectに固定版の採用機能を導入します。求人公開は運営画面で行います。', false, { projectId: requestId }),
  tool('recruitment_applications_list', '対象Projectの応募の状態と版を確認します。応募本文は返しません。', true, { projectId: requestId }),
]

const bookingLimit = { type: 'integer', minimum: 1, maximum: 100 }
export const BOOKING_TOOLS = [
  tool('booking_offers_list', '対象Projectの公開中の予約メニューと定員を取得します。', true, { projectId: requestId, limit: bookingLimit }, ['projectId']),
  tool('booking_records_list', '対象Projectの予約状況を取得します。', true, { projectId: requestId, bookingId: requestId, limit: bookingLimit }, ['projectId']),
  tool('booking_outcome_record', '確認済みの出欠結果を記録します。', false, {
    projectId: requestId, bookingId: requestId, idempotencyKey: requestId,
    outcome: { type: 'string', enum: ['attended', 'no_show', 'host_issue'] },
  }),
]

export const CASE_TOOLS = [
  tool('inbox_list', '対象Projectの問い合わせIDと進捗を返します。本文や連絡先は返しません。', true, { projectId: requestId, entrance: text(80) }, ['projectId']),
  tool('customer_get', '対象Projectの顧客の問い合わせと案件の履歴を返します。', true, { projectId: requestId, contactId: requestId }),
  tool('deal_create_from_inquiry', '対象Projectの問い合わせを案件にします。', false, { projectId: requestId, inquiryId: requestId, idempotencyKey: requestId }),
  tool('deal_get', '案件の状態と版を照会します。', true, { projectId: requestId, caseId: requestId }),
  tool('deal_status_update', '現在の版を指定して案件の状態を更新します。', false, {
    projectId: requestId, caseId: requestId, idempotencyKey: requestId,
    expectedVersion: { type: 'integer', minimum: 1 },
    status: { type: 'string', enum: ['received','estimating','ordered','in_progress','delivered','invoiced','completed','lost'] },
  }),
]

function localEndpoint(origin, path) {
  const url = new URL(origin)
  if (url.origin !== origin || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('FLAP_ORIGIN にローカルのHTTPオリジンを指定してください。')
  }
  return new URL(path, url)
}

const result = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError && { isError }) })

function createLocalMcpServer({ origin, token, path, tools }) {
  const endpoint = localEndpoint(origin, path)
  if (typeof token !== 'string' || !/^[!-~]+$/.test(token)) throw new Error('FLAP_STORE_AGENT_TOKEN を設定してください。')

  const server = new Server({ name: 'flapp-self-host', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!tools.some(tool => tool.name === params.name)) {
      return result('登録されていない操作です。', true)
    }

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' },
        body: JSON.stringify({ name: params.name, arguments: params.arguments ?? {} }),
        redirect: 'error',
        signal: AbortSignal.timeout(5000),
      })
      if (response.status === 401 || response.status === 403) return result('この操作は委任されていません。接続設定を確認してください。', true)
      return result(await response.text(), !response.ok)
    } catch {
      return result('ローカルのFlapbaseに接続できませんでした。', true)
    }
  })
  return server
}

export function createStoreMcpServer(options) {
  return createLocalMcpServer({ ...options, path: '/api/store/agent', tools: DIGITAL_PRODUCT_TOOLS })
}

export function createRecruitmentMcpServer(options) {
  return createLocalMcpServer({ ...options, path: '/api/recruitment/agent', tools: RECRUITMENT_TOOLS })
}

export function createBookingMcpServer(options) {
  return createLocalMcpServer({ ...options, path: '/api/booking/agent', tools: BOOKING_TOOLS })
}

export function createCasesMcpServer(options) {
  return createLocalMcpServer({ ...options, path: '/api/cases/agent', tools: CASE_TOOLS })
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const origin = process.env.FLAP_ORIGIN ?? `http://127.0.0.1:${process.env.FLAP_PORT ?? 5264}`
  const server = process.env.FLAP_CASES_AGENT_TOKEN
    ? createCasesMcpServer({ origin, token: process.env.FLAP_CASES_AGENT_TOKEN })
    : process.env.FLAP_BOOKING_AGENT_TOKEN
    ? createBookingMcpServer({ origin, token: process.env.FLAP_BOOKING_AGENT_TOKEN })
    : process.env.FLAP_RECRUITMENT_AGENT_TOKEN
    ? createRecruitmentMcpServer({ origin, token: process.env.FLAP_RECRUITMENT_AGENT_TOKEN })
    : createStoreMcpServer({ origin, token: process.env.FLAP_STORE_AGENT_TOKEN })
  await server.connect(new StdioServerTransport())
}
