// Everything that fetches a URL just to describe it: chat unfurlers, mail scanners, and the macOS
// clipboard managers (Raycast, Paste, Maccy) that preview any link the moment it is copied.
const PREVIEW_AGENTS = /slackbot|discordbot|twitterbot|facebookexternalhit|whatsapp|telegrambot|linkedinbot|redditbot|skypeuripreview|bingpreview|embedly|quicklook|raycast|paste\/|maccy|iframely|opengraph|metainspector|linkpreview|unfurl|preview|crawler|spider|bot\b/i

// Only meaningful for a GET: chat servers (Mattermost-Bot, Slackbot) announce themselves as bots when
// they POST a real webhook. A GET that reached the URL on its own must never start a run.
export function isPassiveVisit(headers: Headers): boolean {
    const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''} ${headers.get('x-purpose') ?? ''} ${headers.get('x-moz') ?? ''}`
    if (/prefetch|prerender|preview/i.test(purpose)) return true
    const destination = headers.get('sec-fetch-dest')
    if (destination && destination !== 'empty') return true
    return PREVIEW_AGENTS.test(headers.get('user-agent') ?? '')
}
