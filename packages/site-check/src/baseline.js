import { groupFindings, legacyFindings } from './publication.js'
import { basename, relative, sep } from 'node:path'

function findingsOf(result) {
  if (!result || !['flapbase.site-check/v1', 'flapbase.site-check-collection/v1'].includes(result.version)) throw new Error('前回の JSON はサイト点検の結果を指定してください。')
  const findings = result.findings ?? groupFindings((result.reports ?? [result]).flatMap(report => {
    const pagePath = report.source.kind === 'file' ? result.reports ? relative(result.source.input, report.source.input).split(sep).join('/') : basename(report.source.input) : undefined
    return legacyFindings({ ...report, pagePath })
  }))
  if (!Array.isArray(findings) || findings.some(item => typeof item.id !== 'string' || !Array.isArray(item.pages) || !Array.isArray(item.evidence))) throw new Error('前回の JSON の findings が不正です。')
  return findings
}
export function compareBaseline(current, baseline) {
  const previous = findingsOf(baseline), next = findingsOf(current)
  const context = result => ({ kind: result.source?.kind, facts: [...(result.factsRequested ?? ['price', 'area', 'booking'])].sort() })
  if (JSON.stringify(context(current)) !== JSON.stringify(context(baseline))) throw new Error('前回と同じ入力の種類と --facts で再点検してください。')
  // Compare each cause on each page so a partial repair or a newly affected page is visible.
  const subset = (items, other, present) => items.flatMap(item => {
    const match = other.find(candidate => candidate.id === item.id)
    const pages = item.pages.filter(page => (match?.pages.includes(page) ?? false) === present)
    return pages.length ? [{ ...item, pages, pageCount: pages.length, evidence: item.evidence.filter(evidence => pages.includes(evidence.page)) }] : []
  })
  return { fixed: subset(previous, next, false), introduced: subset(next, previous, false), continuing: subset(next, previous, true) }
}
