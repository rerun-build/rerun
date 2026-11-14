'use client'

import { zodResolver } from '@hookform/resolvers/zod'
import { useState } from 'react'
import { useForm, useWatch } from 'react-hook-form'
import { z } from 'zod'

import { BOX_NAME_MAX } from '@/lib/board/types'

const schema = z.object({ name: z.string().trim().min(1).max(BOX_NAME_MAX) })

export type BoxFormValues = z.infer<typeof schema>

export function useBoxDraft({ initialName, frozen }: { initialName: string; frozen: boolean }) {
    const form = useForm<BoxFormValues>({ resolver: zodResolver(schema), defaultValues: { name: initialName } })
    const name = useWatch({ control: form.control, name: 'name' })
    const [beat, setBeat] = useState(0)
    const trimmed = name.trim()

    function setName(next: string) {
        if (!trimmed && next.trim()) setBeat(current => current + 1)
        form.setValue('name', next, { shouldDirty: true })
    }

    function pick(next: string) {
        form.setValue('name', next, { shouldDirty: true })
        setBeat(current => current + 1)
    }

    return {
        form,
        name,
        trimmed,
        named: trimmed !== '',
        setName,
        pick,
        drawKey: !frozen && trimmed && beat > 0 ? String(beat) : null,
    }
}

export type BoxDraft = ReturnType<typeof useBoxDraft>
