import { resolveMx, resolveTxt } from 'node:dns/promises'

import type { Collector } from './types'

export type DetectedService = { name: string; evidence: string }

export type DnsFindings = {
    mailProvider: string | null
    mx: string[]
    services: DetectedService[]
    spfIncludes: string[]
    dmarcPolicy: string | null
    txt: string[]
}

const MAIL_PROVIDERS: [RegExp, string][] = [
    [/(google|googlemail)\.com$/i, 'Google Workspace'],
    [/outlook\.com$/i, 'Microsoft 365'],
    [/zoho\.(com|eu|in)$/i, 'Zoho Mail'],
    [/ovh\.net$/i, 'OVH'],
    [/protonmail\.ch$/i, 'Proton Mail'],
    [/messagingengine\.com$/i, 'Fastmail'],
    [/secureserver\.net$/i, 'GoDaddy'],
    [/(ionos|1and1)\./i, 'IONOS'],
    [/gandi\.net$/i, 'Gandi'],
    [/icloud\.com$/i, 'iCloud'],
    [/mimecast\.com$/i, 'Mimecast'],
    [/pphosted\.com$/i, 'Proofpoint'],
    [/mailgun\.org$/i, 'Mailgun'],
    [/o2switch\.net$/i, 'o2switch'],
]

const VERIFICATION_SIGNATURES: [RegExp, string][] = [
    [/^google-site-verification=/i, 'Google Search Console'],
    [/^MS=ms\d+/i, 'Microsoft 365'],
    [/^facebook-domain-verification=/i, 'Meta Business'],
    [/^apple-domain-verification=/i, 'Apple'],
    [/^atlassian-domain-verification=/i, 'Atlassian'],
    [/^adobe-idp-site-verification=/i, 'Adobe'],
    [/^docusign=/i, 'DocuSign'],
    [/^stripe-verification=/i, 'Stripe'],
    [/^slack-domain-verification=/i, 'Slack'],
    [/^(zoom-domain-verification|ZOOM_verify_)/i, 'Zoom'],
    [/^notion-domain-verification=/i, 'Notion'],
    [/^miro-verification=/i, 'Miro'],
    [/^dropbox-domain-verification=/i, 'Dropbox'],
    [/^airtable-verification=/i, 'Airtable'],
    [/^canva-site-verification=/i, 'Canva'],
    [/^figma-domain-verification=/i, 'Figma'],
    [/^openai-domain-verification=/i, 'OpenAI'],
    [/^anthropic-domain-verification/i, 'Anthropic'],
    [/^hubspot-developer-verification=/i, 'HubSpot'],
    [/^pinterest-site-verification=/i, 'Pinterest'],
    [/^twilio-domain-verification=/i, 'Twilio'],
    [/^(brevo-code|sendinblue-code):/i, 'Brevo'],
    [/^klaviyo-site-verification=/i, 'Klaviyo'],
    [/^webexdomainverification/i, 'Webex'],
    [/^teamviewer-sso-verification=/i, 'TeamViewer'],
    [/^yandex-verification:/i, 'Yandex'],
    [/^ahrefs-site-verification_/i, 'Ahrefs'],
    [/^loom-site-verification=/i, 'Loom'],
    [/^postman-domain-verification=/i, 'Postman'],
    [/^onetrust-domain-verification=/i, 'OneTrust'],
    [/^have-i-been-pwned-verification=/i, 'Have I Been Pwned'],
]

