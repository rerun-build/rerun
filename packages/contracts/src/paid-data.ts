// The paid data a coworker buys with its workspace's Rerun credit: a catalog of routed capabilities
// on Treg, reached through one `paid_data` tool. Treg picks the provider and falls back to the next
// one on a miss, the hub bills what it was charged. Shared because the engine builds the tool and
// its index from it, the hub validates and prices against it, and the UI labels calls with it.
import { z } from 'zod'

import { formatCreditsLabel } from './credits.js'
import { unwrapToolOutputEnvelope } from './tool-output.js'

const MICROS_PER_USD = 1_000_000

// What a workspace pays for a paid data call as a multiple of what Treg charged, when the hub's
// env sets no PAID_DATA_PRICE_MULTIPLIER: at cost. The hub hands its multiplier to the engine, which
// prices the catalog with it, so what the coworker reads is what the workspace is billed.
export const PAID_DATA_DEFAULT_PRICE_MULTIPLIER = 1

// Treg walks the providers of a routed call cheapest first and lets that waterfall reach one dollar
// per call by default: a people search catalogued at a few credits a row once landed on a provider
// billing a hundred. The ceiling sent with each call bounds the waterfall to a multiple of the
// catalog price, so a dear provider is refused unbilled rather than served.
export const PAID_DATA_ROUTE_MAX_COST_FACTOR = 3
export const PAID_DATA_ROUTE_MAX_COST_ERROR = 'route_max_cost'

export const PAID_DATA_TOOL = 'paid_data'
export const PAID_DATA_CATALOG_TOOL = 'paid_data_catalog'
// Sent by an engine that saves each paid answer whole: the hub then adds it to its reply.
export const PAID_DATA_FULL_ANSWER_HEADER = 'x-rerun-paid-data-full'

const text = z.string().min(1)
const optionalText = text.optional()

const country = z.string().length(2).optional().describe('ISO 3166 country code, e.g. "fr". Defaults to "us": always set it for a non-US search.')
const language = z.string().min(2).max(5).optional().describe('Language code of the results, e.g. "fr". Defaults to "en".')
const searchFilters = { country, language }

const limit = (max: number) => z.number().int().min(1).max(max).optional().describe('How many to return.')
// A capability billed per row returned: its default is the row count the estimate assumes.
const DEFAULT_BILLED_ROWS = 10
const billedRows = z.number().int().min(1).max(100).default(DEFAULT_BILLED_ROWS).describe(`Rows to return, ${DEFAULT_BILLED_ROWS} by default. Each row is billed: ask for what you need, not more.`)

const personIdentity = {
    full_name: optionalText.describe("The person's full name. Pair it with `domain`."),
    first_name: optionalText,
    last_name: optionalText,
    domain: optionalText.describe("The company's website domain, e.g. acme.com."),
    linkedin_url: optionalText.describe("The person's LinkedIn profile URL. The most reliable key when you have it."),
}

const linkedinIdentity = {
    linkedin_url: optionalText.describe('The LinkedIn URL, e.g. https://www.linkedin.com/in/jane-doe.'),
    linkedin_handle: optionalText.describe('The handle at the end of the URL, e.g. jane-doe.'),
}

const socialUser = {
    username: optionalText.describe('The handle, without @.'),
    user_id: optionalText.describe("The platform's numeric account id."),
}

const target = { target: text.describe('A domain (acme.com) or a page URL.') }

export const PAID_DATA_GROUPS = ['people', 'companies', 'search', 'seo', 'linkedin', 'tiktok', 'instagram', 'x', 'youtube', 'facebook', 'reddit'] as const
export type PaidDataGroup = (typeof PAID_DATA_GROUPS)[number]

type CatalogEntry = {
    group: PaidDataGroup
    // The index line: the inputs it takes, then what it returns.
    summary: string
    params: z.ZodObject
    // Inputs of which at least one must be set: the schema alone cannot say it.
    oneOf?: readonly string[]
    // The field of `output` Treg leaves empty when no provider found anything.
    missField: string
    unit: 'call' | 'row'
    // What Treg is expected to charge for one unit, measured on real calls and rounded up: a miss on
    // a provider that bills it adds to the charge before the next one answers.
    unitCostMicros: number
    // The plural noun its units are counted in.
    label: string
    routeHeaders?: Readonly<Record<string, string>>
    // The fields each row of `missField` shows in the tool result when the whole answer is saved:
    // the rest of a row stays in the saved file, so a batch of searches does not fill the context.
    shownFields?: readonly string[]
}

