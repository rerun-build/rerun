'use client'

import { TemplateLibraryEmpty } from '@/components/templates/TemplateLibraryEmpty'
import { TemplateTile } from '@/components/templates/TemplateTile'
import type { LibraryTemplate } from '@/lib/templates/library'
import { LEAVING, LIBRARY_EASE, LIBRARY_SETTLE, SETTLE_FROM, SETTLED } from '@/lib/templates/motion'
import { cn } from '@/lib/utils'
import { AnimatePresence, motion, useReducedMotion } from 'motion/react'
import type { ReactNode } from 'react'

const STAGGER_STEP = 0.04
const MAX_STAGGERED = 12

export function TemplateLibraryGrid({
    templates,
    selectedSlug,
    showStatus,
    onSelectTemplate,
    empty,
    filtered,
    revealKey,
    onScratch,
}: {
    templates: LibraryTemplate[]
    selectedSlug: string | null
    showStatus: (template: LibraryTemplate) => boolean
    onSelectTemplate: (slug: string) => void
    empty: boolean
    filtered: boolean
    revealKey: string
    onScratch?: () => void
}) {
    const reduceMotion = useReducedMotion() ?? false

    const cells = (
        <div className="relative grid grid-cols-1 gap-x-5 gap-y-8 @min-[28rem]:grid-cols-2 @min-[46rem]:grid-cols-3 @min-[62rem]:grid-cols-4">
            <AnimatePresence mode="popLayout">
                {templates.map((template, index) => (
                    <GridCell key={template.slug} reduceMotion={reduceMotion} delay={Math.min(index, MAX_STAGGERED) * STAGGER_STEP}>
                        <TemplateTile className="h-full w-full" template={template} selected={selectedSlug === template.slug} showStatus={showStatus(template)} onSelect={() => onSelectTemplate(template.slug)} />
                    </GridCell>
                ))}
                {empty && (
                    <GridCell key="empty" reduceMotion={reduceMotion} delay={0} className="col-span-full">
                        <TemplateLibraryEmpty filtered={filtered} onScratch={onScratch} />
                    </GridCell>
                )}
            </AnimatePresence>
        </div>
    )

    if (reduceMotion) return cells

    return (
        <AnimatePresence mode="wait" initial={false}>
            <motion.div key={revealKey} exit={{ opacity: 0, filter: 'blur(4px)', transition: { duration: 0.16, ease: LIBRARY_EASE } }}>
                {cells}
            </motion.div>
        </AnimatePresence>
    )
}

function GridCell({ reduceMotion, delay, className, children }: { reduceMotion: boolean; delay: number; className?: string; children: ReactNode }) {
    return (
        <motion.div
            layout={reduceMotion ? false : 'position'}
            initial={reduceMotion ? false : SETTLE_FROM}
            animate={{ ...SETTLED, transition: { ...LIBRARY_SETTLE, delay: reduceMotion ? 0 : delay } }}
            exit={reduceMotion ? { opacity: 0 } : LEAVING}
            transition={LIBRARY_SETTLE}
            className={cn('min-w-0', className)}
        >
            {children}
        </motion.div>
    )
}
