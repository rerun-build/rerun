import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, resolve } from 'node:path'
import { vi } from 'vitest'

process.env.RERUN_DATA_DIR = mkdtempSync(resolve(tmpdir(), 'rerun-browser-'))
process.env.RERUN_API_KEY = ''

type RouteHandler = (route: { request: () => { url: () => string; resourceType: () => string }; abort: (code?: string) => Promise<void>; continue: () => Promise<void> }) => Promise<void>

const dns = vi.hoisted(() => ({ lookups: [] as string[] }))

// Hosts in these tests are made up: they resolve to a public address, except the ones named private.
vi.mock('node:dns/promises', () => ({
    lookup: async (host: string) => {
        dns.lookups.push(host)
        return [{ address: host.startsWith('internal.') ? '10.0.0.7' : '93.184.216.34', family: 4 }]
    },
}))

type View = { html: string; body: string; links?: Array<{ href: string; text: string }> }
type PageScript = { status: number | null; views: View[]; documentStatuses: number[]; gotoError?: string; consentBanner: boolean; consentNavigates?: boolean }

const CLOUDFLARE: View = { html: '<html><head><title>Just a moment...</title></head></html>', body: 'Verifying you are human.' }

const pw = vi.hoisted(() => ({
    page: {} as PageScript,
    display: null as string | null,
    displayHolds: [] as string[],
    displayReleases: 0,
    desktop: false,
    launches: [] as Array<{ dir: string; options: Record<string, unknown> }>,
    launchErrors: [] as string[],
    gotos: [] as Array<{ url: string; options: unknown }>,
    screenshots: [] as Array<{ path: string; fullPage: boolean }>,
    routes: 0,
    routeHandler: null as RouteHandler | null,
    consentClicks: 0,
    open: 0,
    maxOpen: 0,
    closes: 0,
    closeError: false,
    joinable: null as (() => Promise<unknown>) | null,
    newPages: 0,
}))

vi.mock('../virtual-display.js', () => ({
    holdDisplay: async (agentId: string) => {
        pw.displayHolds.push(agentId)
        return {
            display: pw.display,
            release: () => {
                pw.displayReleases += 1
            },
        }
    },
}))
vi.mock('../../desktop/session.js', () => ({ desktopAvailable: () => pw.desktop }))
vi.mock('../../desktop/takeover.js', () => ({ joinableBrowser: () => pw.joinable?.() ?? null }))

vi.mock('patchright', () => ({
    chromium: {
        launchPersistentContext: async (dir: string, options: Record<string, unknown>) => {
            pw.launches.push({ dir, options })
            const launchError = pw.launchErrors.shift()
            if (launchError) throw new Error(launchError)
            pw.open += 1
            pw.maxOpen = Math.max(pw.maxOpen, pw.open)
            let view = 0
            const listeners: Array<(response: unknown) => void> = []
            const mainFrame = {}
            const current = () => pw.page.views[Math.min(view, pw.page.views.length - 1)]
            const consentButton = {
                isVisible: async () => pw.page.consentBanner,
                click: async () => {
                    pw.consentClicks += 1
                    if (pw.page.consentNavigates) view += 1
                },
            }
            const page = {
                on: (_event: string, listener: (response: unknown) => void) => listeners.push(listener),
                mainFrame: () => mainFrame,
                goto: async (url: string, gotoOptions: unknown) => {
                    pw.gotos.push({ url, options: gotoOptions })
                    await new Promise(r => setTimeout(r, 5))
                    if (pw.page.gotoError) throw new Error(pw.page.gotoError)
                    for (const status of pw.page.documentStatuses) {
                        listeners.forEach(listener => listener({ status: () => status, frame: () => mainFrame, request: () => ({ resourceType: () => 'document' }) }))
                    }
                    return pw.page.status === null ? null : { status: () => pw.page.status }
                },
                content: async () => current().html,
                url: () => pw.gotos.at(-1)?.url ?? 'about:blank',
                innerText: async () => current().body,
                $$eval: async () => current().links ?? [],
                waitForTimeout: async () => {
                    view += 1
                },
                waitForLoadState: async () => {},
                waitForEvent: async (_event: string, options: { predicate: (frame: unknown) => boolean }) => {
                    if (!pw.page.consentNavigates || !options.predicate(mainFrame)) throw new Error('Timeout 2000ms exceeded while waiting for event "framenavigated"')
                    return mainFrame
                },
                locator: () => ({ or: () => ({ first: () => consentButton }) }),
                getByRole: () => consentButton,
                screenshot: async (screenshotOptions: { path: string; fullPage: boolean }) => {
                    pw.screenshots.push(screenshotOptions)
                },
            }
            return {
                pages: () => [page],
                newPage: async () => {
                    pw.newPages += 1
                    return page
                },
                route: async (_pattern: string, handler: RouteHandler) => {
                    pw.routes += 1
                    pw.routeHandler = handler
                },
                close: async () => {
                    pw.open -= 1
                    pw.closes += 1
                    if (pw.closeError) throw new Error('already closed')
                },
            }
        },
    },
}))

