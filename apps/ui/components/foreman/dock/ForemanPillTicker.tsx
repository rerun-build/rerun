'use client'

import { TextShimmer } from '@rerun/ui'
import { useTranslations } from 'next-intl'

import { TextLoop } from '@/components/ui/text-loop'
import { LOADING_ACTIVITIES } from '@/lib/agent-chat-loader'

/** The run, one line at a time, where the field was: the same line the chat's own loader shows. */
export function ForemanPillTicker({ label }: { label: string | null }) {
    const t = useTranslations('chat.activity')
    return (
        <span role="status" className="flex h-full min-w-0 flex-1 items-center overflow-hidden">
            {label ? (
                <TextShimmer className="max-w-full truncate text-sm">{label}</TextShimmer>
            ) : (
                <TextLoop className="text-sm" interval={2.5}>
                    {LOADING_ACTIVITIES.map(loading => (
                        <TextShimmer key={loading}>{t(loading)}</TextShimmer>
                    ))}
                </TextLoop>
            )}
        </span>
    )
}
