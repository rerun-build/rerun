// @vitest-environment happy-dom
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ inTeam: vi.fn(), user: { id: 'u1' } as { id: string } | null }))
vi.mock('@/ee/actions/organization-entry.actions', () => ({ inOrganizationTeamAction: mocks.inTeam }))
vi.mock('@/supabase/session/SessionProvider', () => ({ useSession: () => ({ user: mocks.user }) }))
vi.mock('@/components/ui/dropdown-menu', () => ({ DropdownMenuItem: ({ children }: { children: React.ReactNode }) => <div role="menuitem">{children}</div> }))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.resetModules()
    localStorage.clear()
    mocks.inTeam.mockReset().mockResolvedValue(true)
    mocks.user = { id: 'u1' }
    container = document.createElement('div')
    document.body.appendChild(container)
    root = createRoot(container)
})

afterEach(() => {
    act(() => root.unmount())
    container.remove()
})

async function openMenu() {
    const { OrganizationMenuItem } = await import('./OrganizationMenuItem')
    await act(async () => root.render(<OrganizationMenuItem key={Math.random()} />))
}

describe('OrganizationMenuItem', () => {
    it('leads someone of a team to their console, and asks once', async () => {
        await openMenu()
        expect(container.querySelector('a')?.getAttribute('href')).toBe('/organization')
        await openMenu()
        expect(container.querySelector('a')).toBeTruthy()
        expect(mocks.inTeam).toHaveBeenCalledTimes(1)
    })

    it('is nothing to anyone else, nor when the server does not answer', async () => {
        mocks.inTeam.mockResolvedValue(false)
        await openMenu()
        expect(container.innerHTML).toBe('')
        mocks.user = { id: 'u2' }
        mocks.inTeam.mockRejectedValue(new Error('offline'))
        await openMenu()
        expect(container.innerHTML).toBe('')
    })

    it('never shows one account what another one is', async () => {
        await openMenu()
        mocks.user = { id: 'u2' }
        mocks.inTeam.mockReturnValue(new Promise(() => {}))
        await openMenu()
        expect(container.innerHTML).toBe('')
    })

    it('draws at once what this browser knows, and drops it once off the team', async () => {
        localStorage.setItem('rerun:organization-team:u1', '1')
        mocks.inTeam.mockResolvedValue(false)
        await openMenu()
        expect(container.innerHTML).toBe('')
        expect(localStorage.getItem('rerun:organization-team:u1')).toBeNull()
    })
})
