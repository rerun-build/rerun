'use client'

import { ScrollFade } from '@rerun/ui/primitives'
import { useTranslations } from 'next-intl'
import { useEffect, useState, type ComponentType } from 'react'
import { toast } from 'sonner'

import { getPublishedDataAction, updatePublishedDataAction } from '@/app/api/_actions/publish.actions'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { useErrorText } from '@/hooks/useErrorText'
import { CheckIcon, ChevronDownIcon, DatabaseIcon, EyeIcon, EyeOffIcon, InfoIcon, PencilIcon, PlusIcon, TableIcon } from '@/lib/icons'
import type { PublishedAccess } from '@/lib/published/access'
import type { DataGrantLevel } from '@/lib/published/data-grants'
import type { PageData, PageTable } from '@/lib/services/published-data'

type Grant = DataGrantLevel | 'off'

const GRANT_ORDER: Grant[] = ['read', 'write', 'off']

const GRANT_ICON: Record<Grant, ComponentType<{ className?: string }>> = {
    read: EyeIcon,
    write: PencilIcon,
    off: EyeOffIcon,
}

function withGrant(data: PageData, table: PageTable, grant: Grant): PageData {
    const same = (other: PageTable) => other.database === table.database && other.table === table.table
    const listed = data.listed.filter(other => !same(other))
    const others = data.others.filter(other => !same(other))
    if (grant === 'off') return { listed, others: [...others, table] }
    const at = data.listed.findIndex(same)
    const row = { ...table, grant }
    return { listed: at === -1 ? [...listed, row] : data.listed.map(other => (same(other) ? row : other)), others }
}

// The tables a published page reads live, a grant each, and the machine's others one click away.
export function ShareLiveData({ slug, access }: { slug: string; access: PublishedAccess }) {
    const t = useTranslations('published.share.data')
    const errorText = useErrorText()
    const [data, setData] = useState<PageData | null>(null)
    const [loadFailed, setLoadFailed] = useState(false)

    useEffect(() => {
        let cancelled = false
        void getPublishedDataAction(slug).then(result => {
            if (cancelled) return
            if (result.ok) setData(result.data)
            else setLoadFailed(true)
        })
        return () => {
            cancelled = true
        }
    }, [slug])

    const change = async (table: PageTable, grant: Grant) => {
        if (!data) return
        const previous = data
        const next = withGrant(data, table, grant)
        setData(next)
        const result = await updatePublishedDataAction(
            slug,
            next.listed.map(row => ({ database: row.database, table: row.table, grant: row.grant }))
        )
        if (!result.ok) {
            setData(previous)
            toast.error(t('updateFailed'), { description: errorText(result) })
            return
        }
        setData(result.data)
    }

    const writesInPublic = access === 'public' && !!data?.listed.some(row => row.grant === 'write')

    return (
        <div className="flex min-h-0 flex-col gap-1 px-4 pb-3">
            <div className="flex items-center gap-1.5 pb-1 text-xs font-medium text-muted-foreground">
                <DatabaseIcon className="size-3.5" />
                {t('title')}
            </div>
            {!data && !loadFailed && <LiveDataSkeleton />}
            {loadFailed && <p className="pb-1 text-xs text-muted-foreground">{t('loadFailed')}</p>}
            {data && (
                <>
                    {data.listed.length === 0 && <p className="pb-1 text-xs text-muted-foreground">{t('empty')}</p>}
                    {data.listed.length > 0 && (
                        <ScrollFade className="-mx-1 max-h-48 px-1">
                            {data.listed.map(row => (
                                <div key={`${row.database}:${row.table}`} className="flex items-center gap-3 py-1">
                                    <TableGlyph />
                                    <TableLabel table={row} />
                                    <GrantMenu grant={row.grant} onChange={grant => void change(row, grant)} />
                                </div>
                            ))}
                        </ScrollFade>
                    )}
                    {data.others.length > 0 && <AddTableMenu tables={data.others} onAdd={table => void change(table, 'read')} />}
                    {writesInPublic && (
                        <p className="mt-1 flex items-start gap-1.5 rounded-md bg-muted/60 px-2.5 py-2 text-xs text-muted-foreground">
                            <InfoIcon className="mt-px size-3.5 shrink-0" />
                            {t('publicWrite')}
                        </p>
                    )}
                </>
            )}
        </div>
    )
}