const { beforeEach, describe, expect, it } = await import('vitest')
const { HostBreaker, BLOCKED_SOURCE_PREFIX } = await import('../host-breaker.js')
const { browserProfileDir, workspaceDir } = await import('../../config/paths.js')
const { browserTools, launchContext, publicRequestsOnly } = await import('./browser.js')
const { chromium } = await import('patchright')

const agentId = 'browsing-agent'

function ctxWith(id = agentId) {
    return { agent: { id, config: { tools: { browser: true }, ephemeral: false, kind: 'user' } }, sessionId: 's', logger: { warn() {} }, hostBreaker: new HostBreaker() } as any
}

// The line saying where the whole page is saved is asserted on its own, in the saved-page tests.
const withoutSavedLine = (text: string): string => text.replace(/\nSaved whole: [^\n]*/, '')

async function navigate(ctx: any, args: Record<string, unknown>): Promise<string> {
    return withoutSavedLine((await (browserTools(ctx).browser_navigate as any).execute({ timeoutMs: 30_000, ...args }, { toolCallId: 'c', messages: [] })) as string)
}

function showing(body: string, html = '<html></html>'): View[] {
    return [{ html, body }]
}

async function decide(handler: RouteHandler, url: string, resourceType: string): Promise<string> {
    let outcome = 'none'
    await handler({
        request: () => ({ url: () => url, resourceType: () => resourceType }),
        abort: async code => {
            outcome = code ? `abort:${code}` : 'abort'
        },
        continue: async () => {
            outcome = 'continue'
        },
    })
    return outcome
}

const verdict = (url: string, resourceType: string): Promise<string> => decide(pw.routeHandler!, url, resourceType)

beforeEach(() => {
    pw.page = { status: 200, views: showing(''), documentStatuses: [], consentBanner: false }
    pw.display = null
    pw.displayHolds.length = 0
    pw.displayReleases = 0
    pw.desktop = false
    pw.launches.length = 0
    pw.launchErrors.length = 0
    pw.gotos.length = 0
    pw.screenshots.length = 0
    pw.routes = 0
    pw.routeHandler = null
    pw.consentClicks = 0
    dns.lookups.length = 0
    pw.open = 0
    pw.maxOpen = 0
    pw.closes = 0
    pw.closeError = false
    pw.joinable = null
    pw.newPages = 0
})

