import type { LucideIcon } from '@/lib/icons'
import { Boxes, Clapperboard, Home, Layers, ListChecks, Megaphone, Scale, ShoppingBagIcon, TrendingUpIcon, UserPlus } from '@/lib/icons'
import type { TemplateCategory } from '@moldwright/contracts'

export const TEMPLATE_CATEGORY_ICONS: Record<TemplateCategory, LucideIcon> = {
    agencies: Megaphone,
    ecommerce: ShoppingBagIcon,
    saas: Layers,
    sales: TrendingUpIcon,
    recruiting: UserPlus,
    'real-estate': Home,
    legal: Scale,
    creators: Clapperboard,
    productivity: ListChecks,
    other: Boxes,
}
