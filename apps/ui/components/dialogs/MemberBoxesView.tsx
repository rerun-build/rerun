'use client'

import type { WorkspaceMember } from '@/app/api/_actions/members.actions'
import type { MemberAccessView, MemberBoxAccess } from '@/app/api/_actions/space-access.actions'
import type { BoxAccess } from '@/app/api/_auth/access'
import type { BoxScope } from '@/app/api/_auth/box-scope'
import { AccessDrillHeader } from '@/components/dialogs/AccessDrillHeader'
import { OPTION_LIST_CLASS, OptionWithDescription, useAccessOptions } from '@/components/dialogs/AccessLevelOption'
import { asIs, personLabel, useBoxAccessCopy } from '@/components/dialogs/access-person'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Group } from '@/components/connections/AiProvidersPanel'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelRow } from '@/components/ui/panel-row'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton, SkeletonPanelRows } from '@/components/ui/skeleton'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import type { AuthorProfile } from '@/lib/chat/message-author'
import { ShieldCheckIcon } from '@/lib/icons'
import { CardAvatar } from '@rerun/ui/chat'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

const EVERYONE = 'everyone'

export type MemberBoxesViewProps = {
    member: WorkspaceMember
    profile: AuthorProfile | null
    // Null while it loads.
    access: MemberAccessView | null
    viewerIsAdmin: boolean
    busy: boolean
    onBack: () => void
    onScopeChange: (scope: BoxScope) => void
    onLevelChange: (box: MemberBoxAccess, level: BoxAccess) => void
    onRestrict: (box: MemberBoxAccess) => void
}

// Every Box seen from one person: the same rows as the Box access dialog, from the other side.
export function MemberBoxesView({ member, profile, access, viewerIsAdmin, busy, onBack, onScopeChange, onLevelChange, onRestrict }: MemberBoxesViewProps) {
    const t = useTranslations('dialogs.members.boxes')
    const copy = useBoxAccessCopy()
    const { title } = personLabel(profile, member.email, copy.teammate)
    const readOnlyReason = viewerIsAdmin ? undefined : copy.adminOnly
    const targetIsAdmin = (access?.role ?? member.role) === 'admin'
    // Opening every Box is free; closing them asks first.
    const [confirmingAssigned, setConfirmingAssigned] = useState(false)

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <AccessDrillHeader
                leading={<CardAvatar src={profile?.photo} fileUrl={asIs} name={title} className="size-8" />}
                title={t('title', { person: title })}
                hint={member.email ?? undefined}
                backLabel={t('back')}
                onBack={onBack}
            />
            {!access ? (
                <MemberBoxesSkeleton />
            ) : targetIsAdmin ? (
                <PanelScroller className="p-4">
                    <Alert>
                        <ShieldCheckIcon />
                        <AlertDescription>{t('adminsSeeAll')}</AlertDescription>
                    </Alert>
                </PanelScroller>
            ) : (
                <PanelScroller className="space-y-6 p-4">
                    <Field orientation="row" label={t('sharedField')} helperText={access.boxScope === 'all' ? t('sharedAll') : t('sharedAssigned')}>
                        <TooltipDisabledReason reason={readOnlyReason}>
                            <Switch checked={access.boxScope === 'all'} disabled={!!readOnlyReason || busy} onCheckedChange={checked => (checked ? onScopeChange('all') : setConfirmingAssigned(true))} aria-label={t('sharedField')} />
                        </TooltipDisabledReason>
                    </Field>
                    <ConfirmDialog
                        open={confirmingAssigned}
                        onOpenChange={setConfirmingAssigned}
                        title={t('limit.title', { person: title })}
                        description={copy.scopeOutcome}
                        confirmLabel={t('limit.confirm')}
                        confirmVariant="default"
                        onConfirm={() => onScopeChange('assigned')}
                    />

                    <Group title={t('group')}>
                        {access.boxes.length === 0 ? (
                            <p className="rounded-md border border-dashed px-3 py-5 text-center text-xs text-muted-foreground">{t('empty')}</p>
                        ) : (
                            access.boxes.map(box => (
                                <MemberBoxRow key={box.spaceId} box={box} boxScope={access.boxScope} personName={title} readOnlyReason={readOnlyReason} busy={busy} onLevelChange={level => onLevelChange(box, level)} onRestrict={() => onRestrict(box)} />
                            ))
                        )}
                    </Group>
                </PanelScroller>
            )}
        </div>
    )
}

