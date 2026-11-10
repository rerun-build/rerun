'use client'

import { useTranslations } from 'next-intl'
import { Button } from '@/components/ui/button'
import { WaveDivider } from '@/components/ui/wave-divider'
import { serviceIconProps } from '@/lib/services/icons'
import type { ServiceAlternative } from '@/lib/services/types'
import { Loader2Icon } from '@/lib/icons'
import { brandIconFilter } from '@rerun/ui/brand-icon'

type ServiceAlternativesProps = {
    alternatives: ServiceAlternative[]
    // The alternative whose details are loading, which also freezes the others.
    swapping: string | null
    disabled?: boolean
    error?: string | null
    onPick: (alternative: ServiceAlternative) => void
}

export function ServiceAlternatives({ alternatives, swapping, disabled, error, onPick }: ServiceAlternativesProps) {
    const t = useTranslations('services.alternatives')
    if (alternatives.length === 0) return null
    return (
        <div className="space-y-2">
            <WaveDivider label={t('label')} />
            <div className="grid grid-cols-3 gap-2">
                {alternatives.map(alternative => (
                    <Button key={alternative.slug} size="sm" variant="outline" disabled={disabled || swapping !== null} onClick={() => onPick(alternative)} className="min-w-0 justify-start gap-2">
                        {swapping === alternative.slug ? <Loader2Icon className="size-3.5 shrink-0 animate-spin" /> : <AlternativeGlyph alternative={alternative} />}
                        <span className="truncate">{alternative.name}</span>
                    </Button>
                ))}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
    )
}

function AlternativeGlyph({ alternative }: { alternative: ServiceAlternative }) {
    const props = serviceIconProps(alternative.icon, alternative.category)
    if ('src' in props) return <img src={props.src} alt="" aria-hidden className="size-3.5 shrink-0 object-contain" style={{ filter: brandIconFilter(props.src) }} />
    const Glyph = props.icon
    return <Glyph className="size-3.5 shrink-0" />
}
