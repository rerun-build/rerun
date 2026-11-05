import { EventEmitter } from 'node:events'
import { vi } from 'vitest'

process.env.RERUN_API_KEY = ''

// Hosts in these tests are made up: they resolve to a public address, except the ones named private.
vi.mock('node:dns/promises', () => ({
    lookup: async (host: string) => [{ address: host.startsWith('internal.') ? '10.0.0.7' : '93.184.216.34', family: 4 }],
}))

type FakeContext = EventEmitter & { pages: () => Array<{ url: () => string; goto: (url: string) => Promise<void> }>; newPage: () => Promise<unknown>; close: () => Promise<void>; closed: boolean }

const state = vi.hoisted(() => ({
    launches: [] as Array<{ dir: string; display: string | null; extra: Record<string, unknown> }>,
    contexts: [] as unknown[],
    url: 'about:blank',
    launchError: null as Error | null,
    holds: 0,
    desktops: [] as string[],
    desktopGate: null as Promise<void> | null,
    cachesDropped: [] as string[],
    viewers: 0,
    onGoto: null as ((context: unknown) => void) | null,
    beforeLaunch: null as (() => void) | null,
}))

vi.mock('../tools/builtin/browser.js', () => ({
    launchContext: async (dir: string, display: string | null, extra: Record<string, unknown>) => {
        state.launches.push({ dir, display, extra })
        state.beforeLaunch?.()
        if (state.launchError) throw state.launchError
        const page = {
            url: () => state.url,
            goto: async (url: string) => {
                state.url = url
                state.onGoto?.(context)
            },
        }
        const context: FakeContext = Object.assign(new EventEmitter(), { closed: false, pages: () => [page], newPage: async () => page }) as FakeContext
        context.close = async () => {
            context.closed = true
        }
        state.contexts.push(context)
        return context
    },
    dropProfileCaches: async (id: string) => {
        state.cachesDropped.push(id)
    },
}))

vi.mock('./session.js', () => ({
    ensureDesktop: async (agentId: string) => {
        if (state.desktopGate) await state.desktopGate
        state.desktops.push(agentId)
        return { display: ':42', vncPort: 5942 }
    },
    viewersOf: () => state.viewers,
    holdDesktop: () => {
        state.holds++
        return () => {
            state.holds--
        }
    },
}))
vi.mock('../lib/logger.js', () => ({ logger: { info() {}, warn() {} } }))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { withKeyedLock } = await import('../lib/lock.js')
const { activeTakeovers, finishTakeover, holdBrowser, joinableBrowser, startTakeover } = await import('./takeover.js')

const contexts = () => state.contexts as FakeContext[]

beforeEach(() => {
    state.launches.length = 0
    state.contexts.length = 0
    state.url = 'about:blank'
    state.launchError = null
    state.holds = 0
    state.desktops.length = 0
    state.desktopGate = null
    state.cachesDropped.length = 0
    state.viewers = 0
    state.onGoto = null
    state.beforeLaunch = null
})

afterEach(async () => {
    for (const id of activeTakeovers()) await finishTakeover(id)
    vi.useRealTimers()
})

