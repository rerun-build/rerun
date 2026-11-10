export const CHATGPT_SECURITY_URL = 'https://chatgpt.com/#settings/Security'

// OpenAI refuses the code on its own page while the setting is off, and we only ever see the wait
// go on: past this, the wait is more likely that than a slow user.
export const STUCK_AFTER_MS = 30_000