export const PAID_DATA_CATALOG = {
    'people.search': {
        group: 'people',
        summary: '(q, or company_domain / title / full_name; country, location, keywords, limit) people matching a description or a company and a title: prospects, decision makers. Billed per row.',
        params: z.strictObject({
            q: optionalText.describe('Free-text description of who you are looking for, e.g. "head of marketing at a Lyon fintech".'),
            company_domain: optionalText.describe('Restrict to one company, by its website domain.'),
            title: optionalText.describe('Job title to match, e.g. "CEO".'),
            full_name: optionalText,
            country,
            location: optionalText.describe('Finer place than the country, e.g. "Bordeaux, France".'),
            keywords: z.array(text).optional().describe('Skills or topics the person must match.'),
            limit: billedRows,
        }),
        oneOf: ['q', 'company_domain', 'title', 'full_name'],
        missField: 'people',
        unit: 'row',
        unitCostMicros: 10_000,
        label: 'profiles',
    },
    'people.email.find': {
        group: 'people',
        summary: "(full_name + domain, first_name + last_name + domain, or linkedin_url) a person's verified work email. Billed only when one is found.",
        params: z.strictObject(personIdentity),
        oneOf: ['full_name', 'last_name', 'linkedin_url'],
        missField: 'email',
        unit: 'call',
        unitCostMicros: 30_000,
        label: 'work emails',
        // Treg refuses the in-call verification on every other route.
        routeHeaders: { 'X-Treg-Route-Verify': 'true' },
    },
    'people.email.verify': {
        group: 'people',
        summary: '(email) whether an address exists and accepts mail. Run it before writing to an address you did not get verified.',
        params: z.strictObject({ email: z.string().email() }),
        missField: 'status',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'email checks',
    },
    'people.phone.find': {
        group: 'people',
        summary: "(linkedin_url, email, or full_name + domain) a person's phone number. Billed only when one is found.",
        params: z.strictObject({ ...personIdentity, email: z.string().email().optional() }),
        oneOf: ['linkedin_url', 'email', 'full_name', 'last_name'],
        missField: 'phone',
        unit: 'call',
        unitCostMicros: 100_000,
        label: 'phone numbers',
    },
    'people.enrich': {
        group: 'people',
        summary: "(email, linkedin_url, or full_name + domain) a person's profile: role, company, location, social links.",
        params: z.strictObject({ ...personIdentity, email: z.string().email().optional() }),
        oneOf: ['email', 'linkedin_url', 'full_name', 'last_name'],
        missField: 'full_name',
        unit: 'call',
        unitCostMicros: 15_000,
        label: 'person profiles',
    },
    'people.identity.resolve': {
        group: 'people',
        summary: '(email) the LinkedIn profile behind a work email.',
        params: z.strictObject({ email: z.string().email() }),
        missField: 'linkedin_url',
        unit: 'call',
        unitCostMicros: 30_000,
        label: 'LinkedIn lookups',
    },
    'companies.search': {
        group: 'companies',
        summary: '(q, name, industry, technology or domain; country, limit) companies matching a description, an industry or a technology they use, from B2B databases: what a company is, never what it needs, often the biggest first. For small local businesses and independent professionals (lawyers, accountants, clinics), use google.serp.maps. Billed per row.',
        params: z.strictObject({
            q: optionalText.describe('Free-text description, e.g. "B2B SaaS selling to restaurants".'),
            name: optionalText,
            industry: optionalText,
            technology: optionalText.describe('A technology the company uses, e.g. "Shopify".'),
            domain: optionalText,
            country,
            limit: billedRows,
        }),
        oneOf: ['q', 'name', 'industry', 'technology', 'domain'],
        missField: 'companies',
        unit: 'row',
        unitCostMicros: 10_000,
        label: 'companies',
    },
    'companies.enrich': {
        group: 'companies',
        summary: "(domain, website, name, linkedin_url or a work email) a company's profile: size, industry, location, socials.",
        params: z.strictObject({ domain: optionalText, website: optionalText, name: optionalText, ...linkedinIdentity, email: z.string().email().optional() }),
        oneOf: ['domain', 'website', 'name', 'linkedin_url', 'linkedin_handle', 'email'],
        missField: 'name',
        unit: 'call',
        unitCostMicros: 15_000,
        label: 'company profiles',
    },
    'companies.similar': {
        group: 'companies',
        summary: '(domain) companies similar to one company: competitors, lookalikes.',
        params: z.strictObject({ domain: text }),
        missField: 'companies',
        unit: 'call',
        unitCostMicros: 100_000,
        label: 'lookalike searches',
    },
    'companies.jobs.search': {
        group: 'companies',
        summary: "(domain or name, limit) a company's open job listings.",
        params: z.strictObject({ domain: optionalText, name: optionalText, limit: limit(100) }),
        oneOf: ['domain', 'name'],
        missField: 'jobs',
        unit: 'call',
        unitCostMicros: 50_000,
        label: 'job listing searches',
    },
    'companies.news': {
        group: 'companies',
        summary: '(domain, limit) recent news about a company.',
        params: z.strictObject({ domain: text, limit: limit(100) }),
        missField: 'articles',
        unit: 'call',
        unitCostMicros: 20_000,
        label: 'company news searches',
    },
    'google.serp.organic': {
        group: 'search',
        summary: '(q, country, language, limit, ai_overview) Google organic results for a keyword: rank, title, URL, snippet, and the AI overview on demand. For SEO rankings, not general research: web_search is free.',
        params: z.strictObject({ q: text.describe('The keyword, as typed in Google.'), ...searchFilters, limit: limit(100), ai_overview: z.boolean().optional() }),
        missField: 'results',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'Google rankings',
    },
    'google.serp.maps': {
        group: 'search',
        summary: '(q, country, language) Google Maps places for a search, e.g. "plumber Lyon 3": name, address, phone, website, rating. The way to list local businesses, independent professionals and small firms.',
        params: z.strictObject({ q: text.describe('What and where, e.g. "plumber Lyon 3".'), ...searchFilters }),
        missField: 'places',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'Google Maps searches',
        shownFields: ['position', 'name', 'category', 'address', 'phone', 'website', 'rating', 'review_count'],
    },
    'google.serp.local': {
        group: 'search',
        summary: "(q, country, language) Google's local pack for a keyword: the businesses that rank locally, with their rating.",
        params: z.strictObject({ q: text, ...searchFilters }),
        missField: 'results',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'local rankings',
    },
    'google.serp.news': {
        group: 'search',
        summary: '(q, country, language, limit) Google News results for a keyword.',
        params: z.strictObject({ q: text, ...searchFilters, limit: limit(100) }),
        missField: 'results',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'Google News searches',
    },
    'ai-search.perplexity.answer': {
        group: 'search',
        summary: "(prompt, country) Perplexity's answer to a question and the sources it cites: whether a brand shows up in AI answers.",
        params: z.strictObject({ prompt: text, country }),
        missField: 'answer',
        unit: 'call',
        unitCostMicros: 10_000,
        label: 'Perplexity answers',
    },
    'google.keywords.volume': {
        group: 'seo',
        summary: '(keywords: up to 100, country, language) monthly Google search volume and CPC of each keyword, in one country. One call prices the whole list: batch every keyword of a country in one call, and for several countries start with the biggest markets.',
        params: z.strictObject({ keywords: z.array(text).min(1).max(100), ...searchFilters }),
        missField: 'rows',
        unit: 'call',
        unitCostMicros: 100_000,
        label: 'keyword volume checks',
    },
    'google.keywords.ideas': {
        group: 'seo',
        summary: '(keyword, country, language, limit) keyword ideas related to a seed keyword, with their volume.',
        params: z.strictObject({ keyword: text, ...searchFilters, limit: limit(100) }),
        missField: 'keywords',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'keyword idea lists',
    },
    'google.keywords.trends': {
        group: 'seo',
        summary: '(keywords: up to 5, country) Google Trends interest over time.',
        params: z.strictObject({ keywords: z.array(text).min(1).max(5), country }),
        missField: 'series',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'trend charts',
    },
    'web.backlinks.summary': {
        group: 'seo',
        summary: "(target) a site's backlink profile: backlinks, referring domains, authority.",
        params: z.strictObject(target),
        missField: 'summary',
        unit: 'call',
        unitCostMicros: 20_000,
        label: 'backlink reports',
    },
    'web.backlinks.list': {
        group: 'seo',
        summary: '(target, limit) the backlinks pointing at a domain or a page.',
        params: z.strictObject({ ...target, limit: limit(100) }),
        missField: 'backlinks',
        unit: 'call',
        unitCostMicros: 30_000,
        label: 'backlink lists',
    },
    'web.anchors.list': {
        group: 'seo',
        summary: "(target, limit) the anchor texts of a domain's backlinks.",
        params: z.strictObject({ ...target, limit: limit(100) }),
        missField: 'anchors',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'anchor text lists',
    },
    'web.url.metrics': {
        group: 'seo',
        summary: '(target) authority and link metrics of a domain or a page.',
        params: z.strictObject(target),
        missField: 'metrics',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'authority checks',
    },
    'linkedin.user.profile': {
        group: 'linkedin',
        summary: "(linkedin_url or linkedin_handle) a member's public profile: headline, experience, location.",
        params: z.strictObject(linkedinIdentity),
        oneOf: ['linkedin_url', 'linkedin_handle'],
        missField: 'full_name',
        unit: 'call',
        unitCostMicros: 10_000,
        label: 'LinkedIn profiles',
    },
    'linkedin.user.posts': {
        group: 'linkedin',
        summary: "(linkedin_url or linkedin_handle, limit) a member's recent posts, with their reaction and comment counts.",
        params: z.strictObject({ ...linkedinIdentity, limit: limit(50) }),
        oneOf: ['linkedin_url', 'linkedin_handle'],
        missField: 'posts',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'LinkedIn post lists',
    },
    'linkedin.company.profile': {
        group: 'linkedin',
        summary: '(linkedin_url or linkedin_handle) a company page: size, industry, followers.',
        params: z.strictObject(linkedinIdentity),
        oneOf: ['linkedin_url', 'linkedin_handle'],
        missField: 'name',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'LinkedIn company pages',
    },
    'linkedin.post.detail': {
        group: 'linkedin',
        summary: '(url) one post or article: text, reactions, comments.',
        params: z.strictObject({ url: text }),
        missField: 'post',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'LinkedIn posts',
    },
    'linkedin.post.comments': {
        group: 'linkedin',
        summary: '(post_urn or post_id, limit) the comments on a post. post_urn is the urn:li:activity:… id a post list returns.',
        params: z.strictObject({ post_urn: optionalText, post_id: optionalText, limit: limit(100) }),
        oneOf: ['post_urn', 'post_id'],
        missField: 'comments',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'LinkedIn comment lists',
    },
    'linkedin.post.reactions': {
        group: 'linkedin',
        summary: '(post_urn or post_id, limit) who reacted to a post: names, headlines, profile URLs. Warm prospects.',
        params: z.strictObject({ post_urn: optionalText, post_id: optionalText, limit: limit(100) }),
        oneOf: ['post_urn', 'post_id'],
        missField: 'reactions',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'LinkedIn reaction lists',
    },
    'tiktok.user.profile': {
        group: 'tiktok',
        summary: "(username, user_id or sec_uid) an account's profile: followers, likes, video count, bio, and the sec_uid its videos need.",
        params: z.strictObject({ ...socialUser, sec_uid: optionalText }),
        oneOf: ['username', 'user_id', 'sec_uid'],
        missField: 'username',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'TikTok profiles',
    },
    'tiktok.user.videos': {
        group: 'tiktok',
        summary: "(sec_uid, from tiktok.user.profile; limit) an account's recent posts, with views, likes and comments. A post with duration_s 0 is a photo slideshow (carousel), not a video.",
        params: z.strictObject({ sec_uid: text, limit: limit(50) }),
        missField: 'videos',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'TikTok video lists',
    },
    'tiktok.search.users': {
        group: 'tiktok',
        summary: '(q) accounts matching a keyword.',
        params: z.strictObject({ q: text }),
        missField: 'users',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'TikTok account searches',
    },
    'tiktok.search.videos': {
        group: 'tiktok',
        summary: '(q, limit) videos matching a keyword, first page only. Never returns photo slideshows: to find slideshows, find the accounts of the niche with tiktok.search.users and read their posts with tiktok.user.videos.',
        params: z.strictObject({ q: text, limit: limit(30) }),
        missField: 'videos',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'TikTok video searches',
    },
    'tiktok.video.detail': {
        group: 'tiktok',
        summary: "(video_id or url) one video's record: caption, stats, author.",
        params: z.strictObject({ video_id: optionalText, url: optionalText }),
        oneOf: ['video_id', 'url'],
        missField: 'video',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'TikTok videos',
    },
    'tiktok.video.comments': {
        group: 'tiktok',
        summary: '(video_id or url, limit) the comments on a video.',
        params: z.strictObject({ video_id: optionalText, url: optionalText, limit: limit(50) }),
        oneOf: ['video_id', 'url'],
        missField: 'comments',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'TikTok comment lists',
    },
    'tiktok.comment.replies': {
        group: 'tiktok',
        summary: '(video_id + comment_id, limit) the replies to one comment.',
        params: z.strictObject({ video_id: text, comment_id: text, limit: limit(50) }),
        missField: 'replies',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'TikTok reply lists',
    },
    'instagram.user.profile': {
        group: 'instagram',
        summary: "(username or user_id) an account's profile: followers, post count, bio.",
        params: z.strictObject(socialUser),
        oneOf: ['username', 'user_id'],
        missField: 'username',
        unit: 'call',
        unitCostMicros: 10_000,
        label: 'Instagram profiles',
    },
    'instagram.user.posts': {
        group: 'instagram',
        summary: "(username or user_id) an account's recent posts, with likes and comments.",
        params: z.strictObject(socialUser),
        oneOf: ['username', 'user_id'],
        missField: 'posts',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Instagram post lists',
    },
    'instagram.user.reels': {
        group: 'instagram',
        summary: "(username or user_id, limit) an account's reels, with views.",
        params: z.strictObject({ ...socialUser, limit: limit(50) }),
        oneOf: ['username', 'user_id'],
        missField: 'reels',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Instagram reel lists',
    },
    'instagram.search.users': {
        group: 'instagram',
        summary: '(q) accounts matching a keyword.',
        params: z.strictObject({ q: text }),
        missField: 'users',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Instagram account searches',
    },
    'instagram.search.reels': {
        group: 'instagram',
        summary: '(q) reels matching a keyword.',
        params: z.strictObject({ q: text }),
        missField: 'reels',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Instagram reel searches',
    },
    'instagram.hashtag.posts': {
        group: 'instagram',
        summary: '(hashtag, without #) recent posts under a hashtag.',
        params: z.strictObject({ hashtag: text }),
        missField: 'posts',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Instagram hashtag searches',
    },
    'instagram.post.detail': {
        group: 'instagram',
        summary: '(shortcode, url or post_id) one post: caption, likes, comments.',
        params: z.strictObject({ shortcode: optionalText, url: optionalText, post_id: optionalText }),
        oneOf: ['shortcode', 'url', 'post_id'],
        missField: 'id',
        unit: 'call',
        unitCostMicros: 20_000,
        label: 'Instagram posts',
    },
    'instagram.post.comments': {
        group: 'instagram',
        summary: '(shortcode or url) the comments on a post.',
        params: z.strictObject({ shortcode: optionalText, url: optionalText }),
        oneOf: ['shortcode', 'url'],
        missField: 'comments',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Instagram comment lists',
    },
    'x.user.profile': {
        group: 'x',
        summary: "(username or user_id) an X account's profile: followers, bio.",
        params: z.strictObject(socialUser),
        oneOf: ['username', 'user_id'],
        missField: 'username',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'X profiles',
    },
    'x.user.posts': {
        group: 'x',
        summary: "(username or user_id) an X account's recent posts, with likes, replies and views.",
        params: z.strictObject(socialUser),
        oneOf: ['username', 'user_id'],
        missField: 'posts',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'X post lists',
    },
    'x.search.posts': {
        group: 'x',
        summary: '(q) recent X posts matching a keyword.',
        params: z.strictObject({ q: text }),
        missField: 'posts',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'X searches',
    },
    'x.post.comments': {
        group: 'x',
        summary: '(tweet_id) the replies to an X post.',
        params: z.strictObject({ tweet_id: text }),
        missField: 'comments',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'X reply lists',
    },
    'youtube.channel.profile': {
        group: 'youtube',
        summary: "(channel_id) a channel's profile: subscribers, video count, description.",
        params: z.strictObject({ channel_id: text }),
        missField: 'name',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'YouTube channels',
    },
    'youtube.channel.videos': {
        group: 'youtube',
        summary: "(channel_id) a channel's recent videos, with views.",
        params: z.strictObject({ channel_id: text }),
        missField: 'videos',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'YouTube video lists',
    },
    'youtube.search.videos': {
        group: 'youtube',
        summary: '(q) YouTube videos matching a keyword.',
        params: z.strictObject({ q: text }),
        missField: 'videos',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'YouTube searches',
    },
    'youtube.video.detail': {
        group: 'youtube',
        summary: '(video_id or url) one video: title, views, likes, description.',
        params: z.strictObject({ video_id: optionalText, url: optionalText }),
        oneOf: ['video_id', 'url'],
        missField: 'video_id',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'YouTube videos',
    },
    'youtube.video.comments': {
        group: 'youtube',
        summary: '(video_id or url) the comments on a video.',
        params: z.strictObject({ video_id: optionalText, url: optionalText }),
        oneOf: ['video_id', 'url'],
        missField: 'comments',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'YouTube comment lists',
    },
    'facebook.user.profile': {
        group: 'facebook',
        summary: '(url or profile_id) a public Facebook profile or page: followers, category, contact.',
        params: z.strictObject({ url: optionalText, profile_id: optionalText }),
        oneOf: ['url', 'profile_id'],
        missField: 'name',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Facebook pages',
    },
    'facebook.user.posts': {
        group: 'facebook',
        summary: "(url or profile_id) a page's recent posts, with reactions and comments.",
        params: z.strictObject({ url: optionalText, profile_id: optionalText }),
        oneOf: ['url', 'profile_id'],
        missField: 'posts',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Facebook post lists',
    },
    'facebook.post.comments': {
        group: 'facebook',
        summary: '(url or post_id) the comments on a public post.',
        params: z.strictObject({ url: optionalText, post_id: optionalText }),
        oneOf: ['url', 'post_id'],
        missField: 'comments',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'Facebook comment lists',
    },
    'reddit.subreddit.posts': {
        group: 'reddit',
        summary: "(subreddit, without r/) a subreddit's recent posts.",
        params: z.strictObject({ subreddit: text }),
        missField: 'posts',
        unit: 'call',
        unitCostMicros: 5_000,
        label: 'subreddit feeds',
    },
    'reddit.post.detail': {
        group: 'reddit',
        summary: '(post_id: the t3_… id) one post, with its text and comments.',
        params: z.strictObject({ post_id: z.string().regex(/^t3_\w+$/, 'a t3_… id') }),
        missField: 'post',
        unit: 'call',
        unitCostMicros: 3_000,
        label: 'Reddit posts',
    },
} as const satisfies Record<string, CatalogEntry>

