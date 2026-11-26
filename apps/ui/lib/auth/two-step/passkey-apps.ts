// The mobile apps that may use passkeys on this hub's domain, read from the environment of a hub
// that serves them (Rerun Cloud's); a self-hosted hub names none and answers 404.
//   PASSKEY_IOS_APP_IDS      TEAMID.bundle.id, comma separated
//   PASSKEY_ANDROID_APPS     package:SHA-256 fingerprint of its signing certificate, comma separated
function list(value: string | undefined): string[] {
    return (value ?? '')
        .split(',')
        .map(entry => entry.trim())
        .filter(Boolean)
}

export function iosPasskeyApps(): string[] {
    return list(process.env.PASSKEY_IOS_APP_IDS)
}

export function androidPasskeyApps(): { packageName: string; fingerprint: string }[] {
    return list(process.env.PASSKEY_ANDROID_APPS).flatMap(entry => {
        const separator = entry.indexOf(':')
        if (separator <= 0) return []
        return [{ packageName: entry.slice(0, separator), fingerprint: entry.slice(separator + 1) }]
    })
}
