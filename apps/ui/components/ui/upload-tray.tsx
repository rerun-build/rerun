'use client'

import { IconBadge } from '@/components/ui/icon-badge'
import { Progress } from '@/components/ui/progress'
import { formatBytes, formatEta } from '@/lib/files/format'
import type { UploadItem } from '@/hooks/useFileUploads'
import { CheckIcon, ChevronDownIcon, RefreshCwIcon, XIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'
import { Stripes } from '@rerun/ui/primitives'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'
import { useId, useState } from 'react'

type UploadTrayProps = {
    items: UploadItem[]
    totalProgress: number
    onCancel: (id: string) => void
    onRetry: (id: string) => void
    onDismiss: () => void
}

const COLLAPSED_ROWS = 6
const COLLAPSE_TRANSITION = { duration: 0.28, ease: [0.4, 0, 0.2, 1] } as const

function statusLine(item: UploadItem, locale: string, t: ReturnType<typeof useTranslations<'ui.upload'>>): string {
    if (item.status === 'error') return item.error ?? t('failed')
    if (item.status === 'done') return formatBytes(item.size, locale)
    if (item.status === 'finishing') return t('finishing')
    if (item.status === 'queued') return t('waiting', { size: formatBytes(item.size, locale) })
    const parts = [`${Math.round(item.progress * 100)}%`]
    if (item.etaMs != null) parts.push(formatEta(item.etaMs))
    return parts.join(' · ')
}

function UploadRow({ item, onCancel, onRetry }: { item: UploadItem; onCancel: (id: string) => void; onRetry: (id: string) => void }) {
    const t = useTranslations('ui.upload')
    const locale = useLocale()
    return (
        <div className="flex items-center gap-2 px-3 py-1.5">
            <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-baseline gap-1.5">
                    <span className="truncate text-xs text-foreground">{item.name}</span>
                    {item.dir && <span className="shrink-0 truncate text-[10px] text-muted-foreground">{item.dir}</span>}
                </div>
                {item.status === 'done' ? (
                    <span className="text-[10px] text-muted-foreground">{statusLine(item, locale, t)}</span>
                ) : (
                    <>
                        <Progress value={item.status === 'finishing' ? null : item.progress * 100} size="sm" tone={item.status === 'error' ? 'destructive' : 'brand'} label={t('uploadingFile', { name: item.name })} />
                        <span className={item.status === 'error' ? 'text-[10px] text-destructive' : 'text-[10px] text-muted-foreground'}>{statusLine(item, locale, t)}</span>
                    </>
                )}
            </div>
            {item.status === 'done' ? (
                <IconBadge tone="green" icon={CheckIcon} />
            ) : item.status === 'error' ? (
                <button type="button" onClick={() => onRetry(item.id)} title={t('retry')} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <RefreshCwIcon className="size-3.5" />
                </button>
            ) : (
                <button type="button" onClick={() => onCancel(item.id)} title={t('cancel')} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                    <XIcon className="size-3.5" />
                </button>
            )}
        </div>
    )
}

export function UploadTray({ items, totalProgress, onCancel, onRetry, onDismiss }: UploadTrayProps) {
    const t = useTranslations('ui.upload')
    const [expanded, setExpanded] = useState(false)
    // `null` = personne n'a touché au chevron, le tray suit la règle automatique.
    const [open, setOpen] = useState<boolean | null>(null)
    const reduceMotion = useReducedMotion()
    const listId = useId()

    if (items.length === 0) return null

    const done = items.filter(item => item.status === 'done').length
    const failed = items.filter(item => item.status === 'error').length
    const settled = done + failed === items.length
    // Une fois tout monté sans casse, la liste n'a plus rien à dire et rend le bas du panneau.
    const isOpen = open ?? !(settled && failed === 0)

    // A dropped folder can carry hundreds of files, and rendering a row per file turns the panel into
    // a wall. What is still moving or broken is what the user needs to see.
    const ordered = [...items].sort((a, b) => rank(a) - rank(b))
    const visible = expanded ? ordered : ordered.slice(0, COLLAPSED_ROWS)
    const hidden = ordered.length - visible.length

    const heading = settled ? (failed ? t('headingFailed', { failed, total: items.length }) : t('headingDone', { count: done })) : t('headingUploading', { current: done + 1, total: items.length })

    return (
        <div className="absolute inset-x-0 bottom-0 z-20 border-t border-border bg-background/95 backdrop-blur">
            {/* `relative` sur les enfants sinon les hachures, absolues, se peindraient par-dessus. */}
            <div className="relative overflow-hidden">
                <Stripes />
                <div className="relative flex items-center gap-2 px-3 py-2">
                    <button type="button" onClick={() => setOpen(!isOpen)} aria-expanded={isOpen} aria-controls={listId} className="flex min-w-0 flex-1 items-center gap-1.5 text-left">
                        <ChevronDownIcon className={cn('size-3.5 shrink-0 text-muted-foreground transition-transform duration-200 ease-out', !isOpen && '-rotate-90')} />
                        <span className="min-w-0 flex-1 truncate text-xs font-medium">{heading}</span>
                    </button>
                    {!settled && (
                        <button type="button" onClick={onDismiss} className="shrink-0 text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                            {t('cancelAll')}
                        </button>
                    )}
                    {settled && (
                        <button type="button" onClick={onDismiss} title={t('dismiss')} className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground">
                            <XIcon className="size-3.5" />
                        </button>
                    )}
                </div>
                {/* Le total reste hors du repli : c'est le résumé, il doit survivre à la fermeture. */}
                {!settled && (
                    <div className="relative px-3 pb-2">
                        <Progress value={totalProgress * 100} size="md" label={t('totalProgress')} />
                    </div>
                )}
            </div>
            {/* Le tray est ancré en bas, donc la hauteur animée pousse le header vers le haut plutôt
                que de faire glisser la liste sous le panneau. */}
            <AnimatePresence initial={false}>
                {isOpen && (
                    <motion.div
                        key="list"
                        id={listId}
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={reduceMotion ? { duration: 0 } : COLLAPSE_TRANSITION}
                        className="overflow-hidden"
                    >
                        <div className="max-h-56 overflow-y-auto border-t border-border/60">
                            {visible.map(item => (
                                <UploadRow key={item.id} item={item} onCancel={onCancel} onRetry={onRetry} />
                            ))}
                            {hidden > 0 && (
                                <button type="button" onClick={() => setExpanded(true)} className="w-full px-3 py-1.5 text-left text-[10px] text-muted-foreground transition-colors hover:text-foreground">
                                    {t('more', { count: hidden })}
                                </button>
                            )}
                        </div>
                    </motion.div>
                )}
            </AnimatePresence>
        </div>
    )
}

function rank(item: UploadItem): number {
    if (item.status === 'error') return 0
    if (item.status === 'uploading' || item.status === 'finishing') return 1
    if (item.status === 'queued') return 2
    return 3
}