export type PaidDataCapability = keyof typeof PAID_DATA_CATALOG

export const PAID_DATA_CAPABILITIES = Object.keys(PAID_DATA_CATALOG) as PaidDataCapability[]

export function isPaidDataCapability(value: unknown): value is PaidDataCapability {
    return typeof value === 'string' && Object.hasOwn(PAID_DATA_CATALOG, value)
}

export function paidDataEntry(capability: PaidDataCapability): CatalogEntry {
    return PAID_DATA_CATALOG[capability]
}

export function isPaidDataGroup(value: unknown): value is PaidDataGroup {
    return typeof value === 'string' && (PAID_DATA_GROUPS as readonly string[]).includes(value)
}

const GROUP_TITLES: Record<PaidDataGroup, string> = {
    people: 'People and leads',
    companies: 'Companies',
    search: 'Search engines',
    seo: 'SEO',
    linkedin: 'LinkedIn',
    tiktok: 'TikTok',
    instagram: 'Instagram',
    x: 'X (Twitter)',
    youtube: 'YouTube',
    facebook: 'Facebook',
    reddit: 'Reddit',
}

const groupCapabilities = (group: PaidDataGroup): PaidDataCapability[] => PAID_DATA_CAPABILITIES.filter(capability => paidDataEntry(capability).group === group)

