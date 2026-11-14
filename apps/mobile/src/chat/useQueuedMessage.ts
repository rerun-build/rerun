import { parseQueued, type QueuedMessage } from '@rerun/contracts'
import { randomUUID } from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { useCallback, useEffect, useState } from 'react'

const folder = () => new Directory(Paths.document, 'queued-messages')
const fileOf = (key: string) => new File(folder(), `${key.replace(/[^\w-]/g, '_')}.json`)

function read(key: string): QueuedMessage | null {
    try {
        const file = fileOf(key)
        return file.exists ? parseQueued(file.textSync()) : null
    } catch {
        return null
    }
}

type QueueState = { queued: QueuedMessage | null; restoredId: string | null }

export function useQueuedMessage(key: string) {
    const [{ queued, restoredId }, setState] = useState<QueueState>(() => {
        const found = read(key)
        return { queued: found, restoredId: found?.id ?? null }
    })

    useEffect(() => {
        const found = read(key)
        setState({ queued: found, restoredId: found?.id ?? null })
    }, [key])

    const enqueue = useCallback(
        (text: string, behindRunId: string | null) => {
            const item: QueuedMessage = { id: randomUUID(), text, createdAt: Date.now(), behindRunId }
            try {
                folder().create({ intermediates: true, idempotent: true })
                fileOf(key).write(JSON.stringify(item))
            } catch {}
            setState(prev => ({ ...prev, queued: item }))
        },
        [key]
    )

    const clear = useCallback(() => {
        try {
            const file = fileOf(key)
            if (file.exists) file.delete()
        } catch {}
        setState(prev => ({ ...prev, queued: null }))
    }, [key])

    return { queued, restoredId, enqueue, clear }
}
