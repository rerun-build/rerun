import 'server-only'

export function foremanHubApiKey(): string | null {
    return process.env.RERUN_MAX_API_KEY || process.env.OPENROUTER_API_KEY || null
}
