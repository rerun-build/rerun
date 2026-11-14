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
    isPremiumModelEntitled: (workspace: WorkspacePlan) => workspace.is_sandbox || isPaidSubscription(workspace.subscription_status),
    activeAgentLimitFor: (maxAgents: number | null, status: string | null | undefined) => (isSubscriptionEntitled(status) ? maxAgents : 0),
}

type PhoneRow = { verified_at: string | null; skipped_at: string | null; unverifiable_at: string | null } | null

export const CLOUD_PHONE = {
    PHONE_ENABLED: true,
    phoneStatusOf: (row: PhoneRow) => (!row ? 'none' : row.verified_at ? 'verified' : row.unverifiable_at ? 'unverifiable' : row.skipped_at ? 'skipped' : 'pending'),
}

export const CLOUD_MARKETPLACE = { MARKETPLACE_ENABLED: true }
