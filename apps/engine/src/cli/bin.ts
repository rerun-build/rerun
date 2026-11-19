#!/usr/bin/env node
import '../config/key-intake.js'
import '../lib/process-report.js'
import { runCommand } from './commands/run.js'
import { migrateCommand } from './commands/migrate.js'
import { agentCommand } from './commands/agent.js'
import { skillCommand } from './commands/skill.js'
import { scheduleCommand } from './commands/schedule.js'
import { mcpCommand } from './commands/mcp.js'
import { doctorCommand } from './commands/doctor.js'
import { installBrowserCommand, installDesktop, installLayoutCommand, rollbackCommand, updateCliTools, updateCommand } from './commands/update.js'
import { serviceCommand } from './commands/service.js'
import { restoreFinalizeCommand } from './commands/restore-finalize.js'
import { snapshotCommand } from './commands/snapshot.js'
import { redactCommand } from './commands/redact.js'
import { sharedEnvCommand } from './commands/shared-env.js'

const HELP = `rerun-engine

Usage:
  rerun run                       Start the API server
  rerun migrate                   Create or update the database
  rerun restore-finalize          Migrate a restored data-dir, skip the runs it slept through
  rerun snapshot [--keep N]       Copy every coworker database to backups/ and check the copies
  rerun agent create --name <n>   Create an agent
  rerun agent list                List agents
  rerun agent delete <id>         Delete an agent
  rerun redact <agentId>          Remove a value read from stdin from a coworker's run history
  rerun shared-env list           List the shared variables every coworker gets (values are not shown)
  rerun shared-env set <NAME>     Set a shared variable (value from stdin)
  rerun shared-env remove <NAME>  Remove a shared variable
  rerun shared-env run <cmd> [args]  Run a command with the shared variables
  rerun skill list <agentId>      List an agent's skills
  rerun schedule list <agentId>   List an agent's scheduled tasks
  rerun mcp login <id> <server>   Sign in to an OAuth MCP server
  rerun mcp status <agentId>      Check MCP server connections
  rerun mcp logout <id> <server>  Clear a stored MCP token
  rerun mcp set-all <server>       Replace that MCP server on every coworker that has it (JSON on stdin)
  rerun doctor                    Check the environment
  rerun update                    Pull, rebuild, migrate and restart the service (git checkout)
  rerun update --artifact <url> --sha256 <hex> --commit <sha>
                                  Install a prebuilt release, migrate and restart the service
  rerun rollback                  Go back to the previous release and restart the service
  rerun install-layout            Write the launcher and the systemd units for the release layout
  rerun install-browser           Install Chromium for the browser tool
  rerun install-desktop           Install the window manager and VNC server behind the Computer
  rerun update-cli-tools          Install the Codex CLI this release pins
  rerun start | stop | restart    Control the systemd service
  rerun status                    Show the service status
  rerun logs [--no-follow]        Tail the service logs
`

async function main() {
    const [command, ...rest] = process.argv.slice(2)
    switch (command) {
        case 'run':
            return runCommand()
        case 'migrate':
            return migrateCommand()
        case 'restore-finalize':
            return restoreFinalizeCommand()
        case 'snapshot':
            return snapshotCommand(rest)
        case 'agent':
            return agentCommand(rest)
        case 'redact':
            return redactCommand(rest)
        case 'shared-env':
            return sharedEnvCommand(rest)
        case 'skill':
            return skillCommand(rest)
        case 'schedule':
            return scheduleCommand(rest)
        case 'mcp':
            return mcpCommand(rest)
        case 'doctor':
            return doctorCommand()
        case 'update':
            return updateCommand(rest)
        case 'rollback':
            return rollbackCommand()
        case 'install-layout':
            return installLayoutCommand()
        case 'install-browser':
            return installBrowserCommand()
        case 'install-desktop':
            return installDesktop()
        case 'update-cli-tools':
            return updateCliTools()
        case 'start':
        case 'stop':
        case 'restart':
        case 'status':
        case 'logs':
            return serviceCommand(command, rest)
        case undefined:
        case 'help':
        case '--help':
        case '-h':
            process.stdout.write(HELP)
            return
        default:
            process.stderr.write(`Unknown command: ${command}\n\n${HELP}`)
            process.exitCode = 1
    }
}

main().catch(err => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`)
    process.exitCode = 1
})
