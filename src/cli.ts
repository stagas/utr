#!/usr/bin/env node

const swc = require.resolve('./swc-register')
const patch = require.resolve('./register')
const jsdom = require.resolve('global-jsdom/register')

import { arg, decarg } from 'decarg'
import * as path from 'path'
import { waitForAction } from './core'

export class Options {
  @arg('<files>', 'Files or patterns to test') files: string[] = []

  @arg('-t', '--testNamePattern', 'Run only tests with a name that matches the regex pattern.') testNamePattern = ''
  @arg('-w', '--watch', 'Watch for changes.') watch = false
  @arg('-u', '--update-snapshots', 'Update snapshots.') updateSnapshots = false
  @arg('-j', '--jsdom', 'Run in jsdom.') jsdom = false
  @arg('-b', '--browser', 'Run in the browser.') browser = false
  @arg('-c', '--coverage', 'Produce coverage report.') coverage = false
  @arg('--runInBand', 'Run all tests serially in the current process.') runInBand = false
  @arg('--debug', 'Enable remote debugging.') debug = false
  @arg('--verbose', 'Verbose output.') verbose = false
}

if (require.main === module) {
  const options = decarg(new Options())!

  const main = async () => {
    let argv = process.argv.slice(2)

    const relative = (x: string) => path.relative(process.cwd(), x)

    if (!options.files.length) {
      options.files = (await import('glob')).sync(path.join(process.cwd(), 'test', '*.spec.*')).map(relative)
      argv.push(...options.files)
    } else if (options.files.some(x => x.includes('*'))) {
      argv = argv.filter(x => !options.files.includes(x))
      options.files = (await (await import('everyday-utils')).asyncSerialMap(options.files, async (x: string) =>
        (await import('glob')).sync(path.join(process.cwd(), x)).map(relative))).flat()
      argv.push(...options.files)
    } else {
      options.files = options.files.map(relative)
    }

    if (options.browser) {
      const { run } = await import('./browser')
      run(options)
      return
    }

    const cmd = options.coverage ? ['c8', 'node'] : ['node']

    if (options.runInBand) {
      require(swc)
      require(patch)
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
        [...cmd.slice(1), '-r', swc, ...(options.jsdom ? ['-r', jsdom] : []), patch, ...argv],
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
