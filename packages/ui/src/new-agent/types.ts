export type CatalogEntry = {
    slug: string
    name: string
    icon: string | null
    category?: string
}

export type ConnectorCatalog = Map<string, CatalogEntry>

export type AgentSuggestion = { id: string; title: string; description: string; name: string; kickoff: string; apps: string[] }
