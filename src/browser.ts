import chalk from '@stagas/chalk'
import { ClientSetup, runInVite, updateVirtualModule, virtualPlugin } from 'run-in-vite'

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

export const run = async (options: Options) => {
  const { resolve: importMetaResolve } = await eval('import(\'import-meta-resolve\')')

  const resolve = async (x: string) =>
    // @ts-ignore
    (await importMetaResolve(x, import.meta.url.replace('cjs', 'esm'))).split('file://').pop()

  const setup: Partial<ClientSetup> = {}
  const root = process.cwd()
  setup.root = root
  setup.quiet = !options.watch
  setup.watch = options.watch
  setup.noForce = true

  setup.responses = {
    '/setup.js': {
      content: `
      import '/@id/virtual:setup'
    `,
    },
  }

  setup.viteOptions = {
    resolve: {
      alias: {
        runner: await resolve('./runner.js'),
        expect: await resolve('@storybook/expect'),
        globals: await resolve('jest-browser-globals'),
        'everyday-utils': await resolve('everyday-utils'),
        snapshot: await resolve('./snapshot.js'),
      },
    },
  }

  setup.html = /*html*/ `\
<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <link
      rel="icon"
      href="data:image/svg+xml,%3Csvg viewBox='0 0 100 100' xmlns='http://www.w3.org/2000/svg'%3E%3Ccircle cx='50' cy='47.2' r='34'%0Afill='transparent' stroke='%23fff' stroke-width='7.5' /%3E%3C/svg%3E"
      type="image/svg+xml"
    />
    <title>Test</title>
  </head>
  <body style="background:#222">
    <script type="module" src="setup.js"></script>
  </body>
</html>`
  const makeVirtual = async () => `
    import 'runner'
    import 'globals'
    import expect from 'expect'
    import { asyncSerialReduce } from 'everyday-utils'
    import { snapshotMatcher, snapshotMatcherUpdater, fetchSnapshots } from 'snapshot'

    window.expect = expect

    expect.extend(${options.updateSnapshots ? 'snapshotMatcherUpdater' : 'snapshotMatcher'})

    window.resultsPromise = new Promise(async resolve => {
      window.snapshots = await fetchSnapshots(${JSON.stringify(await filterFilesWithSnapshots(options.files))},
        filename => fetch(filename).then(res => res.text()))

      resolve(await asyncSerialReduce(${JSON.stringify(options.files)}, async (allResults, filename) => {
        await import(/* @vite-ignore */ '/@fs${root}/' + filename)

        const testResults = await window.runTests(filename, {
          testNamePattern: ${JSON.stringify(options.testNamePattern)},
        })

        return allResults.concat(testResults)
      }, []))
    })
  `

  setup.virtual = {
    'virtual:setup': await makeVirtual(),
  }

  setup.consoleFilter = consoleFilter

  if (options.debug) {
    console.error(chalk.yellow.bold('[[[ debugging active @ port 9222 ]]]'))
    setup.launchOptions = {
      debuggingPort: 9222,
    }
  }

  const instance = await runInVite(setup)
  const { server, page, flush, close } = instance

  page.exposeFunction('getStackCodeFrame', getStackCodeFrame)

  page.on('framenavigated', () => {
    testBegin('bro')
    if (options.coverage) page.coverage.startJSCoverage()
  })

  page.goto(server.networkAddr)

  // eslint-disable-next-line no-constant-condition
  while (true) {
    await page.waitForNavigation({
      waitUntil: 'domcontentloaded',
      timeout: options.watch || options.debug ? 0 : 30 * 1000,
    })

    const testResults = await page.evaluate(async () => {
      return await window.resultsPromise
    }).catch(console.warn) || []

    await flush()

    const { hasErrors, shouldUpdateSnapshots } = testReport(testResults)

    testEnd('bro', hasErrors)

    if (options.coverage) {
      log('retrieving coverage')

      // ripped from: https://github.com/modernweb-dev/web/blob/3f671e732201f141d910b59c60666f31df9c6126/packages/test-runner-chrome/src/ChromeLauncherPage.ts#L86
      const { result: v8Coverage } = await (page as any)._client().send('Profiler.takePreciseCoverage')
      await page.browser().userAgent().catch(() => undefined)
      await page.coverage.stopJSCoverage()
      const { printCoverage } = await import('./browser-coverage')
      console.error()
      await printCoverage(v8Coverage, root)
    }

    if (options.updateSnapshots) {
      await updateSnapshots('bro', testResults)
      options.updateSnapshots = false
    }

    if (options.watch) {
      waitForAction('bro', { watchFiles: false, shouldUpdateSnapshots }, options, async newOptions => {
        if (!virtualPlugin) throw new Error('Virtual plugin not found.')
        Object.assign(options, newOptions)
        updateVirtualModule(virtualPlugin, 'virtual:setup', await makeVirtual())
      })
    } else if (!options.debug) {
      await close()
      process.exit(+hasErrors)
      break
    }
  }
}
