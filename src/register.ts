declare const global: any

import 'global-jsdom/register'
import './runner'
import expect from 'expect'
global.expect = expect

// override because node overwrites them
global.Event = window.Event
global.EventTarget = window.EventTarget

import { decarg } from 'decarg'
import * as fs from 'fs/promises'
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

const options = decarg(new Options(), process.argv)!

expect.extend(options.updateSnapshots ? snapshotMatcherUpdater : snapshotMatcher)

queueMicrotask(async () => {
  testBegin('no')

  global.snapshots = await fetchSnapshots(
    await filterFilesWithSnapshots(options.files),
    filename => fs.readFile(filename, 'utf-8')
  )

  global.runTests(options.files[0], options).then(async (testResults: TestResult[]) => {
    const { hasErrors, shouldUpdateSnapshots } = testReport(testResults)

    testEnd('no', hasErrors)

    process.exitCode = shouldUpdateSnapshots ? 2 : hasErrors ? 1 : 0

    if (options.updateSnapshots) await updateSnapshots('no', testResults)
  })
})
