'use client'

import { inviteToWorkspaceAction } from '@/app/api/_actions/members.actions'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { Input } from '@/components/ui/input'
import { useErrorText } from '@/hooks/useErrorText'
import { CheckIcon, CopyIcon, LinkIcon, MailIcon, UserIcon } from '@/lib/icons'
import { Badge, PanelRow } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { StepFrame } from './StepFrame'

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type SentInvite = { email: string; url?: string }

function InviteLinkRow({ url }: { url: string }) {
    const t = useTranslations('onboarding.team')
    const [copied, setCopied] = useState(false)
    return (
        <PanelRow
            leading={<Icon size="sm" icon={LinkIcon} />}
            title={t('link')}
            description={<span className="block truncate">{url}</span>}
            actions={
                <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                        void navigator.clipboard.writeText(url).then(() => {
                            setCopied(true)
                            setTimeout(() => setCopied(false), 2000)
                        })
                    }
                >
                    {copied ? <CheckIcon /> : <CopyIcon />}
                    {copied ? t('copied') : t('copy')}
                </Button>
            }
        />
    )
}

// Each address leaves the moment it is added: the field holds the Invite button, the people invited
// line up under it, and the footer only moves on. Where no email leaves the install (a self-hosted
// box without a mail provider), each invitation's link is shown to pass on by hand.
export function TeamStep({ invites, onInvited, onDone, onBack, saving, error }: { invites: SentInvite[]; onInvited: (invite: SentInvite) => void; onDone: () => void; onBack: () => void; saving: boolean; error: string | null }) {
    const t = useTranslations('onboarding')
    const errorText = useErrorText()
    const [typed, setTyped] = useState('')
    const [sending, setSending] = useState(false)
    const [refused, setRefused] = useState<string | null>(null)
    const email = typed.trim().toLowerCase()
    const valid = EMAIL.test(email)

    const invite = async () => {
        if (!valid || sending) return
        if (invites.some(sent => sent.email === email)) {
            setTyped('')
            return
        }
        setSending(true)
        setRefused(null)
        const result = await inviteToWorkspaceAction(email)
        setSending(false)
        if (!result.ok) {
            setRefused(errorText(result))
            return
        }
        onInvited({ email, url: result.inviteUrl })
        setTyped('')
    }

    return (
        <StepFrame
            title={t('team.title')}
            description={t('team.description')}
            onBack={onBack}
            primary={invites.length ? { label: t('continue'), onClick: onDone, loading: saving } : undefined}
            secondary={invites.length ? undefined : { label: t('team.skip'), onClick: onDone, loading: saving }}
            error={refused ?? error}
        >
            <div className="space-y-4">
                <form
                    className="relative"
                    onSubmit={event => {
                        event.preventDefault()
                        void invite()
                    }}
                >
                    <span className="pointer-events-none absolute top-1/2 left-3.5 z-10 flex -translate-y-1/2 items-center">
                        <MailIcon className="size-5 text-muted-foreground" />
                    </span>
                    <Input
                        autoFocus
                        type="email"
                        autoComplete="off"
                        aria-label={t('team.label')}
                        value={typed}
                        placeholder={t('team.placeholder')}
                        onChange={event => {
                            setRefused(null)
                            setTyped(event.target.value)
                        }}
                        className="h-12 pr-24 pl-11 text-base"
                    />
                    <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
                        <Button type="submit" size="lg" disabled={!valid} loading={sending}>
                            {t('team.invite')}
                        </Button>
                    </div>
                </form>
                {invites.length > 0 && (
                    <div className="space-y-1.5">
                        {invites.map(sent => (
                            <PanelRow
                                key={sent.email}
                                leading={<Icon size="sm" icon={UserIcon} />}
                                title={<span className="block truncate">{sent.email}</span>}
                                meta={
                                    <Badge size="xs" tone="yellow">
                                        {t('team.invited')}
                                    </Badge>
                                }
                            />
                        ))}
                    </div>
                )}
                {invites.map(sent => sent.url && <InviteLinkRow key={`link-${sent.email}`} url={sent.url} />)}
            </div>
        </StepFrame>
    )
}
