import { mkdtempSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const NORDLYS = { name: 'Nordlys', whiteLabel: true, supportEmail: 'help@nordlys.example' }
const RERUN = { name: 'Rerun', whiteLabel: false, supportEmail: null }

let dataDir: string

// A fresh process on the same data-dir.
async function boot(hub = 'https://hub.example.com/') {
    vi.resetModules()
    vi.stubEnv('RERUN_DATA_DIR', dataDir)
    vi.stubEnv('RERUN_HUB_BASE_URL', hub)
    vi.stubEnv('RERUN_API_KEY', 'box-key')
    vi.stubEnv('RERUN_LOG_LEVEL', 'fatal')
    return await import('./brand.js')
}

const answer = (body: unknown, status = 200) => vi.spyOn(globalThis, 'fetch').mockImplementation(async () => Response.json(body, { status }))
const stored = async () => JSON.parse(await readFile(resolve(dataDir, 'brand.json'), 'utf8'))

beforeEach(() => {
    dataDir = mkdtempSync(resolve(tmpdir(), 'rerun-brand-'))
})

afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllEnvs()
    vi.restoreAllMocks()
})

describe('the brand of the machine', () => {
    it('is Rerun until the hub answers, and its text is left as it is', async () => {
        const { boxBrand, productText, brandNote } = await boot()
        expect(boxBrand()).toEqual(RERUN)
        expect(productText('Rerun calls the workers of a workspace coworkers. See docs.rerun.build (docs.rerun.build).')).toBe('Rerun calls the workers of a workspace coworkers. See docs.rerun.build (docs.rerun.build).')
        expect(brandNote()).toBe('')
    })

    it('is asked of the hub with the box key, and kept', async () => {
        const fetchMock = answer(NORDLYS)
        const { boxBrand, productText, refreshBrand } = await boot()
        await refreshBrand()
        expect(fetchMock).toHaveBeenCalledWith('https://hub.example.com/api/engines/brand', expect.objectContaining({ headers: { Authorization: 'Bearer box-key' } }))
        expect(boxBrand()).toEqual(NORDLYS)
        expect(productText("a Rerun workspace on Rerun's credit")).toBe("a Nordlys workspace on Nordlys's credit")
        expect(await stored()).toEqual(NORDLYS)
    })

    it('survives a restart while the hub is down', async () => {
        answer(NORDLYS)
        await (await boot()).refreshBrand()
        vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('ECONNREFUSED'))
        const restarted = await boot()
        await restarted.refreshBrand()
        expect(restarted.boxBrand()).toEqual(NORDLYS)
    })

    it('follows a rename, and goes back to Rerun when the workspace leaves its organization', async () => {
        vi.useFakeTimers({ toFake: ['Date'] })
        const fetchMock = answer(NORDLYS)
        const { boxBrand, refreshBrand } = await boot()
        await refreshBrand()
        await refreshBrand()
        expect(fetchMock).toHaveBeenCalledTimes(1)

        vi.advanceTimersByTime(60_000)
        answer({ ...NORDLYS, name: 'Aurora' })
        await refreshBrand()
        expect(boxBrand().name).toBe('Aurora')

        vi.advanceTimersByTime(60_000)
        answer(RERUN)
        await refreshBrand()
        expect(boxBrand()).toEqual(RERUN)
        expect(await stored()).toEqual(RERUN)
    })

    it('stays what it was on a hub that predates the route, answers a page or an unreadable brand', async () => {
        for (const response of [() => new Response('Not found', { status: 404 }), () => new Response('<html>', { status: 200 }), () => Response.json({ name: ' ', whiteLabel: true })]) {
            await writeFile(resolve(dataDir, 'brand.json'), JSON.stringify(NORDLYS), 'utf8')
            vi.spyOn(globalThis, 'fetch').mockImplementation(async () => response())
            const { boxBrand, refreshBrand } = await boot()
            await expect(refreshBrand()).resolves.toBeUndefined()
            expect(boxBrand()).toEqual(NORDLYS)
        }
    })

    it('never asks without a hub, and reads Rerun out of a broken file', async () => {
        await writeFile(resolve(dataDir, 'brand.json'), '{', 'utf8')
        const fetchMock = answer(NORDLYS)
        const { boxBrand, refreshBrand } = await boot('')
        await refreshBrand()
        expect(fetchMock).not.toHaveBeenCalled()
        expect(boxBrand()).toEqual(RERUN)
    })

    it('waits for the first answer of a slow hub, so that the machine of an organization never starts as Rerun', async () => {
        vi.useFakeTimers()
        vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(resolve => setTimeout(() => resolve(Response.json(NORDLYS)), 5_000)))
        const { boxBrand, refreshBrand } = await boot()
        const waited = refreshBrand()
        await vi.advanceTimersByTimeAsync(5_000)
        await waited
        expect(boxBrand()).toEqual(NORDLYS)
    })

    it('gives up on a first answer that never comes, and on the runs of the minute that follows', async () => {
        vi.useFakeTimers()
        const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
        const { boxBrand, refreshBrand } = await boot()
        const waited = refreshBrand()
        await vi.advanceTimersByTimeAsync(10_000)
        await waited
        expect(boxBrand()).toEqual(RERUN)
        expect(fetchMock).toHaveBeenCalledTimes(1)
    })

    it('holds a run two seconds at most once the hub has answered', async () => {
        vi.useFakeTimers()
        answer(NORDLYS)
        const { boxBrand, refreshBrand } = await boot()
        await refreshBrand()
        await vi.advanceTimersByTimeAsync(60_000)
        vi.spyOn(globalThis, 'fetch').mockImplementation(() => new Promise(() => {}))
        const waited = refreshBrand()
        await vi.advanceTimersByTimeAsync(2_000)
        await waited
        expect(boxBrand()).toEqual(NORDLYS)
    })

    it('is one line, whatever the hub holds', async () => {
        answer({ ...NORDLYS, name: 'Nord\n\n  lys' })
        const { boxBrand, refreshBrand } = await boot()
        await refreshBrand()
        expect(boxBrand().name).toBe('Nord lys')
    })
})

describe('a text said under the name of a brand', () => {
    it('names the product and leaves every identifier alone', async () => {
        const { brandedText } = await import('@rerun/contracts')
        const said = (text: string, name = 'Nordlys') => brandedText(text, { name, whiteLabel: true })
        expect(said('Rerun, **Rerun** and (Rerun).')).toBe('Nordlys, **Nordlys** and (Nordlys).')
        expect(said('A Rerun screen, a Rerun tool', 'Aurora')).toBe('An Aurora screen, an Aurora tool')
        expect(said('Search the Rerun documentation (docs.rerun.build) for it')).toBe('Search the Nordlys documentation for it')
        expect(said('via Rerun')).toBe('via Nordlys')
        const identifiers = 'rerun_hub_search_docs mcp__rerun__ask_user RERUN_API_KEY /opt/rerun .rerun/pages @rerun/contracts rerun-engine/1.0 ~/Rerun RerunDesktop'
        expect(said(identifiers)).toBe(identifiers)
        expect(said('Rerun', '$& $1')).toBe('$& $1')
    })
})
