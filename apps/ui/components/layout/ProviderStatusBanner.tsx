'use client'

import { TextShimmer } from '@rerun/ui'
import { useLocale, useTranslations } from 'next-intl'
import { useState } from 'react'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { useProviderIncidents } from '@/hooks/useProviderIncidents'
import { useWorkspaceConnections } from '@/hooks/useWorkspaceConnections'
import { TriangleAlertIcon, XIcon } from '@/lib/icons'
import { statusPagesFor } from '@/lib/provider-status/provider-status'
import { cn } from '@/lib/utils'

const DISMISSED_KEY = 'rerun_provider_incidents_dismissed'

function readDismissed(): string[] {
    try {
        const stored: unknown = JSON.parse(localStorage.getItem(DISMISSED_KEY) ?? '[]')
        return Array.isArray(stored) ? stored.filter(id => typeof id === 'string') : []
    } catch {
        return []
    }
}

// A workspace only hears about the providers it has its own connection to. The Rerun hub alone
// never raises the banner: it goes through OpenRouter, which no status page here speaks for.
export function ProviderStatusBanner() {
    const { connections } = useWorkspaceConnections()
    const pages = statusPagesFor(connections.filter(connection => connection.connected).map(connection => connection.provider))
    if (pages.length === 0) return null
    return <ProviderIncidentsBanner pages={pages} />
}

function ProviderIncidentsBanner({ pages }: { pages: string[] }) {
    const t = useTranslations('layout.providerStatus')
    const locale = useLocale()
    const incidents = useProviderIncidents().filter(incident => pages.includes(incident.provider))
    const [dismissedNow, setDismissedNow] = useState<string[] | null>(null)

    if (incidents.length === 0) return null

    // Incidents only ever arrive from the client poll, so storage is never read during a server render.
    const dismissed = dismissedNow ?? readDismissed()
    const active = incidents.filter(incident => !dismissed.includes(incident.id))
    if (active.length === 0) return null

    // Keyed by incident, so the next one shows again. Only the live ids are kept: the list never grows.
    const dismiss = () => {
        const next = incidents.map(incident => incident.id)
        localStorage.setItem(DISMISSED_KEY, JSON.stringify(next))
        setDismissedNow(next)
    }

    const outage = active.some(incident => incident.severity === 'outage')
    const providers = new Intl.ListFormat(locale, { type: 'conjunction' }).format(active.map(incident => incident.label))
    const many = active.length > 1
    const headline = many ? t('headline.many', { providers }) : t('headline.one', { providers })

    return (
        <div role="status" className="shrink-0 border-b border-border px-2 pb-1 md:border-b-0 md:px-0">
            <div className="relative flex flex-nowrap items-center justify-center gap-x-2 gap-y-1 py-1 pl-1 pr-8 text-center text-sm text-foreground md:flex-wrap md:gap-x-3 md:px-8">
                <Icon icon={TriangleAlertIcon} size="xs" glyphClassName={cn(outage ? 'text-destructive' : 'text-amber-500')} />
                <TextShimmer as="span" duration={5} className="min-w-0 truncate font-medium md:hidden">
                    {headline}
                </TextShimmer>
                <TextShimmer as="span" duration={5} className="hidden font-medium md:inline-block">
                    {many ? t('headlineLong.many', { providers }) : t('headlineLong.one', { providers })}
                </TextShimmer>
                <Button asChild size="sm" className="h-6 shrink-0 rounded-full px-3">
                    <a href={active[0].url} target="_blank" rel="noopener noreferrer">
                        {t('viewStatus')}
                    </a>
                </Button>
                <button
                    type="button"
                    onClick={dismiss}
                    aria-label={t('dismiss')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground transition-colors hover:text-foreground"
                >
                    <XIcon className="size-3.5" />
                </button>
            </div>
        </div>
    )
}
