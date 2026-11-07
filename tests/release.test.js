import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { scanRelease } from '../scripts/check-release.mjs'

test('秘密の形式と private import と内部の名前を検出し、値を報告に残さない', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-scan-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await mkdir(join(dir, 'bin'))
  const secret = 'sk-' + 'X'.repeat(30)
  await writeFile(join(dir, 'bin/sample.js'), `import x from '@private/example';\nconst value = '${secret}';\n// ${'FI' + 'NE'}\n`)
  const report = await scanRelease(dir)
  assert.equal(report.status, 'fail')
  assert.ok(report.problems.some(item => item.rule === 'API キー形式'))
  assert.ok(report.problems.some(item => item.rule === '外部か private の import'))
  assert.ok(report.problems.some(item => item.rule === '内部の名前'))
  assert.equal(JSON.stringify(report).includes(secret), false)
})
test('環境設定ファイルを公開対象にしない', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'flap-env-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  await writeFile(join(dir, '.env'), 'VALUE=example')
  const report = await scanRelease(dir)
  assert.equal(report.status, 'fail')
  assert.equal(report.problems[0].rule, '公開対象外のファイル')
})