export function paidDataUnitPriceMicros(capability: PaidDataCapability, multiplier: number): number {
    return Math.round(paidDataEntry(capability).unitCostMicros * multiplier)
}

// Null when the hub could not say what it bills: the catalog then gives no price rather than a wrong one.
export type PaidDataPriceMultiplier = number | null

// In dollars, the unit Treg reads the ceiling in: the catalog cost of the rows the call asks for
// (its default page when it names none), or of the one call, times the factor.
export function paidDataRouteMaxCostUsd(capability: PaidDataCapability, params: Record<string, unknown>): number {
    const entry = paidDataEntry(capability)
    const rows = entry.unit === 'row' ? (typeof params.limit === 'number' && params.limit > 0 ? params.limit : DEFAULT_BILLED_ROWS) : 1
    return (entry.unitCostMicros * rows * PAID_DATA_ROUTE_MAX_COST_FACTOR) / MICROS_PER_USD
}

const unitPrice = (capability: PaidDataCapability, multiplier: number): string => formatCreditsLabel(paidDataUnitPriceMicros(capability, multiplier))

const indexLine = (capability: PaidDataCapability, multiplier: PaidDataPriceMultiplier): string => {
    const line = `- ${capability} ${paidDataEntry(capability).summary}`
    return multiplier === null ? line : `${line} About ${unitPrice(capability, multiplier)} per ${paidDataEntry(capability).unit}.`
}

