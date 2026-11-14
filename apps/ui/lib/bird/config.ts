export type BirdConfig = { apiKey: string; baseUrl: string }

export function birdConfig(): BirdConfig | null {
    const apiKey = process.env.BIRD_API_KEY
    const region = apiKey?.split('_')[1]
    return apiKey && region ? { apiKey, baseUrl: `https://${region}.platform.bird.com/v1` } : null
}
