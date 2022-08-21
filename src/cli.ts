#!/usr/bin/env node

import chalk from '@stagas/chalk'
import { arg, decarg } from 'decarg'
import * as os from 'os'
import { discoverFiles, main } from './utr'

export class Options {
  @arg('<files>', 'Files or patterns to test') files: string[] = []

  @arg('-t', '--testNamePattern', 'Run only tests with a name that matches the regex pattern.') testNamePattern = ''
  @arg('-w', '--watch', 'Watch for changes.') watch = false
  @arg('-u', '--update-snapshots', 'Update snapshots.') updateSnapshots = false
  @arg('-j', '--jsdom', 'Run in jsdom.') jsdom = false
  @arg('-b', '--bro', 'Run in the browser.') browser = false
  @arg('-n', '--no', 'Run in node.') node = false
  @arg('-a', '--auto', 'Automatic environment.') auto = false
  @arg('-c', '--coverage', 'Produce coverage report.') coverage = false
  @arg('-p', '--pass-all', 'Pass all environments') passAll = false
  @arg('--homedir', 'Homedir') homedir = '~'
  @arg('--headless', 'Run browser headless') headless = true
  @arg('--runInBand', 'Run all tests serially in the current process.') runInBand = false
  @arg('--debug', 'Enable remote debugging.') debug = false
  @arg('--verbose', 'Verbose output.') verbose = false

  argv: string[] = []
  envs?: Record<string, string[]>
}

if (require.main === module) {
  const options = decarg(new Options())!
  if (options.homedir === '~') options.homedir = os.homedir()

  const envs = ['node', 'jsdom', 'browser'] as const

  if (envs.every(x => !options[x])) {
    options.auto = true
  }

  if (options.auto) {
    options.node =
      options.jsdom =
      options.browser =
        true
  }

  ;(async () => {
    await discoverFiles(options)

    const results: Record<string, number | void> = {}

    let errors = 0
    let didPassOne = false

    if (options.envs) {
      for (const env of envs) {
        const files = options.envs[env]
        if (files) {
          try {
            results[env] = await main({
              ...options,
              files,
              node: false,
              browser: false,
              jsdom: false,
              [env]: true,
            })
          } catch {
            results[env] = 1
          }
          if (!results[env]) didPassOne = true
          errors += results[env] ?? 0
        }
      }
    } else {
      for (const env of envs) {
        if (options[env]) {
          try {
            results[env] = await main({
              ...options,
              node: false,
              browser: false,
              jsdom: false,
              [env]: true,
            })
          } catch {
            results[env] = 1
          }
          if (!results[env]) didPassOne = true
          errors += results[env] ?? 0
        }
        if (options.watch) break
      }
    }

    console.log(
      Object.entries(results)
        .map(([k, v]) => ` ${k}:${v ? chalk.bold.white.bgRed(' fail ') : chalk.bold.white.bgGreen(' pass ')}`)
        .join('   ')
    )

    process.exit((options.passAll && errors) || !didPassOne ? 1 : 0)
  })()
}
