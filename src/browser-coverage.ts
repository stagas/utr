import { fetchSourceMap } from 'apply-sourcemaps'
import libCoverage from 'istanbul-lib-coverage'
import libReport from 'istanbul-lib-report'
import reports, { ReportOptions } from 'istanbul-reports'
import * as path from 'path'
import v8ToIstanbul from 'v8-to-istanbul'

import { log } from './core'

import type { Profiler } from 'inspector'

export const printCoverage = async (v8Coverage: Profiler.ScriptCoverage[], root = process.cwd()) => {
  const coverageMap = libCoverage.createCoverageMap()

  // https://github.com/modernweb-dev/web/blob/3f671e732201f141d910b59c60666f31df9c6126/packages/test-runner-coverage-v8/src/index.ts#L47
  for (
    const entry of v8Coverage.filter(x =>
      x.url.startsWith('http') && !x.url.includes('@vite') && !x.url.includes('@id')
      && !x.url.includes('node_modules')
    )
  ) {
    const url = new URL(entry.url)
    const pathname = url.pathname
    if (url.protocol.startsWith('http')) {
      log('fetching sourcemap:', entry.url)
      const sources = await fetchSourceMap(entry.url)
      // log('sources', sources)
      if (!sources?.sourceMap?.sourcemap) continue

      let filepath: string
      if (pathname.startsWith('/@fs')) {
        filepath = pathname.replace('/@fs', '')
      } else {
        filepath = path.join(root, pathname.slice(1))
      }
      log('resolved sourcemap path', filepath)
      if (!filepath.startsWith(root)) continue

      const converter = v8ToIstanbul(filepath, 0, sources)
      log('converter loading')
      await converter.load()
      log('converter loaded')
      converter.applyCoverage(entry.functions)

      coverageMap.merge(converter.toIstanbul())
    }
  }

  log('creating coverage report context')
  const context = libReport.createContext({
    dir: root,
    watermarks: {
      statements: [50, 80],
      functions: [50, 80],
      branches: [50, 80],
      lines: [50, 80],
    },
    coverageMap,
  })

  for (const reporter of ['text'] as (keyof ReportOptions)[]) {
    const report = reports.create(reporter, {
      projectRoot: root,
      maxCols: process.stdout.columns || 100,
    })
    report.execute(context)
  }
}
