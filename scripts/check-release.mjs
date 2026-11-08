import { readdir, readFile, lstat } from 'node:fs/promises'
import { resolve, relative, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const secretRules = [
  ['秘密鍵', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/u],
  ['API キー形式', /\b(?:sk-[A-Za-z0-9_-]{20,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[A-Z0-9]{16})\b/u],
  ['秘密の代入', /(?:api[_-]?key|access[_-]?token|client[_-]?secret|password)\s*[:=]\s*["'][A-Za-z0-9_+/=-]{16,}["']/iu],
]
const privateRules = [
  ['端末の絶対パス', /\/(?:Users|home)\/[A-Za-z0-9._-]+\//u],
  ['内部の名前', new RegExp('\\b(?:' + ['FI' + 'NE', 'humanic' + 'agents', 'Another' + 'base', 'DIAGNOSIS' + '-1', 'flapbase' + '-cloud', 'sp' + 'luc'].join('|') + ')\\b', 'iu')],
  ['内部のホスト', /https?:\/\/[^\s"'<>]*(?:\.internal|\.local)(?:[/:\s"'<>]|$)/iu],
]
const roots = new Set(['bin', 'src', 'packages', 'scripts', 'tests', 'skills', 'examples', 'docs'])
const topFiles = new Set(['.gitignore', 'README.md', 'SECURITY.md', 'LICENSE', 'NOTICE', 'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml'])
const ignored = new Set(['.git', 'node_modules', '.DS_Store'])
const extensions = /\.(?:js|mjs|json|md|html|txt|xml|yaml|ts)$/u
const exampleEnv = 'examples/travel-broken/.env'

export async function scanRelease(root) {
  const problems = [], files = [], packages = []
  async function walk(dir) {
    for (const entry of (await readdir(dir, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
      if (ignored.has(entry.name)) continue
      const full = resolve(dir, entry.name)
      const path = relative(root, full).replaceAll('\\', '/')
      if (entry.isSymbolicLink()) { problems.push({ path, rule: 'シンボリックリンク' }); continue }
      if (entry.isDirectory()) {
        if (!roots.has(path.split('/')[0])) { problems.push({ path, rule: '公開対象外のフォルダ' }); continue }
        await walk(full); continue
      }
      // Only this exact non-secret teaching fixture is distributed.
      if (path === exampleEnv && entry.isFile() && (await lstat(full)).size === 26 && await readFile(full, 'utf8') === 'EXAMPLE_ONLY=not-a-secret\n') {
        files.push({ path, sha256: createHash('sha256').update('EXAMPLE_ONLY=not-a-secret\n').digest('hex') }); continue
      }
      if ((!path.includes('/') && !topFiles.has(path)) || (path.includes('/') && !extensions.test(path) && !['LICENSE', 'NOTICE'].includes(entry.name))) {
        problems.push({ path, rule: '公開対象外のファイル' }); continue
      }
      if (!entry.isFile() || (await lstat(full)).size > 4 * 1024 * 1024) { problems.push({ path, rule: '大きさか種類' }); continue }
      const body = await readFile(full, 'utf8')
      for (const [rule, pattern] of [...secretRules, ...privateRules]) {
        if (rule === '内部のホスト' && path === 'tests/fetch.test.js') continue
        if (rule === '内部の名前' && path === 'skills/flapbase-join/SKILL.md' && !pattern.test(body.replaceAll('another' + 'base.app', ''))) continue
        if (pattern.test(body)) problems.push({ path, rule })
      }
      if (/\.(?:m?js|ts)$/u.test(path)) {
        const imports = [
          /^\s*(?:import\s+(?:[^;]*?\sfrom\s*)?|export\s+(?:\*|\{[^}]*\})\s*from\s*)['"]([^'"]+)['"]/gmu,
          /\b(?:import|require)\s*\(\s*['"]([^'"]+)['"]/gu,
        ]
        for (const match of imports.flatMap(pattern => [...body.matchAll(pattern)])) {
          const specifier = match[1]
          if (!specifier.startsWith('node:') && !specifier.startsWith('./') && !specifier.startsWith('../')) problems.push({ path, rule: '外部か private の import' })
          if (specifier.startsWith('.')) {
            const target = relative(root, resolve(dirname(full), specifier))
            if (target === '..' || target.startsWith('../')) problems.push({ path, rule: 'repo 外の import' })
          }
        }
      }
      if (entry.name === 'package.json') {
        const pkg = JSON.parse(body)
        const dependencies = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies })
        if (dependencies.length) problems.push({ path, rule: '依存の追加' })
        if (pkg.license !== 'Apache-2.0') problems.push({ path, rule: 'ライセンス' })
        packages.push({ path, name: pkg.name, dependencies: dependencies.length })
      }
      if (path !== 'docs/release-scan.json') files.push({ path, sha256: createHash('sha256').update(body).digest('hex') })
    }
  }
  await walk(root)
  return { version: 'flapbase.release-scan/v1', status: problems.length ? 'fail' : 'pass',
    scannedFiles: files.length, excluded: ['.git', 'node_modules', '.DS_Store'], unhashed: ['docs/release-scan.json'],
    acceptedFixtures: [{ path: exampleEnv, rule: '公開対象外のファイル', reason: 'EXAMPLE_ONLY の固定の1行だけを持つ点検用の例' }, { path: 'tests/fetch.test.js', rule: '内部のホスト', reason: '危険な URL の拒否を確かめる固定の入力' }, { path: 'skills/flapbase-join/SKILL.md', rule: '内部の名前', reason: '公開しているクリエイターのページの住所だけを許す' }],
    packages, problems, files }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const report = await scanRelease(resolve(process.argv[2] ?? new URL('..', import.meta.url).pathname))
  process.stdout.write(JSON.stringify(report, null, 2) + '\n')
  if (report.problems.length) process.exitCode = 1
}
