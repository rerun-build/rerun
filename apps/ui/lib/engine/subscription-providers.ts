import type { Provider } from '@rerun/contracts'

// Billed flat by their provider: Claude and ChatGPT subscriptions.
export type SubscriptionProvider = Extract<Provider, 'claude' | 'codex'>

export const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ['claude', 'codex']

export function isSubscriptionProvider(provider: string | null | undefined): provider is SubscriptionProvider {
    return SUBSCRIPTION_PROVIDERS.some(subscription => subscription === provider)
}
