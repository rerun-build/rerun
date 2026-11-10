'use client'

import { useTranslations } from 'next-intl'
import { Icon } from '@/components/ui/icon'
import type { AuthMethodSummary } from '@/lib/services/types'
import { ArrowRight, KeyIcon, LinkIcon, LogIn, TerminalSquare, type LucideIcon } from '@/lib/icons'

// The kinds that get their own fallback label and explainer; the others share the generic one.
export function methodKindKey(kind: AuthMethodSummary['kind']): 'oauth' | 'key' | 'stdio' | 'app' | 'other' {
    return kind === 'oauth' || kind === 'key' || kind === 'stdio' || kind === 'app' ? kind : 'other'
}

function methodKindIcon(kind: AuthMethodSummary['kind']): LucideIcon {
    switch (kind) {
        case 'oauth':
            return LogIn
        case 'key':
            return KeyIcon
        case 'stdio':
            return TerminalSquare
        default:
            return LinkIcon
    }
}

// Auth methods as a list to drill into: picking one opens its own configuration view.
// Renders nothing when a service exposes a single method.
export function AuthMethodPicker({ methods, onSelect }: { methods: AuthMethodSummary[]; onSelect: (id: string) => void }) {
    const t = useTranslations('services.authMethod')
    if (methods.length <= 1) return null
    return (
        <div className="flex flex-col gap-1.5">
            {methods.map(m => (
                <button key={m.id} type="button" onClick={() => onSelect(m.id)} className="group flex items-center gap-2.5 rounded-lg border border-border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted">
                    <Icon icon={methodKindIcon(m.kind)} size="sm" />
                    <span className="min-w-0 flex-1">
                        <span className="block font-medium">{m.label || t(`label.${methodKindKey(m.kind)}`)}</span>
                        <span className="block text-xs text-muted-foreground">{t(`description.${methodKindKey(m.kind)}`)}</span>
                    </span>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-colors group-hover:text-foreground" />
                </button>
            ))}
        </div>
    )
}
