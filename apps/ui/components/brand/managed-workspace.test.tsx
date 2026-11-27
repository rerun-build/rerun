// @vitest-environment happy-dom
import { NextIntlClientProvider } from 'next-intl'
import { act, createElement, type ComponentProps, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ENGLISH_MESSAGES } from '@rerun/i18n/messages/en'
import { RERUN_BRAND, type Brand } from '@rerun/contracts'

const NORDLYS: Brand = { ...RERUN_BRAND, organizationId: 'org-nordlys', name: 'Nordlys', supportEmail: 'help@nordlys.test' }
const MANAGED = { id: 7, name: 'Acme', plan: 'organization', subscription_status: 'active', organization_id: 'org-nordlys', is_sandbox: false, boxes_archived_at: null, trial_ends_at: null, rerun_budget_micros: 0, rerun_used_micros: 0, rerun_topup_micros: 0, rerun_credit_paused_at: null }
const OWN = { ...MANAGED, plan: 'base', subscription_status: 'canceled', organization_id: null }

const mocks = vi.hoisted(() => ({ workspace: null as unknown, role: 'admin', loadBrand: vi.fn(), billingOpen: vi.fn(), subscriptionState: vi.fn(), pause: vi.fn() }))

vi.mock('@/supabase/session/SessionProvider', () => ({
    useSession: () => ({ workspace: mocks.workspace, role: mocks.role, user: { id: 'member' }, refreshWorkspace: async () => {}, session: null }),
    useOptionalSession: () => ({ workspace: mocks.workspace }),
    useIsWorkspaceAdmin: () => mocks.role === 'admin',
}))
vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...(await import('@/test/cloud-fakes')).CLOUD_ENTITLEMENTS }))
vi.mock('@/app/api/_actions/workspace-brand.actions', () => ({ loadWorkspaceBrandAction: mocks.loadBrand }))
vi.mock('@/app/api/_actions/workspace-restore.actions', () => ({ getSandboxArchiveStateAction: vi.fn(), getWorkspaceRestoreStageAction: vi.fn(async () => 'waiting') }))
vi.mock('@/app/api/_actions/agent.actions', () => ({ activateAgentAction: vi.fn() }))
vi.mock('@/ee/actions/billing.actions', () => ({ getSubscriptionStateAction: mocks.subscriptionState, getLifetimeBillingStateAction: mocks.subscriptionState, getCreditUsageAction: async () => ({ ok: true, usage: { bySource: [], byCoworker: [], latest: [], byDay: [], period: { start: '2026-11-01', end: '2026-12-01' } } }), setRerunCreditPausedAction: mocks.pause }))
vi.mock('@/ee/components/dialogs/billing/CheckoutDialog', () => ({ CheckoutDialog: () => 'CHECKOUT' }))
vi.mock('@/ee/components/dialogs/billing/tiles/BillingTilesDialog', () => ({ BillingTilesDialog: () => 'PLAN', BillingTilesSkeleton: () => 'PLAN' }))
vi.mock('@/ee/components/dialogs/billing/tiles/LifetimeTilesDialog', () => ({ LifetimeTilesDialog: () => 'LIFETIME' }))
vi.mock('@/ee/components/dialogs/billing/CreditPane', () => ({ CreditPane: () => 'CREDIT_PANE' }))
vi.mock('@/ee/components/dialogs/cancel-subscription/CancelSubscriptionDialog', () => ({ CancelSubscriptionDialog: () => null }))
vi.mock('@/ee/lib/billing/useCreditCheckoutReturn', () => ({ useCreditCheckoutReturn: () => {} }))
vi.mock('@/stores/board.store', () => {
    const state = { agents: [], spaces: [{ id: 'box' }], requestCreation: () => {}, _localActivateAgent: () => {} }
    return { useBoardStore: Object.assign((select: (value: typeof state) => unknown) => select(state), { getState: () => state }) }
})
vi.mock('@/supabase/client', () => ({ createClient: () => ({}) }))
vi.mock('@rerun/analytics/client', () => ({ track: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => {}, push: () => {} }), usePathname: () => '/', useSearchParams: () => new URLSearchParams() }))

const { BrandProvider, useBrand } = await import('./BrandProvider')
const { WorkspaceBrandProvider } = await import('./WorkspaceBrandProvider')
const { RerunOnly } = await import('./RerunOnly')
const { WorkspacePausedBanner } = await import('@/components/layout/WorkspacePausedBanner')
const { AgentLockedOverlay } = await import('@/components/agent/AgentLockedOverlay')
const { NoPlanNotice } = await import('@/components/connections/NoPlanNotice')
const { SpendCard } = await import('@/components/chat/spend/SpendCard')
const { BudgetExhaustedNotice } = await import('@/ee/components/chat/BudgetExhaustedNotice')
const { UpgradePill } = await import('@/ee/components/layout/UpgradePill')
const { BillingDialog } = await import('@/ee/components/dialogs/BillingDialog')
const { useTemplateCta } = await import('@/lib/templates/useTemplateCta')
const { useAgentShareCta } = await import('@/lib/agents/useAgentShareCta')
const { useWorkspaceAccess } = await import('@/hooks/useWorkspaceAccess')
const { buildControlCommands } = await import('@/lib/control-center/commands')
const { useBillingStore } = await import('@/stores/billing.store')

