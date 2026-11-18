'use client'

import { AddButton, Group } from '@/components/connections/AiProvidersPanel'
import { DefaultModelPicker, pickKey } from '@/components/connections/DefaultModelPicker'
import { SourceAvatar } from '@/components/connections/SourceBits'
import { Button } from '@/components/ui/button'
import { PanelRow } from '@/components/ui/panel-row'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { enabledModels, isModelEnabled, isUsable, modelName, type RerunCredit } from '@/lib/engine/ai-sources'
import type { BoxBackupModels, BoxConnection, BoxDefault } from '@/lib/engine/types'
import { ChevronDownIcon, ChevronUpIcon, XIcon } from '@/lib/icons'
import { MAX_BOX_BACKUPS, RERUN_CONNECTION_ID } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import type { ComponentProps } from 'react'

type BackupsGroupProps = {
    connections: BoxConnection[]
    backups: BoxBackupModels
    current: BoxDefault
    credit: RerunCredit
    onChange: (next: BoxBackupModels) => void
    // Set for a member: everything stays in place, disabled, with this reason.
    readOnlyReason?: string
}

// Where a run goes when its subscription hits its usage limit, in the order the owner set. The Rerun
// credit closes the list behind its own switch, off until someone turns it on.
export function BackupsGroup({ connections, backups, current, credit, onChange, readOnlyReason }: BackupsGroupProps) {
    const t = useTranslations('connections')
    const list = backups.backups
    const taken = new Set([pickKey(current), ...list.map(pickKey)])
    const anyLeft = connections.some(c => c.id !== RERUN_CONNECTION_ID && isUsable(c, credit) && enabledModels(c).some(model => !taken.has(pickKey({ connectionId: c.id, model: model.id }))))
    const addDisabledReason = readOnlyReason ?? (list.length >= MAX_BOX_BACKUPS ? t('panel.backups.full', { max: MAX_BOX_BACKUPS }) : anyLeft ? undefined : t('panel.backups.noneLeft'))
    const hasCredit = connections.some(c => c.id === RERUN_CONNECTION_ID)

    const write = (next: Partial<BoxBackupModels>) => onChange({ ...backups, ...next })
    const move = (index: number, by: -1 | 1) => {
        const next = [...list]
        ;[next[index], next[index + by]] = [next[index + by], next[index]]
        write({ backups: next })
    }

    const addMenu = addDisabledReason ? (
        <TooltipDisabledReason reason={addDisabledReason}>
            <AddButton label={t('panel.backups.add')} disabled />
        </TooltipDisabledReason>
    ) : (
        <DefaultModelPicker connections={connections} exclude={taken} withoutRerun credit={credit} onPick={pick => write({ backups: [...list, pick] })}>
            <AddButton label={t('panel.backups.add')} />
        </DefaultModelPicker>
    )

    return (
        <Group title={t('panel.groups.backups')} addMenu={addMenu}>
            {list.map((backup, index) => {
                const source = connections.find(c => c.id === backup.connectionId)
                const ready = !!source && isUsable(source, credit) && isModelEnabled(source, backup.model)
                const name = modelName(backup.connectionId, backup.model)
                return (
                    <PanelRow
                        key={pickKey(backup)}
                        leading={<SourceAvatar provider={source?.provider ?? 'rerun'} />}
                        title={name}
                        description={t(ready ? 'panel.backups.rank' : 'panel.backups.rankNotReady', { rank: index + 1, source: source?.name ?? backup.connectionId })}
                        actions={
                            <>
                                <RowButton label={t('panel.backups.moveUp', { model: name })} readOnlyReason={readOnlyReason} disabled={index === 0} onClick={() => move(index, -1)}>
                                    <ChevronUpIcon className="size-3.5" />
                                </RowButton>
                                <RowButton label={t('panel.backups.moveDown', { model: name })} readOnlyReason={readOnlyReason} disabled={index === list.length - 1} onClick={() => move(index, 1)}>
                                    <ChevronDownIcon className="size-3.5" />
                                </RowButton>
                                <RowButton label={t('panel.backups.remove', { model: name })} readOnlyReason={readOnlyReason} onClick={() => write({ backups: list.filter((_, at) => at !== index) })}>
                                    <XIcon className="size-3.5" />
                                </RowButton>
                            </>
                        }
                    />
                )
            })}
            {hasCredit && (
                <PanelRow
                    leading={<SourceAvatar provider="rerun" />}
                    title={t('panel.backups.credit.title')}
                    description={t('panel.backups.credit.description')}
                    actions={
                        <TooltipDisabledReason reason={readOnlyReason}>
                            <Switch checked={backups.rerunCreditLastResort} disabled={!!readOnlyReason} onCheckedChange={on => write({ rerunCreditLastResort: on })} aria-label={t('panel.backups.credit.title')} />
                        </TooltipDisabledReason>
                    }
                />
            )}
        </Group>
    )
}

function RowButton({ label, readOnlyReason, disabled, ...props }: ComponentProps<typeof Button> & { label: string; readOnlyReason?: string }) {
    return (
        <TooltipDisabledReason reason={readOnlyReason}>
            <Button size="icon-xs" variant="ghost" aria-label={label} disabled={disabled || !!readOnlyReason} {...props} />
        </TooltipDisabledReason>
    )
}
