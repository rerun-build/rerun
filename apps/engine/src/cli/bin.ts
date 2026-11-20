#!/usr/bin/env node
import '../lib/process-report.js'
import { runCommand } from './commands/run.js'
import { migrateCommand } from './commands/migrate.js'
import { agentCommand } from './commands/agent.js'
import { skillCommand } from './commands/skill.js'
import { scheduleCommand } from './commands/schedule.js'
import { mcpCommand } from './commands/mcp.js'
import { doctorCommand } from './commands/doctor.js'
import { installBrowserCommand, installDesktop, installLayoutCommand, installPip, rollbackCommand, updateCliTools, updateCommand } from './commands/update.js'
import { serviceCommand } from './commands/service.js'
import { restoreFinalizeCommand } from './commands/restore-finalize.js'

const HELP = `rerun-engine

Usage:
  rerun run                       Start the API server
  rerun migrate                   Create or update the database
  rerun restore-finalize          Migrate a restored data-dir, skip the runs it slept through
  rerun agent create --name <n>   Create an agent
  rerun agent list                List agents
  rerun agent delete <id>         Delete an agent
  rerun skill list <agentId>      List an agent's skills
  rerun schedule list <agentId>   List an agent's scheduled tasks
  rerun mcp login <id> <server>   Sign in to an OAuth MCP server
  rerun mcp status <agentId>      Check MCP server connections
  rerun mcp logout <id> <server>  Clear a stored MCP token
  rerun doctor                    Check the environment
  rerun update                    Pull, rebuild, migrate and restart the service (git checkout)
  rerun update --artifact <url> --sha256 <hex> --commit <sha>
                                  Install a prebuilt release, migrate and restart the service
  rerun rollback                  Go back to the previous release and restart the service
  rerun install-layout            Write the launcher and the systemd units for the release layout
  rerun install-browser           Install Chromium for the browser tool
  rerun install-desktop           Install the window manager and VNC server behind the Computer
  rerun install-pip               Install pip, so the coworkers can add the Python libraries they need
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
        case 'agent':
            return agentCommand(rest)
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
        case 'install-pip':
            return installPip()
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
