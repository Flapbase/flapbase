const problems = {
  case_conflict: '内容が変わりました。ページを読み直してください。',
  case_publication_stale: '下書きが変わりました。新しい版を確認してください。',
}
for (const form of document.querySelectorAll('form[data-case-operation]')) {
  const action = form.dataset.caseOperation
  const button = form.querySelector('button')
  const status = form.querySelector('[role="status"]')
  form.addEventListener('submit', async event => {
    event.preventDefault()
    button.disabled = true
    const fields = Object.fromEntries(new FormData(form))
    for (const key of ['expectedVersion','amount']) if (Object.hasOwn(fields,key)) fields[key] = Number(fields[key])
    let path = '/api/cases/' + action
    if (action === 'verify-email') {
      path = '/api/auth/send-verification-email'
      fields.callbackURL = location.pathname
    }
    try {
      const response = await fetch(path, {
        method:'POST', headers: { 'content-type':'application/json' }, body:JSON.stringify(fields),
      })
      if (!response.ok) {
        const body = await response.json().catch(() => ({}))
        status.textContent = problems[body.error] ?? '操作を完了できませんでした。'
      } else if (action === 'intake') {
        status.textContent = 'お問い合わせを受け付けました。'
        form.querySelectorAll('input,textarea').forEach(element => { element.disabled = true })
        return
      } else if (action === 'verify-email') {
        status.textContent = '確認用リンクを発行しました。ローカルの確認メールを開いてください。'
      } else if (action === 'convert') {
        location.assign('/cases/' + (await response.json()).caseId)
      } else {
        location.reload()
      }
    } catch {
      status.textContent = '接続を確認して、もう一度お試しください。'
    }
    button.disabled = false
  })
}
