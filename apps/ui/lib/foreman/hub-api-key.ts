import 'server-only'

// The key the onboarding foreman runs on in the hub. A self-hosted install runs it on the same
// OpenRouter key as the rest of the app.
export function foremanHubApiKey(): string | null {
    return process.env.RERUN_MAX_API_KEY || process.env.OPENROUTER_API_KEY || null
}
