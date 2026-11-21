import { readFile } from 'node:fs/promises'
import { createSelfHostedAuthPool } from './auth.mjs'
import { createFreeDownloadStore, storeId } from './free-download.mjs'
import { createStoreLifecycle } from './lifecycle.mjs'
import { parseDigitalProductBase } from './digital-product-base.mjs'

const [path] = process.argv.slice(2)
const { FLAP_STORE_OWNER_ID: owner, FLAP_STORE_PROJECT_ID: projectId, FLAP_STORE_DATA_DIR: directory } = process.env
if (!path || !storeId(owner) || !storeId(projectId) || !directory) {
  console.error('導入する .base ファイルと運営者ID・Project ID・保存先を指定してください。')
  process.exitCode = 1
} else {
  let pool
  try {
    const base = parseDigitalProductBase(JSON.parse(await readFile(path, 'utf8')))
    pool = createSelfHostedAuthPool(process.env.FLAP_AUTH_DATABASE_URL)
    const store = await createFreeDownloadStore({ pool, projectId, directory })
    const result = await createStoreLifecycle({ store, projectId }).installBase(owner, base)
    console.log(JSON.stringify(result))
  } catch (error) {
    console.error(error?.status === 409 ? 'このProjectには別の定義が導入済みです。' : '定義・Project・運営権限を確認してください。')
    process.exitCode = 1
  } finally {
    await pool?.end()
  }
}
