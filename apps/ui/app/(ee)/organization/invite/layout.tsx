import type { Metadata } from 'next'
import { getTranslations } from 'next-intl/server'

export { default } from '@/app/(authflow)/invite/layout'

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations('organization.join')
    return { title: t('metaTitle') }
}
