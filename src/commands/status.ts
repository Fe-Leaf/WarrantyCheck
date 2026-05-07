import chalk from 'chalk'
import { loadConfig } from '../config'

export function statusCommand(options: { json?: boolean }): void {
  const config = loadConfig()

  if (options.json) {
    console.log(JSON.stringify({
      dellApiConfigured: !!(config.dellClientId && config.dellClientSecret),
      delay: config.delay,
    }, null, 2))
    return
  }

  const dellKey = config.dellClientId && config.dellClientSecret
  if (dellKey) {
    console.log(`Dell API:    ${chalk.green('custom key')}`)
  } else {
    console.log(`Dell API:    ${chalk.dim('using default')}`)
  }
  console.log(`Delay:       ${config.delay}ms`)
}
