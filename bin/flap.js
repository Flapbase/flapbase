#!/usr/bin/env node
import { check, formatReport } from '../packages/site-check/src/index.js'
import { readFile, stat } from 'node:fs/promises'

const args = process.argv.slice(2)
const json = args.includes('--json')
const help = `使い方: flap check <URL|HTML ファイル|フォルダ> [--json] [--base-url <公開 URL>] [--facts price,area,booking] [--baseline <前回の json>]

例:
  flap check https://flapbase.com
  flap check examples/cosmetics/index.html --json
  flap check examples/travel --base-url https://example.com/

終了コード: 0 点検完了、1 取得や入力のエラー
`
try {
  if (args.length === 0 || args.includes('--help') || args.includes('-h')) process.stdout.write(help)
  else if (args.length === 1 && args[0] === '--version') process.stdout.write('0.1.0\n')
  else {
    const [command, input, ...options] = args
    if (command !== 'check' || !input || input.startsWith('-')) throw new Error('点検する URL、HTML ファイル、フォルダを指定してください。')
    let baseUrl, facts, baseline
    for (let i = 0; i < options.length; i++) {
      if (options[i] === '--json') continue
      if (options[i] === '--base-url' && options[i + 1]) {
        const parsed = new URL(options[++i])
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('基準の URL は認証情報やクエリのない HTTPS URL にしてください。')
        baseUrl = parsed.href
      } else if (options[i] === '--facts' && options[i + 1] && !options[i + 1].startsWith('--')) facts = options[++i]
      else if (options[i] === '--baseline' && options[i + 1] && !options[i + 1].startsWith('--')) {
        const path = options[++i]
        const info = await stat(path)
        if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error('前回の JSON は32 MiB 以下のファイルを指定してください。')
        baseline = JSON.parse(await readFile(path, 'utf8'))
      } else throw new Error('使えないオプションです。--help で使い方を確認してください。')
    }
    if (baseUrl && /^https?:\/\//iu.test(input)) throw new Error('--base-url は HTML ファイルかフォルダに使います。')
    const result = await check(input, { baseUrl, facts, baseline })
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n'
      : formatReport(result))
  }
} catch (error) {
  const code = error.code ?? 'input.invalid'
  const message = code === 'ENOENT' ? '指定したファイルかフォルダが見つかりません。'
    : error.code?.startsWith('file.') || error.code?.startsWith('folder.') || error.code?.startsWith('url.') || !error.code
      ? error.message : '点検を完了できませんでした。'
  if (json) process.stdout.write(JSON.stringify({ version: 'flapbase.site-check-error/v1', error: { code, message } }) + '\n')
  else process.stderr.write(`点検できません: ${message.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '')}\n`)
  process.exitCode = 1
}
