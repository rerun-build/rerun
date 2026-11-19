import { describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
    redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`) }),
    permanentRedirect: vi.fn((url: string) => { throw new Error(`permanent:${url}`) }),
}))

vi.mock('next/navigation', () => ({ redirect: mocks.redirect, permanentRedirect: mocks.permanentRedirect }))
vi.mock('@/components/factory/FactoryPage', () => ({ FactoryPage: () => null }))
vi.mock('@/components/layout/HomeContent', () => ({ HomeContent: () => null }))
vi.mock('@/components/layout/AppLoader', () => ({ AppLoader: () => null }))
vi.mock('@/app/api/_auth/expert', () => ({ hasPendingCreatorTerms: vi.fn() }))
vi.mock('@/app/api/_services/sandbox.service', () => ({ resolveCreatorLandingWorkspace: vi.fn() }))
vi.mock('@/supabase/server', () => ({ createClient: async () => ({ auth: { getUser: async () => ({ data: { user: null } }) } }) }))

import { FactoryPage } from '@/components/factory/FactoryPage'
import { HomeContent } from '@/components/layout/HomeContent'
import BoardPage from './board/page'
import FactoryRedirect from './factory/page'
import Home from './page'

describe('dashboard routes', () => {
    it('/ renders the factory', async () => {
        const page = await Home({ searchParams: Promise.resolve({}) })
        expect(page.type).toBe(FactoryPage)
    })

    it('/ hands a link with a query to the board, keeping every parameter', async () => {
        await expect(Home({ searchParams: Promise.resolve({ template: 'seo', tag: ['a', 'b'] }) })).rejects.toThrow('redirect:/board?template=seo&tag=a&tag=b')
    })

    it('/board renders the board', async () => {
        const page = await BoardPage()
        expect(page.props.children.type).toBe(HomeContent)
    })

    it('/factory moves permanently to /', () => {
        expect(() => FactoryRedirect()).toThrow('permanent:/')
    })
})
