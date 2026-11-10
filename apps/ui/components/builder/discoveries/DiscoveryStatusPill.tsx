'use client'

import { TextShimmer } from '@rerun/ui'
import { ChromeBar } from '@rerun/ui/chrome'
import { Badge } from '@rerun/ui/primitives'
import { AnimatePresence, motion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Orb } from '@/components/foreman/Orb'
import { CheckIcon } from '@/lib/icons'

const SWAP = { initial: { opacity: 0, y: 4 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -4 }, transition: { duration: 0.2 } }

export function DiscoveryStatusPill({ name, found, digging }: { name: string; found: number; digging: boolean }) {
    const t = useTranslations('builder.discoveries')
    return (
        <ChromeBar start="gauge" end={found > 0 ? 'gauge' : 'text'}>
            <div className="relative flex size-5 items-center justify-center">{digging ? <Orb state="thinking" size={20} facing="right" /> : <CheckIcon className="size-3.5 text-primary" />}</div>
            <AnimatePresence mode="wait" initial={false}>
                <motion.span key={digging ? 'digging' : 'done'} {...SWAP} className="relative">
                    {digging ? <TextShimmer>{t('statusDigging', { name })}</TextShimmer> : t('statusDone', { name })}
                </motion.span>
            </AnimatePresence>
            {found > 0 && (
                <Badge size="xs" tone="brand" glow={false} className="relative tabular-nums">
                    {t('found', { count: found })}
                </Badge>
            )}
        </ChromeBar>
    )
}
