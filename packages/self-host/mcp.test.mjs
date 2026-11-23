import assert from 'node:assert/strict'
import { once } from 'node:events'
import { createServer } from 'node:http'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { createStoreMcpServer } from './mcp.mjs'

test('external stdio client discovers and calls project operations through the guarded HTTP endpoint', async () => {
  const calls = []
  const token = 'self-host-stdio-test-token'
  const server = createServer(async (request, response) => {
    const chunks = []
    for await (const chunk of request) chunks.push(chunk)
    calls.push({
      method: request.method, url: request.url, authorization: request.headers.authorization,
      ...JSON.parse(Buffer.concat(chunks).toString('utf8')),
    })
    if (calls.at(-1).name === 'support_request_get') {
      response.writeHead(403).end('非公開の情報')
      return
    }
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ status: 'draft' }))
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')

  const client = new Client({ name: 'self-host-mcp-test', version: '1.0.0' })
  try {
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: [fileURLToPath(new URL('./mcp.mjs', import.meta.url))],
      env: { FLAP_ORIGIN: 'http://127.0.0.1:' + server.address().port, FLAP_STORE_AGENT_TOKEN: token },
    }))
    const { tools } = await client.listTools()
    assert.deepEqual(tools.map(tool => tool.name), [
      'membership_roster_list', 'product_draft_save', 'follow_up_draft_save', 'operations_summary', 'order_support_get', 'support_requests_list',
      'support_request_get', 'support_reply_draft_save',
    ])
    assert.equal(tools.find(tool => tool.name === 'operations_summary').annotations.readOnlyHint, true)
    const input = { title: '試験資料', description: '告知ページの下書き' }
    const draft = await client.callTool({ name: 'product_draft_save', arguments: input })
    assert.equal(draft.isError, undefined)
    assert.deepEqual(JSON.parse(draft.content[0].text), { status: 'draft' })
    const requestId = 'cda93726-d203-4d90-90fb-d23c55c60e29'
    const denied = await client.callTool({ name: 'support_request_get', arguments: { requestId } })
    assert.equal(denied.isError, true)
    assert.doesNotMatch(denied.content[0].text, /非公開の情報/)
    const unknown = await client.callTool({ name: 'publish', arguments: {} })
    assert.equal(unknown.isError, true)
    assert.deepEqual(calls, [
      { method: 'POST', url: '/api/store/agent', authorization: 'Bearer ' + token, name: 'product_draft_save', arguments: input },
      { method: 'POST', url: '/api/store/agent', authorization: 'Bearer ' + token, name: 'support_request_get', arguments: { requestId } },
    ])
  } finally {
    await client.close()
    await new Promise(resolve => {
      server.close(resolve)
      server.closeAllConnections()
    })
  }
})

test('refuses to start without a local origin and an agent credential', () => {
  assert.throws(() => createStoreMcpServer({ origin: 'https://example.com', token: 'token' }), /FLAP_ORIGIN/)
  assert.throws(() => createStoreMcpServer({ origin: 'http://127.0.0.1:5264', token: ' ' }), /FLAP_STORE_AGENT_TOKEN/)
})