const SELLS = /subscribe|upgrade|top up|buy|billing|free trial|start pro|add credits|payment|rerun/i

let root: Root
let host: HTMLElement

async function draw(node: ReactNode, brand: Brand = NORDLYS) {
    const props = { locale: 'en', messages: ENGLISH_MESSAGES, timeZone: 'UTC' } as ComponentProps<typeof NextIntlClientProvider>
    await act(async () => root.render(createElement(NextIntlClientProvider, props, createElement(BrandProvider, { brand } as ComponentProps<typeof BrandProvider>, node))))
    await act(async () => {})
    return document.body.textContent ?? ''
}

const mailto = () => [...document.body.querySelectorAll('a[href^="mailto:"]')].map(a => a.getAttribute('href'))

beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.clearAllMocks()
    mocks.workspace = MANAGED
    mocks.role = 'admin'
    useBillingStore.setState({ open: false, highlightAddon: null, trigger: null, upgrade: null })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
})

afterEach(async () => {
    await act(async () => root.unmount())
    document.body.innerHTML = ''
})

describe('the brand of a managed workspace on Rerun’s own host', () => {
    const Probe = () => createElement('span', null, `[${useBrand().name}]`, createElement(RerunOnly, null, 'RERUN_ONLY'))
    const inWorkspace = (initial: Brand) => createElement(WorkspaceBrandProvider, { initial } as ComponentProps<typeof WorkspaceBrandProvider>, createElement(Probe))

    it('is the organization’s from the first paint when the page was rendered for it', async () => {
        expect(await draw(inWorkspace(NORDLYS), RERUN_BRAND)).toBe('[Nordlys]')
        expect(mocks.loadBrand).not.toHaveBeenCalled()
    })

    it('is read for a tab on another workspace, and shows nothing of Rerun meanwhile', async () => {
        let answer: (brand: Brand) => void = () => {}
        mocks.loadBrand.mockReturnValue(new Promise<Brand>(resolve => (answer = resolve)))
        expect(await draw(inWorkspace(RERUN_BRAND), RERUN_BRAND)).toBe('[]')
        await act(async () => answer(NORDLYS))
        expect(document.body.textContent).toBe('[Nordlys]')
    })

    it('stays Rerun’s for a direct customer', async () => {
        mocks.workspace = OWN
        expect(await draw(inWorkspace(RERUN_BRAND), RERUN_BRAND)).toBe('[Rerun]RERUN_ONLY')
        expect(mocks.loadBrand).not.toHaveBeenCalled()
    })
})

describe('a managed workspace put away by its organization', () => {
    beforeEach(() => {
        mocks.workspace = { ...MANAGED, subscription_status: 'canceled' }
    })

    it('is paused at once, before its machine is archived, and nothing expires', async () => {
        const seen: unknown[] = []
        const Probe = () => {
            seen.push(useWorkspaceAccess())
            return null
        }
        await draw(createElement(Probe))
        expect(seen.at(-1)).toMatchObject({ access: 'paused', keptUntil: null, paymentFailed: false, needsMachineReason: 'This workspace is paused. Contact Nordlys.' })
    })

    it.each([
        ['the board', () => createElement(WorkspacePausedBanner)],
        ['a coworker', () => createElement(AgentLockedOverlay, { agent: { id: 'a', name: 'Otto', disabledAt: null } as never })],
        ['the AI providers', () => createElement(NoPlanNotice)],
    ])('says who to contact on %s, and sells nothing', async (_where, node) => {
        const text = await draw(node())
        expect(text).toContain('Contact Nordlys')
        expect(text).not.toMatch(SELLS)
        expect(mailto()).toEqual(['mailto:help@nordlys.test'])
    })

    it('names the organization without an address to write to', async () => {
        const text = await draw(createElement(WorkspacePausedBanner), { ...NORDLYS, supportEmail: null })
        expect(text).toContain('Contact Nordlys')
        expect(mailto()).toEqual([])
    })

    it('has no upgrade pill, no billing command and a closed API panel', async () => {
        expect(await draw(createElement(UpgradePill))).toBe('')
        const gates = { isSandbox: false, managed: true, apiPausedReason: 'paused', workspaceAdmin: true, apiEntitled: false, apiLocked: false, needsMachineReason: 'paused', assistantReady: false, hasChangelog: false, darkTheme: false, supportAvailable: true }
        const commands = buildControlCommands(gates)
        expect(commands.map(command => command.id)).not.toContain('billing')
        expect(commands.find(command => command.id === 'api_keys')).toMatchObject({ paid: false, disabledReason: 'paused' })
    })
})

