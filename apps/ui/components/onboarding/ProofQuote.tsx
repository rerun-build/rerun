'use client'

import { Progress } from '@/components/ui/progress'
import { useTimedRotation } from '@/hooks/useTimedRotation'
import { cn } from '@/lib/utils'
import { TESTIMONIALS, testimonialCopy } from '@rerun/cloud/testimonials'
import { ExpertAvatar, initialsFromName } from '@rerun/ui/experts'
import { AnimatePresence, motion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'

const ROTATE_MS = 7000

// One customer at a time, quoted without a frame, the segments above filling while each one shows.
// `large` is the panel's size, the small one sits under the step's card. A build without quotes
// shows nothing.
export function ProofQuote({ large = false }: { large?: boolean }) {
    return TESTIMONIALS.length ? <Rotation large={large} /> : null
}

function Rotation({ large }: { large: boolean }) {
    const t = useTranslations('billing.parts')
    const locale = useLocale()
    const { index, elapsed, show } = useTimedRotation(TESTIMONIALS.length, ROTATE_MS)
    const testimonial = TESTIMONIALS[index]
    const copy = testimonialCopy(testimonial, locale)
    const shift = large ? 8 : 6
    return (
        <figure className={cn('flex w-full flex-col', large ? 'gap-8' : 'gap-4')}>
            <div className="flex gap-2">
                {TESTIMONIALS.map((item, itemIndex) => (
                    <button key={item.id} type="button" aria-label={t('showTestimonial', { company: item.company })} onClick={() => show(itemIndex)} className="flex h-4 flex-1 items-center">
                        <Progress value={itemIndex === index ? elapsed : itemIndex < index ? 100 : 0} size="sm" label={item.company} />
                    </button>
                ))}
            </div>
            <AnimatePresence mode="wait" initial={false}>
                <motion.div key={testimonial.id} initial={{ opacity: 0, y: shift }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -shift }} transition={{ duration: large ? 0.25 : 0.2 }} className={cn('flex flex-col', large ? 'gap-6' : 'gap-4')}>
                    <blockquote dir="auto" className={cn('leading-snug font-medium tracking-tight', large ? 'text-2xl text-balance xl:text-3xl' : 'text-lg text-pretty')}>
                        {t('quoted', { quote: copy.quote })}
                    </blockquote>
                    <figcaption className="flex items-center gap-3">
                        <ExpertAvatar initials={initialsFromName(testimonial.author)} src={testimonial.avatar} alt={testimonial.author} rounded="rounded-full" className={cn('shrink-0', large ? 'size-11 text-xs' : 'size-9 text-[11px]')} />
                        <span className="min-w-0">
                            <span className={cn('block font-medium', !large && 'text-sm')}>{testimonial.author}</span>
                            <span className={cn('block truncate text-muted-foreground', large ? 'text-sm' : 'text-xs')}>
                                {copy.role} · {testimonial.company}
                            </span>
                        </span>
                        {testimonial.companyLogo && (
                            // eslint-disable-next-line @next/next/no-img-element -- a company mark bundled with the testimonial
                            <img src={testimonial.companyLogo} alt="" className={cn('ms-auto object-contain', large ? 'size-8' : 'size-6')} />
                        )}
                    </figcaption>
                </motion.div>
            </AnimatePresence>
        </figure>
    )
}
