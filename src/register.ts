declare const global: any

import './runner'
import expect from 'expect'
global.expect = expect

if (typeof window !== 'undefined') {
  // override because node overwrites them
  global.Event = window.Event
  global.EventTarget = window.EventTarget
}

// @ts-ignore
jest.fn = (fn?: (...args: any[]) => any) => {
  const calls = [] as any[]
  return Object.assign(function (this: any, ...args: any[]) {
    calls.push(args)
    return fn?.apply(this, args)
  }, {
    _isMockFunction: true,
    getMockName() {
      return 'fn'
    },
    mock: {
      calls,
      get lastCall() {
        return calls.at(-1)
      },
    }
  })
}

import { decarg } from 'decarg'
import { asyncSerialReduce } from 'everyday-utils'
import * as fs from 'fs/promises'
import * as path from 'path'

import { Options } from './cli'
import {
  filterFilesWithSnapshots,
  getStackCodeFrame,
  testBegin,
  testEnd,
  testReport,
  transformArgsSync,
  updateSnapshots,
} from './core'
import { fetchSnapshots, snapshotMatcher, snapshotMatcherUpdater } from './snapshot'

import type { TestResult } from './runner'

for (const m of ['debug', 'error', 'warn']) {
  const orig = (console as any)[m]
    ; (console as any)[m] = (...args: any[]) => {
      return orig.apply(console, transformArgsSync(args))
    }
}

global.getStackCodeFrame = getStackCodeFrame

const argv = process.argv.filter(x => !x.endsWith(__filename) && !x.endsWith('bin/utr'))
const options = decarg(new Options(), argv)!

expect.extend(options.updateSnapshots ? snapshotMatcherUpdater : snapshotMatcher)

queueMicrotask(async () => {
  testBegin('no')

  global.snapshots = await fetchSnapshots(
    await filterFilesWithSnapshots(options.files),
    filename => fs.readFile(filename, 'utf-8')
  )

  const testResults = await asyncSerialReduce(options.files, async (allResults, filename) => {
    const filePath = filename.startsWith('/')
      ? filename
      : path.join(process.cwd(), filename)
    await import(filePath)
    const testResults: TestResult[] = await global.runTests(filename, options)
    return allResults.concat(testResults)
  }, [] as TestResult[])

  const { hasErrors, shouldUpdateSnapshots } = testReport(testResults)

  process.exitCode = shouldUpdateSnapshots ? 2 : hasErrors ? 1 : 0

  testEnd('no', hasErrors)

  if (options.updateSnapshots) await updateSnapshots('no', testResults, options)

  process.exit(process.exitCode)
})
