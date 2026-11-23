const form = document.querySelector('form')
const status = document.querySelector('#auth-status')
const logout = document.querySelector('#sign-out')

async function refresh() {
  const response = await fetch('/auth/context', { cache: 'no-store' })
  if (!response.ok && response.status !== 401) throw Error('session_unavailable')
  form.hidden = response.ok
  logout.hidden = !response.ok
  const next = new URLSearchParams(location.search).get('next')
  if (response.ok && /^\/training\/drafts\/[0-9a-f-]{36}\?revision=[1-9][0-9]*&digest=sha256%3A[0-9a-f]{64}$/.test(next ?? '')) location.replace(next)
  if (response.ok && next === '/training/join') location.replace(next + location.hash)
  if (response.ok && (next === '/training' || next === '/training/questions' || next === '/training/my' || /^\/training\/(?:my|orders)\/[0-9a-f-]{36}$/.test(next ?? '') || next === '/membership' || /^\/membership\/orders\/[0-9a-f-]{36}$/.test(next ?? '') || next === '/store' || next === '/cases' || /^\/(?:cases|service\/portal)\/[0-9a-f-]{36}$/.test(next ?? '') || next === '/booking' || /^\/booking\/(?:offers|receipts)\/[0-9a-f-]{36}$/.test(next ?? '') || next === '/recruitment' || /^\/recruitment\/jobs\/[0-9a-f-]{36}$/.test(next ?? '') || /^\/(?:products|receive\/orders)\/[0-9a-f-]{36}$/.test(next ?? ''))) location.replace(next)
  status.textContent = response.ok ? 'ログイン中' : ''
}

async function authenticate(path, body, failure) {
  for (const button of [logout, ...form.querySelectorAll('button')]) button.disabled = true
  try {
    const response = await fetch(path, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    })
    if (!response.ok) {
      status.textContent = failure
      return
    }
    form.reset()
    await refresh()
  } catch {
    status.textContent = '接続を確認してもう一度お試しください'
  } finally {
    for (const button of [logout, ...form.querySelectorAll('button')]) button.disabled = false
  }
}
form.addEventListener('submit', event => {
  event.preventDefault()
  const { name, email, password } = Object.fromEntries(new FormData(form))
  if (event.submitter?.value === 'sign-up') {
    if (!name.trim()) {
      status.textContent = '名前を入力してください'
      return
    }
    void authenticate('/api/auth/sign-up/email', { name: name.trim(), email, password }, 'アカウントを作成できませんでした')
  } else {
    void authenticate('/api/auth/sign-in/email', { email, password }, 'ログインできませんでした')
  }
})
logout.addEventListener('click', () => void authenticate('/api/auth/sign-out', {}, 'ログアウトできませんでした'))
refresh().catch(() => { status.textContent = '認証サーバーに接続できませんでした' })
