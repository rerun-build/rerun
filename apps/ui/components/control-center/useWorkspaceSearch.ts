import type { WorkspaceSearchAnswer } from '@/app/api/_services/workspace-search.service'
import type { WorkspaceSearchHit } from '@rerun/contracts'
import { useEffect, useState } from 'react'

const DEBOUNCE_MS = 250

type Answer = WorkspaceSearchAnswer & { text: string }

type WorkspaceSearch = {
    hits: WorkspaceSearchHit[]
    loading: boolean
    // The machine could not be searched at all, or not to the end: what is missing is not "nothing".
    unavailable: boolean
    truncated: boolean
}

const IDLE: WorkspaceSearch = { hits: [], loading: false, unavailable: false, truncated: false }

async function fetchAnswer(text: string, signal: AbortSignal): Promise<WorkspaceSearchAnswer> {
    const res = await fetch(`/api/workspace-search?${new URLSearchParams({ q: text })}`, { signal })
    if (!res.ok) throw new Error(`workspace search: ${res.status}`)
    return (await res.json()) as WorkspaceSearchAnswer
}

// What the machine holds that mentions `text`: souls, skills, files, Brain pages, table rows.
export function useWorkspaceSearch(text: string, enabled: boolean): WorkspaceSearch {
    const [answer, setAnswer] = useState<Answer | null>(null)

    useEffect(() => {
        if (!enabled) return
        const controller = new AbortController()
        const settle = (result: WorkspaceSearchAnswer) => {
            if (!controller.signal.aborted) setAnswer({ ...result, text })
        }
        const timer = setTimeout(() => {
            fetchAnswer(text, controller.signal).then(settle, () => settle({ hits: [], truncated: false, unavailable: true }))
        }, DEBOUNCE_MS)
        return () => {
            controller.abort()
            clearTimeout(timer)
        }
    }, [text, enabled])

    if (!enabled) return IDLE
    // The previous answer stays on screen while the next one loads: the list refines under the cursor.
    if (answer?.text !== text) return { ...IDLE, hits: answer?.hits ?? [], loading: true }
    return { hits: answer.hits, loading: false, unavailable: answer.unavailable, truncated: answer.truncated }
}
