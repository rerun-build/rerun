'use client'

import { CustomOptionRow, OptionRow } from '@rerun/ui/chat'
import type { TemplateCategory } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useState } from 'react'

import { Field } from '@/components/ui/field'
import { INTAKE_INDUSTRIES } from '@/lib/onboarding/intake'
import { IntakeField } from './IntakeField'
import type { IntakeDraft } from './steps'

// Asked only of someone who gave no site. It buys the one thing the board needs from them, the
// divisions to draw, and "Other" keeps their own words for a line of business we had no bucket for.

type IntakeIndustryStepProps = {
    draft: IntakeDraft
    disabled?: boolean
    onChange: (patch: Partial<IntakeDraft>) => void
    onChoose: (industry: TemplateCategory) => void
    onEnter: () => void
}

export function IntakeIndustryStep({ draft, disabled, onChange, onChoose, onEnter }: IntakeIndustryStepProps) {
    // Ouvrir la ligne libre est un geste, pas une conséquence de ce qui est tapé dedans : sans ce
    // state elle se refermerait au premier effacement.
    const t = useTranslations('foreman.intake')
    const [custom, setCustom] = useState(!!draft.industryLabel)

    return (
        <Field label={t('industry.label')}>
            {/* Deux colonnes et pas une : neuf lignes empilées ne tiennent pas dans un pied de
                colonne. Pas de défilement à elle : la liste est close, et un deuxième conteneur qui
                défile dans celui du pied cachait « Other », qui est la moitié de la question. */}
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
