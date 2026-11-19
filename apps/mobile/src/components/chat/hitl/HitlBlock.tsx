import type { UnknownPendingCall } from '@moldwright/contracts'
import { useTranslations } from 'use-intl'

import { FallbackCard } from './FallbackCard'
import { widgetFor, type HitlWidgetProps } from './registry'
import { askOf, firstAsk, summarizePendingHitl } from './summary'
import { HITL_WIDGETS } from './widgets'

export function HitlBlock(props: HitlWidgetProps) {
    const t = useTranslations('mobileHitl')
    const { pending, webUrl } = props
    const widget = widgetFor(pending, HITL_WIDGETS)
    if (widget) return widget.render(props)
    const { symbol, label } = summarizePendingHitl(pending.kind, pending.input, t)
    return <FallbackCard symbol={symbol} label={label} ask={firstAsk(pending.kind, pending.input)} webUrl={webUrl} />
}

export function UnknownCallBlock({ call, coworkerName, webUrl }: { call: UnknownPendingCall; coworkerName: string; webUrl: string }) {
    const t = useTranslations('mobileHitl')
    return <FallbackCard symbol="hand" label={t('fallback.needsYou', { name: coworkerName })} ask={askOf(call.input)} webUrl={webUrl} />
}