describe('a managed workspace out of credit', () => {
    it.each([
        ['the chat of a coworker', { onConnectProvider: () => {} }],
        ['a chat with nowhere to connect', {}],
        ['a chat with a plan already connected', { ownConnection: { label: 'Claude', provider: 'claude', onUse: () => {} } }],
        ['a chat whose workspace never had credit', { noCredit: true }],
        ['a paused workspace', { preTrial: true }],
    ])('is told to contact its organization in %s', async (_where, props) => {
        const text = await draw(createElement(BudgetExhaustedNotice, { ...props, manager: { name: 'Nordlys', supportEmail: 'help@nordlys.test' } }))
        expect(text).toContain('Contact Nordlys')
        expect(text).not.toMatch(/subscribe|top up|upgrade|free trial|next month|lifetime/i)
        expect(mailto()).toEqual(['mailto:help@nordlys.test'])
    })

    it('still offers its own AI', async () => {
        const text = await draw(createElement(BudgetExhaustedNotice, { onConnectProvider: () => {}, manager: { name: 'Nordlys', supportEmail: null } }))
        expect(text).toContain('Connect Claude')
        expect(text).toContain('Connect ChatGPT')
        expect(text).toContain('Use an API key')
    })

    it('asks the organization for the credit a purchase is short of', async () => {
        const quote = { lines: [], totalMicros: 10_000_000, creditLeftMicros: 1_000_000 } as never
        const request = { purpose: 'Find leads', lines: [] } as never
        const text = await draw(createElement(SpendCard, { request, quote, onSubmit: () => {}, manager: { name: 'Nordlys', supportEmail: 'help@nordlys.test' } }))
        expect(text).toContain('Contact Nordlys')
        expect(text).not.toContain('Add credits')
    })
})

describe('the billing dialog of a managed workspace', () => {
    it('is its credit and nothing to buy, whatever opened it', async () => {
        for (const highlight of [undefined, 'credit_pack', 'referrals'] as const) {
            await act(async () => useBillingStore.getState().openBilling(highlight, 'manual'))
            const text = await draw(createElement(BillingDialog))
            expect(text).toContain('Provided by Nordlys')
            expect(text).toContain('Out of credits')
            expect(text).not.toMatch(/CHECKOUT|PLAN|LIFETIME|CREDIT_PANE/)
            await act(async () => useBillingStore.getState().setOpen(false))
        }
        expect(mocks.subscriptionState).not.toHaveBeenCalled()
    })

    it('is the checkout of a direct customer', async () => {
        mocks.workspace = OWN
        useBillingStore.getState().openBilling(undefined, 'manual')
        expect(await draw(createElement(BillingDialog), RERUN_BRAND)).toContain('CHECKOUT')
    })
})

describe('what a managed workspace installs', () => {
    const template = (overrides: object) => ({ id: 't', slug: 'lead-scout', title: 'Lead Scout', archiveAgentNames: ['Scout'], pricing: { model: 'one_time', amountCents: 4900, currency: 'usd' }, owned: false, isMine: false, access: 'none', ...overrides }) as never

    async function ctaOf(read: () => unknown) {
        let seen: unknown
        const Probe = () => {
            seen = read()
            return null
        }
        await draw(createElement(Probe))
        return seen
    }

    it('is never a template to buy', async () => {
        expect(await ctaOf(() => useTemplateCta(template({}), () => {}))).toMatchObject({ gate: 'blocked', disabled: true, disabledReason: 'Not available in this workspace', steps: [] })
    })

    it('is a free template', async () => {
        expect(await ctaOf(() => useTemplateCta(template({ pricing: { model: 'free', amountCents: 0, currency: 'usd' }, owned: true }), () => {}))).toMatchObject({ gate: 'place', disabled: false })
    })

    it('waits while the workspace is paused, with no plan to start', async () => {
        mocks.workspace = { ...MANAGED, subscription_status: 'canceled' }
        expect(await ctaOf(() => useTemplateCta(template({ owned: true }), () => {}))).toMatchObject({ gate: 'blocked', disabledReason: 'This workspace is paused. Contact Nordlys.' })
        expect(await ctaOf(() => useAgentShareCta('token', { agent: { name: 'Otto' } } as never, () => {}))).toMatchObject({ gate: 'place', disabledReason: 'This workspace is paused. Contact Nordlys.', steps: [] })
    })
})
