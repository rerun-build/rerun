'use client'

import type { Brand } from '@rerun/contracts'
import { useTranslations } from 'next-intl'

import { AuthShell } from '@/components/auth/AuthShell'
import { EmailCodeForm } from '@/components/auth/EmailCodeForm'

const settle = async () => {}

export function AuthPreview({ brand }: { brand: Brand }) {
    const t = useTranslations('auth.page.invited')
    const tPreview = useTranslations('organization.preview')
    return (
        <AuthShell title={tPreview('signIn', { name: brand.name })} subtitle={t('subtitle')}>
            <EmailCodeForm sendCode={settle} verifyCode={settle} />
        </AuthShell>
    )
}