describe('takeover', () => {
    it.each(['file:///etc/passwd', 'http://127.0.0.1:8080/', 'http://internal.example/', 'http://169.254.169.254/'])('opens the window on nothing rather than on %s', async url => {
        await startTakeover('a1', url)
        expect(state.launches).toHaveLength(1)
        expect(state.url).toBe('about:blank')
        expect(activeTakeovers()).toEqual(['a1'])
    })

    it('does not open a tab on a private host in a window already open', async () => {
        await startTakeover('a1', 'https://site.example/login')
        await startTakeover('a1', 'http://10.0.0.5/admin')
        expect(state.url).toBe('https://site.example/login')
    })

    it('opens the agent profile in a real window on the page, and reports where the person ended up', async () => {
        await startTakeover('a1', 'https://site.example/login')
        expect(state.launches).toHaveLength(1)
        expect(state.launches[0]!.dir).toMatch(/agents\/a1\/browser-profile$/)
        expect(state.desktops).toEqual(['a1'])
        expect(state.launches[0]!.display).toBe(':42')
        expect(state.launches[0]!.extra).toMatchObject({ viewport: null })
        expect(activeTakeovers()).toEqual(['a1'])
        expect(state.holds).toBe(1)

        state.url = 'https://site.example/home'
        expect(await finishTakeover('a1')).toEqual({ url: 'https://site.example/home' })
        expect(contexts()[0]!.closed).toBe(true)
        expect(activeTakeovers()).toEqual([])
        expect(state.holds).toBe(0)
        expect(state.cachesDropped).toEqual(['a1'])
    })

    it('keeps the profile lock until it finishes, so the agent browser waits instead of clearing a live lock', async () => {
        await startTakeover('a1')
        let navigated = false
        const navigation = withKeyedLock('browser:a1', async () => {
            navigated = true
        })
        await new Promise(next => setTimeout(next, 20))
        expect(navigated).toBe(false)
        await finishTakeover('a1')
        await navigation
        expect(navigated).toBe(true)
    })

    it('is a no-op when one is already open for the agent, and finishing nothing returns no page', async () => {
        await startTakeover('a1')
        await startTakeover('a1', 'https://other.example/')
        expect(state.launches).toHaveLength(1)
        expect(await finishTakeover('nobody')).toEqual({ url: null })
    })

    it('ignores a second start that arrives while the first is still bringing the screen up', async () => {
        let screenUp!: () => void
        state.desktopGate = new Promise<void>(done => (screenUp = done))
        const first = startTakeover('a1', 'https://site.example/login')
        const second = startTakeover('a1', 'https://other.example/')
        screenUp()
        await Promise.all([first, second])
        expect(state.launches).toHaveLength(1)
        expect(state.holds).toBe(1)
        expect(activeTakeovers()).toEqual(['a1'])
        await finishTakeover('a1')
        expect(activeTakeovers()).toEqual([])
        expect(state.holds).toBe(0)
    })

    it('ends when the person closes the window', async () => {
        await startTakeover('a1', 'https://site.example/')
        contexts()[0]!.emit('close')
        await vi.waitFor(() => expect(activeTakeovers()).toEqual([]))
        expect(state.holds).toBe(0)
    })

    it('closes by itself after fifteen minutes', async () => {
        vi.useFakeTimers()
        await startTakeover('a1')
        await vi.advanceTimersByTimeAsync(15 * 60_000)
        expect(activeTakeovers()).toEqual([])
        expect(contexts()[0]!.closed).toBe(true)
    })

    it('closes a browser opened from the dock once the screen has gone unwatched for two checks', async () => {
        vi.useFakeTimers()
        state.viewers = 1
        await startTakeover('a1', undefined, { endWhenUnwatched: true })
        await vi.advanceTimersByTimeAsync(5 * 60_000)
        expect(activeTakeovers()).toEqual(['a1'])
        state.viewers = 0
        await vi.advanceTimersByTimeAsync(30_000)
        expect(activeTakeovers()).toEqual(['a1'])
        await vi.advanceTimersByTimeAsync(30_000)
        expect(activeTakeovers()).toEqual([])
        expect(contexts()[0]!.closed).toBe(true)
    })

    it('keeps an unwatched browser open when the agent asked for it, and opens the page it asks for on a dock browser', async () => {
        vi.useFakeTimers()
        await startTakeover('a1', undefined, { endWhenUnwatched: true })
        await startTakeover('a1', 'https://site.example/login')
        expect(state.launches).toHaveLength(1)
        expect(state.url).toBe('https://site.example/login')
        await vi.advanceTimersByTimeAsync(5 * 60_000)
        expect(activeTakeovers()).toEqual(['a1'])
    })

    it('surfaces a browser that cannot launch and leaves nothing held', async () => {
        state.launchError = new Error('no chromium')
        await expect(startTakeover('a1')).rejects.toThrow('no chromium')
        await vi.waitFor(() => expect(activeTakeovers()).toEqual([]))
        expect(state.holds).toBe(0)
    })

    it('opens a fresh browser for a start that arrives while the previous one is closing, and keeps it', async () => {
        await startTakeover('a1', 'https://first.example/')
        const closing = finishTakeover('a1')
        await startTakeover('a1', 'https://second.example/')
        await closing
        expect(state.launches).toHaveLength(2)
        expect(contexts()[0]!.closed).toBe(true)
        expect(contexts()[1]!.closed).toBe(false)
        expect(activeTakeovers()).toEqual(['a1'])
    })
})

