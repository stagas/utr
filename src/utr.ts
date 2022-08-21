const swc = require.resolve('./swc-register')
const patch = require.resolve('./register')
const jsdom = require.resolve('global-jsdom/register')

import * as fs from 'fs'
import * as path from 'path'
import { Options } from './cli'
import { waitForAction } from './core'

const matchers = /@jest-environment (?<id1>\w+)|@env (?<id2>\w+)/g

const parseEnvs = (x: string) =>
  [...x.matchAll(matchers)]
    .map(x => x.groups?.id1 || x.groups?.id2).filter(Boolean) as string[]

export const discoverFiles = async (options: Options) => {
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

  for (const file of options.files) {
    const contents = await fs.promises.readFile(path.resolve(process.cwd(), file), 'utf-8')

    let envs = parseEnvs(contents)
    if (!envs.length) envs = (['node', 'jsdom', 'browser'] as const).filter(x => options[x])

    envs.forEach(env => {
      options.envs ??= {}
      options.envs[env] ??= []
      options.envs[env].push(file)
    })
  }

  options.argv = argv
}

export const main = async (options: Options) => {
  let { argv } = options

  if (options.browser) {
    const { run } = await import('./browser')
    return run(options)
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
      [...cmd.slice(1), '-r', swc, ...(options.jsdom ? ['-r', jsdom] : []), patch, ...options.files],
      { stdio: 'inherit' }
    ).status!

    if (options.watch) {
      // remove --update-snapshots for the next runs
      argv = options.argv = argv.filter(x => !['-u', '--update-snapshots'].includes(x))

      waitForAction(
        'no',
        { watchFiles: true, shouldUpdateSnapshots: status === 2 },
        options,
        run,
        () => Promise.resolve()
      )
    } else {
      process.exitCode = status
    }
    return status
  }

  return run()
}
