const api = '/api/courses/v1'
const signIn = document.querySelector('#training-sign-in')
signIn?.addEventListener('click', () => { signIn.hash = location.hash })
const messages = {
  forbidden: '招待されたメールアドレスのアカウントでログインしてください。',
  invitation_unavailable: 'この招待リンクは無効です。研修の担当者にご連絡ください。',
  email_verification_required: 'メールアドレスの確認を完了してください。',
  REVISION_CONFLICT: '新しい下書きがあります。研修画面から最新の版を開いてください。',
  progress_conflict: '進捗が更新されました。ページを読み直してください。',
}
function prepareDocument({ workspaceId: tenantId, title, markdown }) {
  const chapterId = crypto.randomUUID(), lessonId = crypto.randomUUID()
  return {
    contractVersion: 'course-document/v1', revision: 1,
    course: { tenantId, courseId: crypto.randomUUID(), creatorId: null, title, description: '', status: 'published',
      opening: { kind: 'immediate' }, chapters: [{ id: chapterId, title, order: 1 }],
      lessons: [{ id: lessonId, chapterId, title, order: 1, kind: 'material', status: 'published', materials: [],
        required: true, requirePrevious: false, delayDays: 0 }], assignments: [] },
    lessonBodies: [{ lessonId, markdown }],
  }
}

for (const form of document.querySelectorAll('form[data-training]')) {
  const operation = form.dataset.training
  const button = form.querySelector('button')
  const status = form.querySelector('[role="status"]')
  form.addEventListener('submit', async event => {
    event.preventDefault()
    button.disabled = true
    const fields = Object.fromEntries(new FormData(form))
    const headers = { 'content-type': 'application/json' }
    let path, body
    try {
      switch (operation) {
        case 'invite': path = api + '/invitations'; body = fields; break
        case 'accept': path = api + '/invitations/accept'; body = { token: location.hash.slice(1) }; break
        case 'verify': path = '/api/auth/send-verification-email'; body = { email: fields.email, callbackURL: '/training/join' }; break
        case 'approve': path = api + '/draft-approval'; body = { ...fields, revision: Number(fields.revision) }; break
        case 'offer': path = api + '/offers'; body = { ...fields, amountMinor: Number(fields.amountMinor) }; break
        case 'assign': path = api + '/assignments'; body = { ...fields, assignmentId: crypto.randomUUID() }; break
        case 'release': {
          path = api + '/releases'
          body = prepareDocument(fields)
          const identity = await fetch('/auth/context')
          if (!identity.ok) throw Error('sign_in_required')
          body.course.creatorId = (await identity.json()).principalId
          break
        }
        case 'progress': {
          path = api + '/' + fields.source + '/' + encodeURIComponent(fields.accessId) + '/progress'
          body = { lessonId: fields.lessonId, expectedVersion: Number(fields.expectedVersion), completed: true }
          headers['idempotency-key'] = crypto.randomUUID()
          break
        }
      }
      const result = await fetch(path, { method: 'POST', headers, body: JSON.stringify(body) })
      if (!result.ok) {
        const detail = await result.json().catch(() => ({}))
        status.textContent = messages[detail.error] ?? '操作を完了できませんでした。'
      } else if (operation === 'invite') {
        const output = document.querySelector('#invite-result')
        output.querySelector('input').value = (await result.json()).url
        output.hidden = false
        output.querySelector('input').select()
      } else if (operation === 'verify') status.textContent = '確認リンクを開いたあと、招待リンクを開き直してください。'
      else if (operation === 'accept') location.replace('/training/my')
      else if (operation === 'approve') location.replace('/training')
      else if (operation === 'offer') location.assign((await result.json()).purchaseUrl)
      else location.reload()
    } catch {
      status.textContent = '接続を確認してもう一度お試しください。'
    } finally {
      button.disabled = false
    }
  })
}
