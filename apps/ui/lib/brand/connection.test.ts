import { RERUN_BRAND } from '@rerun/contracts'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@rerun/cloud/feature-requests', () => ({ FEATURE_REQUESTS_ENABLED: true }))
vi.mock('./workspace', () => ({
    workspaceBrand: vi.fn(async (id: number) => {
        if (id === 9) throw new Error('database down')
        return id === 7 ? { ...RERUN_BRAND, organizationId: 'org', name: 'Nordlys' } : RERUN_BRAND
    }),
}))

const { offersTeamRequests } = await import('./connection')

const machine = (workspaceId?: number) => ({ baseUrl: 'https://box.example', apiKey: 'key', workspaceId })

describe('a request to the Rerun team', () => {
    it('is offered to the workspaces of Rerun, never to the clients of an organization', async () => {
        expect(await offersTeamRequests(machine(1))).toBe(true)
        expect(await offersTeamRequests(machine())).toBe(true)
        expect(await offersTeamRequests(machine(7))).toBe(false)
    })

    it('is not offered, and holds no chat turn back, when the brand cannot be read', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => {})
        expect(await offersTeamRequests(machine(9))).toBe(false)
    })
})