describe('a browser held by a run', () => {
    it('stays open past the fifteen minutes and the empty room, then closes when the run lets go', async () => {
        vi.useFakeTimers()
        const release = await holdBrowser('a1', 'https://app.example/')
        expect(state.url).toBe('https://app.example/')
        await vi.advanceTimersByTimeAsync(20 * 60_000)
        expect(activeTakeovers()).toEqual(['a1'])
        release()
        release()
        await vi.advanceTimersByTimeAsync(0)
        expect(activeTakeovers()).toEqual([])
        expect(contexts()[0]!.closed).toBe(true)
    })

    it('is one window for every run that holds it, open until the last lets go', async () => {
        const first = await holdBrowser('a1')
        const second = await holdBrowser('a1', 'https://other.example/')
        expect(state.launches).toHaveLength(1)
        first()
        await new Promise(next => setTimeout(next, 10))
        expect(activeTakeovers()).toEqual(['a1'])
        second()
        await vi.waitFor(() => expect(activeTakeovers()).toEqual([]))
    })

    it('is left to the person watching when the run lets go, and closes once they have gone', async () => {
        vi.useFakeTimers()
        state.viewers = 1
        const release = await holdBrowser('a1')
        release()
        await vi.advanceTimersByTimeAsync(60_000)
        expect(activeTakeovers()).toEqual(['a1'])
        state.viewers = 0
        await vi.advanceTimersByTimeAsync(60_000)
        expect(activeTakeovers()).toEqual([])
    })

    it('stays with a person who was handed it, until they are done', async () => {
        const release = await holdBrowser('a1')
        await startTakeover('a1', 'https://site.example/login')
        release()
        await new Promise(next => setTimeout(next, 10))
        expect(activeTakeovers()).toEqual(['a1'])
        await finishTakeover('a1')
        expect(activeTakeovers()).toEqual([])
    })

    it('closes a handed browser that outlived its fifteen minutes as soon as the run lets go', async () => {
        vi.useFakeTimers()
        await startTakeover('a1', 'https://site.example/login')
        const release = await holdBrowser('a1')
        await vi.advanceTimersByTimeAsync(15 * 60_000)
        expect(activeTakeovers()).toEqual(['a1'])
        release()
        await vi.advanceTimersByTimeAsync(0)
        expect(activeTakeovers()).toEqual([])
    })

    it('holds nothing when the window closed the moment it opened', async () => {
        state.onGoto = context => (context as FakeContext).emit('close')
        const release = await holdBrowser('a1', 'https://gone.example/')
        release()
        await vi.waitFor(() => expect(activeTakeovers()).toEqual([]))
        expect(state.holds).toBe(0)
    })
})

describe('joinableBrowser', () => {
    it('has nothing to join when no browser is open', () => {
        expect(joinableBrowser('a1')).toBeNull()
    })

    it('hands over the open window, waiting for one that is still coming up', async () => {
        let screenUp!: () => void
        state.desktopGate = new Promise<void>(done => (screenUp = done))
        const starting = startTakeover('a1')
        expect(joinableBrowser('a1')).toBeNull()
        screenUp()
        await starting
        expect(await joinableBrowser('a1')).toBe(contexts()[0])
    })

    it('has nothing to join in a window that is closing or that never opened', async () => {
        await startTakeover('a1')
        const pending = joinableBrowser('a1')
        const closing = finishTakeover('a1')
        expect(joinableBrowser('a1')).toBeNull()
        expect(await pending).toBeNull()
        await closing

        state.launchError = new Error('no chromium')
        let joining: ReturnType<typeof joinableBrowser> = null
        state.beforeLaunch = () => (joining = joinableBrowser('a2'))
        await expect(startTakeover('a2')).rejects.toThrow('no chromium')
        expect(joining).not.toBeNull()
        expect(await joining).toBeNull()
    })
})
