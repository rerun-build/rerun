'use client'

import { useBrand } from '@/components/brand/BrandProvider'
import { RerunOnly } from '@/components/brand/RerunOnly'
import { TESTIMONIALS, USER_COUNT } from '@rerun/cloud/testimonials'
import { formatNumber } from '@rerun/i18n/format'
import { useLocale, useTranslations } from 'next-intl'

const FACES = TESTIMONIALS.filter(testimonial => testimonial.avatar).slice(0, 4)
const STARS = 5
const STAR = 'M12 2l2.9 6.26 6.85.79-5.07 4.66 1.38 6.74L12 17.1 5.94 20.45l1.38-6.74L2.25 9.05l6.85-.79z'

// The proof the landing puts under its hero, under the sign-in card: the customers it quotes, then
// the count. A self-hosted install quotes nobody and shows nothing.
export function TrustStrip() {
    const t = useTranslations('onboarding.trust')
    const locale = useLocale()
    const { name: brand } = useBrand()
    if (FACES.length === 0) return null
    return (
        <RerunOnly>
            <div className="flex flex-col items-center gap-2.5 sm:flex-row sm:gap-3">
                <span className="flex -space-x-3 rtl:space-x-reverse">
                    {FACES.map(face => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img key={face.id} src={face.avatar} alt={face.author} width={36} height={36} className="size-9 rounded-full object-cover ring-2 ring-background" />
                    ))}
                </span>
                <span className="flex flex-col items-center gap-0.5 text-center sm:items-start sm:text-start">
                    <span aria-hidden className="flex items-center gap-0.5">
                        {Array.from({ length: STARS }, (_, index) => (
                            <svg key={index} viewBox="0 0 24 24" className="size-4 fill-amber-400">
                                <path d={STAR} />
                            </svg>
                        ))}
                    </span>
                    <span className="text-sm text-muted-foreground">
                        {t.rich('users', { count: formatNumber(USER_COUNT, locale), brand, b: chunks => <span className="font-medium text-foreground">{chunks}</span> })}
                    </span>
                </span>
            </div>
        </RerunOnly>
    )
}
