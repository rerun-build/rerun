import type { EngineUsageBucket } from '@rerun/contracts'
import { agentTileStyle, connectorTileStyle, type AgentStatus, type Tile, type TileLink } from '@rerun/ui/iso-grid'
import type { AgentStatusEntry } from '@rerun/ui/monitoring'

const AGENTS: { id: string; name: string; col: number; row: number; status: AgentStatus }[] = [
    { id: 'a-research', name: 'Researcher', col: 1, row: 1, status: 'idle' },
    { id: 'a-seo', name: 'SEO Analyst', col: 3, row: 3, status: 'waiting_human' },
    { id: 'a-copy', name: 'Copywriter', col: 2, row: 6, status: 'working' },
    { id: 'a-publish', name: 'Publisher', col: 4, row: 8, status: 'idle' },
]

export const TILES: Tile[] = AGENTS.map(a => ({
    id: a.id,
    position: { col: a.col, row: a.row },
    span: 2,
    style: agentTileStyle(a.status, a.name),
}))

export const LINKS: TileLink[] = [{ source: 'a-copy', target: 'a-publish', variant: 'beam' }]

const DEFAULT_AGENTS: typeof AGENTS = [
    { id: 'a-seo', name: 'SEO Writer', col: 1, row: 1, status: 'idle' },
    { id: 'a-ecom', name: 'Ecom Manager', col: 2, row: 6, status: 'waiting_human' },
    { id: 'a-saas', name: 'SaaS Support', col: 6, row: 10, status: 'working' },
]

const PROVIDERS: { id: string; icon: string; col: number; row: number; agentId: string }[] = [
    { id: 'p-chatgpt', icon: '/onboarding/tour/board/openai.svg?tone=dark', col: 2, row: 4, agentId: 'a-ecom' },
    { id: 'p-claude', icon: '/onboarding/tour/board/anthropic.svg', col: 5, row: 6, agentId: 'a-ecom' },
    { id: 'p-gemini', icon: '/og/providers/gemini.svg?tone=dark', col: 9, row: 10, agentId: 'a-saas' },
    { id: 'p-openrouter', icon: '/onboarding/tour/board/openrouter.svg?tone=dark', col: 6, row: 13, agentId: 'a-saas' },
]

export const DEFAULT_TILES: Tile[] = [
    ...DEFAULT_AGENTS.map(a => ({ id: a.id, position: { col: a.col, row: a.row }, span: 2, style: agentTileStyle(a.status, a.name) })),
    ...PROVIDERS.map(p => ({ id: p.id, position: { col: p.col, row: p.row }, span: 1, style: connectorTileStyle(p.icon) })),
]

export const DEFAULT_LINKS: TileLink[] = PROVIDERS.map(p => ({ source: p.agentId, target: p.id, variant: 'cable' }))

export const MOCK_AGENTS: AgentStatusEntry[] = [
    { id: 'a-research', name: 'Researcher', status: 'working' },
    { id: 'a-copy', name: 'Copywriter', status: 'waiting_human' },
    { id: 'a-publish', name: 'Publisher', status: 'idle' },
]

export const MOCK_BUCKETS: EngineUsageBucket[] = [140, 210, 180, 260, 320, 280, 360].map((k, i) => ({
    day: `2026-07-0${i + 1}`,
    model: null,
    inputTokens: k * 700,
    outputTokens: k * 300,
    cachedInputTokens: 0,
    reasoningTokens: 0,
    totalTokens: k * 1000,
    costMicros: k * 12_000,
    runCount: Math.round(k / 20),
}))

export const ISO_TILT = 'rotateX(60deg) rotateZ(45deg)'
