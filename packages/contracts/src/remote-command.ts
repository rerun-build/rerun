// What a command on a linked computer runs, read the way the approvals need it: the programs it
// starts, and whether it hides what it runs. Shared by the engine, which decides, and the card, which
// offers "Always allow". It reads, it never runs anything: a command it cannot read is opaque, and an
// opaque command always asks.

export type CommandShell = 'posix' | 'powershell'

export type CommandAnalysis = {
    // The programs it starts, in order, without repeats: `ffmpeg`, `python3`.
    programs: string[]
    // It runs something the reading cannot see: a substitution, a string handed to another shell,
    // a program that starts other programs (xargs, find -exec, env…), a variable set for it, a program
    // named by its path.
    opaque: boolean
    // One of the programs runs any code it is given (python, node…): allowing it allows anything.
    interpreter: boolean
}

// Programs that start other programs from their arguments: allowing them would allow anything.
const RELAYS = new Set([
    'sh', 'bash', 'zsh', 'fish', 'dash', 'ksh', 'csh', 'tcsh', 'cmd', 'powershell', 'pwsh', 'xargs', 'env', 'nohup', 'time', 'nice', 'renice', 'timeout', 'watch', 'exec', 'eval', 'source', '.',
    'parallel', 'ssh', 'start', 'start-process', 'invoke-command', 'invoke-expression', 'iex', 'start-job', 'osascript', 'open', 'script', 'su', 'sudo', 'doas', 'runas', 'stdbuf', 'unbuffer',
    'flock', 'chroot', 'strace', 'gdb', 'busybox', 'command', 'builtin', 'call', 'wsl', 'launchctl', 'systemd-run', 'at', 'crontab', 'schtasks', 'make', 'npx', 'pnpx', 'bunx', 'uvx', 'pipx',
])

const INTERPRETERS = new Set(['python', 'python3', 'python2', 'py', 'node', 'nodejs', 'deno', 'bun', 'ruby', 'perl', 'php', 'lua', 'luajit', 'rscript', 'r', 'julia', 'java', 'jshell', 'groovy', 'scala', 'kotlin', 'swift', 'dotnet', 'awk', 'gawk', 'tclsh', 'wish'])

// PowerShell's own names for programs people know by their Unix name, and the other way round.
const POWERSHELL_ALIASES: Record<string, string> = {
    ls: 'get-childitem', dir: 'get-childitem', gci: 'get-childitem', cat: 'get-content', gc: 'get-content', type: 'get-content', cp: 'copy-item', copy: 'copy-item', cpi: 'copy-item',
    mv: 'move-item', move: 'move-item', mi: 'move-item', rm: 'remove-item', del: 'remove-item', erase: 'remove-item', rd: 'remove-item', rmdir: 'remove-item', ri: 'remove-item',
    echo: 'write-output', write: 'write-output', cd: 'set-location', sl: 'set-location', chdir: 'set-location', pwd: 'get-location', gl: 'get-location', mkdir: 'new-item', md: 'new-item', ni: 'new-item',
    ps: 'get-process', gps: 'get-process', kill: 'stop-process', spps: 'stop-process', curl: 'invoke-webrequest', wget: 'invoke-webrequest', iwr: 'invoke-webrequest', irm: 'invoke-restmethod',
    sort: 'sort-object', select: 'select-object', where: 'where-object', '?': 'where-object', '%': 'foreach-object', foreach: 'foreach-object', saps: 'start-process', sajb: 'start-job', icm: 'invoke-command',
}

// A substitution or a string run as code: the reading stops there.
const POSIX_OPAQUE = [/\$\(/, /`/, /<\(/, />\(/, /\beval\b/]
const POWERSHELL_OPAQUE = [/\$\(/, /\biex\b/i, /invoke-expression/i, /&\s*\{/, /\[scriptblock\]/i, /-encodedcommand\b/i, /-enc\b/i, /\.invoke\(/i, /add-type\b/i]

// `quoted` says the word opened on a quote: `"FOO=1"` is a program name, `FOO="x y"` an assignment.
type Token = { text: string; quoted: boolean }

// The command cut into its simple commands (on `|`, `||`, `&&`, `;`, `&`, a new line), each into
// words, quotes kept together and taken off. Null when a quote is left open: it cannot be read.
function segmentsOf(command: string, shell: CommandShell): Token[][] | null {
    const segments: Token[][] = [[]]
    let word = ''
    let quoted = false
    let inWord = false
    let quote: '"' | "'" | null = null
    const endWord = () => {
        if (inWord) segments[segments.length - 1]!.push({ text: word, quoted })
        word = ''
        quoted = false
        inWord = false
    }
    const endSegment = () => {
        endWord()
        if (segments[segments.length - 1]!.length > 0) segments.push([])
    }
    for (let i = 0; i < command.length; i++) {
        const char = command[i]!
        if (quote) {
            if (char === quote) quote = null
            else if (char === '\\' && quote === '"' && shell === 'posix' && i + 1 < command.length) word += command[++i]
            else if (char === '`' && quote === '"' && shell === 'powershell' && i + 1 < command.length) word += command[++i]
            else word += char
            continue
        }
        if (char === '"' || char === "'") {
            quote = char
            if (!inWord) quoted = true
            inWord = true
            continue
        }
        if (char === '\\' && shell === 'posix' && i + 1 < command.length) {
            word += command[++i]
            inWord = true
            continue
        }
        if (char === '`' && shell === 'powershell' && i + 1 < command.length) {
            word += command[++i]
            inWord = true
            continue
        }
        if (char === '|' || char === ';' || char === '\n' || char === '\r') {
            endSegment()
            if (command[i + 1] === '|' && char === '|') i++
            continue
        }
        // `2>&1`, `>&2`, `&>file`: a redirection, not a second command.
        if (char === '&' && (/[<>]$/.test(word) || command[i + 1] === '>')) {
            word += char
            inWord = true
            continue
        }
        if (char === '&') {
            endSegment()
            if (command[i + 1] === '&') i++
            continue
        }
        if (char === '(' || char === ')') {
            endSegment()
            continue
        }
        // `{ cmd; }` groups commands; `${HOME}` and `{a,b}.mp4` are part of a word.
        if (char === '{' || char === '}') {
            const alone = shell === 'powershell' || (!inWord && (char === '}' || i + 1 >= command.length || /\s/.test(command[i + 1]!)))
            if (alone) {
                endSegment()
                continue
            }
        }
        if (/\s/.test(char)) {
            endWord()
            continue
        }
        word += char
        inWord = true
    }
    if (quote) return null
    endWord()
    return segments.filter(segment => segment.length > 0)
}