export const PAID_DATA_PRICES_UNAVAILABLE = 'Prices are not available right now: each paid_data answer says what it billed.'

// What the model reads through paid_data_catalog: a group is one line per capability, the whole
// catalog is every group, the overview is only the ids. Nothing of it sits in a tool description,
// which the CLI bridges truncate and some model providers refuse past a thousand characters.
export function paidDataGroupIndex(group: PaidDataGroup, multiplier: PaidDataPriceMultiplier): string {
    const index = `${GROUP_TITLES[group]}:\n${groupCapabilities(group).map(capability => indexLine(capability, multiplier)).join('\n')}`
    return multiplier === null ? `${index}\n${PAID_DATA_PRICES_UNAVAILABLE}` : index
}

export function paidDataIndex(multiplier: PaidDataPriceMultiplier): string {
    return PAID_DATA_GROUPS.map(group => paidDataGroupIndex(group, multiplier)).join('\n')
}

export function paidDataOverview(): string {
    const header = `Paid data catalog: ${PAID_DATA_CAPABILITIES.length} capabilities in ${PAID_DATA_GROUPS.length} groups. Call ${PAID_DATA_CATALOG_TOOL} with a group for what each capability takes and returns, or with a capability id for its full input schema.`
    const groups = PAID_DATA_GROUPS.map(group => `${GROUP_TITLES[group]} (${group}): ${groupCapabilities(group).join(', ')}`)
    return [header, ...groups].join('\n')
}

