import fs, { writeFileSync } from 'fs'
import { readResultsCsv } from '../csv'
import { readXlsxResults } from '../xlsx'
import { loadProfiles, getProfile } from '../profiles'
import { formatResults, warnIfStale, daysRemaining, print } from '../output'
import type { OutputMode, WarrantyResult } from '../types'

interface ExpiringOptions {
  days: string
  output?: string
  json?: boolean
  profile?: string
  all?: boolean
}

export async function expiringCommand(file: string | undefined, options: ExpiringOptions): Promise<void> {
  const sourceCount = [file, options.profile, options.all].filter(Boolean).length
  if (sourceCount === 0) {
    print.error('Provide a file, --profile <name>, or --all')
    process.exit(1)
  }
  if (sourceCount > 1) {
    print.error('Provide exactly one of: file, --profile, or --all')
    process.exit(1)
  }

  const windowDays = parseInt(options.days, 10)

  if (options.all) {
    const profiles = loadProfiles()
    if (!profiles.length) {
      print.info('No profiles saved.')
      return
    }

    type TaggedResult = WarrantyResult & { _profileName: string }
    const tagged: TaggedResult[] = []

    for (const p of profiles) {
      if (!fs.existsSync(p.file)) {
        print.warn(`Profile '${p.name}': file not found — ${p.file}. Skipping.`)
        continue
      }
      let results: WarrantyResult[]
      try {
        results = await readXlsxResults(p.file, p.serialCol)
      } catch {
        print.warn(`Profile '${p.name}': failed to read file. Skipping.`)
        continue
      }
      for (const r of results) {
        if (r.status !== 'active' || !r.warrantyEnd) continue
        const days = daysRemaining(r.warrantyEnd)
        if (days !== null && days >= 0 && days <= windowDays) {
          tagged.push({ ...r, _profileName: p.name })
        }
      }
    }

    warnIfStale(tagged)

    if (options.json) {
      const out = JSON.stringify(tagged.map(({ _profileName, ...r }) => ({ profileName: _profileName, ...r })), null, 2)
      if (options.output) {
        writeFileSync(options.output, out)
        print.success(`${tagged.length} device(s) written to ${options.output}`)
      } else {
        console.log(out)
      }
      return
    }

    if (!tagged.length) {
      print.success(`No devices expiring within ${windowDays} days.`)
      return
    }

    const profileNameWidth = Math.max(7, ...tagged.map(r => r._profileName.length))
    const header = `${'Profile'.padEnd(profileNameWidth)}  ${'Serial'.padEnd(12)}  ${'Vendor'.padEnd(8)}  ${'Product'.padEnd(28)}  ${'Expires'.padEnd(12)}  ${'Days Left'}`
    const out = [
      header,
      ...tagged.map(r => {
        const days = daysRemaining(r.warrantyEnd)
        return `${r._profileName.padEnd(profileNameWidth)}  ${r.serial.padEnd(12)}  ${r.vendor.padEnd(8)}  ${(r.product ?? '').substring(0, 28).padEnd(28)}  ${(r.warrantyEnd ?? '').padEnd(12)}  ${days !== null ? String(days) : ''}`
      }),
    ].join('\n')

    if (options.output) {
      writeFileSync(options.output, out)
      print.success(`${tagged.length} device(s) written to ${options.output}`)
    } else {
      console.log(out)
    }
    return
  }

  if (options.profile) {
    const p = getProfile(options.profile)
    if (!p) {
      print.error(`Profile '${options.profile}' not found. Run: warrantycheck profile list`)
      process.exit(1)
    }
    if (!fs.existsSync(p.file)) {
      print.error(`Profile file not found: ${p.file}`)
      process.exit(1)
    }
    const results = await readXlsxResults(p.file, p.serialCol)
    outputExpiring(results, windowDays, options)
    return
  }

  // file mode
  let results: WarrantyResult[]
  try {
    results = readResultsCsv(file!)
  } catch {
    print.error(`Cannot read results file: ${file}`)
    process.exit(1)
  }
  outputExpiring(results, windowDays, options)
}

function outputExpiring(results: WarrantyResult[], windowDays: number, options: { output?: string; json?: boolean }): void {
  warnIfStale(results)

  const filtered = results.filter(r => {
    if (r.status !== 'active' || !r.warrantyEnd) return false
    const days = daysRemaining(r.warrantyEnd)
    return days !== null && days >= 0 && days <= windowDays
  })

  const mode: OutputMode = options.json ? 'json' : 'table'
  const out = formatResults(filtered, mode)

  if (options.output) {
    writeFileSync(options.output, out)
    print.success(`${filtered.length} device(s) written to ${options.output}`)
  } else if (filtered.length === 0) {
    print.success(`No devices expiring within ${windowDays} days.`)
  } else {
    console.log(out)
  }
}
