const REPLACEABLE_STATUSES = new Set(['canceled', 'incomplete_expired', 'unpaid', 'paused'])

export function isSameSubscription(storedSubscriptionId: string | null | undefined, incomingSubscriptionId: string): boolean {
    return !storedSubscriptionId || storedSubscriptionId === incomingSubscriptionId
}

export function shouldAdoptSubscription(
    stored: { id: string | null | undefined; status: string | null | undefined },
    incomingSubscriptionId: string,
): boolean {
    if (isSameSubscription(stored.id, incomingSubscriptionId)) return true
    return REPLACEABLE_STATUSES.has(stored.status ?? '')
}
