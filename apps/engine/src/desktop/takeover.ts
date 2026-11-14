import type { BrowserContext } from 'patchright'
import type { TakeoverResult } from '@rerun/contracts'
import { browserProfileDir } from '../config/paths.js'
import { withKeyedLock } from '../lib/lock.js'
import { logger } from '../lib/logger.js'
import { assertPublicUrl } from '../lib/public-fetch.js'
import { dropProfileCaches, launchContext } from '../tools/builtin/browser.js'
import { ensureDesktop, holdDesktop, viewersOf } from './session.js'

const MAX_TAKEOVER_MS = 15 * 60_000
const OPEN_TIMEOUT_MS = 30_000
const UNWATCHED_CHECK_MS = 30_000
const UNWATCHED_CHECKS_BEFORE_CLOSE = 2
const HANDBACK_GRACE_MS = 3 * 60_000

type Takeover = {
    finish: () => void
    closed: Promise<TakeoverResult>
    ready: Promise<void>
    context: BrowserContext | null
    endWhenUnwatched: boolean
    keptUntil: number
    rearmExpiry: () => void
    runHolds: number
    expired: boolean
    closing: boolean
}
export type TakeoverOptions = { endWhenUnwatched?: boolean }

const active = new Map<string, Takeover>()

function lastUrl(context: BrowserContext): string | null {
    const url = context.pages().at(-1)?.url()
    return url && url !== 'about:blank' ? url : null
}

async function openable(url: string): Promise<boolean> {
    try {
        await assertPublicUrl(url)
        return true
    } catch (err) {
        logger.warn({ err: String(err), url }, 'takeover refused to open the page')
        return false
    }
}

export async function startTakeover(agentId: string, url?: string, { endWhenUnwatched = false }: TakeoverOptions = {}): Promise<void> {
    const open = () => joinActive(agentId, url, endWhenUnwatched)
    const already = open()
    if (already) return already
    const { display } = await ensureDesktop(agentId)
    const meanwhile = open()
    if (meanwhile) return meanwhile
    const release = holdDesktop(agentId)
    let finished!: () => void
    const finishing = new Promise<void>(done => (finished = done))
    const finish = () => {
        takeover.closing = true
        finished()
    }
    let opened!: () => void
    let failed!: (err: unknown) => void
    const ready = new Promise<void>((resolve, reject) => {
        opened = resolve
        failed = reject
    })

    const takeover: Takeover = { finish, closed: Promise.resolve({ url: null }), ready, context: null, endWhenUnwatched, keptUntil: 0, rearmExpiry: () => {}, runHolds: 0, expired: false, closing: false }
    takeover.closed = withKeyedLock(`browser:${agentId}`, async (): Promise<TakeoverResult> => {
        let context: BrowserContext | undefined
        let timer: NodeJS.Timeout | undefined
        let watch: NodeJS.Timeout | undefined
        let unwatchedChecks = 0
        try {
            context = await launchContext(browserProfileDir(agentId), display, { viewport: null, args: ['--start-maximized'] })
            context.once('close', finish)
            const page = context.pages()[0] ?? (await context.newPage())
            if (url && (await openable(url))) await page.goto(url, { waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS }).catch(() => {})
            takeover.context = context
            takeover.rearmExpiry = () => {
                clearTimeout(timer)
                takeover.expired = false
                timer = setTimeout(() => {
                    takeover.expired = true
                    if (takeover.runHolds === 0) finish()
                }, MAX_TAKEOVER_MS)
            }
            takeover.rearmExpiry()
            opened()
            watch = setInterval(() => {
                const unwatched = takeover.endWhenUnwatched && takeover.runHolds === 0 && Date.now() >= takeover.keptUntil && viewersOf(agentId) === 0
                unwatchedChecks = unwatched ? unwatchedChecks + 1 : 0
                if (unwatchedChecks >= UNWATCHED_CHECKS_BEFORE_CLOSE) finish()
            }, UNWATCHED_CHECK_MS)
            await finishing
            return { url: lastUrl(context) }
        } catch (err) {
            takeover.closing = true
            failed(err)
            return { url: null }
        } finally {
            clearTimeout(timer)
            clearInterval(watch)
            await context?.close().catch(() => {})
            await dropProfileCaches(agentId).catch(() => {})
            if (active.get(agentId) === takeover) active.delete(agentId)
            release()
        }
    })
    active.set(agentId, takeover)
    takeover.closed.catch(err => logger.warn({ err: String(err), agentId }, 'takeover ended with an error'))
    await ready
}

function joinActive(agentId: string, url: string | undefined, endWhenUnwatched: boolean): Promise<void> | null {
    const takeover = active.get(agentId)
    if (!takeover || takeover.closing) return null
    if (!endWhenUnwatched) takeover.endWhenUnwatched = false
    const context = takeover.context
    if (!url || !context) return Promise.resolve()
    return openable(url)
        .then(async ok => {
            if (ok) await context.newPage().then(page => page.goto(url, { waitUntil: 'domcontentloaded', timeout: OPEN_TIMEOUT_MS }))
        })
        .catch(() => {})
}

export async function finishTakeover(agentId: string): Promise<TakeoverResult> {
    const takeover = active.get(agentId)
    if (!takeover) return { url: null }
    takeover.finish()
    return takeover.closed
}

export async function handBackTakeover(agentId: string): Promise<TakeoverResult> {
    const takeover = active.get(agentId)
    const context = takeover && !takeover.closing ? takeover.context : null
    const url = context && lastUrl(context)
    if (!takeover || !url) return finishTakeover(agentId)
    takeover.endWhenUnwatched = true
    takeover.keptUntil = Date.now() + HANDBACK_GRACE_MS
    takeover.rearmExpiry()
    return { url, open: true }
}

export async function holdBrowser(agentId: string, url?: string): Promise<() => void> {
    await startTakeover(agentId, url, { endWhenUnwatched: true })
    return holdOpenBrowser(agentId)
}

export function holdOpenBrowser(agentId: string): () => void {
    const takeover = active.get(agentId)
    if (!takeover || takeover.closing) return () => {}
    takeover.runHolds++
    let released = false
    return () => {
        if (released) return
        released = true
        takeover.runHolds--
        if (takeover.runHolds > 0) return
        if (takeover.expired || (takeover.endWhenUnwatched && viewersOf(agentId) === 0)) takeover.finish()
    }
}

export function joinableBrowser(agentId: string): Promise<BrowserContext | null> | null {
    const takeover = active.get(agentId)
    if (!takeover || takeover.closing) return null
    return takeover.ready.then(
        () => (takeover.closing ? null : takeover.context),
        () => null,
    )
}

export const activeTakeovers = (): string[] => [...active.keys()]
