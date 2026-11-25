'use client'

import { useTranslations } from 'next-intl'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { Heading, Page } from '@/ee/components/organization/parts'
import { RotateCwIcon, TriangleAlertIcon } from '@/lib/icons'

export default function ConsoleError({ retry }: { retry: () => void }) {
    const t = useTranslations('organization')
    return (
        <Page>
            <Heading title={t('nav.label')} />
            <EmptyState
                icon={TriangleAlertIcon}
                title={t('failed.title')}
                className="py-16"
                action={
                    <Button variant="outline" onClick={retry}>
                        <RotateCwIcon />
                        {t('failed.retry')}
                    </Button>
                }
            />
        </Page>
    )
}
