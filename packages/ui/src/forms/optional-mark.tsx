'use client'

import { useKitTranslations } from '../locale'

// A client leaf so Field itself stays renderable from a server component.
export function OptionalMark() {
    const t = useKitTranslations()
    return <span className="opacity-70">{t('forms.optional')}</span>
}
