import { getTranslations } from 'next-intl/server'
import Link from 'next/link'

import { Button } from '@/components/ui/button'
import { EmptyState } from '@/components/ui/empty-state'
import { ConsolePage } from '@/ee/components/organization/ConsolePage'
import { CONSOLE_HOME } from '@/ee/lib/organizations/console-routes'
import { LayersIcon } from '@/lib/icons'

export default async function ConsoleNotFound() {
    const t = await getTranslations('organization')
    return (
        <ConsolePage title={t('workspaces.title')}>
            <EmptyState
                icon={LayersIcon}
                title={t('missing.title')}
                description={t('missing.description')}
                className="py-16"
                action={
                    <Button variant="outline" asChild>
                        <Link href={CONSOLE_HOME}>{t('missing.back')}</Link>
                    </Button>
                }
            />
        </ConsolePage>
    )
}
