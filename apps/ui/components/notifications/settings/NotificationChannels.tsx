'use client'

import { Button } from '@/components/ui/button'
import { Bell, CreditCard, MailIcon, Package, Play, Volume2, type LucideIcon } from '@/lib/icons'
import { playNotificationSound } from '@/lib/notifications/browser'
import { EMAIL_CATEGORIES, type EmailCategory, type NotificationPrefs } from '@/lib/notifications/prefs'
import { useTranslations } from 'next-intl'

import { SETTINGS_CARD, SettingsSection, SwitchRow } from './SettingsSection'

type Channel = 'toast' | 'sound' | 'email'

export type ChannelPrefs = Pick<NotificationPrefs, 'scope' | Channel>

export function NotificationChannels({ prefs, onChange }: { prefs: ChannelPrefs; onChange: (patch: Partial<Pick<NotificationPrefs, Channel>>) => void }) {
    const t = useTranslations('notifications.settings.channels')
    const silent = prefs.scope === 'nothing'
    return (
        <SettingsSection title={t('title')}>
            <div className={SETTINGS_CARD}>
                <SwitchRow icon={Bell} label={t('toast.label')} description={t('toast.description')} checked={prefs.toast} disabled={silent} onChange={toast => onChange({ toast })} />
                <SwitchRow
                    icon={Volume2}
                    label={t('sound.label')}
                    description={t('sound.description')}
                    checked={prefs.sound}
                    disabled={silent}
                    onChange={sound => onChange({ sound })}
                    extra={
                        <Button type="button" variant="ghost" size="icon-sm" aria-label={t('sound.play')} disabled={silent} onClick={() => playNotificationSound()} className="text-muted-foreground hover:text-foreground">
                            <Play />
                        </Button>
                    }
                />
                <SwitchRow icon={MailIcon} label={t('email.label')} description={t('email.description')} checked={prefs.email} disabled={silent} onChange={email => onChange({ email })} />
            </div>
        </SettingsSection>
    )
}

const CATEGORY_ICONS: Record<EmailCategory, LucideIcon> = {
    billing: CreditCard,
    product: Package,
}

export function AccountEmails({ categories, onChange }: { categories: NotificationPrefs['categories']; onChange: (category: EmailCategory, value: boolean) => void }) {
    const t = useTranslations('notifications.settings.accountEmails')
    return (
        <SettingsSection title={t('title')}>
            <div className={SETTINGS_CARD}>
                {EMAIL_CATEGORIES.map(category => (
                    <SwitchRow key={category} icon={CATEGORY_ICONS[category]} label={t(`${category}.label`)} description={t(`${category}.description`)} checked={categories[category]} onChange={value => onChange(category, value)} />
                ))}
            </div>
        </SettingsSection>
    )
}
