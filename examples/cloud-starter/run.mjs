import { createServer } from 'node:http'
import { readFile, writeFile } from 'node:fs/promises'
import { buildSite } from './site.mjs'

const config = new URL('site.base.json', import.meta.url)
const render = async () => buildSite(JSON.parse(await readFile(config, 'utf8')))
const command = process.argv[2] ?? 'preview'

if (command === 'build') {
  const html = await render()
  const target = process.argv[3]
  if (!target) throw new Error('Set an output path for build')
  await writeFile(target, html)
  console.log('Generated ' + target)
} else if (command === 'preview') {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/') {
      response.writeHead(404).end()
      return
    }
    try {
      const html = await render()
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' }).end(html)
    } catch (error) {
      if (!response.headersSent) response.writeHead(503, { 'Content-Type': 'text/plain; charset=utf-8' })
      response.end(error instanceof Error ? error.message : 'Preview unavailable')
    }
  })
  server.listen(5264, '127.0.0.1', () => console.log('http://127.0.0.1:5264/'))
} else {
  console.error('Usage: node examples/cloud-starter/run.mjs [preview|build OUTPUT]')
  process.exitCode = 1
}
