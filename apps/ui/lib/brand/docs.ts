import { brandAppUrl } from '@/lib/brand/urls'
import { brandText } from '@/lib/brand/text'
import { APP_URL } from '@/lib/app-url'
import type { Brand } from '@rerun/contracts'

// The pages of Rerun's documentation that hold for the clients of an organization too. A page that is
// not named here (billing, self-hosting, selling templates, Rerun's own apps and sign-up) never
// reaches them, and neither does one written tomorrow until someone puts it here.
const SHARED_PAGES = ['/agents/', '/api/', '/brain', '/chief-of-staff', '/concepts', '/teams', '/vault', '/templates/install']
const RERUN_ONLY_PAGES = ['/api/tools/templates']

export function isSharedDocsPage(url: string): boolean {
    const path = URL.canParse(url) ? new URL(url).pathname : url
    const under = (pages: string[]) => pages.some(page => (page.endsWith('/') ? path.startsWith(page) : path === page))
    return under(SHARED_PAGES) && !under(RERUN_ONLY_PAGES)
}

// What an organization sells, and what Rerun does for its own customers alone: never said to its clients.
const RERUN_ONLY = [
    /\\?\$\d/,
    /\b(?:free trial|trial|paid plan|checkout|invoices? (?:of|for) your|subscription is over|active subscription|AppSumo|lifetime plan|enterprise plan|PRO\*{0,2} badge|paid apps?|sold by the account)\b/i,
    /\bplan(?:'s)? (?:quotas?|limits?)\b|\bneeds an active plan\b|\b(?:Pro|Rerun|your) plan\b|\*\*Subscribe\*\*/i,
    /\(\/billing|\(\/self-host|self-host/i,
    /\b(?:mobile|iphone|android|desktop) app\b|linked computers?/i,
]

// Asking Rerun for a feature or an app goes with the whole line that explains how.
const RERUN_REQUEST = /request (?:to|for) the Rerun team|Request an app/i

const CONTACT = /\[?help@rerun\.build\]?(?:\(mailto:help@rerun\.build\))?/gi
const COMMUNITY = /(?:(?:the |our |on )?\[?Discord(?: (?:server|community|channel))?\]?(?:\([^)]*\))?)(?=[\s.,;:)]|$)/g
const TEAM = /\b(?:the |our )?Rerun team\b/gi

function redirectContacts(text: string, brand: Brand): string {
    const support = brand.supportEmail
    return text
        .replace(CONTACT, support ?? `the people who set up ${brand.name}`)
        .replace(TEAM, support ? `support (${support})` : 'support')
        .replace(/(?:on|in|through|via) (?=(?:the |our )?\[?Discord\b)/gi, 'at ')
        .replace(COMMUNITY, support ?? 'support')
}

const appHost = (url: string): string => new URL(url).host

// The app at the address of the brand. Null while it still answers at Rerun's.
function ownApp(brand: Brand): string | null {
    const app = brandAppUrl(brand)
    return /rerun\.build$/i.test(appHost(app)) ? null : app
}

// A link of Rerun keeps its words and loses its address; one into the app leads to the brand's own.
function rewriteLinks(text: string, brand: Brand): string {
    const app = ownApp(brand)
    const rewritten = app ? text.replaceAll(APP_URL, app).replace(/https:\/\/app\.rerun\.build/gi, app).replace(/\bapp\.rerun\.build\b/gi, appHost(app)) : text
    return rewritten
        .replace(/\[!\[[^\]]*\]\([^)]*\)\]\([^)]*\)|!\[[^\]]*\]\([^)]*\)/g, '')
        .replace(/\[([^\]]+)\]\((?:\/[^)]*|#[^)]*|https?:\/\/(?:[\w-]+\.)*(?:rerun\.build|github\.com\/rerun-build)[^)]*)\)/gi, '$1')
}

const slugOf = (name: string): string =>
    name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '') || 'app'

function sayBrand(text: string, brand: Brand): string {
    const unprefixed = text.replace(/\bOn Rerun Cloud,? (\W{0,3})(\w)/g, (_match, marks: string, first: string) => marks + (marks.includes('`') ? first : first.toUpperCase())).replace(/\bRerun Cloud\b/g, 'Rerun').replace(/(?<![\w./@-])RERUN(?![\w])/g, 'Rerun')
    return brandText(unprefixed, brand)
}

// In prose the word is also a verb: what runs a second time. A list of values loses the one it names.
const rewriteProse = (text: string, brand: Brand): string =>
    text
        .split(/(`[^`]*`(?:, )?)/)
        .map(part => (/^`rerun`/.test(part) ? (part.endsWith(', ') ? '' : `\`${slugOf(brand.name)}\``) : part.startsWith('`') ? rewriteCode(part, brand) : sayBrand(part, brand).replace(/(?<![\w./@-])([Rr])erun(s|ning)?(?![\w/-]|\.\w)/g, '$1e-run$2')))
        .join('')

// A name of the reader's own choosing in an example (`claude mcp add rerun`, `RERUN_MCP_KEY`).
const rewriteCode = (text: string, brand: Brand): string =>
    sayBrand(text, brand)
        .replace(/\bRERUN_([A-Z_]+)\b/g, '$1')
        .replace(/(?<![\w./@-])rerun(?![\w./-])/g, slugOf(brand.name))

// Whatever still names Rerun once rewritten is dropped with the line that says it.
const LEFTOVER = /rerun|discord/i

function namesRerun(text: string, brand: Brand): boolean {
    const app = ownApp(brand)
    return LEFTOVER.test((app ? text.replaceAll(appHost(app), '') : text).replaceAll(brand.name, ''))
}

const isRerunOnly = (text: string): boolean => RERUN_ONLY.some(pattern => pattern.test(text))

function rewritePart(part: string, brand: Brand): string {
    if (!part.trim() || isRerunOnly(part)) return ''
    const rewritten = rewriteProse(redirectContacts(rewriteLinks(part, brand), brand), brand)
    return namesRerun(rewritten, brand) ? '' : rewritten
}

// A row, an item, an aside or a heading goes with what it says; a paragraph only loses the sentence.
const WHOLE_LINE = /^\s*(?:>|\||[-*] |\d+\. |#)/
const SENTENCES = /(?<=[.!?](?:\*\*)?) (?=[A-Z*`[])/

function rewriteLine(line: string, brand: Brand): string | null {
    if (!line.trim()) return line
    if (RERUN_REQUEST.test(line)) return null
    const rewritten = (WHOLE_LINE.test(line) ? [line] : line.split(SENTENCES))
        .map(part => rewritePart(part, brand))
        .filter(part => part.trim())
        .join(' ')
    return rewritten || null
}

// One passage of the documentation as a client of the organization reads it: the brand's name, no
// address of Rerun, nothing about what Rerun sells, and help at the organization's. A fenced block is
// kept or dropped whole.
export function rewriteDocs(text: string, brand: Brand): string {
    const kept = text.split(/(^ *```[\s\S]*?^ *```[^\n]*$)/m).map(part => {
        if (/^ *```/.test(part)) {
            const code = rewriteCode(redirectContacts(rewriteLinks(part, brand), brand), brand)
            return isRerunOnly(part) || namesRerun(code, brand) ? '' : code
        }
        return part
            .split('\n')
            .map(line => rewriteLine(line, brand))
            .filter(line => line !== null)
            .join('\n')
    })
    return kept.join('').replace(/\n{3,}/g, '\n\n').trim()
}
