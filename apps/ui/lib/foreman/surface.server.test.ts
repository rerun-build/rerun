import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const edition = vi.hoisted(() => ({ cloud: true }))
vi.mock('@rerun/cloud/edition', () => ({
    get RERUN_CLOUD() {
        return edition.cloud
    },
}))
vi.mock('@/lib/onboarding/facts', () => ({ ONBOARDING_DIALOG_RELEASED_AT: '2026-12-01T00:00:00Z' }))
vi.mock('@/app/api/_services/workspace-engine.service', () => ({ findWorkspaceEngine: vi.fn(), ensureWorkspaceEngine: vi.fn() }))

import { ensureWorkspaceEngine, findWorkspaceEngine } from '@/app/api/_services/workspace-engine.service'
import { FOREMAN_PHASES } from './phase'
import { resolveForemanSurface } from './surface.server'

const signedIn = { canClaim: true }
const anonymous = { canClaim: false }

describe('resolveForemanSurface', () => {
    beforeEach(() => {
        vi.clearAllMocks()
        vi.mocked(findWorkspaceEngine).mockResolvedValue(null)
    })

    afterEach(() => {
        edition.cloud = true
    })

    describe('once the onboarding dialog is out', () => {
        const dialog = { phase: 'plan' as const, foreman: { profileAt: '2026-12-02T10:00:00Z' }, onboardingCompletedAt: null, workspaceCreatedAt: '2026-12-02T09:00:00Z' }

        it('gives a workspace of the dialog nobody to talk to until its box is claimed', async () => {
            expect(await resolveForemanSurface(7, dialog, signedIn)).toBe('none')
        })

        it('hands it to the Chief of Staff on its box, whatever the hub phase says', async () => {
            vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'box-1' } as never)
            expect(await resolveForemanSurface(7, dialog, signedIn)).toBe('engine')
        })

        it('never claims the compose engine for it: its claiming step does', async () => {
            edition.cloud = false
            expect(await resolveForemanSurface(7, { ...dialog, phase: 'companion' }, signedIn)).toBe('none')
            expect(ensureWorkspaceEngine).not.toHaveBeenCalled()
        })

        it('keeps a workspace from before the release on the hub onboarding', async () => {
            expect(await resolveForemanSurface(7, { ...dialog, foreman: {}, workspaceCreatedAt: '2026-11-20T00:00:00Z' }, signedIn)).toBe('onboarding')
        })
    })

    it('keeps every step of the onboarding on the hub without asking the pool', async () => {
        for (const phase of FOREMAN_PHASES.filter(phase => phase !== 'companion')) {
            expect(await resolveForemanSurface(7, { phase }, signedIn)).toBe('onboarding')
        }
        expect(findWorkspaceEngine).not.toHaveBeenCalled()
        expect(ensureWorkspaceEngine).not.toHaveBeenCalled()
    })

    it('hands a companion with a machine to the foreman on it, whoever is looking', async () => {
        vi.mocked(findWorkspaceEngine).mockResolvedValue({ instanceId: 'box-1' } as never)
        expect(await resolveForemanSurface(7, { phase: 'companion' }, anonymous)).toBe('engine')
        expect(ensureWorkspaceEngine).not.toHaveBeenCalled()
    })

    it('never claims a machine on Rerun Cloud', async () => {
        expect(await resolveForemanSurface(7, { phase: 'companion' }, signedIn)).toBe('none')
        expect(ensureWorkspaceEngine).not.toHaveBeenCalled()
    })

    describe('on a self-hosted install', () => {
        beforeEach(() => {
            edition.cloud = false
        })

        it('leaves the compose engine alone for an anonymous visitor, whose workspace is thrown away', async () => {
            expect(await resolveForemanSurface(7, { phase: 'companion' }, anonymous)).toBe('none')
            expect(ensureWorkspaceEngine).not.toHaveBeenCalled()
        })

        it('hands the compose engine to the first signed-in workspace past its onboarding', async () => {
            vi.mocked(ensureWorkspaceEngine).mockResolvedValue({ ok: true, instanceId: 'compose' })
            expect(await resolveForemanSurface(7, { phase: 'companion' }, signedIn)).toBe('engine')
            expect(ensureWorkspaceEngine).toHaveBeenCalledWith(7)
        })

        it('shows no foreman when the compose engine is already taken', async () => {
            vi.mocked(ensureWorkspaceEngine).mockResolvedValue({ ok: false, error: 'This workspace has no server yet.' })
            expect(await resolveForemanSurface(7, { phase: 'companion' }, signedIn)).toBe('none')
        })

        it('logs a claim that blew up instead of swallowing it', async () => {
            const error = vi.spyOn(console, 'error').mockImplementation(() => {})
            vi.mocked(ensureWorkspaceEngine).mockRejectedValue(new Error('pool down'))
            expect(await resolveForemanSurface(7, { phase: 'companion' }, signedIn)).toBe('none')
            expect(error).toHaveBeenCalledWith(expect.stringContaining('workspace 7'), expect.any(Error))
            error.mockRestore()
        })
    })
})
