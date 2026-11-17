'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BriefcaseIcon, CodeIcon, CrownIcon, HeartIcon, MegaphoneIcon, PlusIcon, ScaleIcon, Settings2Icon, TrendingUpIcon, UserSearchIcon } from '@/lib/icons'
import { rolesForIndustry } from '@/lib/onboarding/intake'
import type { TemplateCategory } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import type { ComponentType } from 'react'
import { ChoiceTile } from './ChoiceTile'
import { StepFrame } from './StepFrame'

const ROLE_ICONS: [RegExp, ComponentType<{ className?: string }>][] = [
    [/founder|owner|ceo|partner|broker/i, CrownIcon],
    [/marketing|growth|creative|demand|community|social/i, MegaphoneIcon],
    [/sales|account|business|sponsor|agent\b/i, TrendingUpIcon],
    [/product|engineering|editor|writer/i, CodeIcon],
    [/support|care/i, HeartIcon],
    [/recruit|talent|hr/i, UserSearchIcon],
    [/operation|logistic|finance|admin|project|paralegal|property/i, Settings2Icon],
    [/lawyer|counsel/i, ScaleIcon],
]

const roleIcon = (role: string) => ROLE_ICONS.find(([pattern]) => pattern.test(role))?.[1] ?? BriefcaseIcon

// The roles are stored in English, as the Chief of Staff reads them; only the tile is translated.
const roleKey = (role: string) =>
    role
        .split(/[^A-Za-z0-9]+/)
        .filter(Boolean)
        .map((word, index) => (index === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase()))
        .join('')

export type RoleAnswer = { role: string; other: boolean }

// The roles of their line of work as tiles, the owner first; "Something else" takes any title.
export function RoleStep({ industry, answer, onChange, onSubmit, onBack, saving, error }: { industry: TemplateCategory | null; answer: RoleAnswer; onChange: (answer: RoleAnswer) => void; onSubmit: () => void; onBack: () => void; saving: boolean; error: string | null }) {
    const t = useTranslations('onboarding')
    const roles = rolesForIndustry(industry)
    const label = (role: string) => {
        const key = `roles.${roleKey(role)}` as Parameters<typeof t>[0]
        return t.has(key) ? t(key) : role
    }

    return (
        <StepFrame title={t('role.title')} description={t('role.description')} onBack={onBack} primary={{ label: t('continue'), onClick: onSubmit, disabled: !answer.role.trim(), loading: saving }} error={error}>
            <div className="space-y-3">
                <div className="grid grid-cols-2 gap-2">
                    {roles.map(role => (
                        <ChoiceTile key={role} icon={roleIcon(role)} label={label(role)} selected={!answer.other && answer.role === role} onClick={() => onChange({ role, other: false })} />
                    ))}
                </div>
                {answer.other ? (
                    <Input
                        autoFocus
                        aria-label={t('role.otherLabel')}
                        value={answer.role}
                        placeholder={t('role.otherPlaceholder')}
                        onChange={event => onChange({ role: event.target.value, other: true })}
                        onKeyDown={event => {
                            if (event.key !== 'Enter' || !answer.role.trim()) return
                            event.preventDefault()
                            onSubmit()
                        }}
                    />
                ) : (
                    <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={() => onChange({ role: '', other: true })}>
                        <PlusIcon />
                        {t('role.other')}
                    </Button>
                )}
            </div>
        </StepFrame>
    )
}
