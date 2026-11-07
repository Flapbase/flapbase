import { auditWebPublicationHtml } from './seo.js'
import { WEBSITE_SEO_RULES, inspectInitialHtml } from './rules.js'

export function inspectChecks(html, url) {
  const expected = new URL(url)
  const report = auditWebPublicationHtml({ html, label: expected.pathname,
    expectedCanonical: expected.href, expectedOrigin: expected.origin })
  const initial = inspectInitialHtml(html, url)
  const issues = initial.pass ? report.issues : [...report.issues,
    { severity: 'warning', code: 'initial-html.thin', message: initial.message }]
  return WEBSITE_SEO_RULES.map(rule => ({
    key: rule.semanticRef.slice('website.seo.'.length), semanticRef: rule.semanticRef,
    ruleRef: rule.ruleRef, label: rule.label,
    pass: !issues.some(issue => issue.code.startsWith(rule.issuePrefix)),
    findings: issues.filter(issue => issue.code.startsWith(rule.issuePrefix)),
  }))
}
