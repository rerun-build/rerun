'use client'

import { useEffect, useRef, useState, type ChangeEvent, type KeyboardEvent, type MouseEvent } from 'react'

type RenameFieldOptions = {
    name: string
    onSubmit: (name: string) => void
    onCancel: () => void
    // True while the name is being saved by a field that stays open until the answer comes back.
    busy?: boolean
    // False for a field drawn already open, which must not take the focus from where it is.
    focus?: boolean
}

// A name edited in place: Enter or a click elsewhere saves, Escape cancels, a blank or unchanged
// name cancels too. The field is mounted only while renaming, so the current name is its initial state.
export function useRenameField({ name, onSubmit, onCancel, busy = false, focus = true }: RenameFieldOptions) {
    const [value, setValue] = useState(name)
    const inputRef = useRef<HTMLInputElement>(null)

    // A menu item starts the rename: its focus restore would steal the focus from an immediate call.
    useEffect(() => {
        if (!focus) return
        const timer = setTimeout(() => {
            inputRef.current?.focus()
            inputRef.current?.select()
        })
        return () => clearTimeout(timer)
    }, [focus])

    // Unmounting the field fires its blur in Chrome, so an Escape (or an Enter) would be followed by
    // a second submit carrying the edited value. A save that failed leaves the field open: once it is
    // no longer busy, it takes an answer again.
    const settled = useRef(false)
    useEffect(() => {
        if (!busy) settled.current = false
    }, [busy])
    const settle = (fn: () => void) => {
        if (settled.current) return
        settled.current = true
        fn()
    }

    const submit = () =>
        settle(() => {
            const next = value.trim()
            if (next && next !== name) onSubmit(next)
            else onCancel()
        })

    return {
        inputProps: {
            ref: inputRef,
            value,
            onChange: (event: ChangeEvent<HTMLInputElement>) => setValue(event.target.value),
            onBlur: submit,
            onClick: (event: MouseEvent<HTMLInputElement>) => event.stopPropagation(),
            onKeyDown: (event: KeyboardEvent<HTMLInputElement>) => {
                event.stopPropagation()
                if (event.key === 'Enter') submit()
                if (event.key === 'Escape') settle(onCancel)
            },
        },
    }
}
