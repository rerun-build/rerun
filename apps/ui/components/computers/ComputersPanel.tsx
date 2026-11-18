'use client'

import { isInterpreterProgram, type RemoteAccessMode, type RemoteComputerSettingsPatch } from '@rerun/contracts'
import { formatBytes, shortRelativeTime } from '@rerun/i18n/format'
import { PanelRow, Skeleton } from '@rerun/ui/primitives'
import { useLocale, useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'
import { toast } from 'sonner'

import { unlinkComputerAction, updateComputerSettingsAction } from '@/app/api/_actions/remote-computers.actions'
import { OPTION_LIST_CLASS, OptionWithDescription } from '@/components/dialogs/AccessLevelOption'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { DialogHeaderBar } from '@/components/dialogs/DialogHeaderBar'
import { Button } from '@/components/ui/button'
import { PanelScroller } from '@/components/ui/panel-list'
import { PanelSteps } from '@/components/ui/panel-steps'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { TooltipDisabledReason } from '@/components/ui/tooltip'
import { useErrorText } from '@/hooks/useErrorText'
import type { ComputerItem, ComputersList } from '@/lib/computers/types'
import { desktopShell } from '@/lib/desktop-shell/client'
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon, FolderIcon, MonitorIcon, TerminalIcon, XIcon } from '@/lib/icons'
import { landingUrl } from '@/lib/site'
import { cn } from '@/lib/utils'

import { ComputerHandle, ComputerNote, ComputerStatusBadge, OsTile, osLabel } from './ComputerBits'
import { ComputerJobs } from './ComputerJobs'
import { ThisComputerLinkRow } from './ThisComputer'

const MODES: RemoteAccessMode[] = ['ask', 'remember', 'full']

type PanelProps = { list: ComputersList | null; error: string | null; onChanged: () => Promise<void> | void }

// The dialog of the workspace menu, next to the Vault and the AI providers: the computers linked to
// the workspace, then one computer's settings in a drill-in.
export function ComputersPanel({ list, error, onChanged }: PanelProps) {
    const t = useTranslations('computers')
    const [openId, setOpenId] = useState<string | null>(null)
    const selected = list?.computers.find(computer => computer.id === openId)

    return (
        <>
            <DialogHeaderBar icon={MonitorIcon} title={t('title')} description={t('description')} />
            <div className="flex min-h-0 flex-1 flex-col">
                <PanelSteps stepKey={selected?.id ?? 'list'} depth={selected ? 1 : 0}>
                    {selected ? (
                        <ComputerDetail computer={selected} onBack={() => setOpenId(null)} onChanged={onChanged} />
                    ) : list === null ? (
                        error ? <p className="p-4 text-sm text-destructive">{error}</p> : <ComputersSkeleton />
                    ) : (
                        <ComputerList list={list} onOpen={setOpenId} onChanged={onChanged} />
                    )}
                </PanelSteps>
            </div>
        </>
    )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <h3 className="flex h-6 items-center text-sm font-medium text-muted-foreground">{title}</h3>
            <div className="space-y-1.5">{children}</div>
        </section>
    )
}

function ComputerList({ list, onOpen, onChanged }: { list: ComputersList; onOpen: (id: string) => void; onChanged: () => Promise<void> | void }) {
    const t = useTranslations('computers')
    const inDesktopApp = !!desktopShell('remoteComputer')
    const [thisOneLinked, setThisOneLinked] = useState<boolean | null>(null)
    const offerThisOne = inDesktopApp && thisOneLinked === false

    if (list.computers.length === 0 && !inDesktopApp) {
        return (
            <PanelScroller className="p-4">
                <EmptyComputers />
            </PanelScroller>
        )
    }

    return (
        <PanelScroller className="space-y-6 p-4">
            {list.engine === 'needs-update' && <ComputerNote>{t('engineNeedsUpdate')}</ComputerNote>}
            {list.engine === 'unreachable' && <ComputerNote tone="neutral">{t('engineUnreachable')}</ComputerNote>}
            {inDesktopApp && (
                <div className={cn(!offerThisOne && 'hidden')}>
                    <Group title={t('thisComputer.heading')}>
                        <ThisComputerLinkRow onLinkedChange={setThisOneLinked} onLinked={onChanged} />
                    </Group>
                </div>
            )}
            {list.computers.length > 0 && (
                <Group title={t('linked')}>
                    {list.computers.map(computer => (
                        <ComputerRow key={computer.id} computer={computer} onClick={() => onOpen(computer.id)} />
                    ))}
                </Group>
            )}
            {list.computers.length === 0 && !offerThisOne && thisOneLinked !== null && <EmptyComputers />}
            {!inDesktopApp && (
                <p className="flex flex-wrap items-center justify-center gap-x-1 text-xs text-muted-foreground">
                    {t('linkFromApp')}
                    <Button variant="link" size="xs" className="h-auto px-0" asChild>
                        <a href={landingUrl('/download')} target="_blank" rel="noopener noreferrer">
                            {t('getTheApp')}
                        </a>
                    </Button>
                </p>
            )}
        </PanelScroller>
    )
}