const SPF_SENDERS: [RegExp, string][] = [
    [/_spf\.google\.com$/i, 'Google Workspace'],
    [/protection\.outlook\.com$/i, 'Microsoft 365'],
    [/sendgrid\.net$/i, 'SendGrid'],
    [/mailgun\.org$/i, 'Mailgun'],
    [/(servers\.mcsv\.net|mcsv\.net)$/i, 'Mailchimp'],
    [/mandrillapp\.com$/i, 'Mandrill'],
    [/salesforce\.com$/i, 'Salesforce'],
    [/zendesk\.com$/i, 'Zendesk'],
    [/amazonses\.com$/i, 'Amazon SES'],
    [/(brevo|sendinblue)\.com$/i, 'Brevo'],
    [/hubspotemail\.net$/i, 'HubSpot'],
    [/mktomail\.com$/i, 'Marketo'],
    [/mailjet\.com$/i, 'Mailjet'],
    [/helpscoutemail\.com$/i, 'Help Scout'],
    [/intercom\.io$/i, 'Intercom'],
    [/freshdesk\.com$/i, 'Freshdesk'],
    [/createsend\.com$/i, 'Campaign Monitor'],
    [/klaviyo/i, 'Klaviyo'],
    [/messagingengine\.com$/i, 'Fastmail'],
    [/zoho\.(com|eu)$/i, 'Zoho'],
    [/ovh\.com$/i, 'OVH'],
    [/(mtasv\.net|postmarkapp\.com)$/i, 'Postmark'],
    [/shopify\.com$/i, 'Shopify'],
    [/pipedrive/i, 'Pipedrive'],
    [/lemlist/i, 'lemlist'],
]

type DnsRecords = { mx: string[]; txt: string[]; dmarc: string[] }

export function readDnsRecords({ mx, txt, dmarc }: DnsRecords): DnsFindings {
    const services = new Map<string, DetectedService>()
    const add = (name: string, evidence: string) => {
        if (!services.has(name)) services.set(name, { name, evidence })
    }

    const mailProvider = mx.map(host => MAIL_PROVIDERS.find(([pattern]) => pattern.test(host))?.[1]).find(Boolean) ?? null
    if (mailProvider) add(mailProvider, 'MX')

    const spf = txt.find(record => /^v=spf1/i.test(record))
    const spfIncludes = spf ? [...spf.matchAll(/include:(\S+)/gi)].map(match => match[1].toLowerCase()) : []
    for (const include of spfIncludes) {
        const sender = SPF_SENDERS.find(([pattern]) => pattern.test(include))?.[1]
        if (sender) add(sender, `SPF include:${include}`)
    }

    for (const record of txt) {
        const known = VERIFICATION_SIGNATURES.find(([pattern]) => pattern.test(record))?.[1]
        if (known) {
            add(known, 'TXT')
            continue
        }
        const vendor = record.match(/^([a-z0-9]+(?:[-_][a-z0-9]+)*?)[-_](?:site|domain)[-_]verification/i)?.[1]
        if (vendor) add(vendor, 'TXT')
    }

    const dmarcPolicy = dmarc.find(record => /^v=DMARC1/i.test(record))?.match(/p=(\w+)/i)?.[1] ?? null

    return { mailProvider, mx, services: [...services.values()], spfIncludes, dmarcPolicy, txt: txt.filter(record => record !== spf) }
}

async function txtRecords(host: string): Promise<string[]> {
    try {
        return (await resolveTxt(host)).map(chunks => chunks.join(''))
    } catch {
        return []
    }
}

export const dnsCollector: Collector<'dns'> = {
    id: 'dns',
    needs: [],
    async run({ input }) {
        const [mx, txt, dmarc] = await Promise.all([
            resolveMx(input.domain)
                .then(records => records.sort((a, b) => a.priority - b.priority).map(record => record.exchange))
                .catch(() => [] as string[]),
            txtRecords(input.domain),
            txtRecords(`_dmarc.${input.domain}`),
        ])
        const data = readDnsRecords({ mx, txt, dmarc })
        return {
            data,
            highlights: [
                `Messagerie : ${data.mailProvider ?? (mx.length ? mx[0] : 'aucun MX')}`,
                data.services.length ? `Services : ${data.services.map(service => service.name).join(', ')}` : 'Aucun service détecté',
                `DMARC : ${data.dmarcPolicy ?? 'absent'}`,
            ],
        }
    },
}
