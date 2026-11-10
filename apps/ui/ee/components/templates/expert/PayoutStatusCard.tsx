'use client'

import { marketplaceFeeLabel } from '@rerun/contracts'
import { Badge, Stripes } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import type { CreatorAccountState } from '@/ee/services/connect.service'
import { Button } from '@/components/ui/button'
import { ExternalLinkIcon, RotateCwIcon } from '@/lib/icons'
import { landingUrl } from '@/lib/site'
import { payoutStateLabel, payoutStateTone, requirementLabel } from '@/ee/lib/templates/payouts'


export function PayoutStatusCard({
    account,
    pending,
    onStartOnboarding,
    onOpenDashboard,
    onReload,
}: {
    account: CreatorAccountState
    pending: 'onboarding' | 'dashboard' | null
    onStartOnboarding: () => void
    onOpenDashboard: () => void
    onReload: () => void
}) {
    const t = useTranslations('templates.payouts')
    const copy = {
        headline: t(`states.${account.state}.headline`),
        body: t(`states.${account.state}.body`, { fee: marketplaceFeeLabel() }),
        cta: t(`states.${account.state}.cta`),
    }
    const verifying = account.state === 'pending_verification'
    const ready = account.state === 'ready'

    return (
        <div className="relative flex flex-col gap-3 overflow-hidden rounded-lg border border-border/60 bg-muted/30 p-4">
            <Stripes />

            <div className="relative flex items-start justify-between gap-3">
                <div className="space-y-1">
                    <p className="text-sm font-medium">{copy.headline}</p>
                    <p className="max-w-[46ch] text-xs text-muted-foreground">{copy.body}</p>
                </div>
                <Badge tone={payoutStateTone(account.state)} size="xs" glow={false} className="shrink-0 font-medium">
                    {payoutStateLabel(account.state, t)}
                </Badge>
            </div>

            {account.disabledReason && <p className="relative text-xs text-destructive">{t('stripeReported', { reason: account.disabledReason.replace(/[._]/g, ' ') })}</p>}

            {account.requirementsDue.length > 0 && (
                <ul className="relative flex flex-col gap-1">
                    {account.requirementsDue.map(requirement => (
                        <li key={requirement} className="text-xs text-muted-foreground">
                            {requirementLabel(requirement, t)}
                        </li>
                    ))}
                </ul>
            )}

            {ready && account.country && (
                <p className="relative text-xs text-muted-foreground">
                    {account.country}
                    {account.defaultCurrency && ` · ${account.defaultCurrency.toUpperCase()}`}
                </p>
            )}

            <div className="relative flex">
                {verifying ? (
                    <Button type="button" size="sm" variant="outline" onClick={onReload}>
                        <RotateCwIcon className="size-3.5" />
                        {copy.cta}
                    </Button>
                ) : ready ? (
                    <Button type="button" size="sm" variant="outline" loading={pending === 'dashboard'} onClick={onOpenDashboard}>
                        <ExternalLinkIcon className="size-3.5" />
                        {copy.cta}
                    </Button>
                ) : (
                    <Button type="button" size="sm" loading={pending === 'onboarding'} onClick={onStartOnboarding}>
                        {copy.cta}
                    </Button>
                )}
            </div>

            {!ready && !verifying && (
                <p className="relative text-[11px] text-muted-foreground">
                    {t.rich('terms', {
                        link: chunks => (
                            <a href={landingUrl('/marketplace-terms')} target="_blank" rel="noreferrer" className="underline underline-offset-2 transition-colors hover:text-foreground">
                                {chunks}
                            </a>
                        ),
                    })}
                </p>
            )}
        </div>
    )
}
