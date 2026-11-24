import { existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { vi } from 'vitest'

const state = vi.hoisted(() => ({
    available: true,
    calls: [] as Array<[string, ...unknown[]]>,
    captures: 0,
    failure: null as Error | null,
    failAfterCalls: null as number | null,
    onCall: null as ((name: string) => unknown) | null,
    screenHolds: 0,
    browserHolds: 0,
    openBrowser: false,
    openBrowserHolds: 0,
    browserUrls: [] as Array<string | undefined>,
    apps: [] as string[],
    sleeps: [] as number[],
    driving: false,
    drivingAfterTyped: null as number | null,
    drivingForPolls: 0,
    parkLongSleeps: false,
    browserGate: null as Promise<void> | null,
    captureGate: null as Promise<void> | null,
    vaultEnv: {} as Record<string, string>,
}))

vi.mock('../../vault/runtime.js', () => ({
    vaultEnvFor: () => state.vaultEnv,
}))

vi.mock('node:timers/promises', () => ({
    setTimeout: async (ms: number, _value: unknown, options?: { signal?: AbortSignal }) => {
        state.sleeps.push(ms)
        if (state.parkLongSleeps && ms >= 60_000) {
            await new Promise((_, reject) => options?.signal?.addEventListener('abort', () => reject(new Error('aborted')), { once: true }))
        }
        await Promise.resolve()
        if (options?.signal?.aborted) throw new Error('aborted')
    },
}))

vi.mock('../../desktop/control.js', () => {
    class ControlRefusal extends Error {}
    const record =
        (name: string) =>
        async (_control: unknown, ...args: unknown[]) => {
            if (state.failure) throw state.failure
            if (state.failAfterCalls !== null && state.calls.length >= state.failAfterCalls) throw new Error('xdotool is gone')
            state.calls.push([name, ...args])
            state.onCall?.(name)
        }
    return {
        ControlRefusal,
        controlScreen: async (agentId: string, signal?: AbortSignal) => ({ agentId, signal }),
        captureScreen: async () => {
            const image = Buffer.from(`shot-${++state.captures}`)
            await state.captureGate
            return { image, mediaType: 'image/jpeg', width: 1280, height: 720 }
        },
        click: record('click'),
        drag: record('drag'),
        movePointer: record('move'),
        pressKeys: record('key'),
        scroll: record('scroll'),
        typeText: record('type'),
    }
})

vi.mock('../../desktop/session.js', () => ({
    computerAvailable: () => state.available,
    humanDriving: () => state.driving || state.sleeps.filter(ms => ms === 500).length < state.drivingForPolls || (state.drivingAfterTyped !== null && state.calls.filter(([name]) => name === 'type').length >= state.drivingAfterTyped),
    holdDesktop: () => {
        state.screenHolds++
        return () => {
            state.screenHolds--
        }
    },
}))

vi.mock('../../desktop/takeover.js', () => ({
    holdOpenBrowser: () => {
        if (!state.openBrowser) return () => {}
        state.openBrowserHolds++
        return () => {
            state.openBrowserHolds--
        }
    },
    holdBrowser: async (_agentId: string, url?: string) => {
        state.browserHolds++
        state.browserUrls.push(url)
        await state.browserGate
        return () => {
            state.browserHolds--
        }
    },
}))

vi.mock('../../desktop/apps.js', () => ({
    openDesktopApp: async (_agentId: string, app: string) => {
        state.apps.push(app)
    },
}))

const { afterEach, beforeEach, describe, expect, it } = await import('vitest')
const { agentConfigSchema } = await import('../../agents/types.js')
const { ControlRefusal } = await import('../../desktop/control.js')
const { agentsOnScreen, computerTools, offersComputer } = await import('./computer.js')

type Built = ReturnType<typeof computerTools>
const open: Built[] = []

function ctxWith(id = 'a1', tools: Record<string, boolean> = {}, extra: Record<string, unknown> = {}, env: Record<string, string> = {}) {
    return { agent: { id, env, config: agentConfigSchema.parse({ name: 'x', tools: { computer: true, ...tools } }) }, sessionId: 's', ...extra } as any
}

function build(ctx: any): Built {
    const built = computerTools(ctx)
    open.push(built)
    return built
}

const act = (built: Built, input: Record<string, unknown>) => (built.tools.computer as any).execute(input, { toolCallId: 'c', messages: [] })
const openApp = (built: Built, input: Record<string, unknown>) => (built.tools.computer_open_app as any).execute(input, { toolCallId: 'c', messages: [] })

beforeEach(() => {
    state.available = true
    state.calls.length = 0
    state.captures = 0
    state.failure = null
    state.failAfterCalls = null
    state.onCall = null
    state.browserUrls.length = 0
    state.apps.length = 0
    state.sleeps.length = 0
    state.driving = false
    state.drivingAfterTyped = null
    state.drivingForPolls = 0
    state.openBrowser = false
    state.parkLongSleeps = false
    state.browserGate = null
    state.captureGate = null
    state.vaultEnv = {}
})

afterEach(() => {
    for (const built of open.splice(0)) built.release()
})

const settled = <T>(work: Promise<T>): Promise<T> => work

describe('offersComputer', () => {
    const config = (input: Record<string, unknown> = {}) => agentConfigSchema.parse({ name: 'x', tools: { computer: true }, ...input })

    it('goes to an agent that was handed a computer, on a box that can show its screen', () => {
        expect(offersComputer(config())).toBe(true)
        expect(offersComputer(agentConfigSchema.parse({ name: 'x', tools: { computer: false } }))).toBe(false)
        state.available = false
        expect(offersComputer(config())).toBe(false)
    })

    it('skips a delegate nobody watches, and goes to the foreman like a coworker', () => {
        expect(offersComputer(config({ ephemeral: true }))).toBe(false)
        expect(offersComputer(config({ kind: 'foreman' }))).toBe(true)
    })
})

describe('computer', () => {
    it('looks at the screen and names the picture it kept for the model', async () => {
        const ctx = ctxWith()
        const result = await settled(act(build(ctx), { action: 'screenshot' }))
        expect(result).toEqual({ status: 'done', screenshotId: expect.any(String), screen: [1280, 720] })
        expect(ctx.screenshots.get(result.screenshotId).image.toString()).toBe('shot-1')
        expect(state.calls).toEqual([])
        expect(state.sleeps).toEqual([])
    })

    it('maps every action onto the screen', async () => {
        const built = build(ctxWith())
        const inputs = [
            { action: 'left_click', coordinate: [10, 20] },
            { action: 'right_click', coordinate: [10, 20] },
            { action: 'double_click', coordinate: [10, 20] },
            { action: 'mouse_move', coordinate: [30, 40] },
            { action: 'left_click_drag', start_coordinate: [1, 2], coordinate: [3, 4] },
            { action: 'scroll', coordinate: [5, 6], scroll_direction: 'down' },
            { action: 'scroll', coordinate: [5, 6], scroll_direction: 'up', scroll_amount: 7 },
            { action: 'type', text: 'hello' },
            { action: 'key', text: 'ctrl+a' },
            { action: 'wait', duration: 2 },
            { action: 'wait' },
        ]
        for (const input of inputs) expect((await settled(act(built, input))).status, input.action).toBe('done')
        expect(state.calls).toEqual([
            ['click', [10, 20]],
            ['click', [10, 20], { button: 'right' }],
            ['click', [10, 20], { double: true }],
            ['move', [30, 40]],
            ['drag', [1, 2], [3, 4]],
            ['scroll', [5, 6], 'down', 3],
            ['scroll', [5, 6], 'up', 7],
            ['type', 'hello'],
            ['key', 'ctrl+a'],
        ])
        expect(state.sleeps).toEqual([600, 600, 600, 600, 600, 600, 600, 600, 600, 2000, 1000])
    })

    it('says which field an action is missing instead of acting blind', async () => {
        const built = build(ctxWith())
        expect(await settled(act(built, { action: 'left_click' }))).toEqual({ status: 'refused', reason: 'left_click needs coordinate.' })
        expect(await settled(act(built, { action: 'left_click_drag', coordinate: [1, 1] }))).toEqual({ status: 'refused', reason: 'left_click_drag needs start_coordinate.' })
        expect(await settled(act(built, { action: 'scroll', coordinate: [1, 1] }))).toEqual({ status: 'refused', reason: 'scroll needs scroll_direction.' })
        expect(await settled(act(built, { action: 'type' }))).toEqual({ status: 'refused', reason: 'type needs text.' })
        expect(state.calls).toEqual([])
    })

    it('reports what the screen refused and what broke as two different things', async () => {
        const built = build(ctxWith())
        state.failure = new ControlRefusal('not yours')
        expect(await settled(act(built, { action: 'left_click', coordinate: [1, 1] }))).toEqual({ status: 'refused', reason: 'not yours' })
        state.failure = new Error('xdotool is gone')
        expect(await settled(act(built, { action: 'left_click', coordinate: [1, 1] }))).toEqual({ status: 'failed', reason: 'xdotool is gone' })
        state.failure = 'plain' as unknown as Error
        expect(await settled(act(built, { action: 'left_click', coordinate: [1, 1] }))).toEqual({ status: 'failed', reason: 'plain' })
    })

    it('stops with the run instead of answering', async () => {
        const controller = new AbortController()
        const built = build(ctxWith('a1', {}, { abortSignal: controller.signal }))
        const waiting = act(built, { action: 'wait', duration: 5 })
        waiting.catch(() => {})
        controller.abort()
        await expect(settled(waiting)).rejects.toThrow()
    })

    it('keeps the screen up from the first action until the run lets go', async () => {
        const built = build(ctxWith())
        expect(state.screenHolds).toBe(0)
        await settled(act(built, { action: 'screenshot' }))
        await settled(act(built, { action: 'screenshot' }))
        expect(state.screenHolds).toBe(1)
        built.release()
        expect(state.screenHolds).toBe(0)
    })

    it('holds the browser already on the screen, a window handed back after a sign-in, until the run lets go', async () => {
        state.openBrowser = true
        const built = build(ctxWith())
        await settled(act(built, { action: 'screenshot' }))
        await settled(act(built, { action: 'screenshot' }))
        expect(state.openBrowserHolds).toBe(1)
        built.release()
        expect(state.openBrowserHolds).toBe(0)
    })

    it('gives the screen to the first run of an agent and tells the others why they gave up waiting', async () => {
        const first = build(ctxWith())
        const second = build(ctxWith())
        const other = build(ctxWith('a2'))
        expect((await settled(act(first, { action: 'screenshot' }))).status).toBe('done')
        expect(await settled(act(second, { action: 'screenshot' }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('Another run') })
        expect((await settled(act(other, { action: 'screenshot' }))).status).toBe('done')
        second.release()
        const third = build(ctxWith())
        expect(await settled(act(third, { action: 'screenshot' }))).toMatchObject({ status: 'refused' })
        first.release()
        expect((await settled(act(third, { action: 'screenshot' }))).status).toBe('done')
        expect(state.sleeps).toContain(5 * 60_000)
    })

    it('hands the screen to a waiting run as soon as the holder ends, one waiter at a time', async () => {
        state.parkLongSleeps = true
        const first = build(ctxWith())
        const second = build(ctxWith())
        const third = build(ctxWith())
        expect((await act(first, { action: 'screenshot' })).status).toBe('done')

        const outcomes: string[] = []
        const secondTurn = act(second, { action: 'screenshot' }).then((r: { status: string }) => outcomes.push(`second:${r.status}`))
        const thirdTurn = act(third, { action: 'screenshot' }).then((r: { status: string }) => outcomes.push(`third:${r.status}`))
        await new Promise(r => setImmediate(r))
        expect(outcomes).toEqual([])

        first.release()
        await secondTurn
        await new Promise(r => setImmediate(r))
        expect(outcomes).toEqual(['second:done'])
        expect(agentsOnScreen()).toEqual(['a1'])

        second.release()
        await thirdTurn
        expect(outcomes).toEqual(['second:done', 'third:done'])
    })

    it('stops waiting for the screen when its run is cancelled', async () => {
        state.parkLongSleeps = true
        const first = build(ctxWith())
        const controller = new AbortController()
        const second = build(ctxWith('a1', {}, { abortSignal: controller.signal }))
        expect((await act(first, { action: 'screenshot' })).status).toBe('done')

        const waiting = act(second, { action: 'screenshot' })
        await new Promise(r => setImmediate(r))
        controller.abort()
        await expect(waiting).rejects.toThrow('aborted')
        first.release()
        expect(agentsOnScreen()).toEqual([])
    })

    it('never takes the screen back once its run let go of it', async () => {
        const built = build(ctxWith())
        expect((await act(built, { action: 'screenshot' })).status).toBe('done')
        built.release()

        expect(await act(built, { action: 'left_click', coordinate: [1, 1] })).toMatchObject({ status: 'refused', reason: expect.stringContaining('over') })
        expect(await openApp(built, { app: 'browser' })).toMatchObject({ status: 'refused' })
        expect(state.calls).toEqual([])
        expect(state.apps).toEqual([])
        expect(state.screenHolds).toBe(0)
        expect(state.browserHolds).toBe(0)
        expect(agentsOnScreen()).toEqual([])
        expect((await act(build(ctxWith()), { action: 'screenshot' })).status).toBe('done')
    })

    it('leaves the screen to others when its run ended while it waited for its turn', async () => {
        state.parkLongSleeps = true
        const first = build(ctxWith())
        const second = build(ctxWith())
        expect((await act(first, { action: 'screenshot' })).status).toBe('done')

        const waiting = act(second, { action: 'screenshot' })
        await new Promise(r => setImmediate(r))
        second.release()
        first.release()

        expect(await waiting).toMatchObject({ status: 'refused', reason: expect.stringContaining('over') })
        expect(agentsOnScreen()).toEqual([])
    })

    it('lets go of a browser that opened after its run ended', async () => {
        let opened!: () => void
        state.browserGate = new Promise(r => (opened = r))
        const built = build(ctxWith())
        const opening = openApp(built, { app: 'browser' })
        await new Promise(r => setImmediate(r))
        built.release()
        opened()

        expect(await opening).toMatchObject({ status: 'refused' })
        expect(state.apps).toEqual([])
        expect(state.browserHolds).toBe(0)
    })

    it('drops an action queued behind another one when its run ends', async () => {
        let opened!: () => void
        state.browserGate = new Promise(r => (opened = r))
        const built = build(ctxWith())
        const opening = openApp(built, { app: 'browser' })
        const queued = act(built, { action: 'left_click', coordinate: [1, 1] })
        await new Promise(r => setImmediate(r))
        built.release()
        opened()

        await opening
        expect(await queued).toMatchObject({ status: 'refused' })
        expect(state.calls).toEqual([])
    })

    it('keeps its hands off while a person drives the screen, and takes it back when they stop', async () => {
        const built = build(ctxWith())
        state.driving = true
        expect(await settled(act(built, { action: 'left_click', coordinate: [1, 1] }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('driving your screen') })
        expect(await settled(openApp(built, { app: 'files' }))).toMatchObject({ status: 'refused' })
        expect(state.calls).toEqual([])
        expect(state.apps).toEqual([])
        state.driving = false
        expect((await settled(act(built, { action: 'left_click', coordinate: [1, 1] }))).status).toBe('done')
    })

    it('waits for a person who clicked in the screen, then carries on', async () => {
        const built = build(ctxWith())
        state.drivingForPolls = 3
        expect((await settled(act(built, { action: 'left_click', coordinate: [1, 1] }))).status).toBe('done')
        expect(state.sleeps).toEqual([500, 500, 500, 600])
        expect(state.calls).toHaveLength(1)
    })

    it('types a long text in pieces and stops where a person takes the screen', async () => {
        const built = build(ctxWith())
        const text = 'x'.repeat(100)
        expect((await settled(act(built, { action: 'type', text }))).status).toBe('done')
        expect(state.calls.map(([, chunk]) => (chunk as string).length)).toEqual([40, 40, 20])
        state.calls.length = 0
        state.drivingAfterTyped = 1
        expect(await settled(act(built, { action: 'type', text }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('driving your screen') })
        expect(state.calls).toHaveLength(1)
    })

    it('types a coworker variable into the page without the value entering the tool call or its result', async () => {
        const built = build(ctxWith('a1', {}, {}, { ATLANTIC_TOKEN: '839201' }))
        const result = await settled(act(built, { action: 'type', secret: 'ATLANTIC_TOKEN' }))
        expect(result.status).toBe('done')
        expect(state.calls).toEqual([['type', '839201']])
        expect(JSON.stringify(result)).not.toContain('839201')
    })

    it('types a variable the Vault gives the coworker the same way', async () => {
        state.vaultEnv = { BANK_PASSWORD: 'vault-value' }
        const built = build(ctxWith('a1', {}, {}, { BANK_PASSWORD: 'stale-value' }))
        expect((await settled(act(built, { action: 'type', secret: 'BANK_PASSWORD' }))).status).toBe('done')
        expect(state.calls).toEqual([['type', 'vault-value']])
    })

    it('reads a variable written as ${KEY} like its bare name', async () => {
        const built = build(ctxWith('a1', {}, {}, { ATLANTIC_TOKEN: '839201' }))
        expect((await settled(act(built, { action: 'type', secret: '${ATLANTIC_TOKEN}' }))).status).toBe('done')
        expect(state.calls).toEqual([['type', '839201']])
    })

    it('refuses a variable that was never filled and points to request_secret', async () => {
        const built = build(ctxWith('a1', {}, {}, { EMPTY_TOKEN: '' }))
        for (const secret of ['MISSING_TOKEN', 'EMPTY_TOKEN']) {
            expect(await settled(act(built, { action: 'type', secret }))).toEqual({ status: 'refused', reason: expect.stringMatching(new RegExp(`${secret}.*request_secret`)) })
        }
        expect(state.calls).toEqual([])
    })

    it('refuses text and secret together instead of guessing which one to type', async () => {
        const built = build(ctxWith('a1', {}, {}, { ATLANTIC_TOKEN: '839201' }))
        expect(await settled(act(built, { action: 'type', text: 'hello', secret: 'ATLANTIC_TOKEN' }))).toEqual({ status: 'refused', reason: 'type takes text or secret, not both.' })
        expect(state.calls).toEqual([])
    })

    it('types a long secret in pieces and stops where a person takes the screen', async () => {
        const built = build(ctxWith('a1', {}, {}, { LONG_SECRET: 'y'.repeat(100) }))
        expect((await settled(act(built, { action: 'type', secret: 'LONG_SECRET' }))).status).toBe('done')
        expect(state.calls.map(([, chunk]) => (chunk as string).length)).toEqual([40, 40, 20])
        state.calls.length = 0
        state.drivingAfterTyped = 1
        expect(await settled(act(built, { action: 'type', secret: 'LONG_SECRET' }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('driving your screen') })
        expect(state.calls).toHaveLength(1)
    })

    describe('followed_by', () => {
        const editBlock = { action: 'double_click', coordinate: [10, 20], followed_by: [{ action: 'key', text: 'ctrl+a' }, { action: 'type', text: 'hello' }, { action: 'key', text: 'Escape' }] }

        it('carries the actions out in order and looks at the screen once', async () => {
            const built = build(ctxWith())
            expect(await settled(act(built, editBlock))).toEqual({ status: 'done', screenshotId: expect.any(String), screen: [1280, 720] })
            expect(state.calls).toEqual([
                ['click', [10, 20], { double: true }],
                ['key', 'ctrl+a'],
                ['type', 'hello'],
                ['key', 'Escape'],
            ])
            expect(state.captures).toBe(1)
            expect(state.sleeps).toEqual([600, 600, 600, 600])
        })

        it('waits without settling on top of the wait', async () => {
            await settled(act(build(ctxWith()), { action: 'left_click', coordinate: [1, 1], followed_by: [{ action: 'wait', duration: 2 }] }))
            expect(state.sleeps).toEqual([600, 2000])
        })

        it('counts as one screenshot of the run', async () => {
            const built = build(ctxWith('claude-series', {}, { provider: 'claude' }))
            for (let i = 0; i < 60; i++) expect((await settled(act(built, editBlock))).status).toBe('done')
            expect((await settled(act(built, editBlock))).status).toBe('refused')
            expect(state.calls).toHaveLength(240)
        })

        it('stops at the first one that fails and says what went through', async () => {
            const built = build(ctxWith())
            const result = await settled(act(built, { action: 'left_click', coordinate: [1, 1], followed_by: [{ action: 'type', text: 'hello' }, { action: 'key' }, { action: 'type', text: 'never' }] }))
            expect(result).toEqual({ status: 'refused', reason: expect.stringMatching(/^key needs text\. Stopped at key, step 3 of 4: the steps before it went through/) })
            expect(state.calls).toEqual([['click', [1, 1]], ['type', 'hello']])
            expect(state.captures).toBe(0)
        })

        it('does nothing more when the first action fails, with the answer it always had', async () => {
            expect(await settled(act(build(ctxWith()), { ...editBlock, coordinate: undefined }))).toEqual({ status: 'refused', reason: 'double_click needs coordinate.' })
            expect(state.calls).toEqual([])
        })

        it('tells what broke from what the screen refused', async () => {
            const built = build(ctxWith())
            state.failAfterCalls = 1
            expect(await settled(act(built, editBlock))).toEqual({ status: 'failed', reason: expect.stringMatching(/^xdotool is gone Stopped at key, step 2 of 4/) })
        })

        it('types a variable without its value entering the call or its result', async () => {
            const built = build(ctxWith('a1', {}, {}, { ATLANTIC_TOKEN: '839201' }))
            const result = await settled(act(built, { action: 'left_click', coordinate: [1, 1], followed_by: [{ action: 'type', secret: 'ATLANTIC_TOKEN' }] }))
            expect(state.calls.at(-1)).toEqual(['type', '839201'])
            expect(JSON.stringify(result)).not.toContain('839201')
        })

        it('presses no key once a person has taken the screen', async () => {
            state.drivingAfterTyped = 1
            const result = await settled(act(build(ctxWith()), { action: 'left_click', coordinate: [1, 1], followed_by: [{ action: 'type', text: 'hello' }, { action: 'key', text: 'Tab' }] }))
            expect(result).toMatchObject({ status: 'refused', reason: expect.stringMatching(/driving your screen.*Stopped at key, step 3 of 3/) })
            expect(state.calls.map(([name]) => name)).toEqual(['click', 'type'])
        })

        it('presses no key once its run let go of the screen', async () => {
            const built = build(ctxWith())
            state.onCall = name => name === 'type' && built.release()
            const result = await settled(act(built, editBlock))
            expect(result).toMatchObject({ status: 'refused', reason: expect.stringContaining('over') })
            expect(state.calls.map(([name]) => name)).toEqual(['click', 'key', 'type'])
        })

        it('stops with the run instead of answering', async () => {
            const controller = new AbortController()
            const built = build(ctxWith('a1', {}, { abortSignal: controller.signal }))
            state.onCall = name => name === 'click' && controller.abort()
            await expect(settled(act(built, editBlock))).rejects.toThrow('aborted')
            expect(state.calls.map(([name]) => name)).toEqual(['click'])
        })

        it('takes nothing that needs a look at the screen first, and ten at most', () => {
            const schema = (build(ctxWith()).tools.computer as any).inputSchema
            const series = (followed_by: unknown[]) => schema.safeParse({ action: 'left_click', coordinate: [1, 1], followed_by }).success
            expect(series([{ action: 'key', text: 'Tab' }])).toBe(true)
            expect(series([{ action: 'left_click', coordinate: [2, 2] }])).toBe(false)
            expect(series(Array(10).fill({ action: 'wait' }))).toBe(true)
            expect(series(Array(11).fill({ action: 'wait' }))).toBe(false)
        })
    })

    it('names the agents whose run has the screen', async () => {
        const built = build(ctxWith('a7'))
        expect(agentsOnScreen()).not.toContain('a7')
        await settled(act(built, { action: 'screenshot' }))
        expect(agentsOnScreen()).toContain('a7')
        built.release()
        expect(agentsOnScreen()).not.toContain('a7')
    })

    it('leaves codex no file once the run ended during the capture', async () => {
        let captured!: () => void
        state.captureGate = new Promise(r => (captured = r))
        const id = `codex-late-${process.pid}`
        const built = build(ctxWith(id, {}, { provider: 'codex' }))
        const taking = act(built, { action: 'screenshot' })
        await vi.waitFor(() => expect(state.captures).toBe(1))
        built.release()
        captured()

        expect(await taking).toMatchObject({ status: 'refused', reason: expect.stringContaining('over') })
        expect(existsSync(resolve(tmpdir(), 'rerun-desktop', 'screens', id))).toBe(false)
    })

    it('hands codex its screenshot as a file to open, and removes the files when the run is over', async () => {
        const ctx = ctxWith('codex-agent', {}, { provider: 'codex' })
        const built = build(ctx)
        const first = await settled(act(built, { action: 'screenshot' }))
        const second = await settled(act(built, { action: 'screenshot' }))
        expect(first).toEqual({ status: 'done', screen: [1280, 720], screenshotPath: expect.stringMatching(/rerun-desktop\/screens\/codex-agent\/.+\.jpg$/), next: expect.stringContaining('view_image') })
        expect(readFileSync(first.screenshotPath).toString()).toBe('shot-1')
        expect(second.screenshotPath).not.toBe(first.screenshotPath)
        expect(ctx.screenshots).toBeUndefined()
        built.release()
        await vi.waitFor(() => expect(existsSync(first.screenshotPath)).toBe(false))
    })

    it('gives a run on a CLI fewer actions, since its pictures all stay in its context', async () => {
        const built = build(ctxWith('claude-agent', {}, { provider: 'claude' }))
        for (let i = 0; i < 60; i++) expect((await settled(act(built, { action: 'screenshot' }))).status).toBe('done')
        expect(await settled(act(built, { action: 'screenshot' }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('60 screenshots') })
    })

    it('ends a run that would click forever', async () => {
        const built = build(ctxWith())
        for (let i = 0; i < 200; i++) expect((await settled(act(built, { action: 'screenshot' }))).status).toBe('done')
        expect(await settled(act(built, { action: 'screenshot' }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('200 screenshots') })
    })
})

describe('computer_open_app', () => {
    it('opens the browser as a window the run holds open, on the page it asked for', async () => {
        const built = build(ctxWith())
        expect((await settled(openApp(built, { app: 'browser', url: 'https://site.example/' }))).status).toBe('done')
        expect(state.browserUrls).toEqual(['https://site.example/'])
        expect(state.apps).toEqual(['browser'])
        expect(state.browserHolds).toBe(1)
        built.release()
        expect(state.browserHolds).toBe(0)
    })

    it('takes only an http(s) page for the browser', () => {
        const schema = (build(ctxWith()).tools.computer_open_app as any).inputSchema
        expect(schema.safeParse({ app: 'browser', url: 'https://site.example/' }).success).toBe(true)
        expect(schema.safeParse({ app: 'browser' }).success).toBe(true)
        expect(schema.safeParse({ app: 'browser', url: 'file:///etc/passwd' }).success).toBe(false)
        expect(schema.safeParse({ app: 'browser', url: 'javascript:alert(1)' }).success).toBe(false)
    })

    it('opens the files and the terminal without holding a browser', async () => {
        const built = build(ctxWith())
        await settled(openApp(built, { app: 'files' }))
        await settled(openApp(built, { app: 'terminal' }))
        expect(state.apps).toEqual(['files', 'terminal'])
        expect(state.browserHolds).toBe(0)
    })

    it('keeps the terminal and the files behind the switches that already govern them', async () => {
        expect(await settled(openApp(build(ctxWith('a1', { shell: false })), { app: 'terminal' }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('shell tool is disabled') })
        expect(await settled(openApp(build(ctxWith('a2', { filesystem: false })), { app: 'files' }))).toMatchObject({ status: 'refused', reason: expect.stringContaining('filesystem tool is disabled') })
        expect(state.apps).toEqual([])
    })
})