export function paidDataCapabilityDoc(capability: PaidDataCapability, multiplier: PaidDataPriceMultiplier): string {
    const entry = paidDataEntry(capability)
    const { $schema: _, ...schema } = z.toJSONSchema(entry.params, { io: 'input' })
    const each = multiplier === null ? '' : `, about ${unitPrice(capability, multiplier)} each`
    const billing = entry.unit === 'row' ? `Billed per row returned${each}, counted as "${entry.label}": limit sets how many.` : `Billed per call${each}, counted as "${entry.label}".`
    return [
        indexLine(capability, multiplier),
        ...(multiplier === null ? [PAID_DATA_PRICES_UNAVAILABLE] : []),
        `Group: ${GROUP_TITLES[entry.group]} (${entry.group}).`,
        ...(entry.oneOf ? [`Needs one of: ${entry.oneOf.join(', ')}.`] : []),
        billing,
        `Input schema: ${JSON.stringify(schema)}`,
        'Nothing found comes back as status "nothing_found" and may still be billed: never repeat the same lookup.',
    ].join('\n')
}

export const paidDataCatalogLookupSchema = z.object({
    group: z.enum(PAID_DATA_GROUPS).optional().describe('A group id: its capabilities, one line each with the inputs and what it returns.'),
    capability: z.string().min(1).optional().describe('A capability id, e.g. "tiktok.user.profile": its full input schema. Wins over group when both are set.'),
})
export type PaidDataCatalogLookup = z.infer<typeof paidDataCatalogLookupSchema>

