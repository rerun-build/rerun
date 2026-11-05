import { mkdir, rm } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { chromium, type BrowserContext, type Page } from 'patchright'
import { tool, type ToolSet } from 'ai'
import { z } from 'zod'
import { resolveInWorkspace } from '../sandbox.js'
import { HostBreaker, hostOf, isFailureStatus, withHostBreaker, type HostAttempt } from '../host-breaker.js'
import { detectBotWall, type BotWall } from '../bot-wall.js'
import { holdDisplay, type DisplayHold } from '../virtual-display.js'
import { offersTakeover } from './hitl.js'
import { browserProfileDir } from '../../config/paths.js'
import { withKeyedLock } from '../../lib/lock.js'
import { NonPublicHostError, assertPublicUrl, isHttpUrl, resolvesToPublicAddresses } from '../../lib/public-fetch.js'
import { PUBLIC_HTTP_URL_MESSAGE, publicHttpUrl } from '../url.js'
import type { RunContext } from '../../runtime/context.js'
import { joinableBrowser } from '../../desktop/takeover.js'
import { savePage } from './page-file.js'

const TEXT_LIMIT = 50_000
const LINKS_LIMIT = 300
const LINK_TEXT_LIMIT = 80
const CHALLENGE_POLL_MS = 1_000
const CHALLENGE_MAX_WAIT_MS = 15_000
const RENDER_SETTLE_MS = 5_000
const CONSENT_TIMEOUT_MS = 2_000
const BLOCKED_RESOURCE_TYPES = new Set(['image', 'media', 'font'])
const PROFILE_LOCK_FILES = ['SingletonLock', 'SingletonCookie', 'SingletonSocket']
// Only cookies, consents and storage are worth keeping between calls; the caches would grow every
// agent's profile by tens of MB on boxes whose disk is already short.
const PROFILE_CACHE_DIRS = ['Default/Cache', 'Default/Code Cache', 'Default/GPUCache', 'Default/DawnWebGPUCache', 'Default/DawnGraphiteCache', 'Default/Service Worker/CacheStorage', 'BrowserMetrics']
const PROFILE_IN_USE = /ProcessSingleton|profile appears to be in use/i

const CONSENT_SELECTORS = [
    '#L2AGLb',
    'form[action^="https://consent."] button[aria-label^="Accept"]',
    '#onetrust-accept-btn-handler',
    '#didomi-notice-agree-button',
    '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',
    '#axeptio_btn_acceptAll',
    '.qc-cmp2-summary-buttons button[mode="primary"]',
].join(', ')
const CONSENT_BUTTON_NAME = /^(accept all|accept|allow all|i agree|agree|tout accepter|accepter|alle akzeptieren|aceptar todo)$/i

type LaunchOptions = NonNullable<Parameters<typeof chromium.launchPersistentContext>[1]>
type RouteHandler = Parameters<BrowserContext['route']>[1]
type ContextGuards = { blockHeavyResources?: boolean }

// Every request of the context, main document, redirect hop, sub-frame or asset, goes to a public
// host over http(s), judged by where its name resolves. One verdict per hostname for the life of the context.
export function publicRequestsOnly({ blockHeavyResources = false }: ContextGuards = {}): RouteHandler {
    const verdicts = new Map<string, Promise<boolean>>()
    const allowed = (hostname: string): Promise<boolean> => {
        const known = verdicts.get(hostname)
        if (known) return known
        const verdict = resolvesToPublicAddresses(hostname)
        verdicts.set(hostname, verdict)
        return verdict
    }
    return async route => {
        const request = route.request()
        const url = request.url()
        if (!isHttpUrl(url) || !(await allowed(new URL(url).hostname))) return route.abort('blockedbyclient')
        if (blockHeavyResources && BLOCKED_RESOURCE_TYPES.has(request.resourceType())) return route.abort()
        return route.continue()
    }
}

async function launchPersistentContext(profileDir: string, options: LaunchOptions): Promise<BrowserContext> {
    try {
        return await chromium.launchPersistentContext(profileDir, options)
    } catch (e) {
        // A Chromium killed with the engine leaves its lock behind; calls of one agent are serialized,
        // so nothing else on this box can be holding the profile.
        if (!PROFILE_IN_USE.test((e as Error).message)) throw e
        await Promise.all(PROFILE_LOCK_FILES.map(name => rm(resolve(profileDir, name), { force: true })))
        return chromium.launchPersistentContext(profileDir, options)
    }
}

