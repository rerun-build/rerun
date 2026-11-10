'use client'

import type { SubscriptionProvider } from '@/components/agent/ModelPickerProviders'
import type { AddableProvider } from '@/lib/engine/ai-sources'
import { ProviderIcon } from '@/lib/engine/provider-icons'

export const PLANS: Record<SubscriptionProvider, { name: string }> = {
    claude: { name: 'Claude' },
    codex: { name: 'ChatGPT' },
}

// The providers behind the API key road, shown as a logo strip so the word "key" is not the only
// thing saying what it covers.
const KEY_LOGOS = ['openrouter', 'anthropic', 'openai', 'google'] as const

export function KeyLogos({ className = 'size-3.5' }: { className?: string }) {
    return (
        <span className="flex items-center gap-2">
            {KEY_LOGOS.map(provider => (
                <ProviderIcon key={provider} provider={provider} className={className} />
            ))}
        </span>
    )
}

export function RerunGlyph({ className }: { className?: string }) {
    return <ProviderIcon provider="rerun" className={className} />
}

// Icon takes a glyph component, and the provider marks are drawn by one dispatcher keyed by id.
type Glyph = (props: { className?: string }) => React.ReactNode

export const PROVIDER_GLYPH: Record<AddableProvider, Glyph> = {
    claude: ({ className }) => <ProviderIcon provider="claude" className={className} />,
    codex: ({ className }) => <ProviderIcon provider="codex" className={className} />,
    anthropic: ({ className }) => <ProviderIcon provider="anthropic" className={className} />,
    openai: ({ className }) => <ProviderIcon provider="openai" className={className} />,
    google: ({ className }) => <ProviderIcon provider="google" className={className} />,
    openrouter: ({ className }) => <ProviderIcon provider="openrouter" className={className} />,
    opencode: ({ className }) => <ProviderIcon provider="opencode" className={className} />,
    custom: ({ className }) => <ProviderIcon provider="custom" className={className} />,
}
