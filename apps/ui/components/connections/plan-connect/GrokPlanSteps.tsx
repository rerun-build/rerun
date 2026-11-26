'use client'

import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'

import type { GrokDeviceAuth } from '@/components/connections/use-grok-device-auth'
import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { CheckIcon, CopyIcon, ExternalLinkIcon } from '@/lib/icons'

import { ForemanTrack, type TrackStep } from './ForemanTrack'
import { StepError } from './step-bits'

// Two steps on xAI's side, then the caller's own: get a code, approve it on xAI's page. Nothing to
// switch on first, unlike ChatGPT: xAI takes a code from any account it signs in.
export function GrokPlanSteps({ auth, lastStep }: { auth: GrokDeviceAuth; lastStep: (linked: boolean) => TrackStep }) {
    const t = useTranslations('connections.grok')
    const { phase } = auth
    const linked = phase === 'connected'
    const waiting = phase === 'waiting'
    const last = lastStep(linked)

    return (
        <ForemanTrack
            at={linked ? 2 : waiting ? 1 : 0}
            done={linked ? 3 : waiting ? 1 : 0}
            orb={phase === 'starting' || waiting ? 'thinking' : linked ? 'speaking' : 'listening'}
            remark={(linked && last.remark) || t(`remarks.${remarkFor(auth)}`)}
            thinking={phase === 'starting' || waiting}
            steps={[
                { title: t('codeStep'), body: <CodeStep auth={auth} /> },
                { title: t('approveStep'), body: waiting && auth.pending ? <p className="text-xs leading-relaxed text-muted-foreground">{t.rich('enterCode', { link: chunks => <InlineLink href={auth.pending!.verificationUrl}>{chunks}</InlineLink> })}</p> : null },
                last,
            ]}
        />
    )
}

function remarkFor(auth: GrokDeviceAuth) {
    if (auth.phase === 'connected') return 'connected'
    if (auth.phase === 'starting') return 'starting'
    if (auth.phase === 'waiting') return 'waiting'
    if (auth.expired) return 'expired'
    return auth.error ? 'retry' : 'grabCode'
}

function CodeStep({ auth }: { auth: GrokDeviceAuth }) {
    const t = useTranslations('connections.grok')
    if (auth.phase === 'connected') return null
    const pending = auth.pending

    return (
        <div className="flex flex-col gap-2">
            {pending ? (
                <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-1.5 ps-4">
                    <code dir="ltr" className="min-w-0 flex-1 truncate font-mono text-lg font-medium tracking-[0.2em]">
                        {pending.userCode}
                    </code>
                    <Button type="button" size="icon" variant="ghost" onClick={auth.copy} aria-label={t('copyCode')}>
                        {auth.copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                    </Button>
                </div>
            ) : (
                <>
                    <TooltipDisabledReason reason={auth.opening && auth.phase !== 'starting' ? t('opening') : undefined} className="self-start">
                        <Button type="button" onClick={auth.start} disabled={auth.phase === 'starting' || auth.opening} className="gap-1.5 self-start">
                            <ProviderIcon provider="grok" className="size-3.5" />
                            {auth.phase === 'starting' ? t('gettingCode') : auth.expired || auth.error ? t('newCode') : t('getCode')}
                        </Button>
                    </TooltipDisabledReason>
                    <p className="text-xs leading-relaxed text-muted-foreground">{t('plans')}</p>
                </>
            )}
            <StepError error={auth.error} />
        </div>
    )
}

function InlineLink({ href, children }: { href: string; children: ReactNode }) {
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 font-medium text-foreground underline-offset-2 hover:underline">
            {children}
            <ExternalLinkIcon className="size-3" />
        </a>
    )
}
