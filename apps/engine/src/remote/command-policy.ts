// What a coworker never runs on a person's computer, whatever the card says: raising its own
// privileges, and the few commands that wipe a disk or stop the machine. A yes on a card cannot lift
// these; the person runs them themselves if they mean it.

const ELEVATION: RegExp[] = [/(?:^|[\s;&|(`$])sudo\b/i, /(?:^|[\s;&|(`$])doas\b/i, /(?:^|[\s;&|(`$])pkexec\b/i, /(?:^|[\s;&|(`$])su(?:\s+-|\s+root\b|\s*$)/i, /\brunas(?:\.exe)?\s/i, /-verb\s+["']?runas\b/i, /\bgsudo\b/i]

const DESTRUCTIVE: RegExp[] = [
    /\brm\s+(?:-[a-z]*r[a-z]*f[a-z]*|-[a-z]*f[a-z]*r[a-z]*)\s+(?:\/|~\/?|\$HOME\/?)(?:\s|$|\*)/i,
    /\bmkfs(?:\.\w+)?\b/i,
    /\b(?:shutdown|halt|poweroff|reboot|kexec)\b/i,
    /\b(?:tel)?init\s+[06]\b/,
    /sysrq-trigger/,
    /\bdd\s+[^|;&]*of=\/dev\//i,
    /:\(\)\s*\{/,
    /\bchown\s+-R\s+\S+\s+\/(?:\s|$)/,
    /\bdiskutil\s+(?:erase|zero|secureErase|partitionDisk)/i,
    /\bformat(?:\.com)?\s+[a-z]:/i,
    /\bformat-volume\b/i,
    /\bclear-disk\b/i,
    /\bdiskpart\b/i,
    /\bbcdedit\b/i,
    /\bremove-item\b[^|;]*-recurse[^|;]*\s["']?[a-z]:\\?["']?(?:\s|$)/i,
    /\breg(?:\.exe)?\s+delete\s+hklm\b/i,
    /\bstop-computer\b|\brestart-computer\b/i,
    /\bcipher\s+\/w\b/i,
    /\bvssadmin\s+delete\b/i,
]

// Null when the command may go to the card; else why it never runs.
export function refusedCommand(command: string): string | null {
    if (ELEVATION.some(pattern => pattern.test(command))) return 'it asks for administrator rights (sudo, runas, UAC), which a coworker never takes on a computer'
    if (DESTRUCTIVE.some(pattern => pattern.test(command))) return 'it can wipe a disk or stop the computer'
    return null
}
