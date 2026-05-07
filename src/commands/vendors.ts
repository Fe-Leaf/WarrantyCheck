import chalk from 'chalk'
import { SUPPORTED_VENDORS } from '../scrapers/index'

export function vendorsCommand(options: { json?: boolean }): void {
  if (options.json) {
    console.log(JSON.stringify(SUPPORTED_VENDORS, null, 2))
    return
  }

  console.log('Supported vendors:')
  for (const { vendor, requiresAuth, description } of SUPPORTED_VENDORS) {
    const authNote = requiresAuth ? chalk.yellow(' (requires: warrantycheck auth ' + vendor + ')') : ''
    console.log(`  ${vendor.padEnd(8)}— ${description}${authNote}`)
  }
}
