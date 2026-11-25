'use client'

import { useRouter } from 'next/navigation'
import { useRef, useState } from 'react'
import { toast } from 'sonner'

import { useErrorText, type Refusal } from '@/hooks/useErrorText'

import { attempt, isStale } from './attempt'
import type { ConsoleResult } from './types'
import { markConsoleChanged } from './useConsoleData'

type Refused = { ok: false } & Refusal

// What every change of the console goes through. The page reads again whatever the answer: a refusal
// often means it changed elsewhere.
export function useConsoleChange<Name extends string = never>(reload: () => Promise<unknown>) {
    const router = useRouter()
    const errorText = useErrorText()
    const running = useRef(false)
    const [pending, setPending] = useState<Name | null>(null)

    // For a dialog, which waits for the answer and shows the refusal itself.
    async function submit<Result extends ConsoleResult>(action: () => Promise<Result>, undo?: () => void): Promise<Result | Refused> {
        const result = await attempt(action)
        if (result.ok) markConsoleChanged()
        else {
            undo?.()
            if (isStale(result)) router.refresh()
        }
        await reload()
        return result
    }

    // `undo` takes back what the page showed ahead of the answer.
    async function change(action: () => Promise<ConsoleResult>, undo?: () => void): Promise<ConsoleResult> {
        const result = await submit(action, undo)
        if (!result.ok) toast.error(errorText(result))
        return result
    }

    // One at a time: a second click while one is under way does nothing. Left pending once it went
    // through for a change that leaves the page.
    async function run(name: Name, action: () => Promise<ConsoleResult>, { leave, done }: { leave?: () => void; done?: () => void } = {}): Promise<void> {
        if (running.current) return
        running.current = true
        setPending(name)
        const result = await attempt(action)
        if (result.ok && leave) {
            markConsoleChanged()
            return leave()
        }
        if ((await change(async () => result)).ok) done?.()
        running.current = false
        setPending(null)
    }

    return { pending, run, submit, change }
}
