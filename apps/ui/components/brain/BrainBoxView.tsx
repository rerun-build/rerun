'use client'

import { TagBadge, useBoxLabel } from '@/components/brain/BrainItemProperties'
import { PageColumn } from '@/components/brain/BrainPageParts'
import { BrainTopBar } from '@/components/brain/BrainTopBar'
import type { BrainSelection } from '@/components/brain/selection'
import { filesOfBox, pagesOfBox, type BrainFiling } from '@/lib/brain/items'
import { BRAIN_PAGE_ICONS } from '@/lib/brain/page-icons'
import { ArchiveIcon, BoxIcon, FileIcon, FolderIcon, type LucideIcon } from '@/lib/icons'
import type { BrainPageSummary } from '@rerun/contracts'
import { AgentBuddy } from '@rerun/ui/iso-grid'
import { useTranslations } from 'next-intl'

type Row = { key: string; icon: LucideIcon; title: string; tags: string[]; open: BrainSelection }

function ItemRow({ row, onSelect }: { row: Row; onSelect: (selection: BrainSelection) => void }) {
    const Glyph = row.icon
    return (
        <button type="button" onClick={() => onSelect(row.open)} className="flex w-full items-center gap-3 py-2.5 text-left text-sm transition-colors hover:bg-accent/40">
            <Glyph className="size-4 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate">{row.title}</span>
            <span className="flex shrink-0 gap-1 max-sm:hidden">
                {row.tags.map(tag => (
                    <TagBadge key={tag} tag={tag} />
                ))}
            </span>
        </button>
    )
}

// A Box seen from the Brain: the coworkers that read it first, and everything filed under it.
export function BrainBoxView({ spaceId, pages, filing, onSelect }: { spaceId: string; pages: BrainPageSummary[]; filing: BrainFiling; onSelect: (selection: BrainSelection) => void }) {
    const t = useTranslations('brain')
    const boxLabel = useBoxLabel()
    const box = filing.boxes.find(entry => entry.id === spaceId) ?? null
    const name = boxLabel(box)
    const coworkers = filing.coworkers.filter(coworker => coworker.spaceId === spaceId)
    const files = filesOfBox(spaceId, filing.files)
    const rows: Row[] = [
        ...pagesOfBox(spaceId, pages, filing.boxes).map(page => ({ key: `page:${page.slug}`, icon: BRAIN_PAGE_ICONS[page.type], title: page.title, tags: page.tags, open: { kind: 'page', slug: page.slug } as const })),
        ...files.map(file => {
            const folder = file.kind === 'dir'
            const icon = folder ? FolderIcon : file.path.toLowerCase().endsWith('.zip') ? ArchiveIcon : FileIcon
            return { key: `file:${file.path}`, icon, title: file.path.split('/').pop() ?? file.path, tags: file.tags, open: { kind: folder ? 'folder' : 'file', path: file.path } as const }
        }),
    ]

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <BrainTopBar crumbs={[{ label: t('crumbs.boxes') }, { label: name, icon: BoxIcon }]} />
            <div className="min-h-0 flex-1 overflow-y-auto">
                <PageColumn>
                    <BoxIcon className="mb-4 size-8 text-muted-foreground" />
                    <h1 className="break-words text-[2rem] font-semibold leading-tight tracking-tight">{name}</h1>
                    <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border pb-4 text-sm">
                        <span className="w-28 shrink-0 text-muted-foreground">{t('box.readFirstBy')}</span>
                        {coworkers.length ? (
                            coworkers.map(coworker => (
                                <span key={coworker.id} className="flex min-w-0 items-center gap-1.5">
                                    <AgentBuddy agentId={coworker.id} size={20} animated={false} facing="right" />
                                    <span className="truncate">{coworker.name}</span>
                                </span>
                            ))
                        ) : (
                            <span className="text-muted-foreground">{t('box.noCoworkers')}</span>
                        )}
                    </div>
                    {rows.length ? (
                        <div className="mt-4 divide-y divide-border">
                            {rows.map(row => (
                                <ItemRow key={row.key} row={row} onSelect={onSelect} />
                            ))}
                        </div>
                    ) : (
                        <p className="mt-6 text-sm text-muted-foreground">{t('box.empty')}</p>
                    )}
                </PageColumn>
            </div>
        </div>
    )
}
