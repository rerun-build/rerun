'use client'

import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'

import type { CodexDeviceAuth } from '@/components/connections/use-codex-device-auth'
import { Button } from '@/components/ui/button'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { ProviderIcon } from '@/lib/engine/provider-icons'
import { CheckIcon, ChevronRightIcon, CopyIcon, ExternalLinkIcon, TriangleAlertIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { CHATGPT_SECURITY_URL, STUCK_AFTER_MS } from './chatgpt-setup'
import { ForemanTrack, type TrackStep } from './ForemanTrack'
import { StepError } from './step-bits'

// OpenAI only takes the device code once the account allows it, a switch in ChatGPT's own settings
// (or the workspace admin's, on a Business or Enterprise plan). Nothing tells us it is off: the
// approval just never comes. So the switch is the first step, one click away for whoever already
// flipped it ("It's already on" goes straight for the code), and the wait brings it back up.
export function ChatGptPlanSteps({ auth, lastStep }: { auth: CodexDeviceAuth; lastStep: (linked: boolean) => TrackStep }) {
    const t = useTranslations('connections.chatgpt')
    const [settingsOpened, setSettingsOpened] = useState(false)
    const [workspacePlan, setWorkspacePlan] = useState(false)
    const { phase } = auth
    const linked = phase === 'connected'
    const onCode = settingsOpened || phase !== 'idle' || auth.expired || auth.error !== null
    const stuck = auth.expired || (phase === 'waiting' && auth.waitedMs > STUCK_AFTER_MS)
    const last = lastStep(linked)

    return (
        <ForemanTrack
            at={linked ? 2 : onCode ? 1 : 0}
            done={linked ? 3 : onCode ? 1 : 0}
            orb={phase === 'starting' || phase === 'waiting' ? 'thinking' : linked ? 'speaking' : 'listening'}
            remark={(linked && last.remark) || t(`remarks.${remarkFor(auth, onCode, stuck)}`)}
            thinking={phase === 'starting' || (phase === 'waiting' && !stuck)}
            steps={[
                {
                    title: t('allowStep'),
                    body: !onCode && (
                        <div className="flex flex-col items-start gap-2">
                            <div className="flex flex-wrap gap-2">
                                <Button asChild className="gap-1.5">
                                    <a href={CHATGPT_SECURITY_URL} target="_blank" rel="noopener noreferrer" onClick={() => setSettingsOpened(true)}>
                                        {t('openSettings')}
                                        <ExternalLinkIcon className="size-3" />
                                    </a>
                                </Button>
                                <Button type="button" variant="outline" onClick={auth.start} className="gap-1.5">
                                    <CheckIcon />
                                    {t('alreadyOn')}
                                </Button>
                            </div>
                            <SettingHint workspacePlan={workspacePlan} onToggle={() => setWorkspacePlan(value => !value)} />
                        </div>
                    ),
                },
                { title: t('codeStep'), body: <CodeStep auth={auth} primary={onCode} stuck={stuck} workspacePlan={workspacePlan} /> },
                last,
            ]}
        />
    )
}

function remarkFor(auth: CodexDeviceAuth, onCode: boolean, stuck: boolean) {
    if (auth.phase === 'connected') return 'connected'
    if (auth.phase === 'starting') return 'starting'
    if (auth.expired) return 'expired'
    if (auth.phase === 'waiting') return stuck ? 'stuck' : 'waiting'
    return onCode ? 'grabCode' : 'turnOn'
}

const SETTING_PATH = ['settings', 'security', 'deviceCode'] as const

function SettingHint({ workspacePlan, onToggle }: { workspacePlan: boolean; onToggle: () => void }) {
    const t = useTranslations('connections.chatgpt')
    return (
        <div className="flex flex-col gap-2 text-xs text-muted-foreground">
            {workspacePlan ? <p className="leading-relaxed">{t.rich('adminSwitches', { copy: () => <CopyAdminMessage /> })}</p> : <SettingPath />}
            <button type="button" onClick={onToggle} className="w-fit underline decoration-muted-foreground/40 underline-offset-2 hover:text-foreground">
                {workspacePlan ? t('plusOrPro') : t('businessQuestion')}
            </button>
        </div>
    )
}

function SettingPath() {
    const t = useTranslations('connections.chatgpt.setting')
    return (
        <ol aria-label={t('path')} className="flex flex-wrap items-center gap-1">
            {SETTING_PATH.map((segment, index) => (
                <li key={segment} className="flex min-w-0 items-center gap-1">
                    {index > 0 && <ChevronRightIcon className="size-3 shrink-0" />}
                    <span className={cn('rounded-md bg-muted px-1.5 py-0.5', index === SETTING_PATH.length - 1 && 'font-medium text-foreground')}>{t(segment)}</span>
                </li>
            ))}
        </ol>
    )
}

function CodeStep({ auth, primary, stuck, workspacePlan }: { auth: CodexDeviceAuth; primary: boolean; stuck: boolean; workspacePlan: boolean }) {
    const t = useTranslations('connections.chatgpt')
    const pending = auth.pending
    if (auth.phase === 'connected') return null

    return (
        <div className="flex flex-col gap-2">
            {pending ? (
                <>
                    <div className="flex items-center gap-2 rounded-lg bg-muted/60 p-1.5 pl-4">
                        <code className="min-w-0 flex-1 truncate font-mono text-lg font-medium tracking-[0.2em]">{pending.userCode}</code>
                        <Button type="button" size="icon" variant="ghost" onClick={auth.copy} aria-label={t('copyCode')}>
                            {auth.copied ? <CheckIcon className="size-4" /> : <CopyIcon className="size-4" />}
                        </Button>
                    </div>
                    <p className="text-xs leading-relaxed text-muted-foreground">
                        {t.rich('enterCode', { link: chunks => <InlineLink href={pending.verificationUrl}>{chunks}</InlineLink> })}
                    </p>
                </>
            ) : (
                <TooltipDisabledReason reason={auth.opening && auth.phase !== 'starting' ? t('opening') : undefined} className="self-start">
                    <Button type="button" variant={primary ? 'default' : 'outline'} onClick={auth.start} disabled={auth.phase === 'starting' || auth.opening} className="gap-1.5 self-start">
                        <ProviderIcon provider="codex" className="size-3.5" />
                        {auth.phase === 'starting' ? t('gettingCode') : auth.expired ? t('newCode') : t('getCode')}
                    </Button>
                </TooltipDisabledReason>
            )}
            {stuck ? <StuckHint expired={auth.expired} workspacePlan={workspacePlan} /> : <StepError error={auth.error} />}
        </div>
    )
}

function StuckHint({ expired, workspacePlan }: { expired: boolean; workspacePlan: boolean }) {
    const t = useTranslations('connections.chatgpt.stuck')
    const key = `${expired ? 'expired' : 'error'}${workspacePlan ? 'Admin' : 'Self'}` as const
    return (
        <p className="flex gap-2 text-xs leading-relaxed text-muted-foreground">
            <TriangleAlertIcon className="mt-0.5 size-3.5 shrink-0 text-amber-500" />
            <span className="min-w-0">
                {t.rich(key, {
                    copy: () => <CopyAdminMessage />,
                    link: chunks => <InlineLink href={CHATGPT_SECURITY_URL}>{chunks}</InlineLink>,
                })}
            </span>
        </p>
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

function CopyAdminMessage() {
    const t = useTranslations('connections.chatgpt')
    const [copied, setCopied] = useState(false)
    const copy = () => {
        void navigator.clipboard.writeText(t('adminMessage'))
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
    }
    return (
        <button type="button" onClick={copy} className="inline-flex items-center gap-1 font-medium text-foreground underline-offset-2 hover:underline">
            {copied ? <CheckIcon className="size-3" /> : <CopyIcon className="size-3" />}
            {copied ? t('copied') : t('copyMessage')}
        </button>
    )
}
