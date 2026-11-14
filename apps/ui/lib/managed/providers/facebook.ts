import type { ManagedProvider, ManagedTool } from '../types'
import { bool, num, requireStr, str, strList } from './args'

const GRAPH_VERSION = 'v26.0'
const GRAPH_BASE = `https://graph.facebook.com/${GRAPH_VERSION}`
const GRAPH_VIDEO_BASE = `https://graph-video.facebook.com/${GRAPH_VERSION}`
const MAX_PAGE_SIZE = 100

const LOGIN_CONFIG_ID = '1664481615043702'

const POST_FIELDS = 'id,message,created_time,updated_time,permalink_url,full_picture,status_type,is_published,shares,reactions.summary(total_count).limit(0),comments.summary(total_count).limit(0)'
const COMMENT_FIELDS = 'id,message,created_time,from,like_count,comment_count,is_hidden,permalink_url,attachment'
const DEFAULT_PAGE_METRICS = ['page_media_view', 'page_total_media_view_unique', 'page_follows', 'page_post_engagements']
const DEFAULT_POST_METRICS = ['post_media_view', 'post_total_media_view_unique', 'post_clicks', 'post_reactions_by_type_total']

type GraphError = { error?: { message?: string; code?: number; error_subcode?: number; error_user_msg?: string } }

async function graph(token: string, method: string, path: string, params: Record<string, string | number | boolean | undefined> = {}, base = GRAPH_BASE): Promise<Record<string, unknown>> {
    const search = new URLSearchParams()
    for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) search.set(key, String(value))
    }
    const isRead = method === 'GET' || method === 'DELETE'
    const qs = isRead ? `?${search.toString()}` : ''
    const res = await fetch(`${base}${path}${qs}`, {
        method,
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(isRead ? {} : { 'Content-Type': 'application/x-www-form-urlencoded' }) },
        ...(isRead ? {} : { body: search.toString() }),
    })
    const text = await res.text()
    const data = (text ? JSON.parse(text) : {}) as Record<string, unknown> & GraphError
    if (!res.ok || data.error) {
        const message = data.error?.error_user_msg ?? data.error?.message ?? res.statusText
        const code = data.error?.code ? ` (code ${data.error.code})` : ''
        throw new Error(`Facebook API ${res.status}${code}: ${message}`)
    }
    return typeof data === 'object' && !Array.isArray(data) ? data : { result: data }
}

async function pageToken(token: string, pageId: string): Promise<string> {
    const data = await graph(token, 'GET', `/${encodeURIComponent(pageId)}`, { fields: 'access_token' })
    if (typeof data.access_token !== 'string') throw new Error(`No access to Page ${pageId}. List the connected Pages with facebook_list_pages.`)
    return data.access_token
}

function id(args: Record<string, unknown>, key: string): string {
    return encodeURIComponent(requireStr(args, key))
}

function limit(args: Record<string, unknown>): number | undefined {
    const value = num(args, 'limit')
    return value === undefined ? undefined : Math.min(Math.max(1, Math.floor(value)), MAX_PAGE_SIZE)
}

function unixTime(args: Record<string, unknown>, key: string): number | undefined {
    const raw = args[key]
    if (typeof raw === 'number') return Math.floor(raw)
    if (typeof raw !== 'string' || !raw) return undefined
    const ms = Date.parse(raw)
    if (Number.isNaN(ms)) throw new Error(`${key} must be an ISO 8601 datetime or a Unix timestamp`)
    return Math.floor(ms / 1000)
}

const PAGE_ID = { type: 'string', description: 'The Page id, as returned by facebook_list_pages.' }
const LIMIT = { type: 'number', description: `Items per page (default 25, max ${MAX_PAGE_SIZE}).` }
const AFTER = { type: 'string', description: 'Pagination cursor: paging.cursors.after from the previous result.' }
const SCHEDULE = {
    type: 'string',
    description: 'Publish later instead of now: ISO 8601 datetime (e.g. 2026-11-02T09:00:00+01:00) between 10 minutes and 30 days ahead.',
}

