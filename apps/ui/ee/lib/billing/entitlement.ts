const ENTITLED_STATUSES = new Set(['active', 'trialing', 'past_due'])

export function isSubscriptionEntitled(status: string | null | undefined): boolean {
    return ENTITLED_STATUSES.has(status ?? '')
}

export function isMachineEntitled(status: string | null | undefined): boolean {
    return status === 'active' || status === 'trialing'
}

export function isPaidSubscription(status: string | null | undefined): boolean {
    return isSubscriptionEntitled(status) && status !== 'trialing'
}

export function isTrialLapsed(status: string | null | undefined, firstPaidAt: string | null | undefined): boolean {
    if (firstPaidAt) return false
    return !isSubscriptionEntitled(status) || status === 'past_due'
}

export function isApiEntitled(status: string | null | undefined): boolean {
    return isSubscriptionEntitled(status)
}

export function isWorkspaceApiEntitled(workspace: { subscription_status: string | null; is_sandbox: boolean }): boolean {
    return workspace.is_sandbox || isApiEntitled(workspace.subscription_status)
}

export function isPremiumModelEntitled(workspace: { subscription_status: string | null; is_sandbox: boolean }): boolean {
    return workspace.is_sandbox || isPaidSubscription(workspace.subscription_status)
}

export function canEndTrialNow(subscription: { status: string | null | undefined; hasPaymentMethod: boolean; cancelAtPeriodEnd: boolean }): boolean {
    return subscription.status === 'trialing' && subscription.hasPaymentMethod && !subscription.cancelAtPeriodEnd
}
