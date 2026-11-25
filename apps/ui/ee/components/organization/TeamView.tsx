'use client'

import { useTranslations } from 'next-intl'
import { useState, type FormEvent } from 'react'

import { CopyLine } from '@/components/dialogs/CopyLine'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'

import { isEmail } from './input'
import { Heading, Page, Section } from './parts'
import { InvitationList, PeopleList, PeopleSkeleton } from './PeopleList'
import type { ConsoleInvitation, ConsolePerson, ConsoleResult, InviteAnswer, OrganizationRole, WriteBlock } from './types'
import { useBlockReason } from './useBlockReason'

const ROLES = ['owner', 'admin'] as const

type TeamViewProps = {
    people: ConsolePerson<OrganizationRole>[]
    invitations: ConsoleInvitation[]
    block: WriteBlock | null
    onInvite: (email: string, role: OrganizationRole) => Promise<ConsoleResult<InviteAnswer>>
    onRoleChange: (person: ConsolePerson<OrganizationRole>, role: OrganizationRole) => void
    onRemove: (person: ConsolePerson<OrganizationRole>) => void
    onRevoke: (invitation: ConsoleInvitation) => void
}

export function TeamView({ people, invitations, block, onInvite, onRoleChange, onRemove, onRevoke }: TeamViewProps) {
    const t = useTranslations('organization')
    const blockReason = useBlockReason(block)
    const ownerCount = people.filter(person => person.role === 'owner').length

    const lockedReason = (person: ConsolePerson<OrganizationRole>) => {
        if (blockReason) return blockReason
        if (person.role === 'owner' && ownerCount <= 1) return t('people.lastOwner')
        return person.isSelf ? t('people.self') : undefined
    }

    return (
        <Page width="max-w-3xl">
            <div className="space-y-10">
                <div className="space-y-5">
                    <Heading title={t('team.title')} meta={t('team.hint')} />
                    <InviteForm reason={blockReason} onInvite={onInvite} />
                </div>
                {invitations.length > 0 && (
                    <Section title={t('team.invited')} meta={invitations.length}>
                        <InvitationList invitations={invitations} lockedReason={blockReason} onRevoke={onRevoke} />
                    </Section>
                )}
                <Section title={t('team.members')} meta={people.length}>
                    <PeopleList people={people} roles={ROLES} removeDescription={t('people.removeConfirm.team')} lockedReason={lockedReason} onRoleChange={onRoleChange} onRemove={onRemove} />
                </Section>
            </div>
        </Page>
    )
}

function InviteForm({ reason, onInvite }: { reason?: string; onInvite: TeamViewProps['onInvite'] }) {
    const t = useTranslations('organization')
    const errorText = useErrorText()
    const [draft, setDraft] = useState('')
    const [role, setRole] = useState<OrganizationRole>('admin')
    const [sending, setSending] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [link, setLink] = useState<{ email: string; url: string } | null>(null)
    const email = draft.trim().toLowerCase()

    const submit = async (event: FormEvent) => {
        event.preventDefault()
        if (!isEmail(email) || sending || reason) return
        setSending(true)
        setError(null)
        setLink(null)
        const result = await onInvite(email, role)
        setSending(false)
        if (!result.ok) return setError(errorText(result))
        setDraft('')
        if (result.inviteUrl) setLink({ email, url: result.inviteUrl })
    }

    return (
        <div className="space-y-3">
            <form className="flex flex-wrap gap-2" onSubmit={submit}>
                <Input
                    id="invite-email"
                    type="email"
                    autoComplete="off"
                    aria-label={t('invite.email')}
                    placeholder={t('invite.teamPlaceholder')}
                    disabled={!!reason}
                    value={draft}
                    onChange={event => {
                        setDraft(event.target.value)
                        setError(null)
                    }}
                    className="h-9 min-w-0 flex-1 basis-56"
                />
                <Select value={role} onValueChange={next => setRole(next as OrganizationRole)} disabled={!!reason}>
                    <SelectTrigger aria-label={t('invite.role')} className="data-[size=default]:h-9">
                        <SelectValue>{t(`roles.${role}`)}</SelectValue>
                    </SelectTrigger>
                    <SelectContent position="popper" align="end">
                        {ROLES.map(candidate => (
                            <SelectItem key={candidate} value={candidate}>
                                {t(`roles.${candidate}`)}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
                <TooltipDisabledReason reason={reason}>
                    <Button type="submit" size="lg" loading={sending} disabled={!!reason || !isEmail(email)}>
                        {t('people.invite')}
                    </Button>
                </TooltipDisabledReason>
            </form>
            {error && <p className="text-sm text-destructive">{error}</p>}
            {link && (
                <div className="space-y-2">
                    <p className="text-sm text-muted-foreground">{t('invite.linkHint', { email: link.email })}</p>
                    <CopyLine value={link.url} label={t('invite.copyLink')} />
                </div>
            )}
        </div>
    )
}

export function TeamSkeleton() {
    const t = useTranslations('organization.team')
    return (
        <Page width="max-w-3xl">
            <div className="space-y-10">
                <div className="space-y-5">
                    <Heading title={t('title')} meta={t('hint')} />
                    <div className="flex flex-wrap gap-2">
                        <Skeleton className="h-9 flex-1 basis-56 rounded-lg" />
                        <Skeleton className="h-9 w-24 rounded-lg" />
                        <Skeleton className="h-9 w-20 rounded-lg" />
                    </div>
                </div>
                <Section title={t('members')}>
                    <PeopleSkeleton />
                </Section>
            </div>
        </Page>
    )
}
