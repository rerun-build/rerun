export const SECRET_PATTERNS: { label: string; re: RegExp }[] = [
    { label: 'Anthropic API key', re: /\bsk-ant-[A-Za-z0-9_-]{20,}/ },
    { label: 'OpenAI API key', re: /\bsk-(?:proj-)?[A-Za-z0-9]{32,}/ },
    { label: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/ },
    { label: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{30,}/ },
    { label: 'Google API key', re: /\bAIza[A-Za-z0-9_-]{30,}/ },
    { label: 'Stripe key', re: /\b[rs]k_(?:live|test)_[A-Za-z0-9]{20,}/ },
    { label: 'AWS access key id', re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
    { label: 'Private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
    { label: 'Bearer token', re: /\bBearer\s+[A-Za-z0-9._-]{24,}/ },
]

export function scanTextForSecrets(text: string): string[] {
    if (!text) return []
    return SECRET_PATTERNS.filter(({ re }) => re.test(text)).map(({ label }) => label)
}

export const SENSITIVE_PATH_PATTERNS: { label: string; re: RegExp }[] = [
    { label: 'Secrets folder', re: /(^|\/)\.(secrets|ssh|aws|gnupg)(\/|$)/ },
    { label: 'Env file', re: /(^|\/)\.env(\.|$)/ },
    { label: 'Credential file', re: /(cookie|credential|password|client[-_]secret|service[-_]account)/i },
    { label: 'Private key file', re: /\.(pem|p12|pfx|key)$|(^|\/)id_(rsa|ed25519|ecdsa)$/ },
]

export function scanPathForSecrets(path: string): string[] {
    if (!path) return []
    return SENSITIVE_PATH_PATTERNS.filter(({ re }) => re.test(path)).map(({ label }) => label)
}
