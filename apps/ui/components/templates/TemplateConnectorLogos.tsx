import type { TemplateConnector } from '@rerun/contracts'
import { brandIconFilter } from '@rerun/ui/brand-icon'
import { useTranslations } from 'next-intl'
import { serviceIconProps } from '@/lib/services/icons'
import { cn } from '@/lib/utils'

const MAX_SHOWN = 4

// Bare logos rather than the boxed Icon: on a card footer four boxes read as buttons.
export function TemplateConnectorLogos({ connectors, className }: { connectors: TemplateConnector[]; className?: string }) {
    const t = useTranslations('templates.connectors')
    if (connectors.length === 0) return <span className={cn('shrink-0 text-xs text-muted-foreground', className)}>{t('none')}</span>

    const hidden = connectors.length - MAX_SHOWN
    return (
        <span className={cn('flex shrink-0 items-center gap-1.5', className)} aria-label={t('label', { names: connectors.map(c => c.name).join(', ') })}>
            {connectors.slice(0, MAX_SHOWN).map(connector => (
                <ConnectorLogo key={connector.slug} connector={connector} />
            ))}
            {hidden > 0 && <span className="text-[11px] text-muted-foreground tabular-nums">+{hidden}</span>}
        </span>
    )
}

export function ConnectorLogo({ connector, className }: { connector: TemplateConnector; className?: string }) {
    const props = serviceIconProps(connector.icon)
    if ('src' in props) return <img src={props.src} alt="" title={connector.name} className={cn('size-3.5 shrink-0 object-contain', className)} style={{ filter: brandIconFilter(props.src) }} />
    const Glyph = props.icon
    return (
        <span title={connector.name} className="flex shrink-0">
            <Glyph className={cn('size-3.5 text-muted-foreground', className)} />
        </span>
    )
}
