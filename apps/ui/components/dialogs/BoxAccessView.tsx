'use client'

import type { AccessLevel, SpaceVisibility } from '@/app/api/_auth/access'
import type { SpaceAccessCoworker, SpaceAccessView } from '@/app/api/_actions/space-access.actions'
import { BoxAccessAddPeople } from '@/components/dialogs/BoxAccessAddPeople'
import { BoxAccessPersonRow } from '@/components/dialogs/BoxAccessPersonRow'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { AddButton, EmptyPitch, Group } from '@/components/connections/AiProvidersPanel'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton, SkeletonPanelRows } from '@/components/ui/skeleton'
import type { AuthorProfile } from '@/lib/chat/message-author'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'
import { useMemo, useState } from 'react'

const AVATARS_SHOWN = 8

export type BoxAccessViewProps = {
    boxName: string
    loading: boolean
    access: SpaceAccessView | null
    busy: boolean
    profileOf: (userId: string) => AuthorProfile | null
    onVisibilityChange: (visibility: SpaceVisibility) => void
    onAccessChange: (userId: string, access: AccessLevel) => void
    onRemove: (userId: string) => void
    onAdd: (userIds: string[], access: AccessLevel) => Promise<boolean>
    // The lab opens straight on the picker.
    initialPage?: 'list' | 'add'
}

export function BoxAccessView({ boxName, loading, access, busy, profileOf, onVisibilityChange, onAccessChange, onRemove, onAdd, initialPage = 'list' }: BoxAccessViewProps) {
    const t = useTranslations('dialogs.boxAccess')
    const [page, setPage] = useState<'list' | 'add'>(initialPage)
    const [confirmingRestrict, setConfirmingRestrict] = useState(false)
    const listedUserIds = useMemo(() => new Set(access?.people.map(person => person.userId) ?? []), [access])
    const memberOf = useMemo(() => new Map(access?.members.map(member => [member.userId, member]) ?? []), [access])

    const pickVisibility = (next: SpaceVisibility) => {
        if (!access || next === access.visibility) return
        if (next === 'restricted') setConfirmingRestrict(true)
        else onVisibilityChange(next)
    }

    return (
        <>
            <DialogHeader className="border-b px-4 py-4">
                <DialogTitle className="truncate pr-6">{t('title', { box: boxName })}</DialogTitle>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5">
                    <DialogDescription>{t('description')}</DialogDescription>
                    {access && <CoworkerAvatars coworkers={access.coworkers} />}
                </div>
            </DialogHeader>

            <PanelSteps stepKey={page} depth={page === 'list' ? 0 : 1}>
                {loading || !access ? (
                    <BoxAccessSkeleton />
                ) : page === 'add' ? (
                    <BoxAccessAddPeople boxName={boxName} members={access.members} listedUserIds={listedUserIds} profileOf={profileOf} onBack={() => setPage('list')} onAdd={onAdd} />
                ) : (
                    <PanelScroller className="space-y-6 p-4">
                        <Field label={t('visibilityField')} htmlFor="box-visibility">
                            <Select value={access.visibility} onValueChange={value => pickVisibility(value as SpaceVisibility)} disabled={busy}>
                                <SelectTrigger id="box-visibility" className="w-full">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent position="popper">
                                    <SelectItem value="workspace">{t('visibility.workspace')}</SelectItem>
                                    <SelectItem value="restricted">{t('visibility.restricted')}</SelectItem>
                                </SelectContent>
                            </Select>
                        </Field>

                        <Group title={t('people')} addMenu={access.people.length > 0 ? <AddButton label={t('addPeople')} disabled={busy} onClick={() => setPage('add')} /> : undefined}>
                            {access.people.length === 0 ? (
                                <EmptyPitch
                                    text={access.visibility === 'restricted' ? t('emptyRestricted') : t('emptyOpen')}
                                    actions={<AddButton label={t('addPeople')} disabled={busy} onClick={() => setPage('add')} />}
                                />
                            ) : (
                                access.people.map(person => (
                                    <BoxAccessPersonRow
                                        key={person.userId}
                                        person={person}
                                        member={memberOf.get(person.userId)}
                                        profile={profileOf(person.userId)}
                                        visibility={access.visibility}
                                        busy={busy}
                                        onAccessChange={next => onAccessChange(person.userId, next)}
                                        onRemove={() => onRemove(person.userId)}
                                    />
                                ))
                            )}
                        </Group>
                    </PanelScroller>
                )}
            </PanelSteps>

            <ConfirmDialog
                open={confirmingRestrict}
                onOpenChange={setConfirmingRestrict}
                title={t('restrict.title', { box: boxName })}
                description={access?.people.length ? t('restrict.descriptionWithPeople') : t('restrict.descriptionEmpty')}
                confirmLabel={t('restrict.confirm')}
                confirmVariant="default"
                onConfirm={() => onVisibilityChange('restricted')}
            />
        </>
    )
}

function CoworkerAvatars({ coworkers }: { coworkers: SpaceAccessCoworker[] }) {
    if (coworkers.length === 0) return null
    const hidden = coworkers.length - AVATARS_SHOWN
    return (
        <span className="flex items-center -space-x-1" aria-label={coworkers.map(coworker => coworker.name).join(', ')}>
            {coworkers.slice(0, AVATARS_SHOWN).map(coworker => (
                <span key={coworker.id} title={coworker.name} className="flex">
                    <AgentBuddy agentId={coworker.id} size={20} animated={false} facing="right" />
                </span>
            ))}
            {hidden > 0 && <span className="pl-2 text-xs text-muted-foreground">+{hidden}</span>}
        </span>
    )
}

function BoxAccessSkeleton() {
    return (
        <div className="space-y-6 p-4">
            <div className="space-y-1.5">
                <Skeleton className="h-3 w-32" />
                <Skeleton className="h-8 w-full rounded-lg" />
            </div>
            <div className="space-y-2">
                <Skeleton className="h-3 w-16" />
                <SkeletonPanelRows rows={3} leading className="space-y-1.5 p-0" />
            </div>
        </div>
    )
}
