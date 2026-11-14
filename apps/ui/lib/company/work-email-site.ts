import { companySiteUrl } from './firecrawl'

const PERSONAL_DOMAINS = new Set(['gmail.com', 'googlemail.com', 'icloud.com', 'me.com', 'mac.com', 'aol.com', 'proton.me', 'pm.me', 'hey.com', 'fastmail.com', 'zoho.com', 'qq.com', '163.com', '126.com', 'naver.com', 'daum.net', 'web.de', 'mail.ru', 'bk.ru', 'inbox.ru', 'list.ru', 'yandex.ru', 'ya.ru', 'orange.fr', 'wanadoo.fr', 'free.fr', 'sfr.fr', 'laposte.net', 'bbox.fr', 'neuf.fr', 'skynet.be', 'telenet.be', 'libero.it', 'virgilio.it', 'tiscali.it', 'btinternet.com', 'comcast.net', 'verizon.net', 'att.net', 'sbcglobal.net', 'bigpond.com', 'uol.com.br', 'bol.com.br', 'terra.com.br', 'rediffmail.com'])
const PERSONAL_LABELS = new Set(['yahoo', 'ymail', 'hotmail', 'outlook', 'live', 'msn', 'gmx', 'protonmail', 'yandex', 'mail', 'email', 'tutanota', 'tuta'])

export function workEmailSite(email: string | null | undefined): string | null {
    const domain = email?.split('@')[1]?.trim().toLowerCase()
    if (!domain) return null
    if (PERSONAL_DOMAINS.has(domain) || PERSONAL_LABELS.has(domain.split('.')[0])) return null
    return companySiteUrl(domain)
}
