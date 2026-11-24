// @vitest-environment happy-dom
import { BrandProvider } from '@/components/brand/BrandProvider'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'
import { act, createElement, type ComponentProps } from 'react'
import { createRoot } from 'react-dom/client'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const openCrisp = vi.fn()
const sendToCrisp = vi.fn()
vi.mock('@/lib/crisp', () => ({ openCrisp: (...args: unknown[]) => openCrisp(...args), sendToCrisp: (...args: unknown[]) => sendToCrisp(...args) }))
vi.mock('@rerun/cloud/support', () => ({ SUPPORT_CHAT_ENABLED: true }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ session: { user: { email: 'ada@nordlys.example' } }, workspace: { id: 7 } }) }))

import { useSupport } from './useSupport'

function supportOf(brand: Brand) {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    let support: ReturnType<typeof useSupport> | undefined
    const Probe = () => {
        support = useSupport()
        return null
    }
    act(() => createRoot(document.createElement('div')).render(createElement(BrandProvider, { brand } as ComponentProps<typeof BrandProvider>, createElement(Probe))))
    return support!
}

const AGENCY: Brand = { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys', supportEmail: 'help@nordlys.example' }

describe('useSupport', () => {
    const assign = vi.fn()
    beforeEach(() => {
        vi.clearAllMocks()
        vi.spyOn(window.location, 'assign').mockImplementation(assign)
    })

    it('opens the chat of Rerun on its own brand', () => {
        const support = supportOf(RERUN_BRAND)
        support.open()
        support.send('stuck')
        expect(support.available).toBe(true)
        expect(openCrisp).toHaveBeenCalledWith('ada@nordlys.example')
        expect(sendToCrisp).toHaveBeenCalledWith({ email: 'ada@nordlys.example', workspaceId: 7, text: 'stuck' })
    })

    it('writes to the organization, never to the chat of Rerun', () => {
        const support = supportOf(AGENCY)
        support.send('It is stuck & slow')
        expect(assign).toHaveBeenCalledWith('mailto:help@nordlys.example?body=It%20is%20stuck%20%26%20slow')
        expect(openCrisp).not.toHaveBeenCalled()
        expect(sendToCrisp).not.toHaveBeenCalled()
    })

    it('offers nobody when the organization gave no address', () => {
        const support = supportOf({ ...AGENCY, supportEmail: null })
        support.open()
        expect(support.available).toBe(false)
        expect(assign).not.toHaveBeenCalled()
    })
})
