export type CompareOgCompetitor = { slug: string; title: string; mark: string; glyph?: boolean }

const mark = (file: string) => `/og/competitors/${file}`

export const COMPARE_OG_COMPETITORS: CompareOgCompetitor[] = [
    { slug: 'rerun-vs-claude-cowork', title: 'Claude Cowork', mark: mark('claude-cowork.svg'), glyph: true },
    { slug: 'rerun-vs-manus', title: 'Manus', mark: mark('manus.png') },
    { slug: 'rerun-vs-grok-bot', title: 'Grok Bot', mark: mark('grok-bot.png') },
    { slug: 'rerun-vs-hermes-agent', title: 'Hermes Agent', mark: mark('hermes.png') },
    { slug: 'rerun-vs-openclaw', title: 'OpenClaw', mark: mark('openclaw.svg'), glyph: true },
    { slug: 'rerun-vs-paperclip', title: 'Paperclip', mark: mark('paperclip.svg') },
    { slug: 'rerun-vs-zapier', title: 'Zapier', mark: mark('zapier.svg'), glyph: true },
    { slug: 'rerun-vs-make', title: 'Make', mark: mark('make.svg'), glyph: true },
    { slug: 'rerun-vs-n8n', title: 'n8n', mark: mark('n8n.svg'), glyph: true },
    { slug: 'rerun-vs-lindy', title: 'Lindy', mark: mark('lindy.png') },
    { slug: 'rerun-vs-twin', title: 'Twin', mark: mark('twin.svg') },
    { slug: 'rerun-vs-dust', title: 'Dust', mark: mark('dust.png') },
    { slug: 'rerun-vs-squad', title: 'Squad', mark: mark('squad.svg') },
]

export function compareOgCompetitor(slug: string): CompareOgCompetitor | null {
    return COMPARE_OG_COMPETITORS.find(competitor => competitor.slug === slug) ?? null
}