export type ParsedPaidDataParams = { ok: true; params: Record<string, unknown> } | { ok: false; error: string }

// Validated by the engine before it asks the hub, and again by the hub: an engine reached through
// a CLI bridge skips the tool schema, and the hub never trusts what an engine sends.
export function parsePaidDataParams(capability: string, params: unknown): ParsedPaidDataParams {
    if (!isPaidDataCapability(capability)) return { ok: false, error: `Unknown capability "${capability}": pick one from ${PAID_DATA_CATALOG_TOOL}.` }
    const entry = paidDataEntry(capability)
    const parsed = entry.params.safeParse(params ?? {})
    if (!parsed.success) {
        const issues = parsed.error.issues.map(issue => `${issue.path.join('.') || 'params'}: ${issue.message}`).join('; ')
        const expected = JSON.stringify(z.toJSONSchema(entry.params, { io: 'input' }).properties)
        return { ok: false, error: `Invalid params for ${capability} (${issues}). It takes: ${expected}` }
    }
    const data = parsed.data as Record<string, unknown>
    if (entry.oneOf && !entry.oneOf.some(key => data[key] !== undefined)) return { ok: false, error: `${capability} needs one of: ${entry.oneOf.join(', ')}.` }
    return { ok: true, params: data }
}

export const paidDataCallSchema = z.object({
    capability: z.string().min(1).describe('A capability id from paid_data_catalog, e.g. "tiktok.user.profile".'),
    params: z.record(z.string(), z.unknown()).default({}).describe('The inputs that capability takes, as paid_data_catalog lists them.'),
})
export type PaidDataCallInput = z.infer<typeof paidDataCallSchema>

// The tools #1216 shipped, one per capability. Stored conversations still hold calls to them, and
// an engine not updated yet still sends them to the hub.
export const LEGACY_PAID_DATA_TOOLS = {
    leads_people_search: 'people.search',
    leads_email_find: 'people.email.find',
    leads_email_verify: 'people.email.verify',
    leads_phone_find: 'people.phone.find',
    google_serp: 'google.serp.organic',
    google_maps_search: 'google.serp.maps',
} as const satisfies Record<string, PaidDataCapability>

export function legacyPaidDataCapability(toolName: string): PaidDataCapability | null {
    return Object.hasOwn(LEGACY_PAID_DATA_TOOLS, toolName) ? LEGACY_PAID_DATA_TOOLS[toolName as keyof typeof LEGACY_PAID_DATA_TOOLS] : null
}

export function isPaidDataTool(toolName: string): boolean {
    return toolName === PAID_DATA_TOOL || legacyPaidDataCapability(toolName) !== null
}

// The capability a paid data call bought, whichever tool it went through.
export function capabilityOfCall(toolName: string, input: unknown): PaidDataCapability | null {
    if (toolName === PAID_DATA_TOOL) {
        const capability = (input as { capability?: unknown } | null | undefined)?.capability
        return isPaidDataCapability(capability) ? capability : null
    }
    return legacyPaidDataCapability(toolName)
}

const plannedCallShape = {
    count: z.number().int().min(1).describe('How many times you plan to call it.'),
    limit: z.number().int().min(1).max(100).optional().describe('For a capability billed per row (people.search, companies.search): the `limit` you will pass on each call.'),
}

