import { cn } from '../cn'
import type { HTMLAttributes } from 'react'

export type MessageRole = 'system' | 'user' | 'assistant'

export type MessageProps = HTMLAttributes<HTMLDivElement> & {
    from: MessageRole
}

export const Message = ({ className, from, ...props }: MessageProps) => <div className={cn('group flex w-full max-w-[95%] flex-col gap-2', from === 'user' ? 'is-user ms-auto justify-end' : 'is-assistant', className)} {...props} />

export type MessageContentProps = HTMLAttributes<HTMLDivElement>

export const MessageContent = ({ children, className, ...props }: MessageContentProps) => (
    <div className={cn('is-user:dark flex w-fit min-w-0 max-w-full flex-col gap-2 overflow-hidden text-sm', 'group-[.is-user]:ms-auto group-[.is-user]:rounded-lg group-[.is-user]:bg-secondary group-[.is-user]:px-4 group-[.is-user]:py-3 group-[.is-user]:text-foreground', 'group-[.is-assistant]:w-full group-[.is-assistant]:text-foreground', className)} {...props}>
        {children}
    </div>
)
