import chalk from '@stagas/chalk'
import { Deferred } from 'everyday-utils'
import * as path from 'path'
import { FS_PREFIX, puppito, PuppitoOptions } from 'puppito'

import { Options } from './cli'
import {
  filterFilesWithSnapshots,
  getStackCodeFrame,
  log,
  testBegin,
  testEnd,
  testReport,
  transformArgs,
  updateSnapshots,
  waitForAction,
  waitForActionDeferred,
} from './core'

import type { TestResult } from './runner'

declare const window: { resultsPromise: Promise<TestResult[]> }

export async function run(runOptions: Options) {
  const root = process.cwd()
  const { resolve: importMetaResolve } = await eval('import(\'import-meta-resolve\')')
  const resolve = async (x: string) =>
    // @ts-ignore
    (await importMetaResolve(x, import.meta.url.replace('cjs', 'esm'), void 0, true)).replace('cjs', 'esm').split(
      'file://'
    ).pop()

  const options = new PuppitoOptions({
    file: __filename,
    alias: {
      runner: await resolve('./runner.js'),
      expect: await resolve('@storybook/expect'),
      globals: await resolve('jest-browser-globals'),
      'everyday-utils': await resolve('everyday-utils'),
      snapshot: await resolve('./snapshot.js'),
    },
  })

  const resolved = runOptions.files.map(x => path.resolve(process.cwd(), x))
  const files = resolved.map((x, i) => [`/${FS_PREFIX}/${path.relative(options.homedir, x)}`, runOptions.files[i]])

  const makeVirtual = async () => `
    import 'runner'
    import 'globals'
    import expect from 'expect'
    import { asyncSerialReduce } from 'everyday-utils'
    import { snapshotMatcher, snapshotMatcherUpdater, fetchSnapshots } from 'snapshot'

    window.expect = expect

    const g = window
    if (g.jest) {
      g.jest.setTimeout = (ms) => {
        g.defaultTimeout = ms
      }
    } else {
      g.jest = {
        setTimeout(ms) {
          g.defaultTimeout = ms
        },
      }
    }

    expect.extend(${runOptions.updateSnapshots ? 'snapshotMatcherUpdater' : 'snapshotMatcher'})

    window.resultsPromise = new Promise(resolve => {
      ;(async () => {
        window.snapshots = await fetchSnapshots(${JSON.stringify(await filterFilesWithSnapshots(runOptions.files))},
          filename => fetch(filename).then(res => res.text()))

        const testResults = await asyncSerialReduce(${
    JSON.stringify(files)
  }, async (allResults, [filename, relative]) => {
          try {
            await import(/* ignore */ filename)
          } catch (error) {
            it(filename, () => {
              throw error
            })
          }

          let testResults = []

          try {
            testResults = await window.runTests(relative, {
              testNamePattern: ${JSON.stringify(runOptions.testNamePattern)},
            })
          } catch {}

          return allResults.concat(testResults)
        }, [])

        resolve(testResults)
      })();
    })

    window.runnerReady()
  `

  options.entrySource = await makeVirtual()
  options.transformArgs = transformArgs
  options.extraAnalyzePaths = runOptions.files
  options.failedRequestFilter = x => {
    return !x.includes('/onreload')
  }
  options.quiet = true //false
  options.headless = runOptions.headless

  if (runOptions.debug) {
    console.error(chalk.yellow.bold('[[[ debugging active @ port 9222 ]]]'))
    options.puppeteer.debuggingPort = 9222
  }

  const instance = await puppito(options)
  const { server, page, flush, close } = instance

  let runnerReady = Deferred<void>()
  page.exposeFunction('getStackCodeFrame', getStackCodeFrame)
  page.exposeFunction('runnerReady', () => runnerReady.resolve())
  page.goto(server.url)

  let errors = 0

  // eslint-disable-next-line no-constant-condition
  while (true) {
    page.once('framenavigated', () => {
      waitForActionDeferred?.reject(new Error('Interrupted because frame navigated.'))

      testBegin('bro')

      if (runOptions.coverage)
        page.coverage.startJSCoverage()
    })

    try {
      await page.waitForNavigation({
        waitUntil: 'domcontentloaded',
        timeout: runOptions.watch || runOptions.debug ? 0 : 30 * 1000,
      })
    } catch {
      break
    }

    try {
      await runnerReady.promise
    } catch {
      break
    }

    runnerReady = Deferred()

    const testResults = await page.evaluate(async () => {
      return await window.resultsPromise
    }).catch(console.warn) || []

    await flush()

    const { hasErrors, shouldUpdateSnapshots } = testReport(testResults)

    errors = +hasErrors

    if (runOptions.watch) console.error(chalk.blue('\n[url]'), chalk.whiteBright(server.url))
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
        server.esbuild!.options.entrySource = await makeVirtual()
        server.esbuild!.onchange!(new Set(resolved))
        server.esbuild!.rebuild()
      }, close)
    } else if (!runOptions.debug) {
      await close()
      return +hasErrors
    }
  }

  await close()
  return errors
}
