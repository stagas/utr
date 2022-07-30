import chalk from '@stagas/chalk'
import { getCodeFrame, parseUrls } from 'apply-sourcemaps'
import Debug from 'debug'
import { queue } from 'event-toolkit'
import { exists } from 'everyday-node'
import { asyncFilter, getStringLength, includesAny } from 'everyday-utils'
import * as fs from 'fs/promises'
import { diffStringsUnified } from 'jest-diff'
import * as path from 'path'

import { Options } from './cli'
import { TestResult } from './runner'
import { filenameToSnap } from './snapshot'

import type { FSWatcher } from 'fs'

export const log = Debug('utr')

let now = 0

export const testBegin = (appName: string) => {
  const cols = process.stdout.columns
  console.error(chalk.blue(`\n[${appName}] test begin `.padEnd(cols + 1, '─')))
  const time = new Date().toLocaleTimeString()
  console.error(chalk.blue(`\x1B[1A\x1B[${cols - time.length - 1}C ${time}`))
  now = performance.now()
}

export const testEnd = (appName: string, hasErrors: boolean) => {
  const cols = process.stdout.columns
  console.error('\n' + chalk[hasErrors ? 'red' : 'green']('─'.repeat(cols)))
  console.error(chalk.blue(`\x1B[1A[${appName}] test end : ${(performance.now() - now).toFixed(2)}ms `))
  const time = new Date().toLocaleTimeString()
  console.error(chalk.blue(`\x1B[1A\x1B[${cols - time.length - 1}C ${time}`))
}

export const testReport = (results: TestResult[]) => {
  const cols = process.stdout.columns
  const hasErrors = results.some(x => x.status === 'failed')
  const shouldUpdateSnapshots = results.some(x => x.error?.message.includes('snapshot'))

  // results:
  console.log(chalk[hasErrors ? 'red' : 'green']('\n'.padEnd(cols + 1, '─')))
  const total = chalk.bold.grey(
    `${
      [
        chalk.green(results.filter(x => x.status === 'passed').length || '-'),
        chalk.red(results.filter(x => x.status === 'failed').length || '-'),
        chalk.yellow(results.filter(x => x.status === 'skipped').length || '-'),
      ].join(' : ')
    } / ${chalk.white(results.filter(x => !x.task!.isGroup).length)}`
  )
  console.log(`\x1B[1A\x1B[${cols - getStringLength(total) - 1}C ${total}\n`)
  console.log(
    results.filter(x => {
      if (
        x.task?.isGroup
        && !results.filter(x => !x.task?.isGroup).some(y =>
          y.task?.namespace.join(' ').startsWith(x.task!.namespace.join(' '))
        )
      )
        return false
      return true
    }).map(x =>
      '  '.repeat(x.task!.namespace.length) + (
        // dprint-ignore
        chalk[x.task!.isGroup ? 'reset' : 'grey'](
          (x.status === 'passed' ? chalk.green('✓ ') :
          x.status === 'failed' ? chalk.red('✕ ') :
          x.status === 'skipped' ? chalk.yellow('○ ') : '')
          + x.task!.ownName
        )
      )
    ).join('\n')
  )
  return { hasErrors, shouldUpdateSnapshots }
}

export const getStackCodeFrame = async (message: string, stack: string) => {
  // only our own stack trace identified by identation level for 'at'
  stack = stack.split('\n').filter(x => x.startsWith('    at') && !x.includes('.snap')).join('\n')
  const urls = parseUrls(stack)
  const codeFrame = await getCodeFrame(message, urls[0])
  return clip(indent(codeFrame ?? '', 4))
}

const clip = (x: string, length = process.stdout.columns) =>
  x.split('\n').map(x => {
    let out = ''
    let count = 0
    main:
    for (let i = 0; i < x.length; i++) {
      if (x[i] === '\x1B') {
        out += x[i++]
        for (; i < x.length; i++) {
          if (x[i] === '[') {
            out += x[i++]
            for (; i < x.length; i++) {
              out += x[i]
              if (x[i] === 'm') continue main
            }
          }
        }
      }
      out += x[i]

      if (++count === length) {
        out += '\x1B[0m'
        break
      }
    }
    return out
  }).join('\n')

const indent = (x: string, amount = 0) => x.split('\n').map(x => ' '.repeat(amount) + x).join('\n')

