'use client'

import { useKitTranslations } from '../locale'

export function OptionalMark() {
    const t = useKitTranslations()
    return <span className="opacity-70">{t('forms.optional')}</span>
}
