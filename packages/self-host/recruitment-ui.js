const errorMessage = new Map([
  ['sign_in_required', 'ログインしてから応募してください。'],
  ['recruitment_version_conflict', '内容が変わりました。ページを読み直してください。'],
  ['recruitment_request_conflict', 'すでにこの応募を受け付けました。応募状況を確認してください。'],
  ['recruitment_approval_required', '公開する版を承認してください。'],
  ['recruitment_invalid_draft', '求人名と求人内容を入力してから検証してください。'],
])

for (const form of document.querySelectorAll('[data-recruitment-operation]')) {
  const operation = form.dataset.recruitmentOperation
  const button = form.querySelector('button')
  const status = form.querySelector('[role="status"]')
  const requestId = operation === 'submit' ? crypto.randomUUID() : null
  form.addEventListener('submit', async event => {
    event.preventDefault()
    const fields = Object.fromEntries(new FormData(form))
    for (const key of ['version', 'publishedVersion']) {
      if (Object.hasOwn(fields, key)) fields[key] = Number(fields[key])
    }
    if (requestId) fields.requestId = requestId
    button.disabled = true
    try {
      const response = await fetch('/api/recruitment/' + operation, {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(fields),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        status.textContent = errorMessage.get(body.error) ?? '操作を完了できませんでした。'
      } else if (operation === 'submit') {
        location.assign('/recruitment/jobs/' + fields.installId + '/applications')
      } else {
        location.reload()
      }
    } catch {
      status.textContent = '接続を確認し、もう一度お試しください。'
    } finally {
      button.disabled = false
    }
  })
}
