export type CheckKey = 'doctype' | 'html' | 'charset' | 'viewport' | 'title' | 'description' | 'canonical' | 'h1' | 'jsonld' | 'initial-html' | 'robots'
export interface CheckFinding { severity: 'error' | 'warning'; code: string; message: string }
export interface Check { key: CheckKey; semanticRef: string; ruleRef: string; label: string; pass: boolean; findings: CheckFinding[] }
export interface Source { kind: 'url' | 'file' | 'folder'; input: string }
export interface Coverage { html: boolean; robots: boolean; sitemap: boolean; languageProfiles: boolean }
export interface Issue { key: string; stage: 'read'; part: 'site' | 'ai'; ai: boolean; title: string; why: string; fix: string; priority: number }
export interface Row { key: string; stage: 'read'; part: 'site' | 'ai'; label: string; value: string; tone: 'ok' | 'bad' | 'mid' | 'na' }
export interface Crawler { name: string; owner: string; kind: 'search' | 'user' | 'training'; allowed: boolean | null }
export interface LanguageProfile { profile: string; url: string | null; status: number | null; language: string | null; visibleTextLength: number | null }
export type FactKey = 'price' | 'area' | 'booking'
export type BusinessField = 'price' | 'days' | 'address' | 'phone'
export interface HtmlLocation { line: number; selector: string; text: string }
export interface Evidence extends HtmlLocation {
  page: string; source: 'html' | 'jsonld' | 'file'; value: string;
  field?: BusinessField; subject?: string; normalized?: string; profile?: string;
  destination?: string | null; finalUrl?: string | null;
}
export interface PublicationFinding { code: string; cause: string; title: string; fix: string; evidence: Evidence[]; rank: number }
export interface Finding extends PublicationFinding { id: string; priority: number; pageCount: number; pages: string[] }
export interface Fact { key: FactKey; label: string; found: boolean; evidence: Evidence[] }
export interface BusinessLink extends HtmlLocation {
  page: string; label: string; target: string | null; destination: string | null;
  finalUrl: string | null; status: 'ok' | 'broken' | 'unchecked'; httpStatus: number | null;
  reason: string | null; kind: 'link' | 'form'; localPath?: string; profile?: string;
}
export interface Publication {
  facts: Fact[]; links: BusinessLink[]; values: Evidence[]; findings: PublicationFinding[];
  htmlLocations: Partial<Record<CheckKey, HtmlLocation>>;
  variants?: (Publication & { profile: string; url: string })[];
}
export interface Difference { fixed: Finding[]; introduced: Finding[]; continuing: Finding[] }
export interface Report {
  version: 'flapbase.site-check/v1'; ruleSetVersion: 'web-publication-seo/v1'; crawlersVersion: string;
  source: Source; url: string; checkedAt: string; coverage: Coverage;
  checks: Check[]; issues: Issue[]; rows: Row[]; crawlers: Crawler[]; profiles: LanguageProfile[];
  pagePath?: string; factsRequested?: FactKey[]; publication?: Publication; findings?: Finding[]; difference?: Difference;
}
export interface Collection {
  version: 'flapbase.site-check-collection/v1'; source: Source; reports: Report[];
  factsRequested: FactKey[]; findings: Finding[]; difference?: Difference;
}
export interface CheckOptions { baseUrl?: string; now?: Date; facts?: FactKey[] | string; baseline?: Report | Collection }
export interface Page { url: string; status: number; html: string | null; server: string | null; mitigated: boolean; redirected: boolean }
export interface Fetched {
  requestedUrl: string; robots: { status: number; text: string } | null; blockedByRobots: boolean;
  page: Page | null; checks: Check[]; sitemap: { found: boolean } | null; llmsTxt: boolean | null;
}
export interface Rule { semanticRef: string; ruleRef: string; issuePrefix: string; label: string; meaning: string; evaluationCondition: string; limitations: readonly string[] }
export function check(input: string, options?: CheckOptions): Promise<Report | Collection>
export function checkFile(path: string, options?: CheckOptions & { root?: string; rootIsSite?: boolean }): Promise<Report>
export function inspectChecks(html: string, url: string): Check[]
export function buildReport(fetched: Fetched, options: { source: Source; coverage: Coverage; profiles?: LanguageProfile[]; now?: Date }): Report
export function formatReport(report: Report | Collection, options?: { lang?: 'en' | 'ja' }): string
export function compareBaseline(current: Report | Collection, baseline: Report | Collection): Difference
export const RESULT_VERSION: 'flapbase.site-check/v1'
export const WEBSITE_SEO_RULE_SET_VERSION: 'web-publication-seo/v1'
export const WEBSITE_SEO_RULES: readonly Rule[]
export const LIMITS: Readonly<{ html: number; robots: number; sitemap: number; files: number; totalBytes: number; depth: number }>
