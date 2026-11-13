// What Rerun Cloud answers about a plan, for the tests of code that only reads the answer. The open
// source build answers "entitled" to everything, so a test about what happens without a plan mocks
// `@rerun/cloud/billing` with these, and runs the same in both builds:
//
//   vi.mock('@rerun/cloud/billing', async importOriginal => ({ ...(await importOriginal<object>()), ...CLOUD_ENTITLEMENTS }))
type WorkspacePlan = { subscription_status: string | null; is_sandbox: boolean }

const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due'])

const isSubscriptionEntitled = (status: string | null | undefined) => ENTITLED_STATUSES.has(status ?? '')
const isPaidSubscription = (status: string | null | undefined) => isSubscriptionEntitled(status) && status !== 'trialing'

export const CLOUD_ENTITLEMENTS = {
    BILLING_ENABLED: true,
    isSubscriptionEntitled,
    isMachineEntitled: (status: string | null | undefined) => status === 'active' || status === 'trialing',
    isPaidSubscription,
    isWorkspaceApiEntitled: (workspace: WorkspacePlan) => workspace.is_sandbox || isSubscriptionEntitled(workspace.subscription_status),
    activeAgentLimitFor: (maxAgents: number | null, status: string | null | undefined) => (isSubscriptionEntitled(status) ? maxAgents : 0),
}

type PhoneRow = { verified_at: string | null; skipped_at: string | null; unverifiable_at: string | null } | null

// Rerun Cloud asks some accounts for a phone number; these read a `user_phones` row the way it does.
export const CLOUD_PHONE = {
    PHONE_ENABLED: true,
    phoneStatusOf: (row: PhoneRow) => (!row ? 'none' : row.verified_at ? 'verified' : row.unverifiable_at ? 'unverifiable' : row.skipped_at ? 'skipped' : 'pending'),
}

export const CLOUD_MARKETPLACE = { MARKETPLACE_ENABLED: true }
