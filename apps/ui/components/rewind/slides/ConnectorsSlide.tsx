'use client'

import { motion } from 'motion/react'
import { useTranslations } from 'next-intl'

import { Icon } from '@/components/ui/icon'
import { Progress } from '@/components/ui/progress'
import { serviceIconProps } from '@/lib/services/icons'
import { RewindCount } from '../RewindCount'
import { RewindHeadline, RewindSlideFrame } from '../RewindSlideFrame'
import { useSettledValue } from '../useSettledValue'
import type { RewindSlideProps } from './types'

const MAX_ROWS = 5

export function ConnectorsSlide({ payload }: RewindSlideProps) {
    const t = useTranslations('rewind.connectors')
    const rows = payload.connectors.slice(0, MAX_ROWS)
    const peak = rows[0]?.calls ?? 1
    const top = rows[0]

    return (
        <RewindSlideFrame
            tone="lime"
            eyebrow={t('eyebrow')}
            visual={
                <div className="flex flex-col gap-3 rewind-wide:gap-5">
                    {rows.map((connector, i) => (
                        <motion.div
                            key={connector.slug}
                            className="flex items-center gap-3"
                            initial={{ opacity: 0, x: -24 }}
                            animate={{ opacity: 1, x: 0 }}
                            transition={{ delay: 0.6 + i * 0.15, duration: 0.4 }}
                        >
                            <span className="w-4 text-right text-sm font-semibold text-white/60">{i + 1}</span>
                            <Icon {...serviceIconProps(connector.icon)} size="md" className="shrink-0" />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline justify-between gap-2">
                                    <span className="truncate font-medium">{connector.name}</span>
                                    <span className="text-sm text-white/70">{t.rich('calls', { count: connector.calls, value: () => <RewindCount value={connector.calls} delay={0.8 + i * 0.15} /> })}</span>
                                </div>
                                <ConnectorShare share={Math.max(6, (connector.calls / peak) * 100)} delay={0.8 + i * 0.15} />
                            </div>
                        </motion.div>
                    ))}
                </div>
            }
        >
            <RewindHeadline>{top ? t.rich('headline', { name: top.name, br: () => <br /> }) : null}</RewindHeadline>
        </RewindSlideFrame>
    )
}

function ConnectorShare({ share, delay }: { share: number; delay: number }) {
    const t = useTranslations('rewind.connectors')
    const shown = useSettledValue(share, delay)
    return <Progress value={shown} size="md" label={t('shareOfCalls')} className="mt-1.5 [&_.progress-fill]:duration-900" />
}
