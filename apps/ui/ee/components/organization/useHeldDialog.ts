'use client'

import { useRef } from 'react'

export type Hold = <Answer>(send: () => Promise<Answer>) => Promise<Answer>

// A dialog that stays open while what it sent has not answered: closed, it would drop the answer, a
// refusal nobody reads or a link shown once.
export function useHeldDialog(onOpenChange: (open: boolean) => void) {
    const held = useRef(false)
    const change = (open: boolean) => {
        if (open || !held.current) onOpenChange(open)
    }
    const hold: Hold = async send => {
        held.current = true
        try {
            return await send()
        } finally {
            held.current = false
        }
    }
    return { onOpenChange: change, close: () => change(false), hold }
}
