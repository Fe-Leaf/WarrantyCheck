import chalk from 'chalk'
import { loadConfig, saveConfig } from '../config'
import { print } from '../output'

interface ConfigSetOptions {
  dellClientId?: string
  dellClientSecret?: string
  delay?: string
}

export function configSetCommand(options: ConfigSetOptions): void {
  if (!options.dellClientId && !options.dellClientSecret && !options.delay) {
    print.error('No options provided. See: warrantycheck config set --help')
    process.exit(1)
  }

  const updates: Parameters<typeof saveConfig>[0] = {}

  if (options.dellClientId)     updates.dellClientId     = options.dellClientId
  if (options.dellClientSecret) updates.dellClientSecret = options.dellClientSecret
  if (options.delay) {
    const ms = parseInt(options.delay, 10)
    if (isNaN(ms) || ms < 0) {
      print.error('--delay must be a positive number of milliseconds')
      process.exit(1)
    }
    updates.delay = ms
  }

  saveConfig(updates)
  print.success('Config updated.')
}

export function configShowCommand(options: { json?: boolean }): void {
  const config = loadConfig()

  if (options.json) {
    console.log(JSON.stringify({
      delay:            config.delay,
      dellClientId:     config.dellClientId ?? null,
      dellClientSecret: config.dellClientSecret ? '***' : null,
    }, null, 2))
    return
  }

  console.log(`${chalk.dim('Delay:')}           ${config.delay}ms`)
  console.log(`${chalk.dim('Dell client ID:')}  ${config.dellClientId ?? chalk.dim('(not set)')}`)
  console.log(`${chalk.dim('Dell secret:')}     ${config.dellClientSecret ? '***' : chalk.dim('(not set)')}`)
}
