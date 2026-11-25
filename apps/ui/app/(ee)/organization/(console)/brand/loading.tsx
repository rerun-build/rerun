'use client'

import { useTranslations } from 'next-intl'

import { Skeleton } from '@/components/ui/skeleton'
import { ConsolePage } from '@/ee/components/organization/ConsolePage'

export default function BrandLoading() {
    const t = useTranslations('organization.brand')
    return (
        <ConsolePage title={t('title')} description={t('description')}>
            <div className="grid items-start gap-x-10 gap-y-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)]">
                <div className="min-w-0 space-y-5">
                    {[t('name'), t('icon'), t('color'), t('support'), t('docs'), t('terms'), t('privacy')].map((label, index) => (
                        <div key={label} className="space-y-2">
                            <p className="text-sm font-medium">{label}</p>
                            <Skeleton className={index === 1 ? 'h-20 w-full rounded-lg' : 'h-10 w-full rounded-lg'} />
                        </div>
                    ))}
                </div>
                <Skeleton className="h-64 w-full rounded-xl" />
            </div>
        </ConsolePage>
    )
}
