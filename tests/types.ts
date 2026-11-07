import { check, checkFile, inspectChecks, buildReport, formatReport, RESULT_VERSION, WEBSITE_SEO_RULES, WEBSITE_SEO_RULE_SET_VERSION, LIMITS } from '../packages/site-check/src/index.js'
import type { Report, Collection, Fetched, Coverage } from '../packages/site-check/src/index.js'
const result: Report | Collection = await check('site', { baseUrl: 'https://example.com/', now: new Date() })
if ('reports' in result) result.reports.forEach(report => formatReport(report))
else formatReport(result)
const file: Report = await checkFile('index.html', { root: 'site' })
const checks = inspectChecks('', 'https://example.com/')
const fetched: Fetched = { requestedUrl: file.url, page: null, robots: null, checks, blockedByRobots: false, sitemap: null, llmsTxt: null }
const coverage: Coverage = { html: false, robots: false, sitemap: false, languageProfiles: false }
buildReport(fetched, { source: file.source, coverage })
const version: 'flapbase.site-check/v1' = RESULT_VERSION
const rulesVersion: 'web-publication-seo/v1' = WEBSITE_SEO_RULE_SET_VERSION
WEBSITE_SEO_RULES.map(rule => rule.semanticRef)
const max: number = LIMITS.html
void [version, rulesVersion, max]
