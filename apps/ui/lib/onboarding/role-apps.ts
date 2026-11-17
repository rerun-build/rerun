// The apps someone in a role works in, lit on the onboarding board once they say what they do. The
// roles are free text (a tile, or what they typed under "Something else"), so they are matched on
// the words they hold rather than looked up.
const ROLE_APPS: [RegExp, string[]][] = [
    [/founder|owner|ceo|partner|principal/i, ['gmail', 'google-calendar', 'slack', 'notion', 'google-sheets', 'hubspot']],
    [/marketing|growth|creative|demand|community|social|editor|writer|content/i, ['instagram', 'linkedin', 'meta-ads', 'tiktok', 'mailchimp', 'klaviyo', 'x', 'notion', 'youtube', 'wordpress']],
    [/sales|account|business|sponsor|agent\b|broker/i, ['hubspot', 'salesforce', 'pipedrive', 'linkedin', 'calendly', 'gmail']],
    [/support|care|success/i, ['gmail', 'intercom', 'zendesk', 'shopify', 'hubspot']],
    [/product|engineering|developer|cto/i, ['linear', 'notion', 'github', 'jira', 'slack']],
    [/operation|logistic|finance|admin|project|paralegal|property|accountant|bookkeep/i, ['google-sheets', 'slack', 'stripe', 'notion', 'google-calendar', 'quickbooks', 'xero']],
    [/recruit|talent|\bhr\b|people/i, ['linkedin', 'calendly', 'airtable', 'gmail', 'greenhouse']],
    [/lawyer|counsel|legal|compliance/i, ['docusign', 'google-drive', 'google-docs', 'gmail']],
]

export function appsOfRole(role: string): string[] {
    const said = role.trim()
    if (!said) return []
    return ROLE_APPS.find(([pattern]) => pattern.test(said))?.[1] ?? []
}