const plannedCallsSchema = z.array(z.object({ capability: z.enum(PAID_DATA_CAPABILITIES as [PaidDataCapability, ...PaidDataCapability[]]), ...plannedCallShape })).min(1)

export const paidDataEstimateSchema = z.object({ calls: plannedCallsSchema })
export type PaidDataEstimateInput = z.infer<typeof paidDataEstimateSchema>

// The tool names the capability as a plain string: the enum of every id would ride along in the
// tool's schema on each step, and the hub refuses an unknown one when it prices the spend anyway.
const plannedCallsInputSchema = z.array(z.object({ capability: z.string().min(1).describe('A capability id from paid_data_catalog, e.g. people.email.find.'), ...plannedCallShape })).min(1)

export const requestSpendSchema = z.object({
    purpose: z.string().min(1).describe('What the user gets for the spend, in one short line, e.g. "Find the work emails of 40 restaurant owners in Bordeaux".'),
    calls: plannedCallsInputSchema.describe('Every paid_data call the task needs, by capability, with how many times you will make it.'),
    soFar: z.string().min(1).optional().describe('Only when asking again after an approval ran out: what the previous spend already got, in one short line, e.g. "31 of 40 found so far".'),
})
export type RequestSpendInput = z.infer<typeof requestSpendSchema>

// The "Always allow" of a spend card, written on the coworker from the app.
export const paidDataAlwaysAllowSchema = z.object({ alwaysAllow: z.boolean() })
export type PaidDataAlwaysAllowInput = z.infer<typeof paidDataAlwaysAllowSchema>

// `units` is what the user is billed for: calls, or rows for a search that returns several.
export type PaidDataEstimateLine = { capability: PaidDataCapability; count: number; units: number; micros: number }

export type PaidDataEstimate = {
    totalMicros: number
    lines: PaidDataEstimateLine[]
}

// What a workspace is expected to pay for a batch of paid data calls, as the hub priced it when the
// coworker asked, next to the credit the workspace had left then.
export type SpendQuote = PaidDataEstimate & { creditLeftMicros: number }

// What Treg is expected to charge us, before the hub's price multiplier. A rough figure on purpose:
// a routed call costs whatever the provider that served it bills, so this only gives an order of
// magnitude. The bill is always the real charge.
export function estimatePaidDataProviderCost(input: PaidDataEstimateInput, multiplier = 1): PaidDataEstimate {
    const lines = input.calls.map(({ capability, count, limit }) => {
        const entry = paidDataEntry(capability)
        const units = entry.unit === 'row' ? count * (limit ?? 10) : count
        return { capability, count, units, micros: Math.round(units * entry.unitCostMicros * multiplier) }
    })
    return { totalMicros: lines.reduce((sum, line) => sum + line.micros, 0), lines }
}

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0

// A quote line stored before the catalog named capabilities carries the tool instead.
function readQuoteLine(line: unknown): PaidDataEstimateLine | null {
    const raw = line as { capability?: unknown; tool?: unknown; count?: unknown; units?: unknown; micros?: unknown } | null
    const capability = isPaidDataCapability(raw?.capability) ? raw.capability : legacyPaidDataCapability(String(raw?.tool))
    if (!capability || !isCount(raw?.units) || !isCount(raw?.micros)) return null
    return { capability, count: isCount(raw?.count) ? raw.count : raw.units, units: raw.units, micros: raw.micros }
}

// The quote request_spend returned, read back from its stored tool output.
export function readSpendQuote(output: unknown): SpendQuote | null {
    const quote = (unwrapToolOutputEnvelope(output) as { quote?: Partial<SpendQuote> } | null | undefined)?.quote
    if (!quote || !isCount(quote.totalMicros) || !Array.isArray(quote.lines)) return null
    const lines = quote.lines.map(readQuoteLine).filter(line => line !== null)
    return { totalMicros: quote.totalMicros, lines, creditLeftMicros: isCount(quote.creditLeftMicros) ? quote.creditLeftMicros : 0 }
}

// What one paid data call billed, read back from its tool output.
export function billedMicrosOf(output: unknown): number {
    const billed = (unwrapToolOutputEnvelope(output) as { billedMicros?: unknown } | null | undefined)?.billedMicros
    return isCount(billed) ? billed : 0
}

// The reason a paid data call carries when the hub refused it for want of credit: the chat shows the
// top-up notice on it.
export const PAID_DATA_OUT_OF_CREDIT = 'out_of_credit'

export function isPaidDataOutOfCredit(output: unknown): boolean {
    return (unwrapToolOutputEnvelope(output) as { reason?: unknown } | null | undefined)?.reason === PAID_DATA_OUT_OF_CREDIT
}

export function usdToMicros(usd: number): number {
    return Math.round(usd * MICROS_PER_USD)
}
