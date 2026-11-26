'use client'

import { useStepDirection } from '@rerun/ui/steps'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'
import { isValidElement, type ComponentType, type ReactNode } from 'react'
import { DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { ArrowLeft } from '@/lib/icons'
import { cn } from '@/lib/utils'

type IconGlyph = ComponentType<{ className?: string }>

const ROLL = {
    enter: (direction: number) => ({ opacity: 0, y: direction * 16, filter: 'blur(3px)' }),
    center: { opacity: 1, y: 0, filter: 'blur(0px)' },
    exit: (direction: number) => ({ opacity: 0, y: direction * -16, filter: 'blur(3px)' }),
}
const ROLL_TRANSITION = { duration: 0.32, ease: [0.22, 1, 0.36, 1] } as const

// The old page rolls out while the new one rolls in, in the same box: the box never changes size.
function Roll({ rollKey, direction, delay = 0, className, children }: { rollKey: string; direction: number; delay?: number; className?: string; children: ReactNode }) {
    return (
        <span className={cn('relative block overflow-hidden', className)}>
            <AnimatePresence mode="popLayout" initial={false} custom={direction}>
                <motion.span key={rollKey} custom={direction} variants={ROLL} initial="enter" animate="center" exit="exit" transition={{ ...ROLL_TRANSITION, delay }} className="block truncate">
                    {children}
                </motion.span>
            </AnimatePresence>
        </span>
    )
}

// The one header every dialog of the app wears: an icon tile, the title, the description, and a
// line under it. Dialogs do not style their DialogHeader themselves, so they cannot drift apart.
// `children` is a row under the title inside the same band, such as a wizard's progress bar.
//
// In a padded DialogContent the band bleeds to the frame edges, the mirror of DialogFooter's
// `-mx-4 -mb-4`. A frame that drops its padding (`p-0`: PanelDialogContent, SplitDialogContent,
// the tabbed dialogs) already puts the band against its edges. The variant reads the frame rather
// than the direct parent because forms wrap the header.
//
// The title row stops short of the close button in the top right corner.
//
// A dialog with sub-pages navigates from this header: it passes `page` (the page's key and depth,
// 0 on the first page), and on a sub-page `onBack` with the page's icon, title and description. The
// body carries no header of its own. The band then keeps one height on every page: title and
// description hold one line each, and they roll up or down with the direction of travel.
export function DialogHeaderBar({
    icon,
    title,
    description,
    actions,
    onBack,
    backLabel,
    page,
    children,
}: {
    icon: IconGlyph | ReactNode
    title: ReactNode
    description?: ReactNode
    actions?: ReactNode
    onBack?: () => void
    backLabel?: string
    page?: { key: string; depth: number }
    children?: ReactNode
}) {
    const t = useTranslations('dialogs.headerBar')
    const direction = useStepDirection(page?.depth ?? 0)
    const tile = isValidElement(icon) ? icon : <Icon size="md" icon={icon as IconGlyph} />

    if (page) {
        return (
            <DialogHeader className="shrink-0 gap-4 border-b p-4 text-start [[data-slot=dialog-content]:not(.p-0)_&]:-mx-4 [[data-slot=dialog-content]:not(.p-0)_&]:-mt-4">
                <div className="flex items-center gap-3 pe-8">
                    <AnimatePresence initial={false}>
                        {onBack && (
                            <motion.span key="back" className="flex shrink-0 overflow-hidden" initial={{ width: 0, marginInlineEnd: -12, opacity: 0 }} animate={{ width: 40, marginInlineEnd: -4, opacity: 1 }} exit={{ width: 0, marginInlineEnd: -12, opacity: 0 }} transition={ROLL_TRANSITION}>
                                <Button size="icon-lg" variant="ghost" aria-label={backLabel ? t('backTo', { page: backLabel }) : t('back')} onClick={onBack} className="size-10 rounded-lg [&_svg:not([class*='size-'])]:size-4">
                                    <ArrowLeft />
                                </Button>
                            </motion.span>
                        )}
                    </AnimatePresence>
                    <Roll rollKey={page.key} direction={direction} className="size-10 shrink-0 rounded-lg">
                        {tile}
                    </Roll>
                    <div className="min-w-0 flex-1 space-y-1">
                        <DialogTitle className="leading-snug">
                            <Roll rollKey={page.key} direction={direction}>
                                {title}
                            </Roll>
                        </DialogTitle>
                        <DialogDescription>
                            <Roll rollKey={page.key} direction={direction} delay={0.04}>
                                {description}
                            </Roll>
                        </DialogDescription>
                    </div>
                    {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
                </div>
                {children}
            </DialogHeader>
        )
    }

    return (
        <DialogHeader className="shrink-0 gap-4 border-b p-4 text-start [[data-slot=dialog-content]:not(.p-0)_&]:-mx-4 [[data-slot=dialog-content]:not(.p-0)_&]:-mt-4">
            <div className="flex items-center gap-3 pe-8">
                {tile}
                <div className="min-w-0 flex-1 space-y-1">
                    <DialogTitle className="leading-snug break-words">{title}</DialogTitle>
                    {description && <DialogDescription>{description}</DialogDescription>}
                </div>
                {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
            </div>
            {children}
        </DialogHeader>
    )
}
