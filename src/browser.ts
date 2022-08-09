import chalk from '@stagas/chalk'
import * as path from 'path'
import { puppito, PuppitoOptions } from 'puppito'

import { Options } from './cli'
import {
  consoleFilter,
  filterFilesWithSnapshots,
  getStackCodeFrame,
  log,
  testBegin,
  testEnd,
  testReport,
  updateSnapshots,
  waitForAction,
} from './core'

import type { TestResult } from './runner'

declare const window: { resultsPromise: Promise<TestResult[]> }

export const run = async (runOptions: Options) => {
  const root = process.cwd()
  const { resolve: importMetaResolve } = await eval('import(\'import-meta-resolve\')')
  const resolve = async (x: string) =>
    // @ts-ignore
    (await importMetaResolve(x, import.meta.url.replace('cjs', 'esm'), void 0, true)).replace('cjs', 'esm').split(
      'file://'
    ).pop()

  const options = new PuppitoOptions()

  options.alias = {
    runner: await resolve('./runner.js'),
    expect: await resolve('@storybook/expect'),
    globals: await resolve('jest-browser-globals'),
    'everyday-utils': await resolve('everyday-utils'),
    snapshot: await resolve('./snapshot.js'),
  }

  const makeVirtual = async () => `
    import 'runner'
    import 'globals'
    import expect from 'expect'
    import { asyncSerialReduce } from 'everyday-utils'
    import { snapshotMatcher, snapshotMatcherUpdater, fetchSnapshots } from 'snapshot'

    window.expect = expect

    expect.extend(${runOptions.updateSnapshots ? 'snapshotMatcherUpdater' : 'snapshotMatcher'})

    window.resultsPromise = new Promise(resolve => {
      ;(async () => {
        window.snapshots = await fetchSnapshots(${JSON.stringify(await filterFilesWithSnapshots(runOptions.files))},
          filename => fetch(filename).then(res => res.text()))

        const testResults = await asyncSerialReduce(${
    JSON.stringify(runOptions.files)
  }, async (allResults, filename) => {
          await import(/* ignore */ '/@fs${root}/' + filename)

          const testResults = await window.runTests(filename, {
            testNamePattern: ${JSON.stringify(runOptions.testNamePattern)},
          })

          return allResults.concat(testResults)
        }, [])

        resolve(testResults)
      })();
    })
  `

  options.file = '/entry.js'
  options.entrySource = await makeVirtual()
  options.consoleFilter = consoleFilter
  options.quiet = true

  if (runOptions.debug) {
    console.error(chalk.yellow.bold('[[[ debugging active @ port 9222 ]]]'))
    options.puppeteer.debuggingPort = 9222
  }

  const instance = await puppito(options)
  const { server, page, flush, close } = instance

  for (const file of runOptions.files) {
    const target = path.join(root, file)
    await server.analyze(target)
  }
  server.updateCache()

  page.exposeFunction('getStackCodeFrame', getStackCodeFrame)

  page.on('framenavigated', () => {
    testBegin('bro')
    if (runOptions.coverage) page.coverage.startJSCoverage()
  })

  page.goto(server.url)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await page.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: runOptions.watch || runOptions.debug ? 0 : 30 * 1000,
    })

    const testResults = await page.evaluate(async () => {
      return await window.resultsPromise
    }).catch(console.warn) || []

    await flush()

    const { hasErrors, shouldUpdateSnapshots } = testReport(testResults)

    testEnd('bro', hasErrors)

    if (runOptions.coverage) {
      log('retrieving coverage')

      // ripped from: https://github.com/modernweb-dev/web/blob/3f671e732201f141d910b59c60666f31df9c6126/packages/test-runner-chrome/src/ChromeLauncherPage.ts#L86
      const { result: v8Coverage } = await (page as any)._client().send('Profiler.takePreciseCoverage')
      await page.browser().userAgent().catch(() => undefined)
      await page.coverage.stopJSCoverage()
      const { printCoverage } = await import('./browser-coverage')
      console.error()
      await printCoverage(v8Coverage, root)
    }

    if (runOptions.updateSnapshots) {
      await updateSnapshots('bro', testResults)
      runOptions.updateSnapshots = false
    }

    if (runOptions.watch) {
      waitForAction('bro', { watchFiles: false, shouldUpdateSnapshots }, runOptions, async newOptions => {
        Object.assign(options, newOptions)
        await server.analyze(options.file, await makeVirtual())
        server.updateCache('/', true)
      })
    } else if (!runOptions.debug) {
      await close()
      process.exit(+hasErrors)
      break
    }
  }
}
