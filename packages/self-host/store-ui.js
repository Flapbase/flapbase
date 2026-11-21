const claim = document.querySelector('#claim')
const publish = document.querySelector('#publish')
const status = document.querySelector('#result')

async function submit(form, path, data) {
  const button = form.querySelector('button')
  button.disabled = true
  status.textContent = ''
  try {
    const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(await data()) })
    if (!response.ok) {
      if (response.status === 401) {
        status.textContent = 'ログインしてからお申し込みください'
        const login = document.querySelector('#login')
        if (login) login.hidden = false
      } else {
        status.textContent = response.status === 409 ? '最新版を読み込み直してください' : '入力内容を確認してください'
      }
      return
    }
    const value = await response.json()
    if (path.endsWith('/checkout')) location.assign(value.checkoutUrl ?? value.receiptUrl)
    else {
      const link = document.createElement('a')
      link.href = value.purchaseUrl
      link.textContent = '商品ページを開く'
      status.replaceChildren('公開しました ', link)
    }
  } catch {
    status.textContent = '接続を確認してもう一度お試しください'
  } finally {
    button.disabled = false
  }
}

claim?.addEventListener('submit', event => {
  event.preventDefault()
  void submit(claim, '/api/commerce/own-site/v1/checkout', () => ({ listingId: claim.dataset.listing, revisionId: claim.dataset.revision }))
})

function encodeFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result.split(',')[1])
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

publish?.addEventListener('submit', event => {
  event.preventDefault()
  const { file, title, description, listingId, amountMinor } = Object.fromEntries(new FormData(publish))
  if (!file.size || file.size > 5_242_880) {
    status.textContent = '5 MBまでのファイルを選んでください'
    return
  }
  void submit(publish, '/api/store/publish', async () => ({
    listingId: listingId || undefined, title, description, amountMinor: Number(amountMinor ?? 0), fileName: file.name, content: await encodeFile(file),
  }))
})


const formOperations = {
  lead: form => ['/api/store/lead', { listingId: form.dataset.listing,
    email: form.elements.email.value, consent: form.elements.consent.checked }, '登録しました'],
  'follow-up': form => ['/api/store/follow-up', { leadId: form.dataset.lead,
    subject: form.elements.subject.value, body: form.elements.body.value }, '案内を記録しました'],
  support: form => ['/api/store/support', { orderId: form.dataset.order, body: form.elements.body.value }, '問い合わせを受け付けました'],
  unsubscribe: form => ['/unsubscribe', { leadId: form.dataset.lead }, '案内を停止しました'],
}

for (const form of document.querySelectorAll('form[data-operation]')) {
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const button = form.querySelector('button')
    const result = form.querySelector('[role=status]')
    const [path, value, success] = formOperations[form.dataset.operation](form)
    button.disabled = true
    try {
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(value) })
      const data = await response.json()
      if (!response.ok) result.textContent = '操作できませんでした。設定と権限を確認してください'
      else if (data.status === 'sending' || data.status === 'delivery_unknown') result.textContent = '送信結果を確認しています'
      else {
        result.textContent = success
        form.reset()
      }
    } catch {
      result.textContent = '接続を確認してもう一度お試しください'
    } finally {
      button.disabled = false
    }
  })
}
