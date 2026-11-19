import { BoxIcon, Building2, ChessKnightIcon, FileTextIcon, FlagIcon, Gavel, HandshakeIcon, MegaphoneIcon, TagIcon, TargetIcon, UserRoundIcon, UsersIcon, WrenchIcon, type LucideIcon } from '@/lib/icons'
import type { BrainPageType } from '@moldwright/contracts'

export const BRAIN_PAGE_ICONS: Record<BrainPageType, LucideIcon> = {
    company: Building2,
    offering: TagIcon,
    market: TargetIcon,
    team: UsersIcon,
    voice: MegaphoneIcon,
    stack: WrenchIcon,
    priorities: FlagIcon,
    customer: HandshakeIcon,
    competitor: ChessKnightIcon,
    person: UserRoundIcon,
    product: BoxIcon,
    decision: Gavel,
    note: FileTextIcon,
}
