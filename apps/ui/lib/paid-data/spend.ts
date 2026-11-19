import { paidDataEntry, type PaidDataCapability, type PaidDataGroup } from '@moldwright/contracts'

import {
    AtSign,
    BriefcaseIcon,
    Building2,
    CameraIcon,
    Clapperboard,
    FilmIcon,
    LinkIcon,
    MailCheckIcon,
    MailIcon,
    MapPinIcon,
    MessagesSquare,
    PhoneIcon,
    RankingIcon,
    TrendingUpIcon,
    UserSearchIcon,
    UsersIcon,
    type LucideIcon,
} from '@/lib/icons'

const GROUP_ICON: Record<PaidDataGroup, LucideIcon> = {
    people: UserSearchIcon,
    companies: Building2,
    search: RankingIcon,
    seo: TrendingUpIcon,
    linkedin: BriefcaseIcon,
    tiktok: Clapperboard,
    instagram: CameraIcon,
    x: AtSign,
    youtube: FilmIcon,
    facebook: UsersIcon,
    reddit: MessagesSquare,
}

const CAPABILITY_ICON: Partial<Record<PaidDataCapability, LucideIcon>> = {
    'people.email.find': MailIcon,
    'people.email.verify': MailCheckIcon,
    'people.phone.find': PhoneIcon,
    'google.serp.maps': MapPinIcon,
    'web.backlinks.summary': LinkIcon,
    'web.backlinks.list': LinkIcon,
    'web.anchors.list': LinkIcon,
}

export function paidDataIcon(capability: PaidDataCapability): LucideIcon {
    return CAPABILITY_ICON[capability] ?? GROUP_ICON[paidDataEntry(capability).group]
}
