for (const form of document.querySelectorAll('form[data-membership]')) {
  const button = form.querySelector('button')
  const status = form.querySelector('[role="status"]')
  form.addEventListener('submit', async event => {
    event.preventDefault()
    button.disabled = true
    const { orderId, amountMinor, ...fields } = Object.fromEntries(new FormData(form))
    const publishing = form.dataset.membership === 'publish'
    try {
      const path = publishing ? '/api/membership/v1/offers' : '/api/membership/v1/orders/' + encodeURIComponent(orderId) + '/cancel'
      const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify(publishing ? { ...fields, amountMinor: Number(amountMinor) } : {}) })
      if (!response.ok) {
        status.textContent = '操作を完了できませんでした。もう一度お試しください。'
        return
      }
      if (publishing) location.assign((await response.json()).purchaseUrl)
      else location.reload()
    } catch {
      status.textContent = '接続を確認してもう一度お試しください。'
    } finally { button.disabled = false }
  })
}