function TableGlyph() {
    return (
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/5">
            <TableIcon className="size-4 text-muted-foreground" />
        </span>
    )
}

function useOwnerLabel() {
    const t = useTranslations('published.share.data')
    return (table: PageTable) => table.owner ?? t('workspace')
}

function TableLabel({ table }: { table: PageTable }) {
    const t = useTranslations('published.share.data')
    const ownerLabel = useOwnerLabel()
    const owner = ownerLabel(table)
    return (
        <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-mono text-[13px]">{table.table}</span>
            <span className="truncate text-xs text-muted-foreground">{table.rows === null ? owner : t('tableMeta', { owner, rows: t('rows', { count: table.rows }) })}</span>
        </span>
    )
}

function GrantMenu({ grant, onChange }: { grant: DataGrantLevel; onChange: (grant: Grant) => void }) {
    const t = useTranslations('published.share.data.grant')
    const GrantGlyph = GRANT_ICON[grant]
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="shrink-0" aria-label={t(`${grant}.label`)}>
                    <GrantGlyph />
                    <span className="max-sm:hidden">{t(`${grant}.label`)}</span>
                    <ChevronDownIcon className="text-muted-foreground" />
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
                {GRANT_ORDER.map(option => {
                    const OptionGlyph = GRANT_ICON[option]
                    return (
                        <DropdownMenuItem key={option} onSelect={() => option !== grant && onChange(option)} className="items-start gap-2.5 py-2">
                            <OptionGlyph className="mt-0.5 size-4 shrink-0" />
                            <span className="flex min-w-0 flex-1 flex-col">
                                <span>{t(`${option}.label`)}</span>
                                <span className="text-xs text-muted-foreground">{t(`${option}.hint`)}</span>
                            </span>
                            {grant === option && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
                        </DropdownMenuItem>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function AddTableMenu({ tables, onAdd }: { tables: PageTable[]; onAdd: (table: PageTable) => void }) {
    const t = useTranslations('published.share.data')
    const ownerLabel = useOwnerLabel()
    const databases = [...new Set(tables.map(table => table.database))]
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="sm" className="-ms-1.5 self-start text-muted-foreground">
                    <PlusIcon />
                    {t('addTable')}
                </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-64">
                {databases.map(database => {
                    const inDatabase = tables.filter(table => table.database === database)
                    return (
                        <div key={database}>
                            <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">{ownerLabel(inDatabase[0])}</DropdownMenuLabel>
                            {inDatabase.map(table => (
                                <DropdownMenuItem key={table.table} onSelect={() => onAdd(table)} className="gap-2.5">
                                    <span className="min-w-0 flex-1 truncate font-mono text-[13px]">{table.table}</span>
                                    {table.rows !== null && <span className="text-xs text-muted-foreground">{t('rows', { count: table.rows })}</span>}
                                </DropdownMenuItem>
                            ))}
                        </div>
                    )
                })}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

function LiveDataSkeleton() {
    return (
        <>
            {[0, 1].map(index => (
                <div key={index} className="flex items-center gap-3 py-1">
                    <Skeleton className="size-8 rounded-md" />
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                        <Skeleton className="h-3.5 w-24" />
                        <Skeleton className="h-3 w-32" />
                    </span>
                    <Skeleton className="h-7 w-28 max-sm:w-12" />
                </div>
            ))}
            <Skeleton className="mt-1 h-7 w-24" />
        </>
    )
}
