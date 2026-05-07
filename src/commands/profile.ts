import path from 'path'
import chalk from 'chalk'
import { loadProfiles, saveProfile, removeProfile, getProfile } from '../profiles'
import { print } from '../output'

export function profileAddCommand(options: { name: string; file: string; serialCol: string; vendorCol?: string }): void {
  if (!options.file.endsWith('.xlsx')) {
    print.error(`File must be an .xlsx file: ${options.file}`)
    process.exit(1)
  }

  const absPath = path.resolve(options.file)

  if (getProfile(options.name)) {
    print.error(`Profile '${options.name}' already exists. Use \`profile edit\` to update it.`)
    process.exit(1)
  }

  saveProfile({ name: options.name, file: absPath, serialCol: options.serialCol, vendorCol: options.vendorCol ?? null })
  print.success(`Profile '${options.name}' saved.`)
}

export function profileListCommand(): void {
  const profiles = loadProfiles()
  if (!profiles.length) {
    console.log('No profiles saved.')
    return
  }

  console.log(chalk.bold('Saved Profiles'))
  console.log(chalk.dim('──────────────'))
  for (const p of profiles) {
    const vendorPart = p.vendorCol ? `  ${chalk.dim(`Vendor: "${p.vendorCol}"`)}` : ''
    console.log(
      `${chalk.bold(p.name.padEnd(14))} ${chalk.dim(p.file.padEnd(40))} ${chalk.dim(`Serial: "${p.serialCol}"`)}${vendorPart}`
    )
  }
}

export function profileEditCommand(options: { name: string; file?: string; serialCol?: string; vendorCol?: string }): void {
  const existing = getProfile(options.name)
  if (!existing) {
    print.error(`Profile '${options.name}' not found.`)
    process.exit(1)
  }

  const updated = {
    ...existing,
    ...(options.file !== undefined ? { file: path.resolve(options.file) } : {}),
    ...(options.serialCol !== undefined ? { serialCol: options.serialCol } : {}),
    ...(options.vendorCol !== undefined ? { vendorCol: options.vendorCol } : {}),
  }

  saveProfile(updated)
  print.success(`Profile '${options.name}' updated.`)
}

export function profileRemoveCommand(options: { name: string }): void {
  if (!getProfile(options.name)) {
    print.error(`Profile '${options.name}' not found.`)
    process.exit(1)
  }

  removeProfile(options.name)
  print.success(`Profile '${options.name}' removed.`)
}
