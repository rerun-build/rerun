'use client'

import { LayoutTile } from '@/components/data/LayoutTile'
import { ConfirmDialog } from '@/components/dialogs/ConfirmDialog'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverHeader, PopoverTitle, PopoverTrigger } from '@/components/ui/popover'
import { TooltipDisabledReason, TooltipLabeled } from '@/components/ui/tooltip'
import { ALL_ROWS, LAYOUT_ICONS } from '@/lib/data/views'
import { EllipsisIcon, Maximize2Icon, PencilIcon, PlusIcon, TableIcon, Trash2Icon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { CARD_LAYOUTS, type CardLayout, type TableView } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

type DataViewBarProps = {
    views: TableView[]
    activeId: string
    /** Why views cannot be added here, e.g. an engine that predates them. */
    unavailableReason?: string
    onSelect: (id: string) => void
    onAdd: (layout: CardLayout) => void
    /** A view is being created: the layout picker waits for it. */
    adding?: boolean
    onEdit: (view: TableView) => void
    onDelete: (view: TableView) => void
    onExpand?: () => void
    /** Search and table actions, at the right end of the tabs. */
    actions?: React.ReactNode
}

export function DataViewBar({ views, activeId, unavailableReason, onSelect, onAdd, adding, onEdit, onDelete, onExpand, actions }: DataViewBarProps) {
    const t = useTranslations('data.viewBar')
    const [pendingDelete, setPendingDelete] = useState<TableView | null>(null)
    const [pickerOpen, setPickerOpen] = useState(false)

    return (
        <div className="flex items-center gap-2 border-b border-border">
            <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto [scrollbar-width:none]">
                <ViewTab label={t('allRows')} icon={TableIcon} active={activeId === ALL_ROWS} onSelect={() => onSelect(ALL_ROWS)} />
                {views.map(view => (
                    <ViewTab key={view.id} label={view.name} icon={LAYOUT_ICONS[view.layout]} active={activeId === view.id} onSelect={() => onSelect(view.id)}>
                        <DropdownMenu>
                            <DropdownMenuTrigger asChild>
                                <button type="button" aria-label={t('viewOptions', { name: view.name })} className="-mr-1 rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-foreground">
                                    <EllipsisIcon className="size-3.5" />
                                </button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="start">
                                <DropdownMenuItem onSelect={() => onEdit(view)}>
                                    <PencilIcon />
                                    {t('editView')}
                                </DropdownMenuItem>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem variant="destructive" onSelect={() => setPendingDelete(view)}>
                                    <Trash2Icon />
                                    {t('deleteView')}
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </ViewTab>
                ))}
                <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
                    <TooltipDisabledReason reason={unavailableReason}>
                        <PopoverTrigger asChild>
                            <Button type="button" variant="ghost" size="icon-xs" disabled={!!unavailableReason || adding} aria-label={t('addView')} className="mb-1 shrink-0 text-muted-foreground">
                                <PlusIcon className="size-3.5" />
                            </Button>
                        </PopoverTrigger>
                    </TooltipDisabledReason>
                    <PopoverContent align="start" className="w-[min(24rem,calc(100vw-2rem))]">
                        <PopoverHeader>
                            <PopoverTitle className="text-xs text-muted-foreground">{t('addNewView')}</PopoverTitle>
                        </PopoverHeader>
                        <div className="grid grid-cols-4 gap-2">
                            {CARD_LAYOUTS.map(layout => (
                                <LayoutTile
                                    key={layout}
                                    layout={layout}
                                    onClick={() => {
                                        setPickerOpen(false)
                                        onAdd(layout)
                                    }}
                                />
                            ))}
                        </div>
                    </PopoverContent>
                </Popover>
            </div>
            <div className="flex shrink-0 items-center gap-0.5 pb-1">
                {actions}
                {onExpand && (
                    <TooltipLabeled label={t('expand')}>
                        <Button type="button" variant="ghost" size="icon-xs" onClick={onExpand} aria-label={t('expand')} className="text-muted-foreground">
                            <Maximize2Icon className="size-3.5" />
                        </Button>
                    </TooltipLabeled>
                )}
            </div>
            <ConfirmDialog
                open={!!pendingDelete}
                onOpenChange={open => !open && setPendingDelete(null)}
                title={t('deleteViewTitle', { name: pendingDelete?.name ?? '' })}
                description={t('deleteViewDescription')}
                onConfirm={() => {
                    if (pendingDelete) onDelete(pendingDelete)
                    setPendingDelete(null)
                }}
            />
        </div>
    )
}

function ViewTab({ label, icon: Icon, active, onSelect, children }: { label: string; icon: typeof TableIcon; active: boolean; onSelect: () => void; children?: React.ReactNode }) {
    return (
        <div
            className={cn(
                '-mb-px flex shrink-0 items-center gap-1 border-b-2 px-2 pt-1 pb-2 text-[13px] transition-colors',
                active ? 'border-foreground font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
            )}
        >
            <button type="button" onClick={onSelect} aria-pressed={active} className="flex items-center gap-1.5 outline-none">
                <Icon className="size-3.5" />
                <span className="max-w-40 truncate">{label}</span>
            </button>
            {active && children}
        </div>
    )
}
