import type { Provider } from '@rerun/contracts'

// Billed flat by their provider: Claude, ChatGPT and SuperGrok subscriptions.
export type SubscriptionProvider = Extract<Provider, 'claude' | 'codex' | 'grok'>

export const SUBSCRIPTION_PROVIDERS: SubscriptionProvider[] = ['claude', 'codex', 'grok']

export function isSubscriptionProvider(provider: string | null | undefined): provider is SubscriptionProvider {
    return SUBSCRIPTION_PROVIDERS.some(subscription => subscription === provider)
}
