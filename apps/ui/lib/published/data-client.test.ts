import { describe, expect, it, vi } from 'vitest'
import { injectDataClient } from './data-client'

type DataClient = { watch: (table: string, onRows: (page: unknown) => void) => () => void }

// Runs the injected script against a fake page, its timers in our hands.
function loadDataClient() {
    const script = injectDataClient('').replace(/^<script>/, '').replace(/<\/script>$/, '')
    const timers: (() => void)[] = []
    const page: { rerun?: { data: DataClient } } = {}
    const fetch = vi.fn(async () => new Response(JSON.stringify({ columns: [], rows: [], total: 0 })))
    const setTimeout = (run: () => void) => timers.push(run)
    new Function('window', 'document', 'fetch', 'setTimeout', 'clearTimeout', 'console', script)(page, { hidden: false }, fetch, setTimeout, () => {}, { warn: () => {} })
    return { data: page.rerun!.data, timers, fetch }
}

describe('rerun.data.watch', () => {
    it('keeps reading after the page callback throws', async () => {
        const { data, timers, fetch } = loadDataClient()
        let renders = 0
        data.watch('clients', () => {
            renders++
            throw new Error('render failed')
        })
        await vi.waitFor(() => expect(timers).toHaveLength(1))
        timers.shift()!()
        await vi.waitFor(() => expect(renders).toBe(2))
        expect(fetch).toHaveBeenCalledTimes(2)
        await vi.waitFor(() => expect(timers).toHaveLength(1))
    })
})

describe('injectDataClient', () => {
    it('goes first in the head, before any script of the page', () => {
        const out = injectDataClient('<!doctype html><html><head><title>x</title><script>rerun.data.rows("a")</script></head><body></body></html>')
        expect(out.indexOf('window.rerun.data=data')).toBeGreaterThan(out.indexOf('<head>'))
        expect(out.indexOf('window.rerun.data=data')).toBeLessThan(out.indexOf('<title>'))
    })

    it('goes after the html tag, or after the doctype, of a page with no head', () => {
        expect(injectDataClient('<html lang="en"><body></body></html>').startsWith('<html lang="en"><script>')).toBe(true)
        expect(injectDataClient('<!DOCTYPE html><p>hi</p>').startsWith('<!DOCTYPE html><script>')).toBe(true)
        expect(injectDataClient('<p>hi</p>').startsWith('<script>')).toBe(true)
    })

    it('only ever calls the page host', () => {
        const out = injectDataClient('')
        expect(out).toContain("var base='/__rerun/data/tables'")
        expect(out).toContain("credentials:'same-origin'")
    })
})