type MemberBoxRowProps = {
    box: MemberBoxAccess
    boxScope: BoxScope
    personName: string
    readOnlyReason: string | undefined
    busy: boolean
    onLevelChange: (level: BoxAccess) => void
    onRestrict: () => void
}

function MemberBoxRow({ box, boxScope, personName, readOnlyReason, busy, onLevelChange, onRestrict }: MemberBoxRowProps) {
    const t = useTranslations('dialogs.members.boxes')
    const tBoxAccess = useTranslations('dialogs.boxAccess')
    const copy = useBoxAccessCopy()
    const accessOptions = useAccessOptions()
    const levelOptions: Record<BoxAccess | typeof EVERYONE, { label: string; description: string }> = { everyone: { label: t('everyone.label'), description: t('everyone.description') }, ...accessOptions }
    const [confirmingRestrict, setConfirmingRestrict] = useState(false)
    const [confirmingNone, setConfirmingNone] = useState(false)
    const name = box.name || tBoxAccess('unnamedBox')
    const noneOutcome = copy.levelOutcome(box, boxScope)
    const fromEveryone = box.source === 'workspace'
    const value = fromEveryone ? EVERYONE : box.access

    return (
        <PanelRow
            title={name}
            description={box.visibility === 'restricted' ? t('coworkersRestricted', { count: box.agentCount }) : t('coworkers', { count: box.agentCount })}
            actions={
                <TooltipDisabledReason reason={readOnlyReason}>
                    <Select value={value} onValueChange={next => (next === 'none' && noneOutcome ? setConfirmingNone(true) : onLevelChange(next as BoxAccess))} disabled={!!readOnlyReason || busy}>
                        <SelectTrigger size="sm" className="w-32 shrink-0" aria-label={t('accessTo', { box: name })}>
                            <SelectValue>{levelOptions[value].label}</SelectValue>
                        </SelectTrigger>
                        <SelectContent position="popper" align="end" className={OPTION_LIST_CLASS}>
                            {fromEveryone ? (
                                <SelectItem value={EVERYONE} disabled>
                                    <OptionWithDescription {...levelOptions.everyone} />
                                </SelectItem>
                            ) : (
                                <SelectItem value="none">
                                    <OptionWithDescription {...levelOptions.none} />
                                </SelectItem>
                            )}
                            <SelectItem value="use">
                                <OptionWithDescription {...levelOptions.use} />
                            </SelectItem>
                            <SelectItem value="manage">
                                <OptionWithDescription {...levelOptions.manage} />
                            </SelectItem>
                        </SelectContent>
                    </Select>
                </TooltipDisabledReason>
            }
        >
            {box.visibility === 'workspace' && (
                <TooltipDisabledReason reason={readOnlyReason} className="self-start">
                    <Button variant="link" size="xs" className="h-auto self-start p-0 text-xs" disabled={!!readOnlyReason || busy} onClick={() => setConfirmingRestrict(true)}>
                        {t('restrictBox')}
                    </Button>
                </TooltipDisabledReason>
            )}
            <ConfirmDialog
                open={confirmingRestrict}
                onOpenChange={setConfirmingRestrict}
                title={t('restrict.title', { box: name })}
                description={t('restrict.description', { person: personName })}
                confirmLabel={t('restrict.confirm')}
                confirmVariant="default"
                onConfirm={onRestrict}
            />
            {noneOutcome && (
                <ConfirmDialog
                    open={confirmingNone}
                    onOpenChange={setConfirmingNone}
                    title={t('removeAccess.title', { box: name })}
                    description={noneOutcome}
                    confirmLabel={t('removeAccess.confirm')}
                    onConfirm={() => onLevelChange('none')}
                />
            )}
        </PanelRow>
    )
}

function MemberBoxesSkeleton() {
    return (
        <div className="space-y-6 p-4">
            <div className="flex items-center justify-between gap-4">
                <div className="space-y-1.5">
                    <Skeleton className="h-3 w-40" />
                    <Skeleton className="h-3 w-48" />
                </div>
                <Skeleton className="h-5 w-9 rounded-full" />
            </div>
            <div className="space-y-2">
                <Skeleton className="h-3 w-14" />
                <SkeletonPanelRows rows={4} className="space-y-1.5 p-0" />
            </div>
        </div>
    )
}
