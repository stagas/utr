declare const global: any

import 'global-jsdom/register'
import './runner'
import expect from 'expect'
global.expect = expect

// override because node overwrites them
global.Event = window.Event
global.EventTarget = window.EventTarget

import { decarg } from 'decarg'
import { asyncSerialReduce } from 'everyday-utils'
import * as fs from 'fs/promises'
import * as path from 'path'
import { Options } from './cli'
import {
  consoleFilter,
  filterFilesWithSnapshots,
  getStackCodeFrame,
  testBegin,
  testEnd,
  testReport,
  updateSnapshots,
} from './core'
import { fetchSnapshots, snapshotMatcher, snapshotMatcherUpdater } from './snapshot'

import type { TestResult } from './runner'

// patch console to apply stack traces
for (const m of ['debug', 'error', 'warn']) {
  const orig = (console as any)[m]
  ;(console as any)[m] = (...args: any[]) => {
    return orig.apply(console, consoleFilter(args))
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

  if (options.updateSnapshots) await updateSnapshots('no', testResults)
})
