'use client'

import { Button } from '@/components/ui/button'
import { Icon } from '@/components/ui/icon'
import { AnimatePresence, motion } from 'motion/react'
import { XIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import type { ComponentType, ReactNode } from 'react'

export type SidePanelTab = {
    id: string
    icon: ComponentType<{ className?: string }>
    label: string
    description: string
}

type SidePanelTabHeaderProps = {
    tab: SidePanelTab
    onClose: () => void
    // Whose panel this is. With a title the header names its owner, stays put from one tab to the
    // next, and the tab moves down to the second line.
    leading?: ReactNode
    title?: string
}

const EASE = [0.22, 1, 0.36, 1] as const

function RevealLine({ text, base, className }: { text: string; base: number; className?: string }) {
    return (
        <span className={`flex flex-wrap ${className ?? ''}`}>
            {text.split(' ').map((w, i) => (
                <span key={`${w}-${i}`} className="inline-flex overflow-hidden leading-[1.35]">
                    <motion.span
                        className="inline-block"
                        initial={{ y: '120%' }}
                        animate={{ y: 0, transition: { duration: 0.55, ease: EASE, delay: base + i * 0.045 } }}
                        exit={{ y: '-120%', transition: { duration: 0.25, ease: 'easeIn', delay: i * 0.02 } }}
                    >
                        {w}&nbsp;
                    </motion.span>
                </span>
            ))}
        </span>
    )
}

export function SidePanelTabHeader({ tab, onClose, leading, title }: SidePanelTabHeaderProps) {
    const t = useTranslations('layout.sidePanel')
    if (title) {
        return (
            <div className="flex items-center justify-between gap-3 p-4 border-b border-border">
                <div className="flex items-center gap-3 min-w-0">
                    {leading}
                    <div className="flex flex-col min-w-0">
                        <span className="truncate text-sm font-semibold leading-[1.35]">{title}</span>
                        <AnimatePresence mode="popLayout" initial={false}>
                            <motion.div key={tab.id}>
                                <RevealLine text={`${tab.label} · ${tab.description}`} base={0.08} className="text-xs text-muted-foreground" />
                            </motion.div>
                        </AnimatePresence>
                    </div>
                </div>
                <Button aria-label={t('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                    <XIcon className="size-4" />
                </Button>
            </div>
        )
    }
    return (
        <div className="flex items-center justify-between p-4 border-b border-border">
            <AnimatePresence mode="popLayout" initial={false}>
                <motion.div key={tab.id} className="flex items-center gap-3 min-w-0">
                    <motion.div
                        initial={{ opacity: 0, scale: 0.6, rotate: -8 }}
                        animate={{ opacity: 1, scale: 1, rotate: 0, transition: { duration: 0.4, ease: EASE } }}
                        exit={{ opacity: 0, scale: 0.6, transition: { duration: 0.2, ease: 'easeIn' } }}
                    >
                        <Icon icon={tab.icon} size="sm" />
                    </motion.div>
                    <div className="flex flex-col min-w-0">
                        <RevealLine text={tab.label} base={0.08} className="text-sm font-semibold" />
                        <RevealLine text={tab.description} base={0.16} className="text-xs text-muted-foreground" />
                    </div>
                </motion.div>
            </AnimatePresence>
            <Button aria-label={t('close')} variant="ghost" size="icon-sm" onClick={onClose}>
                <XIcon className="size-4" />
            </Button>
        </div>
    )
}
