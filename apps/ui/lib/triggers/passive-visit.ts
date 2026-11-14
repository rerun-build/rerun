const PREVIEW_AGENTS = /slackbot|discordbot|twitterbot|facebookexternalhit|whatsapp|telegrambot|linkedinbot|redditbot|skypeuripreview|bingpreview|embedly|quicklook|raycast|paste\/|maccy|iframely|opengraph|metainspector|linkpreview|unfurl|preview|crawler|spider|bot\b/i

export function isPassiveVisit(headers: Headers): boolean {
    const purpose = `${headers.get('sec-purpose') ?? ''} ${headers.get('purpose') ?? ''} ${headers.get('x-purpose') ?? ''} ${headers.get('x-moz') ?? ''}`
    if (/prefetch|prerender|preview/i.test(purpose)) return true
    const destination = headers.get('sec-fetch-dest')
    if (destination && destination !== 'empty') return true
    return PREVIEW_AGENTS.test(headers.get('user-agent') ?? '')
}
