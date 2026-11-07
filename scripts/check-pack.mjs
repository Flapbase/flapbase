import { mkdtemp, mkdir, cp, rm, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { pathToFileURL, fileURLToPath } from 'node:url'
import assert from 'node:assert/strict'
import { scanRelease } from './check-release.mjs'

const root = fileURLToPath(new URL('..', import.meta.url))
const scratch = await mkdtemp(join(tmpdir(), 'flap-pack-'))
const env = { ...process.env, npm_config_cache: join(scratch, 'cache'), npm_config_update_notifier: 'false' }
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, result.stderr || result.error?.message || result.stdout)
  return result.stdout
}
try {
  const output = join(scratch, 'tarballs')
  await mkdir(output)
  const cli = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output]))[0]
  const core = JSON.parse(run('npm', ['pack', '--ignore-scripts', '--json', '--pack-destination', output], resolve(root, 'packages/site-check')))[0]
  for (const tarball of [cli, core]) {
    const name = tarball === cli ? 'cli' : 'core'
    const unpack = join(scratch, `unpack-${name}`)
    await mkdir(unpack)
    run('tar', ['-xzf', join(output, tarball.filename), '-C', unpack])
    const scan = await scanRelease(join(unpack, 'package'))
    assert.equal(scan.status, 'pass', JSON.stringify(scan.problems))
    assert.ok(!tarball.files.some(file => /(?:tests|scripts|node_modules|\.env)\//u.test(file.path)))
  }
  const install = join(scratch, 'install')
  await mkdir(install)
  run('npm', ['install', '--ignore-scripts', '--no-audit', '--no-fund', '--package-lock=false', join(output, cli.filename), join(output, core.filename)], install)
  await cp(join(root, 'examples/cosmetics/index.html'), join(install, 'sample.html'))
  const checked = JSON.parse(run('npx', ['--offline', '--no-install', '@flapbase/cli', 'check', 'sample.html', '--json'], install))
  assert.equal(checked.checks.length, 11)
  assert.ok(checked.checks.every(item => item.pass))
  const moduleUrl = pathToFileURL(join(install, 'node_modules/@flapbase/site-check/src/index.js')).href
  const script = `import { checkFile } from ${JSON.stringify(moduleUrl)}; const report = await checkFile('sample.html'); console.log(JSON.stringify(report));`
  const coreResult = JSON.parse(run(process.execPath, ['--input-type=module', '-e', script], install))
  assert.deepEqual(coreResult.checks, checked.checks)
  const installedPackage = JSON.parse(await readFile(join(install, 'node_modules/@flapbase/cli/package.json'), 'utf8'))
  assert.equal(installedPackage.dependencies, undefined)
  console.log(JSON.stringify({ status: 'pass', isolatedNpx: true, coreImport: true, tarballScan: true,
    packages: [cli, core].map(item => ({ name: item.name, version: item.version, files: item.files.length, unpackedSize: item.unpackedSize })) }))
} finally { await rm(scratch, { recursive: true, force: true }) }