export async function launchContext(profileDir: string, display: string | null, extra: LaunchOptions = {}, guards: ContextGuards = {}): Promise<BrowserContext> {
    const options: LaunchOptions = {
        channel: 'chromium',
        headless: !display,
        ...(display ? { env: { ...process.env, DISPLAY: display } } : {}),
        ...extra,
    }
    await mkdir(profileDir, { recursive: true })
    const context = await launchPersistentContext(profileDir, options)
    await context.route('**/*', publicRequestsOnly(guards))
    return context
}

export async function dropProfileCaches(agentId: string): Promise<void> {
    await Promise.all(PROFILE_CACHE_DIRS.map(dir => rm(resolve(browserProfileDir(agentId), dir), { recursive: true, force: true })))
}

// undefined while the page is mid-navigation (a challenge redirecting to the real page).
async function currentBotWall(page: Page): Promise<BotWall | null | undefined> {
    try {
        const [html, text] = await Promise.all([page.content(), page.innerText('body')])
        return detectBotWall({ html, text })
    } catch {
        return undefined
    }
}

async function waitOutBotWall(page: Page, timeoutMs: number): Promise<BotWall | null> {
    const polls = Math.floor(Math.min(CHALLENGE_MAX_WAIT_MS, timeoutMs / 2) / CHALLENGE_POLL_MS)
    let wall = await currentBotWall(page)
    for (let i = 0; i < polls && wall !== null && wall?.clearsByItself !== false; i++) {
        await page.waitForTimeout(CHALLENGE_POLL_MS)
        wall = await currentBotWall(page)
    }
    return wall ?? null
}

// Some consent walls (YouTube, Google) submit a form and navigate to the real page: the text is
// only worth reading once that page has loaded.
async function acceptCookieBanner(page: Page, timeoutMs: number): Promise<boolean> {
    const button = page.locator(CONSENT_SELECTORS).or(page.getByRole('button', { name: CONSENT_BUTTON_NAME })).first()
    try {
        if (!(await button.isVisible())) return false
        const navigated = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame(), timeout: CONSENT_TIMEOUT_MS }).catch(() => null)
        await button.click({ timeout: CONSENT_TIMEOUT_MS })
        if (await navigated) await page.waitForLoadState('domcontentloaded', { timeout: timeoutMs })
        return true
    } catch {
        return false
    }
}

async function settle(page: Page): Promise<void> {
    await page.waitForLoadState('networkidle', { timeout: RENDER_SETTLE_MS }).catch(() => {})
}

type Visit = { url: string; screenshotPath?: string; links?: boolean; timeoutMs: number }

async function readLinks(page: Page): Promise<string> {
    const anchors = await page.$$eval('a[href]', elements => elements.map(a => ({ href: (a as HTMLAnchorElement).href, text: (a as HTMLElement).innerText ?? '' })))
    const seen = new Set<string>()
    const lines: string[] = []
    for (const { href, text } of anchors) {
        if (!/^https?:\/\//.test(href) || seen.has(href)) continue
        seen.add(href)
        const label = text.replace(/\s+/g, ' ').trim().slice(0, LINK_TEXT_LIMIT)
        lines.push(label ? `- ${label} — ${href}` : `- ${href}`)
        if (lines.length === LINKS_LIMIT) break
    }
    return `\n\nLinks:\n${lines.length ? lines.join('\n') : 'none'}`
}

async function readPage(ctx: RunContext, page: Page, { url, screenshotPath, links, timeoutMs }: Visit): Promise<HostAttempt> {
    let documentStatus: number | undefined
    page.on('response', response => {
        if (response.request().resourceType() === 'document' && response.frame() === page.mainFrame()) documentStatus = response.status()
    })
    const response = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: timeoutMs })
    const wall = await waitOutBotWall(page, timeoutMs)
    if (!wall) {
        await settle(page)
        if (await acceptCookieBanner(page, timeoutMs)) await settle(page)
    }
    const status = documentStatus ?? response?.status() ?? 0
    const body = wall
        ? `Blocked by ${wall.provider} bot protection, so this page cannot be read from here. ${offersTakeover(ctx.agent.config) ? 'If the user can get past it by hand, call request_takeover with this URL; otherwise use another source.' : 'Use another source.'}`
        : (await page.innerText('body')).replace(/\s+\n/g, '\n').trim().slice(0, TEXT_LIMIT)
    const linkList = links && !wall ? await readLinks(page) : ''
    const html = wall ? null : await page.content().catch(() => null)
    const saved = html === null ? null : await savePage(ctx.agent.id, { url, view: 'browser', body: html, ext: 'html', status, finalUrl: page.url() })
    let note = ''
    if (screenshotPath) {
        const target = await resolveInWorkspace(ctx.agent.id, screenshotPath)
        await mkdir(dirname(target), { recursive: true })
        await page.screenshot({ path: target, fullPage: true })
        note = `\n\n[screenshot saved to ${screenshotPath}]`
    }
    const savedLine = saved ? `\nSaved whole: ${saved} (the rendered HTML: read or grep it for anything this text leaves out)` : ''
    return { text: `[${status}] ${url}${savedLine}\n\n${body}${linkList}${note}`, failed: !!wall || isFailureStatus(status) }
}

