import { RERUN_BRAND } from '@rerun/contracts'
import type { NextConfig } from 'next'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { brandIcons, brandManifestIcons, RERUN_FAVICON } from './icons'

const AGENCY = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', iconUrl: 'https://cdn.example/icon.png' }
const inPublic = (url: string) => existsSync(path.resolve(__dirname, '../../public', url.slice(1)))

describe('brand icons', () => {
    it('keeps the files of Rerun, every one of them served', () => {
        const { icon, apple } = brandIcons(RERUN_BRAND) as { icon: { url: string }[]; apple: { url: string } }
        const urls = [...icon.map(entry => entry.url), apple.url, ...(brandManifestIcons(RERUN_BRAND) ?? []).map(entry => entry.src)]
        expect(urls).toEqual([RERUN_FAVICON, '/icon.png', '/apple-icon.png', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png'])
        expect(urls.filter(url => !inPublic(url))).toEqual([])
    })

    it('serves them from paths no redirect takes over', async () => {
        vi.stubEnv('NEXT_PUBLIC_ADMIN_URL', 'https://admin.example')
        vi.resetModules()
        const { default: config } = await import('../../next.config')
        // withPostHogConfig hands Next a function of the build phase.
        const resolved = await (config as unknown as (phase: string, context: object) => Promise<NextConfig>)('phase-production-server', { defaultConfig: {} })
        const sources = ((await resolved.redirects?.()) ?? []).map(redirect => redirect.source.replace(/\/:.*$/, ''))
        expect(sources).toContain('/brand')
        const { icon, apple } = brandIcons(RERUN_BRAND) as { icon: { url: string }[]; apple: { url: string } }
        const urls = [...icon.map(entry => entry.url), apple.url, ...(brandManifestIcons(RERUN_BRAND) ?? []).map(entry => entry.src)]
        expect(urls.filter(url => sources.some(source => url === source || url.startsWith(`${source}/`)))).toEqual([])
        vi.unstubAllEnvs()
    })

    it('draws every size of an organization from its image', () => {
        expect(brandIcons(AGENCY)).toEqual({ icon: AGENCY.iconUrl, apple: AGENCY.iconUrl })
        expect(brandManifestIcons(AGENCY)).toEqual([{ src: AGENCY.iconUrl, sizes: '512x512', type: 'image/png', purpose: 'any' }])
    })
})
