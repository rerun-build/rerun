import { useLocale } from 'next-intl'

import { messageDayLabel, messageTime } from '@/lib/time'

export function ChatTimeSeparator({ createdAt }: { createdAt: string }) {
    const locale = useLocale()
    return (
        <time dateTime={createdAt} className="block text-center text-muted-foreground text-xs">
            <span className="font-medium">{messageDayLabel(createdAt, locale)}</span> {messageTime(createdAt, locale)}
        </time>
    )
}
