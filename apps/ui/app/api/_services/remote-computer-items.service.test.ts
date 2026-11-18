import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('server-only', () => ({}))
vi.mock('@/flags', () => ({ releasedOrEarlyAccess: vi.fn() }))
vi.mock('@/app/api/_services/members.service', () => ({ resolveMemberIdentities: vi.fn(async () => new Map()) }))
vi.mock('@/app/api/_services/remote-computers.service', () => ({ hasLinkedComputers: vi.fn(), listWorkspaceComputers: vi.fn() }))

const { hasLinkedComputers, listWorkspaceComputers } = await import('@/app/api/_services/remote-computers.service')
const { mentionComputerItems } = await import('./remote-computer-items.service')

const ctx = { userId: 'u1', userEmail: 'claire@example.com', authUser: { is_anonymous: false }, workspace: { id: 7 }, role: 'member', supabase: {} } as never

beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(listWorkspaceComputers).mockResolvedValue({ computers: [], engine: 'ok' })
})

describe('mentionComputerItems', () => {
    it('answers an empty list without asking the box when the workspace has no computer', async () => {
        vi.mocked(hasLinkedComputers).mockResolvedValue(false)
        expect(await mentionComputerItems(ctx)).toEqual({ computers: [], engine: 'none' })
        expect(listWorkspaceComputers).not.toHaveBeenCalled()
    })

    it('reads the box once a computer is linked', async () => {
        vi.mocked(hasLinkedComputers).mockResolvedValue(true)
        expect(await mentionComputerItems(ctx)).toEqual({ computers: [], engine: 'ok' })
        expect(listWorkspaceComputers).toHaveBeenCalledWith(7)
    })
})
