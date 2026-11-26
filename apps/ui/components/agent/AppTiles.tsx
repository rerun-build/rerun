'use client'

import { BorderBeam } from '@rerun/ui'
import { useTranslations } from 'next-intl'
import { Fragment, type ReactNode } from 'react'

import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { TooltipLabeled } from '@/components/ui/tooltip'
import { AlertTriangleIcon, LinkIcon, LockIcon, PencilIcon, PlusIcon, RefreshCwIcon, Trash2Icon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { type AppTile, type TileStatus, isBroken, worstStatus } from './apps-tab'

export const TILE_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(5.5rem,1fr))] gap-2'

export type TileHandlers = {
    onSignIn: (tile: AppTile) => void
    onReconnect: (tile: AppTile) => void
    onEdit: (tile: AppTile) => void
    onRemove: (tile: AppTile) => void
    onAddAccount: (slug: string) => void
}

function useStatusText() {
    const t = useTranslations('agent.agentPanelServices')
    const tConnect = useTranslations('services.connect')
    const tList = useTranslations('services.list')
    const tMcp = useTranslations('services.customMcp.status')
    return {
        hint(tile: AppTile, status: TileStatus): string | null {
            if (status === 'unknown') return null
            if (status === 'error') return tile.kind === 'mcp' ? (tile.error ?? tMcp('noAnswer')) : t('errorHint')
            if (status === 'needs_auth') return tile.kind === 'mcp' ? tMcp('needsAuth') : t('needsAuthHint')
            if (status === 'needs_config') return t('needsConfigHint')
            if (tile.kind === 'mcp') return tMcp('connected', { count: tile.toolCount })
            if (tile.kind === 'vault') return t('vaultReady')
            return tConnect('connected')
        },
        short(status: TileStatus): string {
            if (status === 'needs_auth') return tList('needsSignIn')
            if (status === 'needs_config') return tList('needsSetup')
            return tMcp('unreachable')
        },
    }
}

function StatusPip({ status, label }: { status: TileStatus; label: string | null }) {
    if (status === 'unknown' || !label) return null
    return (
        <TooltipLabeled label={label}>
            <span role="img" aria-label={label} className="absolute -end-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full bg-background">
                {status === 'active' ? <span className="size-2 rounded-full bg-emerald-500" /> : <AlertTriangleIcon className="size-3 text-amber-400" />}
            </span>
        </TooltipLabeled>
    )
}

function CountPill({ count }: { count: number }) {
    return <span className="rounded bg-muted px-1.5 text-[10px] leading-4 font-normal text-muted-foreground tabular-nums">{count}</span>
}

// `count` is left out while the list is still paging in: a number that grows as you scroll says nothing.
export function AppsHeading({ title, count, hint }: { title: string; count?: number; hint?: string }) {
    return (
        <div className="mb-2 flex flex-col gap-0.5 px-0.5">
            <h3 className="flex items-center gap-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                {title}
                {count !== undefined && <CountPill count={count} />}
            </h3>
            {hint && <span className="text-xs text-muted-foreground/80">{hint}</span>}
        </div>
    )
}

// The actions of one account, server or Vault entry: the menu of a lone tile, or one account
// section of a grouped one.
function TileActions({ tile, readOnly, handlers }: { tile: AppTile; readOnly: boolean; handlers: TileHandlers }) {
    const t = useTranslations('agent.agentPanelServices')
    const tMcp = useTranslations('services.customMcp')
    const sharedWithAll = tile.kind === 'app' ? !!tile.service.vault?.sharedWithAll : tile.kind === 'vault' && tile.item.sharedWithAll
    const lent = tile.kind === 'vault' || (tile.kind === 'app' && !!tile.service.vault)
    return (
        <>
            {tile.kind === 'app' &&
                (isBroken(tile.status) ? (
                    <DropdownMenuItem disabled={readOnly} onSelect={() => handlers.onSignIn(tile)}>
                        <LinkIcon />
                        {tile.status === 'needs_auth' ? t('connect') : t('configure')}
                    </DropdownMenuItem>
                ) : (
                    <DropdownMenuItem disabled={readOnly} onSelect={() => handlers.onReconnect(tile)}>
                        <RefreshCwIcon />
                        {tile.service.app ? t('account') : t('reconnect')}
                    </DropdownMenuItem>
                ))}
            {tile.kind === 'mcp' && (
                <>
                    {tile.status === 'needs_auth' && tile.server.signInUrl && (
                        <DropdownMenuItem disabled={readOnly} onSelect={() => handlers.onSignIn(tile)}>
                            <LinkIcon />
                            {tMcp('connect')}
                        </DropdownMenuItem>
                    )}
                    <DropdownMenuItem disabled={readOnly} onSelect={() => handlers.onEdit(tile)}>
                        <PencilIcon />
                        {t('edit')}
                    </DropdownMenuItem>
                </>
            )}
            <DropdownMenuItem variant="destructive" disabled={readOnly || sharedWithAll} onSelect={() => handlers.onRemove(tile)}>
                <Trash2Icon />
                {tile.kind === 'mcp' || lent ? t('vaultRemoveAction') : t('uninstallAction')}
            </DropdownMenuItem>
            {sharedWithAll && !readOnly && <p className="px-1.5 pt-0.5 pb-1 text-[11px] text-muted-foreground">{t('vaultShared')}</p>}
        </>
    )
}

