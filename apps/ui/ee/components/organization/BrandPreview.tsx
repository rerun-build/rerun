'use client'

import type { BrandPalette, BrandPaletteSide } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import type { CSSProperties } from 'react'

import { Progress } from '@/components/ui/progress'

import { SquareLogo } from './SquareLogo'

export function BrandPreview({ name, iconUrl, palette }: { name: string; iconUrl: string | null; palette: BrandPalette }) {
    return (
        <div className="grid gap-3 sm:grid-cols-2">
            <ThemePane theme="light" name={name} iconUrl={iconUrl} side={palette.light} />
            <ThemePane theme="dark" name={name} iconUrl={iconUrl} side={palette.dark} />
        </div>
    )
}

// An island of one theme, whatever theme the console is read in.
function ThemePane({ theme, name, iconUrl, side }: { theme: 'light' | 'dark'; name: string; iconUrl: string | null; side: BrandPaletteSide }) {
    const t = useTranslations('organization.brand.preview')
    const vars = { '--brand': side.brand, '--color-brand': side.brand, colorScheme: theme } as CSSProperties
    return (
        <figure aria-label={t(theme)} className={`${theme} min-w-0 space-y-4 rounded-xl border border-border bg-background p-4 text-sm text-foreground`} style={vars}>
            <figcaption className="flex items-center gap-2.5">
                <SquareLogo name={name} iconUrl={iconUrl} className="size-8" />
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                <span role="img" aria-label={t('unread')} className="size-2 shrink-0 rounded-full" style={{ background: side.brand }} />
            </figcaption>
            <div className="space-y-2">
                <p className="ms-auto w-fit max-w-[85%] rounded-2xl rounded-ee-md px-3.5 py-2" style={{ background: side.bubble, color: side.bubbleInk }}>
                    {t('user')}
                </p>
                <p className="w-fit max-w-[85%] rounded-[20px] bg-muted px-3.5 py-2">
                    {t.rich('assistant', {
                        link: chunks => (
                            <span className="underline underline-offset-4" style={{ color: side.brandText }}>
                                {chunks}
                            </span>
                        ),
                    })}
                </p>
            </div>
            <Progress value={62} size="md" label={t('progress')} />
        </figure>
    )
}
