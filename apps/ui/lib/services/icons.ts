import {
    BarChart3Icon,
    BotIcon,
    CodeIcon,
    CreditCardIcon,
    ListChecksIcon,
    MegaphoneIcon,
    MessageSquareIcon,
    PlugIcon,
    SearchIcon,
    ShoppingBagIcon,
    UsersIcon,
    type LucideIcon,
} from '@/lib/icons'

const BY_NAME: Record<string, LucideIcon> = {
    stripe: CreditCardIcon,
    metricool: MegaphoneIcon,
    'brand-voice': MessageSquareIcon,
}

const BY_CATEGORY: Record<string, LucideIcon> = {
    payments: CreditCardIcon,
    ecommerce: ShoppingBagIcon,
    crm: UsersIcon,
    marketing: MegaphoneIcon,
    seo: SearchIcon,
    analytics: BarChart3Icon,
    dev: CodeIcon,
    productivity: ListChecksIcon,
    other: BotIcon,
}

export function resolveServiceIcon(icon: string | null, category?: string): LucideIcon {
    if (icon && BY_NAME[icon]) return BY_NAME[icon]
    if (category && BY_CATEGORY[category]) return BY_CATEGORY[category]
    return PlugIcon
}

export function serviceIconProps(icon: string | null, category?: string): { src: string } | { icon: LucideIcon } {
    if (icon && /^https?:\/\//i.test(icon)) return { src: icon }
    return { icon: resolveServiceIcon(icon, category) }
}
