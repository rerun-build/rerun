'use client'

import { useTranslations } from 'next-intl'
import { RERUN_CLOUD } from '@rerun/cloud/edition'
import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ExternalLinkIcon, HammerIcon } from '@/lib/icons'
import { landingUrl } from '@/lib/site'

export function TemplateLibraryEmpty({ filtered, onScratch }: { filtered: boolean; onScratch?: () => void }) {
    const t = useTranslations('templates.library')
    if (!RERUN_CLOUD) {
        return (
            <EmptyState
                icon={HammerIcon}
                title={filtered ? t('empty.filtered') : t('empty.none')}
                description={t('empty.selfHosted')}
                action={
                    <Button variant="outline" size="sm" onClick={onScratch}>
                        {t('createCoworker')}
                    </Button>
                }
                className="pt-8"
            />
        )
    }

    return (
        <EmptyState
            icon={HammerIcon}
            title={filtered ? t('empty.filtered') : t('empty.none')}
            description={t('empty.cloud')}
            action={
                <Button asChild variant="outline" size="sm">
                    <a href={landingUrl('/community/experts/program')} target="_blank" rel="noreferrer">
                        {t('empty.become')}
                        <ExternalLinkIcon className="size-4" />
                    </a>
                </Button>
            }
            className="pt-8"
        />
    )
}
