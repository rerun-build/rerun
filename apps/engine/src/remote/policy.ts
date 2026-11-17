import { analyzeCommand, shellOfComputer, type CommandAnalysis, type RemoteComputerView } from '@rerun/contracts'

export type CommandVerdict = { allowed: boolean; analysis: CommandAnalysis }

// What a computer's settings let through without a card. `ask` lets nothing through; `remember`
// lets a command through when every program it starts was always allowed and it hides nothing;
// `full` lets everything through. What never runs (command-policy.ts) is decided before this.
export function commandVerdict(view: Pick<RemoteComputerView, 'settings' | 'facts'>, command: string): CommandVerdict {
    const analysis = analyzeCommand(command, shellOfComputer(view.facts?.shell))
    const { mode, allowedPrograms } = view.settings
    if (mode === 'full') return { allowed: true, analysis }
    if (mode === 'ask' || analysis.opaque || analysis.programs.length === 0) return { allowed: false, analysis }
    const allowed = new Set(allowedPrograms.map(program => program.toLowerCase()))
    return { allowed: analysis.programs.every(program => allowed.has(program)), analysis }
}