describe('browser_navigate', () => {
    it('returns the status, the url and the visible text with blank runs collapsed', async () => {
        pw.page.views = showing('  Title   \n\n  Body line  \n  ')
        expect(await navigate(ctxWith(), { url: 'https://example.com/page' })).toBe('[200] https://example.com/page\n\nTitle\n  Body line')
        expect(pw.gotos).toEqual([{ url: 'https://example.com/page', options: { waitUntil: 'domcontentloaded', timeout: 30_000 } }])
        expect(pw.closes).toBe(1)
    })

    it('opens the agent profile so cookies outlive the call, and drops its caches afterwards', async () => {
        const profile = browserProfileDir(agentId)
        mkdirSync(resolve(profile, 'Default/Cache'), { recursive: true })
        writeFileSync(resolve(profile, 'Default/Cookies'), 'session')
        await navigate(ctxWith(), { url: 'https://example.com/' })
        expect(pw.launches[0].dir).toBe(profile)
        expect(existsSync(resolve(profile, 'Default/Cookies'))).toBe(true)
        expect(existsSync(resolve(profile, 'Default/Cache'))).toBe(false)
    })

    it('runs windowed on the display of its own agent, held for the length of the call', async () => {
        pw.display = ':7'
        await navigate(ctxWith('other-agent'), { url: 'https://example.com/' })
        expect(pw.launches[0].options).toMatchObject({ channel: 'chromium', headless: false, env: { DISPLAY: ':7' } })
        expect(pw.displayHolds).toEqual(['other-agent'])
        expect(pw.displayReleases).toBe(1)
    })

    it('releases the display when the navigation fails', async () => {
        pw.page.gotoError = 'net::ERR_NAME_NOT_RESOLVED'
        await navigate(ctxWith(), { url: 'https://example.com/' })
        expect(pw.displayReleases).toBe(1)
    })

    it('falls back to headless without a display', async () => {
        await navigate(ctxWith(), { url: 'https://example.com/' })
        expect(pw.launches[0].options).toMatchObject({ channel: 'chromium', headless: true })
        expect(pw.launches[0].options).not.toHaveProperty('env')
    })

    it('blocks images, media and fonts unless a screenshot is wanted', async () => {
        await navigate(ctxWith(), { url: 'https://example.com/' })
        expect(pw.routes).toBe(1)
        expect(await verdict('https://example.com/logo.png', 'image')).toBe('abort')
        expect(await verdict('https://example.com/app.js', 'script')).toBe('continue')
        await navigate(ctxWith(), { url: 'https://example.com/', screenshotPath: 'shot.png' })
        expect(pw.routes).toBe(2)
        expect(await verdict('https://example.com/logo.png', 'image')).toBe('continue')
    })

    it.each(['file:///etc/passwd', 'ftp://example.com/x', 'javascript:alert(1)'])('refuses %s in its schema, so the model is told before anything runs', url => {
        const schema = (browserTools(ctxWith()).browser_navigate as any).inputSchema
        const result = schema.safeParse({ url, timeoutMs: 1000 })
        expect(result.success).toBe(false)
        expect(JSON.stringify(result.error?.issues)).toContain('only http and https URLs on public hosts are accepted')
        expect(schema.safeParse({ url: 'https://example.com/', timeoutMs: 1000 }).success).toBe(true)
    })

    it.each(['file:///etc/passwd', 'http://127.0.0.1:8080/', 'http://169.254.169.254/latest/meta-data/', 'http://internal.example/admin'])('refuses %s before opening a browser, as a result the model reads', async url => {
        const out = await navigate(ctxWith(), { url })
        expect(out).toMatch(/^Navigation refused: .* is not a public host \(.*\), only http and https URLs on public hosts are accepted\.$/)
        expect(out).not.toContain('failed in this run')
        expect(pw.launches).toEqual([])
        expect(pw.gotos).toEqual([])
        expect(pw.displayHolds).toEqual([])
    })

    describe('requests of the browser', () => {
        it('aborts a request to a private host, a redirect or a sub-frame included, and lets public ones through', async () => {
            await navigate(ctxWith(), { url: 'https://example.com/' })
            expect(await verdict('http://10.0.0.5/latest/meta-data/', 'document')).toBe('abort:blockedbyclient')
            expect(await verdict('http://internal.example/', 'document')).toBe('abort:blockedbyclient')
            expect(await verdict('http://127.0.0.1:8080/frame', 'document')).toBe('abort:blockedbyclient')
            expect(await verdict('https://cdn.example.com/app.js', 'script')).toBe('continue')
        })

        it('aborts any scheme but http and https', async () => {
            await navigate(ctxWith(), { url: 'https://example.com/' })
            expect(await verdict('file:///etc/passwd', 'document')).toBe('abort:blockedbyclient')
            expect(await verdict('ftp://example.com/x', 'other')).toBe('abort:blockedbyclient')
        })

        it('resolves each hostname once for the life of the browser', async () => {
            await navigate(ctxWith(), { url: 'https://example.com/' })
            dns.lookups.length = 0
            await verdict('https://cdn.example.com/a.js', 'script')
            await verdict('https://cdn.example.com/b.js', 'script')
            await verdict('https://cdn.example.com/c.css', 'stylesheet')
            expect(dns.lookups).toEqual(['cdn.example.com'])
        })

        it('guards a window opened for a person the same way, assets included', async () => {
            await launchContext('some-profile', ':9', { viewport: null })
            expect(pw.routes).toBe(1)
            expect(await verdict('http://192.168.1.1/', 'document')).toBe('abort:blockedbyclient')
            expect(await verdict('https://example.com/logo.png', 'image')).toBe('continue')
        })

        it('is the handler a context gets, usable on its own', async () => {
            const handler = publicRequestsOnly({ blockHeavyResources: true })
            expect(await decide(handler, 'https://example.com/logo.png', 'image')).toBe('abort')
            expect(await decide(handler, 'http://[::1]/', 'document')).toBe('abort:blockedbyclient')
        })
    })

    it('caps the text at 50k characters', async () => {
        pw.page.views = showing('z'.repeat(80_000))
        const out = await navigate(ctxWith(), { url: 'https://example.com/' })
        expect(out).toBe(`[200] https://example.com/\n\n${'z'.repeat(50_000)}`)
    })

    it('waits out a challenge and reports the status of the page it lands on', async () => {
        pw.page.status = 403
        pw.page.documentStatuses = [403, 200]
        pw.page.views = [CLOUDFLARE, CLOUDFLARE, { html: '<html></html>', body: 'Job listings' }]
        expect(await navigate(ctxWith(), { url: 'https://jobs.example/' })).toBe('[200] https://jobs.example/\n\nJob listings')
    })

    it('reports a challenge that never clears as a block the breaker counts', async () => {
        pw.page.status = 403
        pw.page.views = [CLOUDFLARE]
        const out = await navigate(ctxWith(), { url: 'https://walled.example/' })
        expect(out).toBe('[403] https://walled.example/\n\nBlocked by Cloudflare bot protection, so this page cannot be read from here. Use another source.\n\n[attempt 1/3 on walled.example failed in this run]')
    })

    it('points at request_takeover when a person can clear the block from the desktop', async () => {
        pw.desktop = true
        pw.page.status = 403
        pw.page.views = [CLOUDFLARE]
        const out = await navigate(ctxWith(), { url: 'https://walled.example/' })
        expect(out).toContain('call request_takeover with this URL')
        expect(out).not.toContain('Use another source.')
    })

    it('does not wait on a block that no amount of time clears', async () => {
        pw.page.status = 403
        pw.page.views = [{ html: '', body: "You've been blocked by network security." }, { html: '', body: 'never reached' }]
        expect(await navigate(ctxWith(), { url: 'https://www.reddit.com/r/startups/' })).toContain('Blocked by Reddit bot protection')
    })

    it('counts a block served with a 200 as a failure too', async () => {
        pw.page.views = [{ html: '<iframe src="https://geo.captcha-delivery.com/captcha/"></iframe>', body: '' }]
        expect(await navigate(ctxWith(), { url: 'https://dd.example/' })).toContain('[attempt 1/3 on dd.example failed in this run]')
    })

    it('does not mistake a long page that embeds a bot vendor for a block', async () => {
        pw.page.views = showing('listing '.repeat(1_000), '<script src="https://js.captcha-delivery.com/tags.js"></script>')
        const out = await navigate(ctxWith(), { url: 'https://ads.example/' })
        expect(out).not.toContain('Blocked by')
        expect(out).not.toContain('failed in this run')
    })

    it('accepts a cookie banner before reading the page', async () => {
        pw.page.consentBanner = true
        pw.page.views = showing('Results')
        expect(await navigate(ctxWith(), { url: 'https://example.com/' })).toBe('[200] https://example.com/\n\nResults')
        expect(pw.consentClicks).toBe(1)
    })

    it('reads the page a consent wall navigates to once accepted', async () => {
        pw.page.consentBanner = true
        pw.page.consentNavigates = true
        pw.page.views = [{ html: '', body: 'Before you continue to YouTube' }, { html: '', body: 'NASA channel' }]
        expect(await navigate(ctxWith(), { url: 'https://www.youtube.com/@NASA' })).toBe('[200] https://www.youtube.com/@NASA\n\nNASA channel')
    })

    it('runs the calls of one agent one browser at a time, and different agents side by side', async () => {
        await Promise.all([navigate(ctxWith(), { url: 'https://a.example/' }), navigate(ctxWith(), { url: 'https://b.example/' })])
        expect(pw.maxOpen).toBe(1)
        pw.maxOpen = 0
        await Promise.all([navigate(ctxWith('agent-one'), { url: 'https://a.example/' }), navigate(ctxWith('agent-two'), { url: 'https://b.example/' })])
        expect(pw.maxOpen).toBe(2)
    })

    it('clears a lock left by a killed browser and launches again', async () => {
        pw.launchErrors = ['Failed to create a ProcessSingleton for your profile directory']
        pw.page.views = showing('ok')
        expect(await navigate(ctxWith(), { url: 'https://example.com/' })).toBe('[200] https://example.com/\n\nok')
        expect(pw.launches).toHaveLength(2)
    })

    it('lists the links of the page when asked, once each and only web addresses', async () => {
        pw.page.views = [
            {
                html: '<html></html>',
                body: 'Results',
                links: [
                    { href: 'https://www.tiktok.com/@chenny/photo/766', text: '  How to set up\n your first Meta ad ' },
                    { href: 'https://www.tiktok.com/@chenny/photo/766', text: 'duplicate' },
                    { href: 'javascript:void(0)', text: 'Log in' },
                    { href: 'https://www.tiktok.com/@alex/photo/760', text: '' },
                ],
            },
        ]
        const out = await navigate(ctxWith(), { url: 'https://www.tiktok.com/search/photo?q=ads', links: true })
        expect(out).toBe('[200] https://www.tiktok.com/search/photo?q=ads\n\nResults\n\nLinks:\n- How to set up your first Meta ad — https://www.tiktok.com/@chenny/photo/766\n- https://www.tiktok.com/@alex/photo/760')
    })

    it('caps the links it lists', async () => {
        pw.page.views = [{ html: '<html></html>', body: 'Many', links: Array.from({ length: 400 }, (_, i) => ({ href: `https://example.com/${i}`, text: `Item ${i}` })) }]
        const out = await navigate(ctxWith(), { url: 'https://example.com/', links: true })
        expect(out.split('\n').filter(line => line.startsWith('- '))).toHaveLength(300)
    })

    it('lists no links unless asked, nor behind a bot wall', async () => {
        pw.page.views = [{ html: '<html></html>', body: 'Results', links: [{ href: 'https://example.com/a', text: 'A' }] }]
        expect(await navigate(ctxWith(), { url: 'https://example.com/' })).toBe('[200] https://example.com/\n\nResults')
        pw.page.status = 403
        pw.page.views = [{ ...CLOUDFLARE, links: [{ href: 'https://walled.example/a', text: 'A' }] }]
        expect(await navigate(ctxWith(), { url: 'https://walled.example/', links: true })).not.toContain('Links:')
    })

    it('keeps the rendered HTML in the workspace and says where, right under the status', async () => {
        pw.page.views = showing('Pricing', '<html><body><nav><a href="/compare">Compare</a></nav>Pricing</body></html>')

        const out = (await (browserTools(ctxWith()).browser_navigate as any).execute({ url: 'https://render.example/pricing', timeoutMs: 30_000 }, { toolCallId: 'c', messages: [] })) as string

        expect(out.split('\n').slice(0, 2)).toEqual(['[200] https://render.example/pricing', 'Saved whole: .rerun/pages/render.example/pricing.browser.html (the rendered HTML: read or grep it for anything this text leaves out)'])
        expect(readFileSync(resolve(workspaceDir(agentId), '.rerun/pages/render.example/pricing.browser.html'), 'utf8')).toBe('<html><body><nav><a href="/compare">Compare</a></nav>Pricing</body></html>')
    })

    it('saves no page behind a bot wall', async () => {
        pw.page.views = [CLOUDFLARE]

        const out = (await (browserTools(ctxWith()).browser_navigate as any).execute({ url: 'https://walled.example/', timeoutMs: 1000 }, { toolCallId: 'c', messages: [] })) as string

        expect(out).not.toContain('Saved whole')
    })

    it('saves a full-page screenshot inside the workspace and says where', async () => {
        pw.page.views = showing('hi')
        const out = await navigate(ctxWith(), { url: 'https://example.com/', screenshotPath: 'shots/home.png' })
        const target = resolve(workspaceDir(agentId), 'shots/home.png')
        expect(out).toBe('[200] https://example.com/\n\nhi\n\n[screenshot saved to shots/home.png]')
        expect(pw.screenshots).toEqual([{ path: target, fullPage: true }])
        expect(existsSync(dirname(target))).toBe(true)
    })

    it('refuses a screenshot outside the workspace and still closes the browser', async () => {
        const out = await navigate(ctxWith(), { url: 'https://example.com/', screenshotPath: '../../escape.png' })
        expect(out).toMatch(/^Navigation failed: /)
        expect(pw.screenshots).toHaveLength(0)
        expect(pw.closes).toBe(1)
    })

    it('reports a navigation error and closes the browser even when close fails', async () => {
        pw.page.gotoError = 'net::ERR_NAME_NOT_RESOLVED'
        pw.closeError = true
        expect(await navigate(ctxWith(), { url: 'https://nowhere.example/' })).toBe('Navigation failed: net::ERR_NAME_NOT_RESOLVED\n\n[attempt 1/3 on nowhere.example failed in this run]')
        expect(pw.closes).toBe(1)
    })

    it('reads a page without a response as status 0 and not as a failure', async () => {
        pw.page.status = null
        pw.page.views = showing('cached')
        expect(await navigate(ctxWith(), { url: 'https://example.com/' })).toBe('[0] https://example.com/\n\ncached')
    })

    it('closes a host after three refusals and stops launching a browser for it', async () => {
        pw.page.status = 403
        const ctx = ctxWith()
        expect(await navigate(ctx, { url: 'https://www.blocked.example/a' })).toContain('[attempt 1/3 on blocked.example failed in this run]')
        expect(await navigate(ctx, { url: 'https://blocked.example/b' })).toContain('[attempt 2/3 on blocked.example failed in this run]')
        expect(await navigate(ctx, { url: 'https://blocked.example/c' })).toContain(`${BLOCKED_SOURCE_PREFIX} blocked.example`)
        expect(await navigate(ctx, { url: 'https://blocked.example/d' })).toMatch(new RegExp(`^${BLOCKED_SOURCE_PREFIX} blocked.example`))
        expect(pw.launches).toHaveLength(3)
    })

    it('resets the count once the host answers again', async () => {
        const ctx = ctxWith()
        pw.page.status = 500
        await navigate(ctx, { url: 'https://flaky.example/' })
        await navigate(ctx, { url: 'https://flaky.example/' })
        pw.page.status = 200
        expect(await navigate(ctx, { url: 'https://flaky.example/' })).toBe('[200] https://flaky.example/\n\n')
        pw.page.status = 500
        expect(await navigate(ctx, { url: 'https://flaky.example/' })).toContain('[attempt 1/3 on flaky.example failed in this run]')
    })

    it('keeps its own breaker when the run has none', async () => {
        pw.page.status = 429
        const tools = browserTools({ agent: { id: agentId } } as any)
        for (let i = 0; i < 3; i++) await (tools.browser_navigate as any).execute({ url: 'https://rate.example/', timeoutMs: 1000 }, {})
        expect(await (tools.browser_navigate as any).execute({ url: 'https://rate.example/', timeoutMs: 1000 }, {})).toMatch(new RegExp(`^${BLOCKED_SOURCE_PREFIX}`))
        expect(pw.launches).toHaveLength(3)
    })

    describe('with a browser already open on the screen', () => {
        async function openWindow() {
            const context = await chromium.launchPersistentContext('open-profile', {})
            pw.launches.length = 0
            return context
        }

        it('refuses a private host without opening a tab in that window', async () => {
            const context = await openWindow()
            pw.joinable = async () => context
            expect(await navigate(ctxWith(), { url: 'http://127.0.0.1:3000/' })).toMatch(/^Navigation refused: 127\.0\.0\.1:3000 is not a public host/)
            expect(pw.newPages).toBe(0)
            expect(pw.gotos).toEqual([])
        })

        it('reads the page in a new tab of that window and leaves the window as it is', async () => {
            const context = await openWindow()
            pw.joinable = async () => context
            pw.page.views = showing('Dashboard')
            expect(await navigate(ctxWith(), { url: 'https://app.example/' })).toBe('[200] https://app.example/\n\nDashboard')
            expect(pw.newPages).toBe(1)
            expect(pw.launches).toEqual([])
            expect(pw.routes).toBe(0)
            expect(pw.closes).toBe(0)
            expect(pw.displayHolds).toEqual([])
        })

        it('reports a tab that could not load without touching the window', async () => {
            const context = await openWindow()
            pw.joinable = async () => context
            pw.page.gotoError = 'net::ERR_NAME_NOT_RESOLVED'
            expect(await navigate(ctxWith(), { url: 'https://nowhere.example/' })).toContain('Navigation failed: net::ERR_NAME_NOT_RESOLVED')
            expect(pw.closes).toBe(0)
        })

        it('opens a browser of its own when that window is on its way out', async () => {
            pw.joinable = async () => null
            pw.page.views = showing('Fresh')
            expect(await navigate(ctxWith(), { url: 'https://example.com/' })).toContain('Fresh')
            expect(pw.launches).toHaveLength(1)
            expect(pw.closes).toBe(1)
        })
    })
})