const tools: ManagedTool[] = [
    {
        name: 'facebook_list_pages',
        description: 'List the Facebook Pages the user shared with Rerun, with their id, name, category and follower count. Every other tool needs a Page id from here.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args, token) => graph(token, 'GET', '/me/accounts', { fields: 'id,name,category,link,followers_count,fan_count', limit: MAX_PAGE_SIZE }),
    },
    {
        name: 'facebook_get_connected_account',
        description: 'Get the Facebook identity Rerun acts as (id and name). Use it to confirm which account is connected.',
        inputSchema: { type: 'object', properties: {} },
        execute: async (_args, token) => graph(token, 'GET', '/me', { fields: 'id,name' }),
    },
    {
        name: 'facebook_get_page',
        description: "Get a Page's public details: name, about, description, category, website, contact info, location, follower count and picture.",
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID }, required: ['pageId'] },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}`, {
                fields: 'id,name,about,description,category,link,website,phone,emails,location,followers_count,fan_count,picture',
            }),
    },
    {
        name: 'facebook_get_page_insights',
        description: `Read a Page's performance metrics over a period. Default metrics: ${DEFAULT_PAGE_METRICS.join(', ')}. Pass since/until to pick the period (at most 90 days apart).`,
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                metrics: { type: 'array', items: { type: 'string' }, description: `Page Insights metric names. Default ${DEFAULT_PAGE_METRICS.join(', ')}.` },
                period: { type: 'string', enum: ['day', 'week', 'days_28', 'total_over_range'], description: 'Aggregation period. Default day.' },
                since: { type: 'string', description: 'Start of the period, ISO 8601 date or Unix timestamp.' },
                until: { type: 'string', description: 'End of the period, ISO 8601 date or Unix timestamp.' },
            },
            required: ['pageId'],
        },
        execute: async (args, token) => {
            const metrics = strList(args, 'metrics')
            return graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}/insights`, {
                metric: (metrics?.length ? metrics : DEFAULT_PAGE_METRICS).join(','),
                period: str(args, 'period') ?? 'day',
                since: unixTime(args, 'since'),
                until: unixTime(args, 'until'),
            })
        },
    },
    {
        name: 'facebook_list_posts',
        description: "List a Page's own published posts, newest first, with their text, link, picture, and reaction, comment and share counts.",
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, limit: LIMIT, after: AFTER }, required: ['pageId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}/posts`, { fields: POST_FIELDS, limit: limit(args), after: str(args, 'after') }),
    },
    {
        name: 'facebook_list_scheduled_posts',
        description: "List a Page's posts scheduled for later, with their planned publish time.",
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, limit: LIMIT, after: AFTER }, required: ['pageId'] },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}/scheduled_posts`, {
                fields: 'id,message,created_time,scheduled_publish_time,permalink_url,full_picture',
                limit: limit(args),
                after: str(args, 'after'),
            }),
    },
    {
        name: 'facebook_list_tagged_posts',
        description: 'List posts by other people or Pages that tag or mention this Page.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, limit: LIMIT, after: AFTER }, required: ['pageId'] },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}/tagged`, {
                fields: 'id,message,created_time,from,permalink_url',
                limit: limit(args),
                after: str(args, 'after'),
            }),
    },
    {
        name: 'facebook_list_photos',
        description: 'List the photos the Page uploaded, with their caption, link and image URL.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, limit: LIMIT, after: AFTER }, required: ['pageId'] },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}/photos`, {
                type: 'uploaded',
                fields: 'id,name,created_time,link,images',
                limit: limit(args),
                after: str(args, 'after'),
            }),
    },
    {
        name: 'facebook_list_videos',
        description: 'List the videos the Page uploaded, with their title, description, length and link.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, limit: LIMIT, after: AFTER }, required: ['pageId'] },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}/videos`, {
                fields: 'id,title,description,created_time,length,permalink_url,picture',
                limit: limit(args),
                after: str(args, 'after'),
            }),
    },
    {
        name: 'facebook_list_albums',
        description: "List the Page's photo albums with their name, description and photo count. Facebook does not let apps create albums: a new one is made on Facebook itself.",
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, limit: LIMIT, after: AFTER }, required: ['pageId'] },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'pageId')}/albums`, {
                fields: 'id,name,description,count,created_time,updated_time,link',
                limit: limit(args),
                after: str(args, 'after'),
            }),
    },
    {
        name: 'facebook_add_photos_to_album',
        description: 'Add photos to one of the Page albums from public image URLs (1 to 10), with an optional caption on each. The photos are published in the album.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                albumId: { type: 'string', description: 'The album id, as returned by facebook_list_albums.' },
                imageUrls: { type: 'array', items: { type: 'string' }, description: 'Public URLs of the images (JPEG, PNG, GIF, under 4 MB each).' },
                caption: { type: 'string', description: 'The text shown with each photo.' },
            },
            required: ['pageId', 'albumId', 'imageUrls'],
        },
        execute: async (args, token) => {
            const imageUrls = strList(args, 'imageUrls') ?? []
            if (imageUrls.length < 1 || imageUrls.length > 10) throw new Error('imageUrls must hold between 1 and 10 image URLs')
            const accessToken = await pageToken(token, requireStr(args, 'pageId'))
            const photoIds: string[] = []
            for (const url of imageUrls) {
                const photo = await graph(accessToken, 'POST', `/${id(args, 'albumId')}/photos`, { url, caption: str(args, 'caption') })
                photoIds.push(String(photo.id))
            }
            return { albumId: requireStr(args, 'albumId'), photoIds }
        },
    },
    {
        name: 'facebook_get_post',
        description: 'Get one post of the Page with its text, link, picture, and reaction, comment and share counts.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, postId: { type: 'string', description: 'The post id.' } }, required: ['pageId', 'postId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'postId')}`, { fields: POST_FIELDS }),
    },
    {
        name: 'facebook_get_post_insights',
        description: `Read one post's performance. Default metrics: ${DEFAULT_POST_METRICS.join(', ')}.`,
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                postId: { type: 'string', description: 'The post id.' },
                metrics: { type: 'array', items: { type: 'string' }, description: `Post Insights metric names. Default ${DEFAULT_POST_METRICS.join(', ')}.` },
            },
            required: ['pageId', 'postId'],
        },
        execute: async (args, token) => {
            const metrics = strList(args, 'metrics')
            return graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'postId')}/insights`, { metric: (metrics?.length ? metrics : DEFAULT_POST_METRICS).join(',') })
        },
    },
    {
        name: 'facebook_list_reactions',
        description: 'List the reactions on a post or comment, with the total count.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                objectId: { type: 'string', description: 'The post or comment id.' },
                type: { type: 'string', enum: ['LIKE', 'LOVE', 'WOW', 'HAHA', 'SAD', 'ANGRY', 'CARE'], description: 'Only this reaction type.' },
                limit: LIMIT,
                after: AFTER,
            },
            required: ['pageId', 'objectId'],
        },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'objectId')}/reactions`, {
                summary: 'total_count',
                type: str(args, 'type'),
                limit: limit(args),
                after: str(args, 'after'),
            }),
    },
    {
        name: 'facebook_create_post',
        description: 'Publish a text post on the Page, optionally with a link preview. Pass scheduledAt to schedule it instead. Returns the new post id.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                message: { type: 'string', description: 'The post text.' },
                link: { type: 'string', description: 'A URL to attach as a link preview.' },
                scheduledAt: SCHEDULE,
            },
            required: ['pageId', 'message'],
        },
        execute: async (args, token) => {
            const scheduledAt = unixTime(args, 'scheduledAt')
            return graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'pageId')}/feed`, {
                message: requireStr(args, 'message'),
                link: str(args, 'link'),
                ...(scheduledAt ? { published: false, scheduled_publish_time: scheduledAt } : {}),
            })
        },
    },
    {
        name: 'facebook_create_photo_post',
        description: 'Publish a photo on the Page from a public image URL, with an optional caption. Pass scheduledAt to schedule it instead.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                imageUrl: { type: 'string', description: 'Public URL of the image (JPEG, PNG, GIF, under 4 MB).' },
                caption: { type: 'string', description: 'The text shown with the photo.' },
                scheduledAt: SCHEDULE,
            },
            required: ['pageId', 'imageUrl'],
        },
        execute: async (args, token) => {
            const scheduledAt = unixTime(args, 'scheduledAt')
            return graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'pageId')}/photos`, {
                url: requireStr(args, 'imageUrl'),
                caption: str(args, 'caption'),
                ...(scheduledAt ? { published: false, scheduled_publish_time: scheduledAt } : {}),
            })
        },
    },
    {
        name: 'facebook_create_multi_photo_post',
        description: 'Publish one post with several photos (2 to 10) from public image URLs, with an optional text.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                imageUrls: { type: 'array', items: { type: 'string' }, description: 'Public URLs of the images, in display order.' },
                message: { type: 'string', description: 'The post text.' },
                scheduledAt: SCHEDULE,
            },
            required: ['pageId', 'imageUrls'],
        },
        execute: async (args, token) => {
            const imageUrls = strList(args, 'imageUrls') ?? []
            if (imageUrls.length < 2 || imageUrls.length > 10) throw new Error('imageUrls must hold between 2 and 10 image URLs')
            const pageId = requireStr(args, 'pageId')
            const accessToken = await pageToken(token, pageId)
            const photoIds: string[] = []
            for (const url of imageUrls) {
                const photo = await graph(accessToken, 'POST', `/${encodeURIComponent(pageId)}/photos`, { url, published: false, temporary: true })
                photoIds.push(String(photo.id))
            }
            const scheduledAt = unixTime(args, 'scheduledAt')
            const attached: Record<string, string> = {}
            photoIds.forEach((photoId, index) => {
                attached[`attached_media[${index}]`] = JSON.stringify({ media_fbid: photoId })
            })
            return graph(accessToken, 'POST', `/${encodeURIComponent(pageId)}/feed`, {
                message: str(args, 'message'),
                ...attached,
                ...(scheduledAt ? { published: false, scheduled_publish_time: scheduledAt } : {}),
            })
        },
    },
    {
        name: 'facebook_create_video_post',
        description: 'Publish a video on the Page from a public video URL, with an optional title and description. Pass scheduledAt to schedule it instead.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                videoUrl: { type: 'string', description: 'Public URL of the video file (MP4 recommended).' },
                title: { type: 'string', description: 'The video title.' },
                description: { type: 'string', description: 'The text shown with the video.' },
                scheduledAt: SCHEDULE,
            },
            required: ['pageId', 'videoUrl'],
        },
        execute: async (args, token) => {
            const scheduledAt = unixTime(args, 'scheduledAt')
            return graph(
                await pageToken(token, requireStr(args, 'pageId')),
                'POST',
                `/${id(args, 'pageId')}/videos`,
                {
                    file_url: requireStr(args, 'videoUrl'),
                    title: str(args, 'title'),
                    description: str(args, 'description'),
                    ...(scheduledAt ? { published: false, scheduled_publish_time: scheduledAt } : {}),
                },
                GRAPH_VIDEO_BASE
            )
        },
    },
    {
        name: 'facebook_update_post',
        description: "Edit the text of one of the Page's posts.",
        inputSchema: {
            type: 'object',
            properties: { pageId: PAGE_ID, postId: { type: 'string', description: 'The post to edit.' }, message: { type: 'string', description: 'The new text.' } },
            required: ['pageId', 'postId', 'message'],
        },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'postId')}`, { message: requireStr(args, 'message') }),
    },
    {
        name: 'facebook_publish_scheduled_post',
        description: 'Publish a scheduled post right away instead of waiting for its planned time.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, postId: { type: 'string', description: 'The scheduled post id.' } }, required: ['pageId', 'postId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'postId')}`, { is_published: true }),
    },
    {
        name: 'facebook_reschedule_post',
        description: 'Move a scheduled post to another publish time.',
        inputSchema: {
            type: 'object',
            properties: { pageId: PAGE_ID, postId: { type: 'string', description: 'The scheduled post id.' }, scheduledAt: SCHEDULE },
            required: ['pageId', 'postId', 'scheduledAt'],
        },
        execute: async (args, token) => {
            const scheduledAt = unixTime(args, 'scheduledAt')
            if (!scheduledAt) throw new Error('Missing required argument: scheduledAt')
            return graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'postId')}`, { scheduled_publish_time: scheduledAt })
        },
    },
    {
        name: 'facebook_delete_post',
        description: 'Permanently delete one of the Page posts. Irreversible, so confirm the post with facebook_get_post first.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, postId: { type: 'string', description: 'The post to delete.' } }, required: ['pageId', 'postId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'DELETE', `/${id(args, 'postId')}`),
    },
    {
        name: 'facebook_list_comments',
        description: 'List the comments on a post (or the replies to a comment), with author, text, like count and whether they are hidden.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                objectId: { type: 'string', description: 'The post id, or a comment id to read its replies.' },
                order: { type: 'string', enum: ['chronological', 'reverse_chronological'], description: 'Default chronological.' },
                limit: LIMIT,
                after: AFTER,
            },
            required: ['pageId', 'objectId'],
        },
        execute: async (args, token) =>
            graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'objectId')}/comments`, {
                fields: COMMENT_FIELDS,
                filter: 'stream',
                summary: 'total_count',
                order: str(args, 'order'),
                limit: limit(args),
                after: str(args, 'after'),
            }),
    },
    {
        name: 'facebook_get_comment',
        description: 'Get one comment with its author, text, like count and replies count.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, commentId: { type: 'string', description: 'The comment id.' } }, required: ['pageId', 'commentId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'GET', `/${id(args, 'commentId')}`, { fields: COMMENT_FIELDS }),
    },
    {
        name: 'facebook_create_comment',
        description: 'Comment as the Page on a post, or reply to a comment by passing its id.',
        inputSchema: {
            type: 'object',
            properties: {
                pageId: PAGE_ID,
                objectId: { type: 'string', description: 'The post id, or the comment id to reply to.' },
                message: { type: 'string', description: 'The comment text.' },
                imageUrl: { type: 'string', description: 'Public URL of an image to attach.' },
            },
            required: ['pageId', 'objectId'],
        },
        execute: async (args, token) => {
            const message = str(args, 'message')
            const imageUrl = str(args, 'imageUrl')
            if (!message && !imageUrl) throw new Error('Pass a message, an imageUrl, or both')
            return graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'objectId')}/comments`, { message, attachment_url: imageUrl })
        },
    },
    {
        name: 'facebook_update_comment',
        description: 'Edit the text of a comment the Page wrote.',
        inputSchema: {
            type: 'object',
            properties: { pageId: PAGE_ID, commentId: { type: 'string', description: 'The comment to edit.' }, message: { type: 'string', description: 'The new text.' } },
            required: ['pageId', 'commentId', 'message'],
        },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'commentId')}`, { message: requireStr(args, 'message') }),
    },
    {
        name: 'facebook_hide_comment',
        description: "Hide someone else's comment on one of the Page posts (spam, abuse) or show it again. A hidden comment stays visible to its author and their friends only. The Page's own comments cannot be hidden: edit or delete them instead.",
        inputSchema: {
            type: 'object',
            properties: { pageId: PAGE_ID, commentId: { type: 'string', description: 'The comment id.' }, hidden: { type: 'boolean', description: 'true to hide, false to show again. Default true.' } },
            required: ['pageId', 'commentId'],
        },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'commentId')}`, { is_hidden: bool(args, 'hidden') ?? true }),
    },
    {
        name: 'facebook_delete_comment',
        description: 'Permanently delete a comment on one of the Page posts. Irreversible: prefer facebook_hide_comment for moderation.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, commentId: { type: 'string', description: 'The comment to delete.' } }, required: ['pageId', 'commentId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'DELETE', `/${id(args, 'commentId')}`),
    },
    {
        name: 'facebook_like',
        description: 'Like a post or comment as the Page.',
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, objectId: { type: 'string', description: 'The post or comment id.' } }, required: ['pageId', 'objectId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'POST', `/${id(args, 'objectId')}/likes`),
    },
    {
        name: 'facebook_unlike',
        description: "Remove the Page's like from a post or comment.",
        inputSchema: { type: 'object', properties: { pageId: PAGE_ID, objectId: { type: 'string', description: 'The post or comment id.' } }, required: ['pageId', 'objectId'] },
        execute: async (args, token) => graph(await pageToken(token, requireStr(args, 'pageId')), 'DELETE', `/${id(args, 'objectId')}/likes`),
    },
]

export const facebookProvider: ManagedProvider = {
    id: 'facebook',
    label: 'Facebook',
    oauth: {
        authorizationEndpoint: `https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`,
        tokenEndpoint: `${GRAPH_BASE}/oauth/access_token`,
        scopes: [],
        clientIdEnv: 'RERUN_FACEBOOK_CLIENT_ID',
        clientSecretEnv: 'RERUN_FACEBOOK_CLIENT_SECRET',
        authorizeParams: { config_id: LOGIN_CONFIG_ID, override_default_response_type: 'true' },
        accountEmail: async accessToken => {
            const data = await graph(accessToken, 'GET', '/me/accounts', { fields: 'name', limit: MAX_PAGE_SIZE }).catch(() => null)
            const names = Array.isArray(data?.data) ? data.data.map(page => (page as { name?: unknown }).name).filter((name): name is string => typeof name === 'string') : []
            return names.length ? names.join(', ') : undefined
        },
    },
    tools,
}
