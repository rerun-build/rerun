'use client'

import { CustomOptionRow, OptionRow } from '@moldwright/ui/chat'
import type { IntakeKind } from '@moldwright/contracts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Field } from '@/components/ui/field'
import { INTAKE_INDUSTRIES } from '@/lib/onboarding/intake'
import { IntakeField } from './IntakeField'
import type { IntakeDraft } from './steps'

type IntakeIndustryStepProps = {
    draft: IntakeDraft
    disabled?: boolean
    onChange: (patch: Partial<IntakeDraft>) => void
    onChoose: (industry: IntakeKind) => void
    onEnter: () => void
}

export function IntakeIndustryStep({ draft, disabled, onChange, onChoose, onEnter }: IntakeIndustryStepProps) {
    const t = useTranslations('foreman.intake')
    const [custom, setCustom] = useState(!!draft.industryLabel)

    return (
        <Field label={t('industry.label')}>
            <div className="-mx-1">
                <div className="grid grid-cols-2 gap-x-1 gap-y-0.5">
                    {INTAKE_INDUSTRIES.map((option, index) => (
                        <OptionRow
                            key={option.value}
                            index={index}
                            label={t(`industries.${option.value}`)}
                            selected={!custom && draft.industry === option.value}
                            disabled={disabled}
                            onChoose={() => {
                                setCustom(false)
                                onChoose(option.value)
                            }}
                        />
                    ))}
                    <CustomOptionRow
                        open={custom}
                        onOpen={() => {
                            setCustom(true)
                            onChange({ industry: null })
                        }}
                        label={t('industry.other')}
                        className="col-span-2"
                    >
                        <IntakeField autoFocus value={draft.industryLabel} disabled={disabled} placeholder={t('industry.placeholder')} onChange={industryLabel => onChange({ industryLabel, industry: null })} onEnter={onEnter} />
                    </CustomOptionRow>
                </div>
            </div>
        </Field>
    )
}
