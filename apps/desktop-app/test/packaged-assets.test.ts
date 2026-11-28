import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, matchesGlob, relative, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import config from '../electron-builder.config'

const APP_ROOT = resolve(import.meta.dirname, '..')
const SOURCES = join(APP_ROOT, 'src')

// electron-vite leaves a `?asset` import of `resources/` where it is: the bundle points at
// `app.asar/resources/...`, so electron-builder has to pack the file itself (RER-398: the tray icons
// were left out, and the tray was blank). An asset anywhere else is copied into `out/`, packed already.
function assetImports(): string[] {
    const assets = new Set<string>()
    for (const file of readdirSync(SOURCES, { recursive: true, encoding: 'utf8' })) {
        if (!/\.tsx?$/.test(file)) continue
        const path = join(SOURCES, file)
        for (const [, specifier] of readFileSync(path, 'utf8').matchAll(/from\s+['"]([^'"]+)\?asset['"]/g)) {
            const asset = relative(APP_ROOT, resolve(dirname(path), specifier)).split('\\').join('/')
            if (asset.startsWith('resources/')) assets.add(asset)
        }
    }
    return [...assets].sort()
}

describe('the files the main process loads at run time', () => {
    const assets = assetImports()
    const packed = (config.files as string[]).filter((pattern) => !pattern.startsWith('!'))

    it('finds the tray icons among them', () => {
        expect(assets).toEqual(expect.arrayContaining(['resources/tray/tray.png', 'resources/tray/trayTemplate.png', 'resources/tray/trayTemplate@2x.png', 'resources/tray/badge.png']))
    })

    it.each(assets)('packs %s into the app', (asset) => {
        expect(existsSync(join(APP_ROOT, asset))).toBe(true)
        expect(packed.some((pattern) => matchesGlob(asset, pattern))).toBe(true)
    })
})