function hardwareOf(computer: ComputerItem): string | null {
    return computer.facts?.gpus?.[0] ?? computer.facts?.cpu ?? null
}

function ComputerRow({ computer, onClick }: { computer: ComputerItem; onClick: () => void }) {
    const t = useTranslations('computers')
    const locale = useLocale()
    const hardware = hardwareOf(computer)
    const description =
        computer.status === 'offline' ? (
            computer.lastSeenAt ? t('lastSeen', { when: shortRelativeTime(computer.lastSeenAt, locale) }) : t('neverConnected')
        ) : (
            <>
                <ComputerHandle handle={computer.handle} /> · {osLabel(computer.os)}
                {hardware ? ` · ${hardware}` : ''}
            </>
        )

    return <PanelRow onClick={onClick} leading={<OsTile os={computer.os} />} title={computer.name} description={description} actions={<RowStatus computer={computer} />} />
}

function RowStatus({ computer }: { computer: ComputerItem }) {
    return (
        <>
            <ComputerStatusBadge status={computer.status} jobs={computer.runningJobs} />
            <ChevronRightIcon className="ml-1 size-4 text-muted-foreground" />
        </>
    )
}

function EmptyComputers() {
    const t = useTranslations('computers.empty')
    return (
        <div className="flex flex-col items-center gap-3 rounded-md border border-dashed px-3 py-8 text-center">
            <OsTile os="mac" />
            <div className="space-y-1">
                <p className="text-sm font-medium">{t('title')}</p>
                <p className="mx-auto max-w-xs text-xs text-muted-foreground">{t('body')}</p>
            </div>
            {!desktopShell('remoteComputer') && (
                <Button variant="outline" asChild>
                    <a href={landingUrl('/download')} target="_blank" rel="noopener noreferrer">
                        <DownloadIcon className="size-4" />
                        {t('getApp')}
                    </a>
                </Button>
            )}
        </div>
    )
}

function ComputersSkeleton() {
    return (
        <div className="space-y-2 p-4">
            <Skeleton className="h-3 w-16" />
            {Array.from({ length: 3 }, (_, i) => (
                <div key={i} className="flex items-center gap-3 rounded-md border p-3">
                    <Skeleton className="size-9 rounded-md" />
                    <div className="flex-1 space-y-1.5">
                        <Skeleton className="h-3.5 w-28" />
                        <Skeleton className="h-2.5 w-44" />
                    </div>
                    <Skeleton className="h-4 w-14 rounded-full" />
                </div>
            ))}
        </div>
    )
}

function DetailBlock({ title, children }: { title: string; children: ReactNode }) {
    return (
        <section className="space-y-2">
            <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
            {children}
        </section>
    )
}

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }) {
    return (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
            <div className="min-w-0 flex-1 space-y-0.5">
                <p className="text-sm">{title}</p>
                <p className="text-xs text-muted-foreground">{description}</p>
            </div>
            {children}
        </div>
    )
}

