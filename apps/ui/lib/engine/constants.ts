import { RERUN_MODELS, type RerunTier } from '@rerun/contracts'

// rerun-engine runs a single HTTP server per Space (one engine, many agents
// addressed by /agents/:id), unlike Hermes which used one port per agent.
export const ENGINE_DEFAULT_PORT = 3000

// Providers accepted by rerun-engine (docs/API.md POST /agents → config.provider).
// `rerun` is the zero-friction demo provider: free models routed through the hub
// (/api/llm), so users can try them without bringing their own key.
export const ENGINE_PROVIDERS: { id: string; label: string }[] = [
    { id: 'rerun', label: 'Rerun' },
    { id: 'anthropic', label: 'Anthropic' },
    { id: 'openai', label: 'OpenAI' },
    { id: 'google', label: 'Google' },
    { id: 'openrouter', label: 'OpenRouter' },
]

// The models exposed by the `rerun` provider, as the boxes name them. Aliases rather than
// OpenRouter ids: the hub proxy (app/api/llm/chat/completions) rewrites whatever a box asks for
// into one of the ids below, so the shared key can never be spent on anything else and a box that
// has not self-updated keeps running the current model. In the order the engine seeds them.
export const RERUN_DEMO_MODEL_IDS = [RERUN_MODELS.balanced, RERUN_MODELS.fast, RERUN_MODELS.smart] as const

// What each Rerun tier actually runs. The one place that choice lives: change a line, deploy the
// hub, and every box follows without an update. A replacement must take images and tools, and its
// context window must not be smaller than the tier's entry in MODEL_CONTEXT_WINDOW.
export const RERUN_UPSTREAM_MODELS: Record<RerunTier, string> = {
    fast: 'openai/gpt-6-luna',
    balanced: 'anthropic/claude-haiku-5.5',
    smart: 'openai/gpt-6-sol',
}

// What the hub asks of a tier's reasoning, over whatever the box sent. Fast has to answer sooner
// than Balanced, and left to its own effort its model takes more steps and finishes later.
export const RERUN_TIER_REASONING: Partial<Record<RerunTier, { effort: 'low' }>> = {
    fast: { effort: 'low' },
}

// The boolean switches in an agent's config.tools / config.selfImprovement. Derived from
// the engine schemas in @rerun/contracts, so they cannot drift from what the engine
// actually accepts (this list used to be hand-maintained and had gone stale at 6 of 17).
export { SELF_IMPROVEMENT_KEYS as ENGINE_SELF_IMPROVEMENT_KEYS, TOOL_KEYS as ENGINE_TOOL_KEYS } from '@rerun/contracts'
