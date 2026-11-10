import { AppText } from '@/components/ui/AppText'
import { useMessageTimes } from '@/lib/time'

export function ChatTimeSeparator({ createdAt }: { createdAt: string }) {
    const times = useMessageTimes()
    return (
        <AppText variant="caption" tone="muted" style={{ textAlign: 'center' }}>
            <AppText variant="caption" tone="muted" medium>
                {times.day(createdAt)}
            </AppText>{' '}
            {times.time(createdAt)}
        </AppText>
    )
}
