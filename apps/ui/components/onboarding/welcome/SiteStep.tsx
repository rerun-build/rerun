'use client'

import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowRightIcon, GlobeIcon } from '@/lib/icons'
import { faviconUrl, siteDomain } from '@/lib/onboarding/site-favicon'
import { cn } from '@/lib/utils'
import { platformHost } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import { useEffect, useState } from 'react'
import { StepFrame } from './StepFrame'

// Long enough that an address typed letter by letter does not send every domain it passes through,
// short enough that the board changes while the next question is still being read.
const TYPING_PAUSE_MS = 350

function SiteMark({ domain }: { domain: string | null }) {
    const [failed, setFailed] = useState<string | null>(null)
    if (!domain || failed === domain) return <GlobeIcon className="size-5 text-muted-foreground" />
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={faviconUrl(domain)} alt="" className="size-5 rounded-sm" onError={() => setFailed(domain)} />
}

export function SiteStep({ firstName, value, onChange, onRead, onSubmit, onSkip, saving, error }: { firstName: string | null; value: string; onChange: (value: string) => void; onRead: (site: string) => void; onSubmit: () => void; onSkip: () => void; saving: 'site' | 'skip' | null; error: string | null }) {
    const t = useTranslations('onboarding.site')
    const tErrors = useTranslations('errors')
    const domain = siteDomain(value)
    const platform = platformHost(value)
    const readable = domain && !platform ? value.trim() : null

    useEffect(() => {
        if (!readable) return
        const timer = setTimeout(() => onRead(readable), TYPING_PAUSE_MS)
        return () => clearTimeout(timer)
    }, [readable, onRead])

    const submit = () => {
        if (readable && !saving) onSubmit()
    }

    return (
        <StepFrame
            title={firstName ? t('titleNamed', { name: firstName }) : t('title')}
            description={t('description')}
            secondary={{ label: t('skip'), onClick: onSkip, disabled: saving !== null, loading: saving === 'skip' }}
            error={platform ? tErrors('notYourCompanySite', { domain: platform }) : error}
        >
            <form
                className="relative"
                onSubmit={event => {
                    event.preventDefault()
                    submit()
                }}
            >
                <span className="pointer-events-none absolute top-1/2 left-3.5 z-10 flex -translate-y-1/2 items-center">
                    <SiteMark domain={domain} />
                </span>
                <Input
                    autoFocus
                    type="text"
                    inputMode="url"
                    autoComplete="url"
                    autoCapitalize="none"
                    spellCheck={false}
                    aria-label={t('label')}
                    value={value}
                    placeholder={t('placeholder')}
                    onChange={event => onChange(event.target.value)}
                    className={cn('h-12 pr-14 pl-11 text-base')}
                />
                <div className="absolute top-1/2 right-1.5 flex -translate-y-1/2 items-center">
                    <Button type="submit" size="icon-lg" disabled={!readable || saving !== null} loading={saving === 'site'} aria-label={t('continue')}>
                        <ArrowRightIcon />
                    </Button>
                </div>
            </form>
        </StepFrame>
    )
}
