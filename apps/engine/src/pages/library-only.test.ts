import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const ALLOWED = new Set(['pxpipe-proxy', 'pxpipe-proxy/transform'])
const IMPORT_RE = /(?:from\s*|import\s*\(\s*|import\s+|require\(\s*)['"](pxpipe-proxy(?:\/[^'"]*)?)['"]/g

export function badPxpipeImports(source: string): string[] {
    return [...source.matchAll(IMPORT_RE)].map(m => m[1]!).filter(spec => !ALLOWED.has(spec))
}

function sources(dir: string): string[] {
    return readdirSync(dir).flatMap(name => {
        const p = join(dir, name)
        if (statSync(p).isDirectory()) return sources(p)
        return /\.(ts|tsx|mts|js|mjs)$/.test(name) && !name.endsWith('library-only.test.ts') ? [p] : []
    })
}

const tcp = () => process.getActiveResourcesInfo().filter(r => r === 'TCPServerWrap' || r === 'TCPSocketWrap' || r === 'TCPWrap').length

describe('pxpipe-proxy stays a library', () => {
    it('catches a subpath import in a fixture', () => {
        expect(badPxpipeImports(`import { x } from 'pxpipe-proxy/proxy'`)).toEqual(['pxpipe-proxy/proxy'])
        expect(badPxpipeImports(`import { x } from 'pxpipe-proxy/transform'`)).toEqual([])
    })
    it('engine sources import only . and ./transform', () => {
        const bad = sources(join(import.meta.dirname, '..')).flatMap(f => badPxpipeImports(readFileSync(f, 'utf8')).map(s => `${f}: ${s}`))
        expect(bad).toEqual([])
    })
    it('importing the entry point opens no TCP server or socket', async () => {
        const before = tcp()
        await import('pxpipe-proxy/transform')
        await new Promise(r => setImmediate(r))
        expect(tcp()).toBe(before)
    })
})