function ComputerDetail({ computer, onBack, onChanged }: { computer: ComputerItem; onBack: () => void; onChanged: () => Promise<void> | void }) {
    const t = useTranslations('computers')
    const tDetail = useTranslations('computers.detail')
    const locale = useLocale()
    const errorText = useErrorText()
    const [confirmRemove, setConfirmRemove] = useState(false)
    const [removing, setRemoving] = useState(false)
    const settings = computer.settings
    // What the person just picked, shown until the box's own answer is read back: after a failed
    // save the controls say what the computer follows, not what was clicked.
    const [picked, setPicked] = useState<RemoteComputerSettingsPatch>({})
    const mode: RemoteAccessMode = picked.mode ?? settings?.mode ?? 'remember'
    const unattended = picked.unattended ?? settings?.unattended ?? true
    const readOnly = !computer.canManage
    const reason = readOnly ? t('managersOnly') : !settings ? t('settingsNeedEngine') : undefined
    const locked = readOnly || !settings

    const save = async (patch: RemoteComputerSettingsPatch) => {
        setPicked(current => ({ ...current, ...patch }))
        try {
            const res = await updateComputerSettingsAction(computer.id, patch)
            if (!res.ok) toast.error(errorText(res))
            await onChanged()
        } catch {
            // The request itself did not go through (offline, the hub restarting).
            toast.error(errorText({ code: 'generic' }))
        } finally {
            setPicked({})
        }
    }

    const remove = async () => {
        setRemoving(true)
        const res = await unlinkComputerAction(computer.id)
        setRemoving(false)
        if (!res.ok) return toast.error(errorText(res))
        setConfirmRemove(false)
        onBack()
        await onChanged()
    }

    const facts = computer.facts
    const hardware = hardwareOf(computer)

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="flex items-center gap-3 border-b px-3 py-2.5">
                <Button aria-label={tDetail('back')} variant="ghost" size="icon-sm" className="shrink-0" onClick={onBack}>
                    <ChevronLeftIcon className="size-4" />
                </Button>
                <OsTile os={computer.os} size="sm" />
                <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate text-sm font-medium">{computer.name}</span>
                    <span className="truncate text-[11px] text-muted-foreground">
                        <ComputerHandle handle={computer.handle} />
                        {computer.linkedBy?.name ? ` · ${tDetail('linkedBy', { name: computer.linkedBy.name })}` : ''}
                    </span>
                </div>
                <ComputerStatusBadge status={computer.status} jobs={computer.runningJobs} />
            </div>

            <PanelScroller className="space-y-6 p-4">
                {computer.status === 'offline' && <ComputerNote tone="neutral">{computer.lastSeenAt ? tDetail('offlineSince', { when: shortRelativeTime(computer.lastSeenAt, locale) }) : tDetail('neverConnected')}</ComputerNote>}
                {computer.status === 'paused' && <ComputerNote>{tDetail('paused')}</ComputerNote>}

                <ComputerJobs computerId={computer.id} online={computer.status !== 'offline'} />

                <DetailBlock title={tDetail('approvals')}>
                    {settings ? (
                        <div className="space-y-4">
                            <SettingRow title={tDetail('commands')} description={t(`modes.${mode}.description`)}>
                                <TooltipDisabledReason reason={reason}>
                                    <Select
                                        value={mode}
                                        onValueChange={value => void save({ mode: value as RemoteAccessMode })}
                                        disabled={locked}
                                    >
                                        <SelectTrigger size="sm" className="w-44 shrink-0" aria-label={tDetail('modeLabel')}>
                                            <SelectValue>{t(`modes.${mode}.label`)}</SelectValue>
                                        </SelectTrigger>
                                        <SelectContent position="popper" align="end" className={OPTION_LIST_CLASS}>
                                            {MODES.map(value => (
                                                <SelectItem key={value} value={value}>
                                                    <OptionWithDescription label={t(`modes.${value}.label`)} description={t(`modes.${value}.description`)} />
                                                </SelectItem>
                                            ))}
                                        </SelectContent>
                                    </Select>
                                </TooltipDisabledReason>
                            </SettingRow>
                            <SettingRow title={tDetail('unattended')} description={tDetail('unattendedHint')}>
                                <TooltipDisabledReason reason={reason}>
                                    <Switch
                                        checked={unattended}
                                        aria-label={tDetail('unattended')}
                                        onCheckedChange={value => void save({ unattended: value })}
                                        disabled={locked}
                                    />
                                </TooltipDisabledReason>
                            </SettingRow>
                        </div>
                    ) : (
                        // What the box follows is unknown while it does not answer: no value is shown rather than a default.
                        <p className="text-xs text-muted-foreground">{t('settingsNeedEngine')}</p>
                    )}
                </DetailBlock>

                {mode !== 'ask' && settings && (
                    <DetailBlock title={tDetail('alwaysAllowed')}>
                        <div className="flex flex-wrap gap-1.5">
                            {settings.allowedPrograms.length === 0 && settings.allowedFolders.length === 0 && <p className="text-xs text-muted-foreground">{tDetail('nothingAllowed')}</p>}
                            {settings.allowedPrograms.map(program => (
                                <AllowedChip key={program} icon={TerminalIcon} label={program} reason={reason} warn={isInterpreterProgram(program)} onRemove={() => save({ allowedPrograms: settings.allowedPrograms.filter(item => item !== program) })} />
                            ))}
                            {settings.allowedFolders.map(folder => (
                                <AllowedChip key={folder} icon={FolderIcon} label={folder} reason={reason} onRemove={() => save({ allowedFolders: settings.allowedFolders.filter(item => item !== folder) })} />
                            ))}
                        </div>
                    </DetailBlock>
                )}

                <DetailBlock title={tDetail('screen')}>
                    <p className="text-xs text-muted-foreground">{computer.capabilities.includes('screen') ? tDetail('screenOn') : tDetail('screenOff')}</p>
                </DetailBlock>

                {facts && (
                    <DetailBlock title={tDetail('machine')}>
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs">
                            <dt className="text-muted-foreground">{tDetail('system')}</dt>
                            <dd className="truncate">
                                {osLabel(facts.os)} {facts.osVersion}
                            </dd>
                            {hardware && (
                                <>
                                    <dt className="text-muted-foreground">{facts.gpus?.[0] ? tDetail('graphics') : tDetail('processor')}</dt>
                                    <dd className="truncate">{hardware}</dd>
                                </>
                            )}
                            {facts.memoryBytes !== undefined && (
                                <>
                                    <dt className="text-muted-foreground">{tDetail('memory')}</dt>
                                    <dd>{formatBytes(facts.memoryBytes, locale)}</dd>
                                </>
                            )}
                            <dt className="text-muted-foreground">{tDetail('folder')}</dt>
                            <dd className="truncate font-mono">{facts.workDir}</dd>
                        </dl>
                        {facts.software && facts.software.length > 0 && (
                            <div className="flex flex-wrap gap-1 pt-1">
                                {facts.software.map(item => (
                                    <span key={item} className="rounded border bg-muted/30 px-1.5 py-0.5 text-[11px] text-muted-foreground">
                                        {item}
                                    </span>
                                ))}
                            </div>
                        )}
                    </DetailBlock>
                )}
            </PanelScroller>

            <div className="border-t p-3">
                <TooltipDisabledReason reason={readOnly ? t('managersOnly') : undefined}>
                    <Button variant="outline" size="sm" className="text-destructive" disabled={readOnly} onClick={() => setConfirmRemove(true)}>
                        {tDetail('remove')}
                    </Button>
                </TooltipDisabledReason>
            </div>
            <ConfirmDialog open={confirmRemove} onOpenChange={setConfirmRemove} title={tDetail('removeTitle', { name: computer.name })} description={tDetail('removeBody')} confirmLabel={tDetail('removeConfirm')} pending={removing} onConfirm={() => void remove()} />
        </div>
    )
}

function AllowedChip({ icon: Glyph, label, reason, warn, onRemove }: { icon: typeof TerminalIcon; label: string; reason: string | undefined; warn?: boolean; onRemove: () => void }) {
    const t = useTranslations('computers.detail')
    return (
        <span className={cn('inline-flex max-w-full items-center gap-1.5 rounded-md border py-0.5 pr-1 pl-2 text-xs', warn ? 'border-orange-500/30 bg-orange-500/5' : 'bg-muted/30')} title={warn ? t('interpreterWarning') : undefined}>
            <Glyph className="size-3 shrink-0 text-muted-foreground" />
            <span className="truncate font-mono">{label}</span>
            <TooltipDisabledReason reason={reason}>
                <Button variant="ghost" size="icon-xs" className="size-5 text-muted-foreground" disabled={!!reason} aria-label={t('stopAllowing', { label })} onClick={onRemove}>
                    <XIcon className="size-3" />
                </Button>
            </TooltipDisabledReason>
        </span>
    )
}

