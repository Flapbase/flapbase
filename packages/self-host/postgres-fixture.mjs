import { execFileSync } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { createServer } from 'node:net'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createSelfHostedAuthPool } from './auth.mjs'
import { setupSchema } from './setup.mjs'

// Only a newly initialized loopback PostgreSQL instance is used by the tests.
export async function startArtifactTestPostgres({ seed = true } = {}) {
  const bin = process.env.POSTGRES_BIN || execFileSync('pg_config', ['--bindir'], { encoding: 'utf8' }).trim()
  const directory = await mkdtemp(join(tmpdir(), 'flap-store-pg-'))
  const socket = await mkdtemp(join('/tmp', 'flap-store-socket-'))
  const data = join(directory, 'data')
  const port = await new Promise((resolve, reject) => {
    const probe = createServer().on('error', reject)
    probe.listen(0, '127.0.0.1', () => { const port = probe.address().port; probe.close(() => resolve(port)) })
  })
  const run = (tool, args) => execFileSync(join(bin, tool), args, { stdio: ['ignore', 'pipe', 'pipe'] })
  const connection = 'postgresql://flap_store_test@127.0.0.1:' + port + '/postgres?sslmode=disable'
  const pool = createSelfHostedAuthPool(connection)
  let closing
  const close = () => closing ??= (async () => {
    await pool.end()
    try { run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']) } catch (error) {
      if (!/PID file.*does not exist|no server running/s.test(String(error.stderr ?? ''))) throw error
    }
    await Promise.all([rm(directory, {recursive:true, force:true}), rm(socket, {recursive:true, force:true})])
  })()
  try {
    run('initdb', ['-D', data, '-U', 'flap_store_test', '-A', 'trust', '--no-locale', '--encoding', 'UTF8'])
    run('pg_ctl', ['-D', data, '-l', join(directory, 'postgres.log'), '-o', '-h 127.0.0.1 -p '+port+' -k '+socket+' -c shared_memory_type=mmap -c dynamic_shared_memory_type=mmap', '-w', 'start'])
    if (seed) await setupSchema(pool)
    return { connection, sql: { query: (text, values) => pool.query(text, values).then(result=>result.rows) }, close }
  } catch (error) {
    await close()
    throw error
  }
}
