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

function localEndpoint(origin) {
  const url = new URL(origin)
  if (url.origin !== origin || url.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('FLAP_ORIGIN にローカルのHTTPオリジンを指定してください。')
  }
  return new URL('/api/store/agent', url)
}

const result = (text, isError = false) => ({ content: [{ type: 'text', text }], ...(isError && { isError }) })

export function createStoreMcpServer({ origin, token }) {
  const endpoint = localEndpoint(origin)
  if (typeof token !== 'string' || !/^[!-~]+$/.test(token)) throw new Error('FLAP_STORE_AGENT_TOKEN を設定してください。')

  const server = new Server({ name: 'flapp-self-host', version: '0.1.0' }, { capabilities: { tools: {} } })
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: DIGITAL_PRODUCT_TOOLS }))
  server.setRequestHandler(CallToolRequestSchema, async ({ params }) => {
    if (!DIGITAL_PRODUCT_TOOLS.some(tool => tool.name === params.name)) {
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

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  const origin = process.env.FLAP_ORIGIN ?? `http://127.0.0.1:${process.env.FLAP_PORT ?? 5264}`
  const server = createStoreMcpServer({ origin, token: process.env.FLAP_STORE_AGENT_TOKEN })
  await server.connect(new StdioServerTransport())
}
