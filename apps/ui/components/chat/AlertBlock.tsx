'use client'

import { MessageResponse } from '@/components/ai-elements/message'
import { AlertBlock as AlertBlockBase, type AlertBlockProps } from '@moldwright/ui/chat'

const renderMarkdown = (text: string) => <MessageResponse>{text}</MessageResponse>

export function AlertBlock(props: Omit<AlertBlockProps, 'renderText'>) {
    return <AlertBlockBase {...props} renderText={renderMarkdown} />
}
