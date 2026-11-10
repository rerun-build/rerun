'use client'

import { MessageResponse } from '@/components/ai-elements/message'
import { StepRow } from '@/components/chat/StepRow'
import { BrainIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'

const renderMarkdown = (text: string) => <MessageResponse>{text}</MessageResponse>

/** A settled or running thought on one line of the folded steps. */
export function ReasoningStep({ text, isStreaming = false }: { text: string; isStreaming?: boolean }) {
    const t = useTranslations('chat.reasoning')
    return (
        <StepRow iconProps={{ icon: BrainIcon }} label={isStreaming ? t('thinking') : t('thought')} detail={text.replace(/\s+/g, ' ')} status={isStreaming ? 'running' : 'done'}>
            {text && <div className="border-l border-border pl-3 text-xs leading-relaxed text-muted-foreground/80">{renderMarkdown(text)}</div>}
        </StepRow>
    )
}
