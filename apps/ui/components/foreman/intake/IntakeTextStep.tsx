'use client'

import { useId } from 'react'

import { Field } from '@/components/ui/field'
import { IntakeField } from './IntakeField'

export function IntakeTextStep({ label, value, placeholder, disabled, onChange, onEnter }: { label: string; value: string; placeholder: string; disabled?: boolean; onChange: (value: string) => void; onEnter: () => void }) {
    const id = useId()
    return (
        <Field label={label} htmlFor={id}>
            <div className="flex items-center gap-2.5 rounded-md border border-border bg-background px-2.5 py-2">
                <IntakeField id={id} autoFocus value={value} disabled={disabled} placeholder={placeholder} onChange={onChange} onEnter={onEnter} />
            </div>
        </Field>
    )
}
