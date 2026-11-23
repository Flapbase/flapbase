import { LearnerError } from '../course-engine/src/learning-access.js'
import { storeId } from './free-download.mjs'
import { escape, html, send } from './store-http.mjs'

const page = (title, content) => html(title, '<h1>' + escape(title) + '</h1>' + content, '/course-ui.js')
const hidden = (name, value) => `<input type="hidden" name="${name}" value="${escape(value)}">`
const form = (action, fields, label) => `<form data-training="${action}">${fields}<button>${label}</button><p role="status"></p></form>`
const options = (items, name) => items.map(item => `<option value="${escape(item.id)}">${escape(name(item))}</option>`).join('')
const learnerLink = id => '/training/my/' + encodeURIComponent(id)

const draftLink = ({ artifactRef, revision, digest }) =>
  '/training/drafts/' + artifactRef + '?' + new URLSearchParams({ revision: String(revision), digest })

function dashboard({ workspaceId, courses, drafts, learners, assignments }) {
  const courseOptions = options(courses, item => item.title + ' 第' + item.revision + '版')
  const learnerOptions = options(learners, item => item.name)
  const rows = assignments.map(item => `<tr><th scope="row">${escape(item.learnerName ?? item.learnerId)}</th>
    <td>${escape(item.title)} 第${item.courseRevision}版</td><td>${item.completed} / ${item.total}</td></tr>`).join('')
  const review = drafts.map(draft => `<li><a href="${escape(draftLink(draft))}">${escape(draft.title)} 第${draft.revision}版</a></li>`).join('')
  return page('法人研修', `<nav aria-label="研修"><a href="/training/my">自分の教材</a></nav>
    <section><h2>受講者を招待</h2>
    ${form('invite', '<label>名前 <input name="name" maxlength="80" required></label><label>メールアドレス <input name="email" type="email" maxlength="320" required></label>', '招待リンクを発行')}
    <label id="invite-result" hidden>共有する招待リンク <input readonly></label></section>
    ${review ? '<section><h2>公開前の教材</h2><ul>' + review + '</ul></section>' : ''}
    <section><h2>教材を公開</h2>
    ${form('release', hidden('workspaceId', workspaceId) + '<label>教材名 <input name="title" maxlength="160" required></label><label>本文 <textarea name="markdown" maxlength="50000" rows="6" required></textarea></label>', '確認した教材を公開')}</section>
    <section><h2>教材を割り当てる</h2>
    ${courseOptions && learnerOptions ? form('assign', '<label>教材 <select name="artifactRevisionId">' + courseOptions +
      '</select></label><label>受講者 <select name="learnerId">' + learnerOptions + '</select></label>', '割り当てる') : '<p>教材を公開し、受講者が招待を受けると割り当てられます。</p>'}</section>
    <section><h2>受講状況</h2>${rows ? '<table><thead><tr><th scope="col">受講者</th><th scope="col">教材</th><th scope="col">完了</th></tr></thead><tbody>' + rows + '</tbody></table>' : '<p>割当はまだありません。</p>'}</section>`)
}

function reading(assignmentId, { pin, document, completedLessonIds, version }) {
  const lessons = new Map(document.course.lessons.map(lesson => [lesson.id, lesson.title]))
  const sections = document.lessonBodies.map(body => {
    const completed = completedLessonIds.includes(body.lessonId)
    return `<section><h2>${escape(lessons.get(body.lessonId))}</h2><p class="description">${escape(body.markdown)}</p>${completed
      ? '<p>受講済み</p>'
      : form('progress', hidden('assignmentId', assignmentId) + hidden('lessonId', body.lessonId) + hidden('expectedVersion', version), '受講済みにする')}</section>`
  }).join('')
  return page(document.course.title, `<p><a href="/training/my">自分の教材</a> · 第${pin.revision}版</p>${sections || '<p>現在読める教材はありません。</p>'}`)
}

function draftReview({ pin, document }) {
  const bodies = new Map(document.lessonBodies.map(body => [body.lessonId, body.markdown]))
  const sections = document.course.lessons.map(lesson =>
    `<section><h2>${escape(lesson.title)}</h2><p class="description">${escape(bodies.get(lesson.id) ?? '')}</p></section>`).join('')
  const fields = hidden('artifactRef', pin.artifactRef) + hidden('revision', pin.revision) + hidden('digest', pin.digest)
  return page(document.course.title, `<p><a href="/training">法人研修へ</a> · 下書き 第${pin.revision}版</p>
    <p class="description">${escape(document.course.description)}</p>${sections}
    <details><summary>受講条件と教材の設定</summary><p class="description">${escape(JSON.stringify(document.course, null, 2))}</p></details>
    ${form('approve', fields, '確認した版を公開')}`)
}

export async function renderTraining(res, route, course, resolveHuman) {
  const path = route.pathname
  const assignment = /^\/training\/my\/([^/]+)$/.exec(path)?.[1]
  const draft = /^\/training\/drafts\/([^/]+)$/.exec(path)?.[1]
  if (path !== '/training' && path !== '/training/join' && path !== '/training/my' && !assignment && !draft) return false
  if ((assignment && !storeId(assignment)) || (draft && !storeId(draft))) {
    res.writeHead(404).end()
    return true
  }
  const joining = path === '/training/join'
  const human = await resolveHuman({ includeVerifiedEmail: joining })
  if (!human) {
    if (joining) send(res, 200, page('研修に参加', '<a id="training-sign-in" href="/?next=%2Ftraining%2Fjoin">ログインまたは登録</a>'))
    else res.writeHead(303, { location: '/?next=' + encodeURIComponent(path + route.search) }).end()
    return true
  }
  const actor = human.principalId
  try {
    if (joining) {
      send(res, 200, page('研修に参加', human.verifiedEmail
        ? form('accept', '', '招待を受ける')
        : '<p>招待されたメールアドレスを確認してください。</p>' + form('verify', '<label>メールアドレス <input name="email" type="email" required></label>', 'メール確認リンクを発行')))
    } else if (path === '/training') send(res, 200, dashboard(await course.dashboard(actor)))
    else if (draft) {
      const fixed = await course.getDraft(actor, { artifactRef: draft, revision: Number(route.searchParams.get('revision')), digest: route.searchParams.get('digest') })
      if (fixed.document.course.status !== 'draft') { res.writeHead(404).end(); return true }
      send(res, 200, draftReview(fixed))
    } else if (assignment) send(res, 200, reading(assignment, await course.learn(actor, assignment, { kind: 'read' })))
    else {
      const items = (await course.learnerHome(actor)).map(item => `<li><a href="${learnerLink(item.id)}">${escape(item.title)}</a></li>`).join('')
      send(res, 200, page('自分の教材', items ? '<ul>' + items + '</ul>' : '<p>教材が割り当てられるとここに表示されます。</p>'))
    }
  } catch (error) {
    if (!(error instanceof LearnerError) && error.status !== 404) throw error
    send(res, 404, page('この研修は表示できません', '<a href="/">ログイン画面へ</a>'))
  }
  return true
}
