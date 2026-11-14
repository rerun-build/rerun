import { GlobeIcon } from '../icons'

import { GitHubIcon, LinkedInIcon, XIcon } from './social-icons'
import type { Expert } from './types'

export function ChipList({ title, items }: { title: string; items: string[] }) {
    if (items.length === 0) return null
    return (
        <div>
            <h4 className="text-xs font-medium tracking-wide text-foreground/40 uppercase">{title}</h4>
            <div className="mt-3 flex flex-wrap gap-1.5">
                {items.map(item => (
                    <span key={item} className="rounded-full bg-foreground/5 px-2.5 py-1 text-xs text-foreground/70 ring-1 ring-foreground/10">
                        {item}
                    </span>
                ))}
            </div>
        </div>
    )
}

const SOCIAL_ICONS = { xUrl: XIcon, linkedinUrl: LinkedInIcon, githubUrl: GitHubIcon, websiteUrl: GlobeIcon } as const

export const SOCIAL_LINK_REL = 'noopener noreferrer nofollow ugc'

export function SocialLinks({ expert }: { expert: Expert }) {
    const links = (Object.keys(SOCIAL_ICONS) as (keyof typeof SOCIAL_ICONS)[])
        .map(key => ({ url: expert[key], Icon: SOCIAL_ICONS[key], key }))
        .filter(link => link.url)

    if (links.length === 0) return null

    return (
        <div className="flex items-center gap-2">
            {links.map(({ url, Icon, key }) => (
                <a
                    key={key}
                    href={url ?? undefined}
                    target="_blank"
                    rel={SOCIAL_LINK_REL}
                    className="flex size-9 items-center justify-center rounded-lg bg-foreground/5 text-foreground/60 ring-1 ring-foreground/10 transition-colors hover:bg-foreground/10 hover:text-foreground"
                >
                    <Icon className="size-4" />
                </a>
            ))}
        </div>
    )
}