function MenuHead({ tile }: { tile: AppTile }) {
    const status = useStatusText()
    return (
        <DropdownMenuLabel className="flex flex-col">
            <span>{tile.name}</span>
            {tile.account && <span className={cn('truncate text-xs font-normal text-muted-foreground', tile.kind === 'vault' && tile.item.kind === 'secret' && 'font-mono')}>{tile.account}</span>}
            {isBroken(tile.status) && <span className="text-xs font-normal text-amber-600 dark:text-amber-400">{status.short(tile.status)}</span>}
        </DropdownMenuLabel>
    )
}

function ReadOnlyNote({ reason }: { reason: string }) {
    return (
        <>
            <DropdownMenuSeparator />
            <p className="flex items-start gap-1.5 px-1.5 py-1 text-[11px] text-muted-foreground">
                <LockIcon className="mt-px size-3 shrink-0" />
                {reason}
            </p>
        </>
    )
}

type TileProps = {
    tiles: AppTile[]
    icon: ReactNode
    // A catalog app that takes another account next to the ones it has.
    canAddAccount: boolean
    busy: boolean
    // Why the member cannot change this coworker: every action stays, disabled, with the reason
    // written in the menu (a disabled menu item gets no tooltip, and a finger has no hover).
    readOnlyReason?: string
    handlers: TileHandlers
}

// A tile opens its menu on click, so every action stays reachable on a touch screen too.
export function AppTileCard({ tiles, icon, canAddAccount, busy, readOnlyReason, handlers }: TileProps) {
    const t = useTranslations('agent.agentPanelServices')
    const tList = useTranslations('services.list')
    const status = useStatusText()
    const first = tiles[0]
    const worst = worstStatus(tiles)
    const broken = isBroken(worst)
    const grouped = tiles.length > 1
    const readOnly = !!readOnlyReason
    const pipLabel = status.hint(tiles.find(tile => tile.status === worst) ?? first, worst)
    const line = broken ? status.short(worst) : grouped ? t('accounts', { count: tiles.length }) : (first.account ?? ' ')
    const mono = !broken && !grouped && first.kind === 'vault' && first.item.kind === 'secret'
    return (
        <DropdownMenu>
            <DropdownMenuTrigger asChild>
                <button
                    type="button"
                    disabled={busy}
                    aria-busy={busy}
                    className="relative flex min-w-0 flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-2.5 hover:bg-accent disabled:opacity-60 data-[state=open]:bg-accent"
                >
                    {broken && <BorderBeam pattern="arcs" tone="yellow" width={1} outset={1} />}
                    <span className="relative flex shrink-0">
                        {icon}
                        <StatusPip status={worst} label={pipLabel} />
                    </span>
                    <span className="w-full truncate text-center text-xs font-medium">{first.name}</span>
                    <span className={cn('-mt-1 w-full truncate text-center text-[10px]', broken ? 'text-amber-600 dark:text-amber-400' : 'text-muted-foreground', mono && 'font-mono')}>{line}</span>
                </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="center" className="max-w-[min(18rem,calc(100vw-2rem))] min-w-52">
                {grouped ? (
                    <>
                        <DropdownMenuLabel>{first.name}</DropdownMenuLabel>
                        {tiles.map(tile => (
                            <Fragment key={tile.key}>
                                <DropdownMenuSeparator />
                                <DropdownMenuLabel className="flex items-center gap-1.5 py-0.5 text-xs font-normal text-muted-foreground">
                                    <span className={cn('size-1.5 shrink-0 rounded-full', isBroken(tile.status) ? 'bg-amber-400' : 'bg-emerald-500')} />
                                    <span className="truncate">{isBroken(tile.status) ? `${tile.account ?? first.name} · ${status.short(tile.status)}` : (tile.account ?? first.name)}</span>
                                </DropdownMenuLabel>
                                <TileActions tile={tile} readOnly={readOnly} handlers={handlers} />
                            </Fragment>
                        ))}
                    </>
                ) : (
                    <>
                        <MenuHead tile={first} />
                        <DropdownMenuSeparator />
                        <TileActions tile={first} readOnly={readOnly} handlers={handlers} />
                    </>
                )}
                {canAddAccount && first.slug && (
                    <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem disabled={readOnly} onSelect={() => first.slug && handlers.onAddAccount(first.slug)}>
                            <PlusIcon />
                            {tList('addAccount')}
                        </DropdownMenuItem>
                    </>
                )}
                {readOnlyReason && <ReadOnlyNote reason={readOnlyReason} />}
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export function TileSkeletons() {
    return (
        <section>
            <Skeleton className="mb-2 h-4 w-24" />
            <div className={TILE_GRID}>
                {Array.from({ length: 8 }, (_, index) => (
                    <div key={index} className="flex flex-col items-center gap-1.5 rounded-lg border border-border bg-card p-2.5">
                        <Skeleton className="size-8 rounded-lg" />
                        <Skeleton className="h-3 w-14" />
                        <Skeleton className="h-2.5 w-10" />
                    </div>
                ))}
            </div>
        </section>
    )
}
