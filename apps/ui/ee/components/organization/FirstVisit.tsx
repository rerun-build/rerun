'use client'

import type { Brand } from '@rerun/contracts'
import { useTranslations } from 'next-intl'
import Link from 'next/link'

import { buttonVariants } from '@/components/ui/button'
import type { ConsoleSetup } from '@/ee/lib/organizations/console.server'
import { CONSOLE_NEW_WORKSPACE, CONSOLE_SECTIONS } from '@/ee/lib/organizations/console-routes'
import { ArrowRightIcon, CheckIcon } from '@/lib/icons'
import { cn } from '@/lib/utils'

import { BrandScreenPreview } from './BrandScreenPreview'
import { Page } from './parts'

export function FirstVisit({ brand, setup }: { brand: Brand; setup: ConsoleSetup }) {
    const t = useTranslations('organization.firstVisit')
    const steps = [
        { id: 'brand' as const, href: CONSOLE_SECTIONS.brand!, done: setup.brand },
        ...(setup.domain === null ? [] : [{ id: 'domain' as const, href: CONSOLE_SECTIONS.domains!, done: setup.domain }]),
        { id: 'workspace' as const, href: CONSOLE_NEW_WORKSPACE, done: false },
        { id: 'team' as const, href: CONSOLE_SECTIONS.team!, done: setup.team },
    ]
    const next = steps.findIndex(step => !step.done)
    return (
        <Page>
            <div className="grid items-center gap-x-16 gap-y-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)]">
                <div className="min-w-0 space-y-8">
                    <h1 className="text-3xl font-medium tracking-tight text-balance break-words sm:text-4xl">{t('title', { name: brand.name })}</h1>
                    <ol className="border-t border-border">
                        {steps.map(({ id, href, done }, index) => (
                            <li key={id} className="border-b border-border">
                                <Link href={href} className="group flex min-h-14 items-center gap-4">
                                    <span className="flex w-5 justify-center text-sm text-muted-foreground tabular-nums">{done ? <CheckIcon aria-label={t('done')} className="size-4 text-brand" /> : index + 1}</span>
                                    <span className={cn('min-w-0 flex-1 text-sm', done ? 'text-muted-foreground' : 'font-medium')}>{t(`steps.${id}`)}</span>
                                    {index === next ? <span className={buttonVariants({ size: 'sm' })}>{t('start')}</span> : !done && <ArrowRightIcon className="size-4 text-muted-foreground rtl:rotate-180" />}
                                </Link>
                            </li>
                        ))}
                    </ol>
                </div>
                <BrandScreenPreview surface="auth" brand={brand} className="max-lg:order-first" frameClassName="aspect-[1.5]" />
            </div>
        </Page>
    )
}
