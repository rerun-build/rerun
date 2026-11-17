import { execFile } from 'node:child_process'
import { access, constants } from 'node:fs/promises'
import { arch, cpus, homedir, hostname, release, totalmem } from 'node:os'
import { delimiter, join } from 'node:path'
import type { RemoteFacts, RemoteOs } from '@rerun/contracts'

// The programs a coworker most often reaches for on a computer, looked up on the PATH so it knows
// what it can run before it tries.
const WATCHED_PROGRAMS = ['ffmpeg', 'ffprobe', 'python3', 'python', 'node', 'npm', 'git', 'docker', 'blender', 'magick', 'yt-dlp', 'ollama', 'nvidia-smi', 'pandoc', 'soffice', 'brew', 'winget', 'choco', 'code', 'unity', 'davinci-resolve']

export function osOf(platform: NodeJS.Platform): RemoteOs {
    if (platform === 'win32') return 'win'
    return platform === 'darwin' ? 'mac' : 'linux'
}

function run(program: string, args: string[], timeoutMs = 4_000): Promise<string> {
    return new Promise(resolve => {
        execFile(program, args, { timeout: timeoutMs, windowsHide: true, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 }, (err, stdout) => resolve(err ? '' : stdout))
    })
}

export async function findOnPath(program: string, env: NodeJS.ProcessEnv, platform: NodeJS.Platform = process.platform): Promise<boolean> {
    const dirs = (env.PATH ?? env.Path ?? '').split(platform === 'win32' ? ';' : delimiter).filter(Boolean)
    const names = platform === 'win32' ? ['.exe', '.cmd', '.bat', '.com'].map(ext => `${program}${ext}`) : [program]
    for (const dir of dirs) {
        for (const name of names) {
            try {
                await access(join(dir, name), platform === 'win32' ? constants.F_OK : constants.X_OK)
                return true
            } catch {
                // Not in this folder.
            }
        }
    }
    return false
}

async function osVersion(platform: NodeJS.Platform): Promise<string> {
    if (platform === 'darwin') return (await run('sw_vers', ['-productVersion'])).trim() || release()
    if (platform === 'linux') {
        const pretty = /^PRETTY_NAME="?([^"\n]+)"?/m.exec(await run('cat', ['/etc/os-release']))
        return pretty?.[1] ?? release()
    }
    return release()
}

async function gpus(platform: NodeJS.Platform): Promise<string[]> {
    if (platform === 'darwin') {
        try {
            const data = JSON.parse(await run('system_profiler', ['SPDisplaysDataType', '-json'], 6_000)) as { SPDisplaysDataType?: { sppci_model?: string }[] }
            return (data.SPDisplaysDataType ?? []).flatMap(gpu => (gpu.sppci_model ? [gpu.sppci_model] : []))
        } catch {
            return []
        }
    }
    if (platform === 'win32') {
        const out = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'], 6_000)
        return out.split(/\r?\n/).map(line => line.trim()).filter(Boolean)
    }
    const nvidia = await run('nvidia-smi', ['--query-gpu=name', '--format=csv,noheader'])
    if (nvidia.trim()) return nvidia.split('\n').map(line => line.trim()).filter(Boolean)
    return (await run('sh', ['-c', 'lspci 2>/dev/null | grep -Ei "vga|3d controller" | cut -d: -f3-']))
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
}

export async function readFacts(options: { env: NodeJS.ProcessEnv; workDir: string; shell: string; platform?: NodeJS.Platform }): Promise<RemoteFacts> {
    const platform = options.platform ?? process.platform
    const [version, cards, found] = await Promise.all([osVersion(platform), gpus(platform), Promise.all(WATCHED_PROGRAMS.map(async program => ((await findOnPath(program, options.env, platform)) ? program : null)))])
    return {
        hostname: hostname().slice(0, 255),
        os: osOf(platform),
        osVersion: version.slice(0, 100),
        arch: arch(),
        cpu: cpus()[0]?.model?.trim().slice(0, 200),
        cores: cpus().length,
        memoryBytes: totalmem(),
        gpus: cards.slice(0, 8).map(card => card.slice(0, 200)),
        shell: options.shell.slice(0, 32),
        homeDir: homedir(),
        workDir: options.workDir,
        software: found.filter((program): program is string => program !== null),
    }
}