const ENV_ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/
const REDIRECTION = /^(?:\d*[<>]|&>)/
// The operator alone, its file in the next word: `> out.txt`, `2>> log`, `<<< text`.
const BARE_REDIRECTION = /^(?:\d*(?:>>?|>\||<<?<?|<>|[<>]&)|&>>?)$/

// The words of a simple command once its redirections are taken off. Without this `> ffmpeg rm x`
// would read as ffmpeg, the file, instead of rm, the program.
function commandWords(segment: Token[]): Token[] {
    const words: Token[] = []
    for (let i = 0; i < segment.length; i++) {
        const token = segment[i]!
        if (token.quoted || !REDIRECTION.test(token.text)) words.push(token)
        else if (BARE_REDIRECTION.test(token.text)) i++
    }
    return words
}

// The name a program is allowed under: its file name, lower case, without the extension Windows adds.
export function programName(word: string, shell: CommandShell = 'posix'): string {
    const base = word.split(/[\\/]/).pop() ?? word
    const lower = base.toLowerCase()
    const name = shell === 'powershell' || /\.(exe|cmd|bat|com|ps1)$/.test(lower) ? lower.replace(/\.(exe|cmd|bat|com|ps1)$/, '') : lower
    return shell === 'powershell' ? (POWERSHELL_ALIASES[name] ?? name) : name
}

export const isInterpreterProgram = (program: string): boolean => INTERPRETERS.has(program.toLowerCase())

export function analyzeCommand(command: string, shell: CommandShell = 'posix'): CommandAnalysis {
    const segments = segmentsOf(command, shell)
    if (!segments) return { programs: [], opaque: true, interpreter: false }
    const opaquePatterns = shell === 'powershell' ? POWERSHELL_OPAQUE : POSIX_OPAQUE
    let opaque = opaquePatterns.some(pattern => pattern.test(command))
    const programs: string[] = []
    for (const segment of segments) {
        const words = commandWords(segment)
        const at = words.findIndex(token => !(shell === 'posix' && !token.quoted && ENV_ASSIGNMENT.test(token.text)))
        // A variable set for the command, or for the ones after it, changes what a program runs
        // (PATH, GIT_SSH_COMMAND, LD_PRELOAD): the same as `env`.
        if (shell === 'posix' && at !== 0) opaque = true
        const first = words[at]
        if (!first) continue
        // A program named by a path or a variable is whatever file sits there: `./ffmpeg` is not ffmpeg.
        if (/[\\/$]/.test(first.text)) opaque = true
        // PowerShell's call operator and a dot-sourced script hide the program in the next word.
        if (shell === 'powershell' && first.text === '.') opaque = true
        const program = programName(first.text, shell)
        if (!program) continue
        if (RELAYS.has(program)) opaque = true
        if (program === 'find' && words.some(token => /^-(exec|execdir|ok|okdir)$/.test(token.text))) opaque = true
        if (program === 'git' && words.some(token => /^(-c|--exec-path|--upload-pack|--config)/.test(token.text))) opaque = true
        if (!programs.includes(program)) programs.push(program)
    }
    return { programs, opaque, interpreter: programs.some(isInterpreterProgram) }
}

export function shellOfComputer(shell: string | undefined): CommandShell {
    return /^(powershell|pwsh)/i.test(shell ?? '') ? 'powershell' : 'posix'
}

// What "Always allow" keeps for one command, when it can keep anything: its one program, never a
// command that hides what it runs. Null when the card can only allow it once.
export function alwaysAllowFor(commands: string[], shell: CommandShell = 'posix'): { program: string; interpreter: boolean } | null {
    if (commands.length === 0) return null
    const analyses = commands.map(command => analyzeCommand(command, shell))
    if (analyses.some(analysis => analysis.opaque)) return null
    const programs = [...new Set(analyses.flatMap(analysis => analysis.programs))]
    if (programs.length !== 1) return null
    return { program: programs[0]!, interpreter: analyses.some(analysis => analysis.interpreter) }
}
