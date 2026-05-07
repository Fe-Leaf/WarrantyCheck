import { Command } from 'commander'
import chalk from 'chalk'
import { vendorsCommand } from './commands/vendors'
import { lookupCommand } from './commands/lookup'
import { bulkCommand } from './commands/bulk'
import { expiringCommand } from './commands/expiring'
import { summaryCommand } from './commands/summary'
import { statusCommand } from './commands/status'
import { configSetCommand, configShowCommand } from './commands/config'
import { reportCommand } from './commands/report'
import { profileAddCommand, profileListCommand, profileEditCommand, profileRemoveCommand } from './commands/profile'

// playwright-extra stealth plugin fires async CDP calls that may race with browser.close().
// Those rejections are benign; suppress only them to avoid crashing the process.
process.on('unhandledRejection', (err) => {
  if (err instanceof Error && err.message.includes('browser has been closed')) return
  if (err instanceof Error && err.message.includes('Target page, context or browser has been closed')) return
  throw err
})

const program = new Command()

program
  .name('warrantycheck')
  .description('Device warranty status checker for Dell, HP, and Lenovo')
  .version('0.1.0')
  .option('--no-color', 'Disable colored output')
  .hook('preAction', (cmd) => {
    if (cmd.opts().color === false) chalk.level = 0
  })

program
  .command('lookup <serial> [serials...]')
  .description('Look up warranty for one or more devices (max 10)')
  .option('-v, --vendor <vendor>', 'Vendor: dell, hp, lenovo (auto-detected if omitted)')
  .option('--json', 'Output as JSON')
  .option('-q, --quiet', 'Output expiration date only')
  .option('--no-headless', 'Show browser window (debug)')
  .action(async (serial, rest, options) => { await lookupCommand([serial, ...rest], options) })

program
  .command('bulk [file]')
  .description('Check warranty for all devices in a CSV or XLSX file')
  .option('-o, --output <path>', 'Output CSV path', 'warranty-results.csv')
  .option('--json', 'Output as JSON array instead of CSV')
  .option('-d, --delay <ms>', 'Delay between requests per vendor stream (ms)')
  .option('-v, --vendor <vendor>', 'Force vendor for all rows: dell, hp, lenovo (auto-detected per row if omitted)')
  .option('--no-headless', 'Show browser window (debug)')
  .option('--serial-col <name>', 'Serial number column name (required for xlsx)')
  .option('--vendor-col <name>', 'Vendor column name (xlsx only)')
  .option('--profile <name>', 'Use a saved profile')
  .option('--all', 'Run across all saved profiles')
  .action(async (file, options) => { await bulkCommand(file, options) })

program
  .command('expiring [results]')
  .description('Show devices expiring within N days')
  .option('-d, --days <days>', 'Days to look ahead', '90')
  .option('-o, --output <path>', 'Output file (default: stdout)')
  .option('--json', 'Output as JSON')
  .option('--profile <name>', 'Use a saved profile')
  .option('--all', 'Run across all saved profiles')
  .action(async (results, options) => { await expiringCommand(results, options) })

program
  .command('summary [results]')
  .description('Show fleet warranty summary')
  .option('--json', 'Output as JSON')
  .option('--profile <name>', 'Use a saved profile')
  .option('--all', 'Run across all saved profiles')
  .action(async (results, options) => { await summaryCommand(results, options) })

program
  .command('status')
  .description('Show configuration status')
  .option('--json', 'Output as JSON')
  .action((options) => { statusCommand(options) })

const configCmd = program.command('config').description('View or update local configuration')

configCmd
  .command('set')
  .description('Set configuration values')
  .option('--dell-client-id <id>',     'Dell TechDirect API client ID')
  .option('--dell-client-secret <secret>', 'Dell TechDirect API client secret')
  .option('--delay <ms>',              'Default delay between requests (ms)')
  .action((options) => { configSetCommand(options) })

configCmd
  .command('show')
  .description('Show current configuration')
  .option('--json', 'Output as JSON')
  .action((options) => { configShowCommand(options) })

program
  .command('report [file]')
  .description('Generate HTML warranty report')
  .option('-o, --output <path>', 'Output HTML file (required)')
  .option('--profile <name>', 'Use a saved profile')
  .option('--all', 'Run across all profiles')
  .action(async (file, options) => { await reportCommand(file, options) })

const profileCmd = program.command('profile').description('Manage client profiles')

profileCmd
  .command('add')
  .description('Add a client profile')
  .requiredOption('--name <name>', 'Profile name')
  .requiredOption('--file <path>', 'Path to xlsx file')
  .requiredOption('--serial-col <name>', 'Serial number column name')
  .option('--vendor-col <name>', 'Vendor column name')
  .action((options) => { profileAddCommand(options) })

profileCmd
  .command('list')
  .description('List all profiles')
  .action(() => { profileListCommand() })

profileCmd
  .command('edit')
  .description('Edit a profile')
  .requiredOption('--name <name>', 'Profile name')
  .option('--file <path>', 'New file path')
  .option('--serial-col <name>', 'New serial column name')
  .option('--vendor-col <name>', 'New vendor column name')
  .action((options) => { profileEditCommand(options) })

profileCmd
  .command('remove')
  .description('Remove a profile')
  .requiredOption('--name <name>', 'Profile name')
  .action((options) => { profileRemoveCommand(options) })

program
  .command('vendors')
  .description('List supported vendors')
  .option('--json', 'Output as JSON')
  .action((options) => vendorsCommand(options))

program.parse()
