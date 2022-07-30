#!/usr/bin/env node

const swc = require.resolve('./swc-register')
const patch = require.resolve('./register')

import { arg, decarg } from 'decarg'
import * as path from 'path'
import { waitForAction } from './core'

export class Options {
  @arg('<files>', 'Files to test') files!: string[]

  @arg('-t', '--testNamePattern', 'Run only tests with a name that matches the regex pattern.') testNamePattern = ''
  @arg('-w', '--watch', 'Watch for changes.') watch = false
  @arg('-u', '--update-snapshots', 'Update snapshots.') updateSnapshots = false
  @arg('-b', '--browser', 'Run in the browser.') browser = false
  @arg('-c', '--coverage', 'Produce coverage report.') coverage = false
  @arg('--runInBand', 'Run all tests serially in the current process.') runInBand = false
  @arg('--debug', 'Enable remote debugging.') debug = false
  @arg('--verbose', 'Verbose output.') verbose = false
}

if (require.main === module) {
  const options = decarg(new Options())!

  options.files = options.files.map(x => path.relative(process.cwd(), x))

  const main = async () => {
    if (options.browser) {
      const { run } = await import('./browser')
      run(options)
      return
    }

    let argv = process.argv.slice(2)
    const cmd = options.coverage ? ['c8', 'node'] : ['node']

    if (options.runInBand) {
      require(swc)
      require(patch)
      // await import(swc)
      // await import(patch)
      for (const file of options.files) {
        require(path.join(process.cwd(), file))
      }
      return
    }

    const run = async (newOptions: Partial<Options> = {}) => {
      if (newOptions.updateSnapshots) {
        argv.push('-u')
      }
      if (newOptions.testNamePattern === '') {
        if (argv.includes('-t')) argv.splice(argv.indexOf('-t'), 2)
        if (argv.includes('--testNamePattern')) argv.splice(argv.indexOf('--testNamePattern'), 2)
        Object.assign(options, newOptions)
      }

      const { sync: spawnSync } = await import('cross-spawn')

      const status = spawnSync(
        cmd[0],
        [...cmd.slice(1), '-r', swc, '-r', patch, '--input-type', 'module', ...argv],
        { stdio: 'inherit' }
      ).status!

      if (options.watch) {
        // remove --update-snapshots for the next runs
        argv = argv.filter(x => !['-u', '--update-snapshots'].includes(x))

        waitForAction('no', { watchFiles: true, shouldUpdateSnapshots: status === 2 }, options, run)
      } else {
        process.exitCode = status
      }
    }

    run()
  }

  main()
}
