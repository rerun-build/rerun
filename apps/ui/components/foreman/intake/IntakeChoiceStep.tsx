'use client'

import { CustomOptionRow, OptionRow } from '@moldwright/ui/chat'
import { ScrollFade } from '@moldwright/ui/primitives'
import { useState } from 'react'

import { Field } from '@/components/ui/field'
import { IntakeField } from './IntakeField'

type IntakeChoiceStepProps = {
    label: string
    options: string[]
    value: string
    placeholder: string
    disabled?: boolean
    onChange: (value: string) => void
    onChoose: (value: string) => void
    onEnter: () => void
}

export function IntakeChoiceStep({ label, options, value, placeholder, disabled, onChange, onChoose, onEnter }: IntakeChoiceStepProps) {
    const [custom, setCustom] = useState(!!value && !options.includes(value))

    return (
        <Field label={label}>
            <ScrollFade className="-mx-1 max-h-64">
                <div className="space-y-0.5">
                    {options.map((option, index) => (
                        <OptionRow
                            key={option}
                            index={index}
                            label={option}
                            selected={!custom && value === option}
                            disabled={disabled}
                            onChoose={() => {
                                setCustom(false)
                                onChoose(option)
                            }}
                        />
                    ))}
                    <CustomOptionRow
                        open={custom}
                        onOpen={() => {
                            setCustom(true)
                            onChange('')
                        }}
                    >
                        <IntakeField autoFocus value={value} disabled={disabled} placeholder={placeholder} onChange={onChange} onEnter={onEnter} />
                    </CustomOptionRow>
                </div>
            </ScrollFade>
        </Field>
    )
}
