import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { spawnSync } from 'node:child_process'

test('skill の名前と説明を見つけ、記載されたローカルの命令を実行する', () => {
  const skill = readFileSync(new URL('../skills/flapbase-site-check/SKILL.md', import.meta.url), 'utf8')
  const frontmatter = /^---\nname: ([a-z0-9-]+)\ndescription: ([^\n]+)\n---\n/u.exec(skill)
  assert.ok(frontmatter)
  assert.equal(frontmatter[1], 'flapbase-site-check')
  assert.ok(frontmatter[2].length > 0)
  assert.equal(/TODO|TBD|\[INSERT/u.test(skill), false)
  const result = spawnSync(process.execPath, ['bin/flap.js', 'check', 'examples/cosmetics/index.html', '--json'], { encoding: 'utf8' })
  assert.equal(result.status, 0)
  assert.equal(JSON.parse(result.stdout).checks.length, 11)
})
