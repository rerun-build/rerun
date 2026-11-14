const WALL_MAX_TEXT_LENGTH = 3_000

const WALLS: Array<BotWall & { marker: RegExp }> = [
    { provider: 'Cloudflare', clearsByItself: true, marker: /<title>\s*just a moment\.\.\.|cf-chl-|checking your browser before|verify(ing)? you are human|additional verification required/i },
    { provider: 'DataDome', clearsByItself: true, marker: /captcha-delivery\.com/i },
    { provider: 'PerimeterX', clearsByItself: true, marker: /px-captcha/i },
    { provider: 'Imperva', clearsByItself: true, marker: /pardon our interruption|_incapsula_resource/i },
    { provider: 'Reddit', clearsByItself: false, marker: /blocked by network security|whoa there, pardner|prove your humanity/i },
    { provider: 'Google', clearsByItself: false, marker: /\/sorry\/index|our systems have detected unusual traffic/i },
    { provider: 'Amazon', clearsByItself: false, marker: /enter the characters you see below/i },
]

export type BotWall = { provider: string; clearsByItself: boolean }

export type PageSnapshot = { html: string; text: string }

export function detectBotWall({ html, text }: PageSnapshot): BotWall | null {
    if (text.length > WALL_MAX_TEXT_LENGTH) return null
    const wall = WALLS.find(({ marker }) => marker.test(html) || marker.test(text))
    return wall ? { provider: wall.provider, clearsByItself: wall.clearsByItself } : null
}
