'use client'

import { useErrorText } from '@/hooks/useErrorText'
import { updateNotificationPrefsAction, updateNotificationPrefsByTokenAction } from '@/app/api/_actions/notifications.actions'
import { Field } from '@/components/ui/field'
import { Icon } from '@/components/ui/icon'
import { Switch } from '@/components/ui/switch'
import { EMAIL_CATEGORIES, type EmailCategory, type EmailPrefs, type NotificationPrefsPatch } from '@/lib/notifications/prefs'
import { Check, CreditCard, Loader2, MailIcon, Package, type LucideIcon } from '@/lib/icons'
import { useTranslations } from 'next-intl'
import { useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'

const CATEGORY_ICONS: Record<EmailCategory, LucideIcon> = {
    billing: CreditCard,
    product: Package,
}

function SwitchRow({ icon, label, description, checked, onChange }: { icon: LucideIcon; label: string; description: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <label className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted">
            <Icon icon={icon} size="sm" />
            <Field orientation="row" label={label} helperText={description} className="flex-1">
                <Switch checked={checked} onCheckedChange={onChange} />
            </Field>
        </label>
    )
}

type SaveState = 'idle' | 'saving' | 'saved'

export function EmailPreferencesForm({ initialPrefs, token }: { initialPrefs: EmailPrefs; token?: string }) {
    const t = useTranslations('notifications.emailPreferences')
    const tCategories = useTranslations('notifications.settings.accountEmails')
    const errorText = useErrorText()
    const form = useForm<EmailPrefs>({ defaultValues: initialPrefs })
    const prefs = form.watch()
    const [saveState, setSaveState] = useState<SaveState>('idle')
    const savedTimer = useRef<ReturnType<typeof setTimeout>>(undefined)

    const persist = async (patch: NotificationPrefsPatch) => {
        setSaveState('saving')
        const res = token ? await updateNotificationPrefsByTokenAction(token, patch) : await updateNotificationPrefsAction(patch)
        if (res.ok) {
            setSaveState('saved')
            clearTimeout(savedTimer.current)
            savedTimer.current = setTimeout(() => setSaveState('idle'), 2000)
        } else {
            setSaveState('idle')
            toast.error(t('saveFailed'), { description: errorText(res) })
        }
    }

    const toggleRunEmails = (value: boolean) => {
        form.setValue('email', value)
        void persist({ email: value })
    }

    const toggleCategory = (category: EmailCategory, value: boolean) => {
        form.setValue(`categories.${category}`, value)
        void persist({ categories: { [category]: value } })
    }

    return (
        <div className="flex flex-col gap-6">
            <section className="flex flex-col gap-1">
                <h2 className="px-3 text-sm font-semibold text-foreground">{t('coworkerTitle')}</h2>
                <SwitchRow icon={MailIcon} label={t('email.label')} description={t('email.description')} checked={prefs.email} onChange={toggleRunEmails} />
            </section>

            <section className="flex flex-col gap-1">
                <h2 className="px-3 text-sm font-semibold text-foreground">{tCategories('title')}</h2>
                {EMAIL_CATEGORIES.map(category => (
                    <SwitchRow key={category} icon={CATEGORY_ICONS[category]} label={tCategories(`${category}.label`)} description={tCategories(`${category}.description`)} checked={prefs.categories[category]} onChange={v => toggleCategory(category, v)} />
                ))}
            </section>

            <div className="flex h-5 items-center gap-1.5 px-3 text-xs text-muted-foreground">
                {saveState === 'saving' && (
                    <>
                        <Loader2 className="size-3.5 animate-spin" />
                        <span>{t('saving')}</span>
                    </>
                )}
                {saveState === 'saved' && (
                    <>
                        <Check className="size-3.5 text-emerald-400" />
                        <span>{t('saved')}</span>
                    </>
                )}
            </div>
        </div>
    )
}