const navigationFailed = (e: unknown): HostAttempt => ({ text: `Navigation failed: ${(e as Error).message}`, failed: true })
const navigationRefused = (e: NonPublicHostError, url: string): HostAttempt => ({ text: `Navigation refused: ${e.message} (${url}), ${PUBLIC_HTTP_URL_MESSAGE}.`, failed: false })

// The tab stays open and loads everything: it is on the screen the agent and a person look at.
async function readInOpenBrowser(ctx: RunContext, context: BrowserContext, visit: Visit): Promise<HostAttempt> {
    try {
        return await readPage(ctx, await context.newPage(), visit)
    } catch (e) {
        return navigationFailed(e)
    }
}

export function browserTools(ctx: RunContext): ToolSet {
    const id = ctx.agent.id
    const breaker = ctx.hostBreaker ?? new HostBreaker()
    return {
        browser_navigate: tool({
            description: 'Open a URL in a real Chromium browser, wait for it to render (including JavaScript and bot-protection challenges, cookie banners accepted), and return the visible text, plus the links on the page when you ask for them. Cookies persist between your calls. Use this instead of web_fetch for pages that need JS to load or that block simple requests. Optionally save a screenshot into your workspace to inspect later with vision_analyze.',
            inputSchema: z.object({
                url: publicHttpUrl,
                screenshotPath: z.string().optional().describe('Workspace-relative path to save a full-page PNG screenshot'),
                links: z.boolean().default(false).describe('Also list the links on the page (text and URL), e.g. to open the results of a search'),
                timeoutMs: z.number().int().positive().max(120_000).default(30_000),
            }),
            execute: async (visit: Visit) => {
                const host = hostOf(visit.url)
                return withHostBreaker(breaker, host ? [host] : [], async (): Promise<HostAttempt> => {
                    try {
                        await assertPublicUrl(visit.url)
                    } catch (e) {
                        if (e instanceof NonPublicHostError) return navigationRefused(e, visit.url)
                        throw e
                    }
                    // Nothing is awaited when there is no window to join, so the lock below is
                    // taken before a session opening right now can take it and be missed.
                    const joining = joinableBrowser(id)
                    const open = joining && (await joining)
                    if (open) return readInOpenBrowser(ctx, open, visit)
                    return withKeyedLock(`browser:${id}`, async (): Promise<HostAttempt> => {
                        let context: BrowserContext | undefined
                        let screen: DisplayHold | undefined
                        try {
                            screen = await holdDisplay(id)
                            context = await launchContext(browserProfileDir(id), screen.display, {}, { blockHeavyResources: !visit.screenshotPath })
                            return await readPage(ctx, context.pages()[0] ?? (await context.newPage()), visit)
                        } catch (e) {
                            return navigationFailed(e)
                        } finally {
                            await context?.close().catch(() => {})
                            screen?.release()
                            await dropProfileCaches(id)
                        }
                    })
                })
            },
        }),
    }
}
