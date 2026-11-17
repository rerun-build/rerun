'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { CameraIcon, CodeIcon, HomeIcon, MegaphoneIcon, PlusIcon, ScaleIcon, ShoppingBagIcon, TrendingUpIcon, UserSearchIcon, ZapIcon } from '@/lib/icons'
import { INTAKE_INDUSTRIES } from '@/lib/onboarding/intake'
import type { TemplateCategory } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'
import { ChoiceTile } from './ChoiceTile'
import { StepFrame } from './StepFrame'

const INDUSTRY_ICONS: Record<Exclude<TemplateCategory, 'other'>, ComponentType<{ className?: string }>> = {
    agencies: MegaphoneIcon,
    ecommerce: ShoppingBagIcon,
    saas: CodeIcon,
    sales: TrendingUpIcon,
    recruiting: UserSearchIcon,
    'real-estate': HomeIcon,
    legal: ScaleIcon,
    creators: CameraIcon,
    productivity: ZapIcon,
}

export type IndustryAnswer = { industry: TemplateCategory | null; label: string; other: boolean }

// The tiles answer it in one tap, the site's guess already picked; "Other" opens a field for a
// line of work the list does not hold.
export function IndustryStep({ answer, onChange, onSubmit, onBack, saving, error }: { answer: IndustryAnswer; onChange: (answer: IndustryAnswer) => void; onSubmit: () => void; onBack: () => void; saving: boolean; error: string | null }) {
    const t = useTranslations('onboarding')
    const answered = answer.other ? !!answer.label.trim() : !!answer.industry

    return (
        <StepFrame title={t('industry.title')} description={t('industry.description')} onBack={onBack} primary={{ label: t('continue'), onClick: onSubmit, disabled: !answered, loading: saving }} error={error}>
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                    {INTAKE_INDUSTRIES.map(({ value }) => (
                        <ChoiceTile key={value} icon={INDUSTRY_ICONS[value as Exclude<TemplateCategory, 'other'>] ?? ZapIcon} label={t(`industries.${value}`)} selected={!answer.other && answer.industry === value} onClick={() => onChange({ industry: value, label: '', other: false })} />
                    ))}
                </div>
                {answer.other ? (
                    <Input
                        autoFocus
                        aria-label={t('industry.otherLabel')}
                        value={answer.label}
                        placeholder={t('industry.otherPlaceholder')}
                        onChange={event => onChange({ ...answer, label: event.target.value })}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' || !answered) return
                            event.preventDefault()
                            onSubmit()
                        }}
                    />
                ) : (
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange({ industry: null, label: '', other: true })}>
                        <PlusIcon />
                        {t('industry.other')}
                    </Button>
                )}
            </div>
        </StepFrame>
    )
}
