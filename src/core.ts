import chalk from '@stagas/chalk'
import { applySourceMaps, clearAllCaches, getCodeFrame, parseUrls } from 'apply-sourcemaps'
import Debug from 'debug'
import { queue } from 'event-toolkit'
import { exists } from 'everyday-node'
import { asyncFilter, getStringLength, includesAny } from 'everyday-utils'
import * as fs from 'fs/promises'
import { diffStringsUnified } from 'jest-diff'
import * as os from 'os'
import * as path from 'path'

import { Options } from './cli'
import { TestResult } from './runner'
import { filenameToSnap } from './snapshot'

import type { FSWatcher } from 'fs'
import { FS_PREFIX } from 'puppito'

export const log = Debug('utr')

let now = 0

export function testBegin(appName: string) {
  clearAllCaches()
  const cols = process.stdout.columns
  console.error(chalk.blue(`\n[${appName}] test begin `.padEnd(cols + 1, '─')))
  const time = new Date().toLocaleTimeString()
  console.error(chalk.blue(`\x1B[1A\x1B[${cols - time.length - 1}C ${time}`))
  now = performance.now()
}

export function testEnd(appName: string, hasErrors: boolean) {
  const cols = process.stdout.columns
  console.error('\n' + chalk[hasErrors ? 'red' : 'green']('─'.repeat(cols)))
  console.error(chalk.blue(`\x1B[1A[${appName}] test end : ${(performance.now() - now).toFixed(2)}ms `))
  const time = new Date().toLocaleTimeString()
  console.error(chalk.blue(`\x1B[1A\x1B[${cols - time.length - 1}C ${time}`))
}

export function testReport(results: TestResult[]) {
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

export async function getStackCodeFrame(message: string, stack?: string) {
  // only our own stack trace identified by identation level for 'at'
  stack = stack?.split('\n').filter(x => x.startsWith('    at') && !x.includes('.snap')).join('\n')
  if (!stack?.trim().length) return ''
  const urls = parseUrls(stack)
  const codeFrame = await getCodeFrame(message, urls[0])
  return clip(indent(codeFrame ?? '', 4))
}

function clip(x: string, length = process.stdout.columns) {
  return x.split('\n').map(x => {
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
              if (x[i] === 'm')
                continue main
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
}

function indent(x: string, amount = 0) {
  return x.split('\n').map(x => ' '.repeat(amount) + x).join('\n')
}

export function transformArgsSync(args: any[], originUrl?: string) {
  return args.map(x => {
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
            'entry',
            'bundle',
            'runTest',
            'pptr:',
            'node:',
            'asyncSerialReduce',
            '/utr/',
            '/register',
            '/runner',
            '/expect',
          ])
        )
        .join('\n')

      const urls = parseUrls(cleanStack)
      for (const [i, url] of urls.entries()) {
        let target = originUrl ? url.url.replace(originUrl, '') : url.url

        if (!target.startsWith('/')) {
          target = path.relative(process.cwd(), path.join(process.cwd(), target))
        } else {
          target = path.relative(process.cwd(), target)
        }

        cleanStack = cleanStack.replaceAll(
          url.originalUrl,
          [
            i > 0 || didError ? '\x1B[0m' + target + '\x1B[39m' : target,
            url.line,
            url.column,
          ].join(':')
        )
      }

      const lines = cleanStack
        .split('\n')
        .filter(x => x.trim().length)

      const [firstUrl] = parseUrls(lines[0]!)
      if (firstUrl) lines.shift()

      cleanStack = indent(
        lines
          .map(x => x.startsWith('    at') ? chalk.grey(x.slice(2)) : x)
          .join('\n'),
        4
      )

      const color = didError ? 'red' : didSkipError ? 'yellow' : 'green'

      return [
        chalk[color](message) + '  ' + chalk.grey(firstUrl?.originalUrl ?? ''),
        ...(cleanStack.trim().length ? [cleanStack] : []),
      ]
        .join('\n')
    } else
      return x
  })
}

export async function transformArgs(args: any[], originUrl?: string) {
  for (const [i, arg] of args.entries()) {
    if (typeof arg !== 'string') continue
    args[i] = await applySourceMaps(arg, url => {
      return path.relative(process.cwd(), url.replace(`/${FS_PREFIX}/`, os.homedir() + '/'))
    })
  }
  return transformArgsSync(args, originUrl)
}

const watchers: FSWatcher[] = []
export let waitForActionDeferred: any

export async function waitForAction(
  appName: string,
  { watchFiles, shouldUpdateSnapshots }: { watchFiles: boolean; shouldUpdateSnapshots: boolean },
  options: Options,
  cb: (newOptions?: Partial<Options>) => void,
  cleanup: () => Promise<void>,
) {
  const { singleKeypress } = await import('everyday-node')

  if (watchFiles) {
    const { watch } = await import('fs')
    const { eachDep } = await import('each-dep')

    const rerun = queue.debounce(100).last(() => {
      console.log(chalk.blue(`[${appName}] change detected - running tests again...`))
      waitForActionDeferred?.reject(new Error('Interrupted because file(s) changed.'))
      cb()
    })

    watchers.splice(0).forEach(x => x.close())
    for await (const dep of eachDep(options.files[0])) {
      watchers.push(watch(dep, rerun))
    }
  }

  console.log(chalk.blue(`[${appName}] watching for changes...`))

  waitForActionDeferred = await singleKeypress(
    chalk.blue(`[${appName}]`)
      + ` [r]un${options.testNamePattern ? ' [a]ll' : ''} [q]uit${
        shouldUpdateSnapshots ? chalk.bold.yellowBright(' [u]pdate snaphots') : ''
      }: `
  )

  try {
    const { char, key } = await waitForActionDeferred.promise

    if ((key.name === 'c' && key.ctrl) || char === 'q') {
      console.log(chalk.bold('quit'))
      cleanup()
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
  } catch {}
}

function toBacktickString(x: string) {
  return '`' + JSON.stringify(x).slice(1, -1).replaceAll('`', '\\`').replaceAll('\\"', '"').replaceAll('\\n', '\n')
    + '`'
}

export async function updateSnapshots(appName: string, testResults: TestResult[]) {
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

export function filterFilesWithSnapshots(files: string[]) {
  return asyncFilter(files, filename => exists(filenameToSnap(filename)))
}
