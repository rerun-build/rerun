'use client'

import { useEffect, useRef, useState } from 'react'
import { motion, useReducedMotion } from 'motion/react'
import { useLocale, useTranslations } from 'next-intl'

import { isPaid, priceLabel, templateCardCtaLabel, type TemplatePricing } from '@rerun/contracts'
import { Badge } from '@rerun/ui/primitives'
import { buttonVariants } from '@/components/ui/button'
import type { PurchaseAccess } from '@/lib/templates/entitlement'
import { cn } from '@/lib/utils'

// What a card says a template costs, and what it says under the cursor. The two faces are mounted
// back to back on one plate that flips: the slot is as wide and as tall as the wider of the two, so
// nothing reflows and the meta line beside it never moves.
//
// The revealed label is a span, not a Button: the card itself is the button, and a real one nested
// inside it would be invalid markup and a second tab stop for an action that is already the card's.
//
// `flip` is what a card that is not a button turns off: the back face reads as a call to action,
// and a card nobody can click has none to offer.
export function TemplateCardPrice({ pricing, access, flip = true }: { pricing: TemplatePricing; access: PurchaseAccess; flip?: boolean }) {
    const paid = isPaid(pricing)
    const state: PriceState = { owned: paid && access === 'active', lapsed: paid && access === 'lapsed', pricing }

    if (!flip) {
        return (
            <span className="flex shrink-0 items-center">
                <PriceFace {...state} />
            </span>
        )
    }

    return <FlippingPrice {...state} />
}

type PriceState = { owned: boolean; lapsed: boolean; pricing: TemplatePricing }

function PriceFace({ owned, lapsed, pricing }: PriceState) {
    const t = useTranslations('templates.price')
    const locale = useLocale()
    if (owned) {
        return (
            <Badge tone="green" size="xs" glow={false} className="font-medium">
                {t('purchased')}
            </Badge>
        )
    }
    if (lapsed) {
        return (
            <Badge tone="orange" size="xs" glow={false} className="font-medium">
                {t('expired')}
            </Badge>
        )
    }
    return <span className="text-sm font-semibold text-foreground">{priceLabel(pricing, t, locale)}</span>
}

function FlippingPrice({ owned, lapsed, pricing }: PriceState) {
    const t = useTranslations('templates.price')
    const locale = useLocale()
    const { ref, active } = useCardActive<HTMLSpanElement>()
    const reduceMotion = useReducedMotion()

    return (
        <span ref={ref} className="grid shrink-0 items-center justify-items-end [perspective:600px]">
            <motion.span
                className="grid [grid-area:1/1] items-center justify-items-end [transform-style:preserve-3d]"
                animate={reduceMotion ? { rotateX: 0 } : { rotateX: active ? 180 : 0 }}
                transition={FLIP_TRANSITION}
            >
                <span
                    className={cn(
                        // flex, not a bare block: the badge is inline-flex and would otherwise sit on
                        // the face's text baseline, a couple of pixels below the meta line beside it.
                        'flex items-center [grid-area:1/1] [backface-visibility:hidden]',
                        // Reduced motion keeps the swap, drops the tumble: without the flip there is
                        // no back face to hide the front one, so it has to fade out on its own.
                        reduceMotion && 'transition-opacity duration-150',
                        reduceMotion && active && 'opacity-0',
                    )}
                >
                    <PriceFace owned={owned} lapsed={lapsed} pricing={pricing} />
                </span>

                <span
                    aria-hidden
                    className={cn(
                        buttonVariants({ variant: 'outline', size: 'xs' }),
                        '[grid-area:1/1] [backface-visibility:hidden]',
                        reduceMotion ? 'transition-opacity duration-150' : '[transform:rotateX(180deg)]',
                        reduceMotion && !active && 'opacity-0',
                    )}
                >
                    {owned ? t('install') : lapsed ? t('renew') : templateCardCtaLabel(pricing, t, locale)}
                </span>
            </motion.span>
        </span>
    )
}

const FLIP_TRANSITION = { type: 'spring', stiffness: 180, damping: 20, mass: 0.9 } as const

// The card is what the cursor is on, not this slot, and on its landing twin the card is a server
// component: the state is read off the DOM rather than passed down. The `.group` ancestor is the
// very element the card's own hover rules already point at.
function useCardActive<T extends HTMLElement>() {
    const ref = useRef<T>(null)
    const [hovered, setHovered] = useState(false)
    const [focused, setFocused] = useState(false)

    useEffect(() => {
        const card = ref.current?.closest('.group')
        if (!card) return

        const enter = () => setHovered(true)
        const leave = () => setHovered(false)
        // Mirrors `group-focus-visible` on the in-app card (the card is the button) and
        // `group-has-[a:focus-visible]` on the landing one (the link is inside it).
        const focusIn = () => setFocused(card.matches(':focus-visible') || !!card.querySelector(':focus-visible'))
        const focusOut = () => setFocused(false)

        card.addEventListener('pointerenter', enter)
        card.addEventListener('pointerleave', leave)
        card.addEventListener('focusin', focusIn)
        card.addEventListener('focusout', focusOut)

        return () => {
            card.removeEventListener('pointerenter', enter)
            card.removeEventListener('pointerleave', leave)
            card.removeEventListener('focusin', focusIn)
            card.removeEventListener('focusout', focusOut)
        }
    }, [])

    return { ref, active: hovered || focused }
}
