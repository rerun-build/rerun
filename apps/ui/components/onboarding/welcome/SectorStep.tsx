'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { BookOpenIcon, CameraIcon, ChevronDownIcon, CodeIcon, GraduationCapIcon, HammerIcon, HandshakeIcon, HeartIcon, HeartPulseIcon, HomeIcon, MegaphoneIcon, PencilIcon, ScaleIcon, SearchIcon, ShoppingBagIcon, TrendingUpIcon, UserIcon, UserRoundIcon, UserSearchIcon, UtensilsCrossed, WalletIcon } from '@/lib/icons'
import { FIRST_SECTORS, SECTORS, searchSectors, sectorById, type SectorId } from '@/lib/onboarding/sectors'
import { cn } from '@/lib/utils'
import { useTranslations } from 'next-intl'
import { useState, type ComponentType } from 'react'
import { ChoiceTile } from './ChoiceTile'
import { StepFrame } from './StepFrame'

const SECTOR_ICONS: Record<SectorId, ComponentType<{ className?: string }>> = {
    freelance: UserRoundIcon,
    agency: MegaphoneIcon,
    consulting: HandshakeIcon,
    creators: CameraIcon,
    ecommerce: ShoppingBagIcon,
    saas: CodeIcon,
    sales: TrendingUpIcon,
    'real-estate': HomeIcon,
    legal: ScaleIcon,
    finance: WalletIcon,
    recruiting: UserSearchIcon,
    health: HeartPulseIcon,
    education: GraduationCapIcon,
    hospitality: UtensilsCrossed,
    trades: HammerIcon,
    nonprofit: HeartIcon,
    personal: UserIcon,
    student: BookOpenIcon,
}

// `label` is what they typed instead of picking one.
export type SectorAnswer = { sector: SectorId | null; label: string }

// A search on top, the answers most people give under it, "See more" for the rest. The search reads
// the words people use for each line of work, and whatever is typed can be kept as the answer, so
// nobody is left without one.
export function SectorStep({ answer, onChange, onSubmit, saving, error }: { answer: SectorAnswer; onChange: (answer: SectorAnswer) => void; onSubmit: () => void; saving: boolean; error: string | null }) {
    const t = useTranslations('onboarding')
    const [query, setQuery] = useState('')
    const [more, setMore] = useState(false)
    const typed = query.trim()
    const matches = searchSectors(typed, id => `${t(`sectors.${id}.label`)} ${t(`sectors.${id}.keywords`)}`)
    // What was picked before the search is not an answer to it.
    const settled = !typed || answer.label === typed || matches.some(sector => sector.id === answer.sector)
    const answered = settled && (!!answer.sector || !!answer.label)
    const listed = typed ? matches : more ? SECTORS : FIRST_SECTORS.flatMap(id => sectorById(id) ?? [])
    // A pick hidden behind "See more" stays on screen once made, and so does an answer of their own.
    const hiddenPick = !typed ? sectorById(answer.sector) : null
    const shown = hiddenPick && !listed.some(sector => sector.id === hiddenPick.id) ? [hiddenPick, ...listed] : listed
    const ownWords = typed || answer.label
    const ownTile = ownWords && <ChoiceTile icon={PencilIcon} label={t('sector.use', { words: ownWords })} selected={!!answer.label && answer.label === ownWords} onClick={() => onChange({ sector: null, label: ownWords })} />

    return (
        <StepFrame title={t('sector.title')} description={t('sector.description')} primary={{ label: t('continue'), onClick: onSubmit, disabled: !answered, loading: saving }} error={error}>
            <form
                className="space-y-4"
                onSubmit={event => {
                    event.preventDefault()
                    if (answered) onSubmit()
                    else if (typed) onChange(matches.length > 0 ? { sector: matches[0].id, label: '' } : { sector: null, label: typed })
                }}
            >
                <div className="relative">
                    <span className="pointer-events-none absolute top-1/2 start-3.5 z-10 flex -translate-y-1/2 items-center">
                        <SearchIcon className="size-5 text-muted-foreground" />
                    </span>
                    <Input autoFocus aria-label={t('sector.search')} value={query} placeholder={t('sector.placeholder')} maxLength={120} onChange={event => setQuery(event.target.value)} className="h-12 ps-11 text-base" />
                </div>

                <div className="grid min-h-[10.75rem] grid-cols-2 content-start gap-2 sm:grid-cols-3">
                    {!typed && ownTile}
                    {shown.map(sector => (
                        <ChoiceTile key={sector.id} icon={SECTOR_ICONS[sector.id]} label={t(`sectors.${sector.id}.label`)} selected={!answer.label && answer.sector === sector.id} onClick={() => onChange({ sector: sector.id, label: '' })} />
                    ))}
                    {typed && ownTile}
                    {typed && matches.length === 0 && <p className="col-span-full text-sm text-muted-foreground text-pretty">{t('sector.notListed')}</p>}
                </div>

                {!more && (
                    <div className={cn('flex justify-center', typed && 'invisible')}>
                        <Button type="button" variant="ghost" size="sm" className="text-muted-foreground" onClick={() => setMore(true)}>
                            {t('sector.more')}
                            <ChevronDownIcon />
                        </Button>
                    </div>
                )}
            </form>
        </StepFrame>
    )
}
