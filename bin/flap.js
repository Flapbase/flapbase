#!/usr/bin/env node
import { check, formatReport } from '../packages/site-check/src/index.js'

const args = process.argv.slice(2)
const json = args.includes('--json')
const help = `使い方: flap check <URL|HTML ファイル|フォルダ> [--json] [--base-url <公開 URL>]

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
    let baseUrl
    for (let i = 0; i < options.length; i++) {
      if (options[i] === '--json') continue
      if (options[i] === '--base-url' && options[i + 1]) {
        const parsed = new URL(options[++i])
        if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) throw new Error('基準の URL は認証情報やクエリのない HTTPS URL にしてください。')
        baseUrl = parsed.href
      } else throw new Error('使えないオプションです。--help で使い方を確認してください。')
    }
    if (baseUrl && /^https?:\/\//iu.test(input)) throw new Error('--base-url は HTML ファイルかフォルダに使います。')
    const result = await check(input, { baseUrl })
    process.stdout.write(json ? JSON.stringify(result, null, 2) + '\n'
      : result.reports ? result.reports.map(formatReport).join('\n') : formatReport(result))
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
