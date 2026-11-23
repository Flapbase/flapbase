/**
 * One deterministic masker for text that may reach a language model (Owner 2026-11-05:
 * personal data never goes to an LLM). It removes the contact parts that identify a
 * person: email addresses, phone numbers, IP addresses, and the personal parts of a URL
 * (user info, query and fragment). Origin and path stay, so a public page is still named.
 *
 * The placeholders are the ones knowledge search already stores, so a model that echoes
 * one back shows a word the product already uses. No model, list of names or guess.
 */
export const PERSONAL_DATA_PLACEHOLDERS = Object.freeze({ contact: '[連絡先]', number: '[番号]', address: '[接続先]' })

const URL_PATTERN = /\bhttps?:\/\/[^\s<>"'`（）「」『』【】]+/giu
const EMAIL_PATTERN = /[\w.+-]+[@＠][\w-]+(?:\.[\w-]+)*\.[A-Za-z]{2,}/gu
const IPV4_PATTERN = /\b(?:\d{1,3}\.){3}\d{1,3}\b/gu
// A run of digits with the separators people type between them; phoneLike decides.
// Not glued to letters or digits, so identifiers and digests (UUIDs, hex) stay intact.
const PHONE_CANDIDATE = /(?<![\w０-９])[+＋(（]?[0-9０-９][0-9０-９ \-‐－ー−()（）]{7,}[0-9０-９](?![\w０-９])/gu
const DIGIT = /[0-9０-９]/gu

/** Domestic numbers start with 0 and have 10 or 11 digits; an international one starts with + and has 10 to 15. */
function phoneLike(value) {
  const digits = value.match(DIGIT)?.join('') ?? ''
  if (/^[+＋]/u.test(value)) return digits.length >= 10 && digits.length <= 15
  return /^[0０]/u.test(digits) && digits.length >= 10 && digits.length <= 11
}

function maskPhones(text) {
  return text.replace(PHONE_CANDIDATE, match => {
    if (phoneLike(match)) return PERSONAL_DATA_PLACEHOLDERS.number
    // Two numbers written next to each other ("03-1234-5678 090-1234-5678").
    return match.split(/(\s+)/u).map(part => phoneLike(part) ? PERSONAL_DATA_PLACEHOLDERS.number : part).join('')
  })
}

function maskUrl(raw) {
  // Trailing sentence punctuation is not part of the address.
  const tail = raw.match(/[.,;:!?。、．，]+$/u)?.[0] ?? ''
  const value = tail ? raw.slice(0, -tail.length) : raw
  let url
  try { url = new URL(value) } catch { return `${value.split(/[?#]/u)[0].replace(/\/\/[^/@]*@/u, '//')}${tail}` }
  // An address with nothing personal in it stays exactly as written.
  if (!url.username && !url.password && !url.search && !url.hash) return raw
  return `${url.protocol}//${url.host}${url.pathname}${tail}`
}

/** Mask one text. `urls: false` keeps URLs whole (knowledge-search questions keep their earlier shape). */
export function maskPersonalData(text, options = {}) {
  let out = options.urls === false ? text : text.replace(URL_PATTERN, maskUrl)
  out = out.replace(EMAIL_PATTERN, PERSONAL_DATA_PLACEHOLDERS.contact)
  out = maskPhones(out)
  return out.replace(IPV4_PATTERN, PERSONAL_DATA_PLACEHOLDERS.address)
}