export const consoleFilter = (args: any[]) =>
  args.map(x => {
    if (typeof x === 'string') {
      const didError = x.includes('DidError')
      const didNotError = x.includes('DidNotError')
      const didSkipError = x.includes('DidSkipError')

      if (!didError && !didNotError && !didSkipError) {
        return x
      }

      const parts = x.split('\n\n')
      const [, message] = parts
      let [, , ...stack] = parts

      if (x.includes('Error: Snapshots')) {
        const [, , , actual, , expected] = stack
        const difference = indent(diffStringsUnified(expected.trim(), actual.trim()), 2)
        stack = [...stack.slice(0, 2), difference, ...stack.slice(6)]
      }

      let cleanStack = stack
        .join('\n\n')
        .split('\n')
        .filter(x =>
          !includesAny(x, [
            '@id/virtual:setup',
            'runTest',
            'pptr:',
            'node:',
            '/register',
            '/runner',
            '/expect/',
          ])
        )
        .join('\n')

      const urls = parseUrls(cleanStack)
      for (const url of urls) {
        let target = url.url
        if (target.startsWith('/')) {
          target = path.relative(process.cwd(), target)
        }

        cleanStack = cleanStack.replaceAll(
          url.originalUrl,
          [
            '\x1B[0m' + target + '\x1B[39m',
            url.line,
            url.column,
          ].join(':')
        )
      }

      cleanStack = cleanStack.split('\n')
        .map(x => x.startsWith('    at') ? chalk.grey(x.slice(2)) : x)
        .join('\n')

      const color = didError ? 'red' : didSkipError ? 'yellow' : 'green'

      return ['\n' + chalk[color](message), indent(cleanStack, 4)].join('\n\n')
    } else return x
  })

const watchers: FSWatcher[] = []
let offKeypress: (() => void) | undefined

export const waitForAction = async (
  appName: string,
  { watchFiles, shouldUpdateSnapshots }: { watchFiles: boolean; shouldUpdateSnapshots: boolean },
  options: Options,
  cb: (newOptions?: Partial<Options>) => void,
) => {
  offKeypress?.()

  const { keypress } = await import('everyday-node')

  if (watchFiles) {
    const { watch } = await import('fs')
    const { eachDep } = await import('each-dep')

    const rerun = queue.debounce(100).last(() => {
      console.log(chalk.blue(`[${appName}] change detected - running tests again...`))
      cb()
    })

    watchers.splice(0).forEach(x => x.close())
    for await (const dep of eachDep(options.files[0])) {
      watchers.push(watch(dep, rerun))
    }
  }

  console.log(chalk.blue(`[${appName}] watching for changes...`))

  offKeypress = await keypress(
    chalk.blue(`[${appName}]`)
      + ` [r]un${options.testNamePattern ? ' [a]ll' : ''} [q]uit${
        shouldUpdateSnapshots ? chalk.bold.yellowBright(' [u]pdate snaphots') : ''
      }: `,
    (char, key) => {
      if ((key.name === 'c' && key.ctrl) || char === 'q') {
        console.log(chalk.bold('quit'))
        process.exit()
      } else if (char === 'r') {
        console.log(chalk.bold('run'))
        cb()
      } else if (char === 'u') {
        console.log(chalk.bold('update snapshots'))
        cb({ updateSnapshots: true })
      } else if (char === 'a') {
        console.log(chalk.bold('run all'))
        cb({ testNamePattern: '' })
      }
    }
  )
}

const toBacktickString = (x: string) =>
  '`' + JSON.stringify(x).slice(1, -1).replaceAll('`', '\\`').replaceAll('\\"', '"').replaceAll('\\n', '\n')
  + '`'

export const updateSnapshots = async (appName: string, testResults: TestResult[]) => {
  const output: Record<string, string> = {}

  for (const x of testResults) {
    if (!x.task?.snapshots) continue
    const snapshots = x.task.snapshots
    for (const [i, s] of snapshots.entries()) {
      const name = [...x.task.namespace, i + 1].join(' ')
      output[x.task.filename] ??= ''
      output[x.task.filename] += `\nexports[${toBacktickString(name)}] = ${toBacktickString(s)};\n`
    }
  }

  for (const [filename, snap] of Object.entries(output)) {
    const snapFilename = filenameToSnap(filename)
    await fs.mkdir(path.dirname(snapFilename), { recursive: true })
    await fs.writeFile(snapFilename, snap, 'utf-8')
  }

  console.log(chalk.blue(`[${appName}]`), chalk.bold.green('updated snapshots'))
}

export const filterFilesWithSnapshots = (files: string[]) =>
  asyncFilter(files, filename => exists(filenameToSnap(filename)))
