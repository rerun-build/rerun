'use client'

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useState } from 'react'

import { attempt, isStale } from './attempt'
import type { ConsoleResult } from './types'

// A tab left alone this long reads again when it comes back.
const STALE_AFTER_MS = 10_000

const POLL_FIRST_MS = 4_000
const POLL_SLOWEST_MS = 30_000
const POLL_GROWTH = 1.4
const POLL_MAX = 60

// Something changed since this tab loaded: a page the browser kept from before reads again.
let changed = false

export function markConsoleChanged(): void {
    changed = true
}

type ConsoleDataOptions<Data> = {
    waiting?: (data: Data) => boolean
    // What a fresh reading keeps of the one before.
    merge?: (fresh: Data, known: Data) => Data
}

type ConsoleData<Data> = {
    data: Data
    // Shows a change ahead of its answer, and returns what takes it back.
    expect: (change: (data: Data) => Data) => () => void
    update: (change: (data: Data) => Data) => void
    reload: () => Promise<void>
}

// What a page shows: what the server rendered, then what `load` reads after each change, when the tab
// comes back, and every few seconds while `waiting` says a job is under way. Reading again never
// blanks the page: one that fails leaves it as it was.
export function useConsoleData<Data extends object>(initial: Data, load: () => Promise<ConsoleResult<Data>>, { waiting, merge = fresh => fresh }: ConsoleDataOptions<Data> = {}): ConsoleData<Data> {
    const router = useRouter()
    const [rendered, setRendered] = useState(initial)
    const [data, setData] = useState(initial)
    const turn = useRef(0)
    const readAt = useRef(0)
    const latest = useRef({ load, merge })

    useEffect(() => {
        latest.current = { load, merge }
    })

    if (rendered !== initial) {
        setRendered(initial)
        setData(known => merge(initial, known))
    }

    const reload = useCallback(async () => {
        const mine = ++turn.current
        const result = await attempt(() => latest.current.load())
        if (mine !== turn.current) return
        readAt.current = Date.now()
        if (result.ok) setData(known => latest.current.merge(result, known))
        else if (isStale(result)) router.refresh()
    }, [router])

    useEffect(() => {
        readAt.current = Date.now()
        if (changed) void reload()
    }, [reload])

    useEffect(() => {
        const comeBack = () => {
            if (document.visibilityState === 'visible' && Date.now() - readAt.current > STALE_AFTER_MS) void reload()
        }
        document.addEventListener('visibilitychange', comeBack)
        window.addEventListener('focus', comeBack)
        return () => {
            document.removeEventListener('visibilitychange', comeBack)
            window.removeEventListener('focus', comeBack)
        }
    }, [reload])

    const expect = (change: (data: Data) => Data) => {
        const before = data
        setData(change)
        return () => setData(before)
    }

    const polling = waiting?.(data) ?? false
    useEffect(() => {
        if (!polling) return
        let timer: ReturnType<typeof setTimeout>
        let polls = 0
        let stopped = false
        const next = () => {
            if (polls >= POLL_MAX) return
            timer = setTimeout(poll, Math.min(POLL_FIRST_MS * POLL_GROWTH ** polls, POLL_SLOWEST_MS))
        }
        const poll = async () => {
            polls++
            if (document.visibilityState === 'visible') await reload()
            if (!stopped) next()
        }
        next()
        return () => {
            stopped = true
            clearTimeout(timer)
        }
    }, [polling, reload])

    return { data, expect, update: setData, reload }
}
