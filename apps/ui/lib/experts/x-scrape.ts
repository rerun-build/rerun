import { runApifyActor } from './apify'

const DEFAULT_PROFILE_ACTOR = 'apidojo/twitter-user-scraper'
const DEFAULT_TWEETS_ACTOR = 'apidojo/tweet-scraper'
const MAX_TWEETS = 30
const MAX_TWEET_LENGTH = 400

export type RawXUser = Record<string, unknown> & {
    id?: string
    userName?: string
    name?: string
    description?: string
    location?: string
    profilePicture?: string
    coverPicture?: string
    followers?: number
    following?: number
    statusesCount?: number
    createdAt?: string
    isVerified?: boolean
    isBlueVerified?: boolean
    protected?: boolean
    entities?: { url?: { urls?: unknown[] }; description?: { urls?: unknown[] } }
}

export type XTweet = {
    text: string
    createdAt?: string
    likeCount?: number
    retweetCount?: number
    isReply?: boolean
    isRetweet?: boolean
}

export type RawXProfile = {
    profile: RawXUser
    tweets: XTweet[]
}

const RESERVED_HANDLES = new Set(['i', 'home', 'explore', 'search', 'notifications', 'messages', 'settings', 'intent', 'share', 'compose', 'login', 'signup'])

export function xUsername(url: string): string {
    const bare = url.trim().match(/^@?([A-Za-z0-9_]{1,15})$/)
    const username = url.match(/(?:x|twitter)\.com\/(?:#!\/)?@?([A-Za-z0-9_]{1,15})/i)?.[1] ?? bare?.[1]
    if (!username || RESERVED_HANDLES.has(username.toLowerCase())) throw new Error(`Not an X profile URL: ${url}`)
    return username
}

export function canonicalXUrl(username: string): string {
    return `https://x.com/${username}`
}

export async function scrapeXProfile(url: string): Promise<RawXProfile> {
    const username = xUsername(url)
    const actor = process.env.APIFY_X_PROFILE_ACTOR ?? DEFAULT_PROFILE_ACTOR
    const [profile] = await runApifyActor<RawXUser>(actor, { twitterHandles: [username], getFollowers: false, getFollowing: false, maxItems: 1 }, 1)
    if (!profile) throw new Error(`Apify returned no X profile for @${username}`)
    return { profile, tweets: await scrapeTweets(username) }
}

async function scrapeTweets(username: string): Promise<XTweet[]> {
    try {
        const actor = process.env.APIFY_X_TWEETS_ACTOR ?? DEFAULT_TWEETS_ACTOR
        const items = await runApifyActor<Record<string, unknown>>(actor, { twitterHandles: [username], maxItems: MAX_TWEETS, sort: 'Latest' }, MAX_TWEETS)
        return items.map(toTweet).filter(tweet => tweet.text.length > 0)
    } catch {
        return []
    }
}

function toTweet(item: Record<string, unknown>): XTweet {
    const body = typeof item.fullText === 'string' ? item.fullText : typeof item.text === 'string' ? item.text : ''
    return {
        text: body.slice(0, MAX_TWEET_LENGTH),
        createdAt: typeof item.createdAt === 'string' ? item.createdAt : undefined,
        likeCount: typeof item.likeCount === 'number' ? item.likeCount : undefined,
        retweetCount: typeof item.retweetCount === 'number' ? item.retweetCount : undefined,
        isReply: typeof item.isReply === 'boolean' ? item.isReply : undefined,
        isRetweet: typeof item.isRetweet === 'boolean' ? item.isRetweet : undefined,
    }
}

export function extractXPhotoUrl(profile: RawXProfile): string | null {
    const candidate = profile.profile.profilePicture
    if (typeof candidate !== 'string' || !candidate.startsWith('http')) return null
    return candidate.replace(/_(normal|bigger|mini|200x200)\.(jpg|jpeg|png|webp)$/i, '_400x400.$2')
}

export function extractXBannerUrl(profile: RawXProfile): string | null {
    const candidate = profile.profile.coverPicture
    if (typeof candidate !== 'string' || !candidate.startsWith('http')) return null
    return /\/profile_banners\/\d+\/\d+\/?$/.test(candidate) ? `${candidate.replace(/\/$/, '')}/1500x500` : candidate
}
