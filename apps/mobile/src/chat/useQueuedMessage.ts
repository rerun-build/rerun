import { parseQueued, queuedPreview, type QueuedMessage } from '@rerun/contracts'
import { randomUUID } from 'expo-crypto'
import { Directory, File, Paths } from 'expo-file-system'
import { useCallback, useState } from 'react'

import { restoreDraft } from './composer-drafts'

// A file per conversation, not SecureStore: a value there is capped at 2 KB and a message is not.
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

// `restoredId` names what was already waiting when the conversation opened, as opposed to what the
// person just queued: only the former has to prove the run it was queued behind is still the one
// running.
type QueueState = { queued: QueuedMessage | null; restoredId: string | null }

/**
 * The web's `useQueuedMessage`: the single message waiting behind the run in flight, kept on the
 * phone so it survives the app being closed while the run keeps going.
 */
export function useQueuedMessage(key: string) {
    const [{ queued, restoredId }, setState] = useState<QueueState>(() => {
        const found = read(key)
        return { queued: found, restoredId: found?.id ?? null }
    })

    // Another conversation reads its own file, on the render that names it.
    const [readKey, setReadKey] = useState(key)
    if (readKey !== key) {
        setReadKey(key)
        const found = read(key)
        setState({ queued: found, restoredId: found?.id ?? null })
    }

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

    // A message that stopped waiting goes back to the composer. Text already typed there stays, and the
    // message leaves the queue either way: left queued, it would go out on its own.
    const returnToComposer = useCallback(
        (draftKey: string) => {
            if (queued) restoreDraft(draftKey, queuedPreview(queued.text).text)
            clear()
        },
        [queued, clear]
    )

    return { queued, restoredId, enqueue, clear, returnToComposer }
}
