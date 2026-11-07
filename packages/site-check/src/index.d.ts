export type CheckKey = 'doctype' | 'html' | 'charset' | 'viewport' | 'title' | 'description' | 'canonical' | 'h1' | 'jsonld' | 'initial-html' | 'robots'
export interface CheckFinding { severity: 'error' | 'warning'; code: string; message: string }
export interface Check { key: CheckKey; semanticRef: string; ruleRef: string; label: string; pass: boolean; findings: CheckFinding[] }
export interface Source { kind: 'url' | 'file' | 'folder'; input: string }
export interface Coverage { html: boolean; robots: boolean; sitemap: boolean; languageProfiles: boolean }
export interface Issue { key: string; stage: 'read'; part: 'site' | 'ai'; ai: boolean; title: string; why: string; fix: string; priority: number }
export interface Row { key: string; stage: 'read'; part: 'site' | 'ai'; label: string; value: string; tone: 'ok' | 'bad' | 'mid' | 'na' }
export interface Crawler { name: string; owner: string; kind: 'search' | 'user' | 'training'; allowed: boolean | null }
export interface LanguageProfile { profile: string; url: string | null; status: number | null; language: string | null; visibleTextLength: number | null }
export interface Report {
  version: 'flapbase.site-check/v1'; ruleSetVersion: 'web-publication-seo/v1'; crawlersVersion: string;
  source: Source; url: string; checkedAt: string; coverage: Coverage;
  checks: Check[]; issues: Issue[]; rows: Row[]; crawlers: Crawler[]; profiles: LanguageProfile[];
}
export interface Collection { version: 'flapbase.site-check-collection/v1'; source: Source; reports: Report[] }
export interface CheckOptions { baseUrl?: string; now?: Date }
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
export function formatReport(report: Report): string
export const RESULT_VERSION: 'flapbase.site-check/v1'
export const WEBSITE_SEO_RULE_SET_VERSION: 'web-publication-seo/v1'
export const WEBSITE_SEO_RULES: readonly Rule[]
export const LIMITS: Readonly<{ html: number; robots: number; sitemap: number; files: number; totalBytes: number; depth: number }>
