import type { MatcherFunction } from 'expect'
import pretty from './vendor/pretty-format2'

import type { Task } from './runner'

declare const current: { filename: string; task: Task }
declare const snapshots: Record<string, Snapshots>

export type Snapshots = {
  [k: string]: string
} & { $locations?: Record<string, { line: number; column: number }> }

function dirname(x: string) {
  return x.split('/').slice(0, -1).join('/') ?? x
}

function basename(x: string) {
  return x.split('/').pop() ?? x
}

export function filenameToSnap(filename: string) {
  const snap = `${dirname(filename)}/__snapshots__/${basename(filename)}.snap`
  return filename[0] === '/' && snap[0] !== '/' ? '/' + snap : snap
}

function isMultiline(x: string) {
  return x.includes('\n')
}

function toMatchSnapshot(withUpdate: boolean): MatcherFunction {
  return function(received: any) {
    const serialized = pretty(received)
    const actual = isMultiline(serialized) ? `\n${serialized}\n` : serialized
    current.task.snapshots.push(actual)
    if (withUpdate)
      return {
        pass: true,
        message: () => '',
      }

    const name = [...current.task.namespace, current.task.snapshots.length].join(' ')
    const expected = snapshots[current.filename]?.[name]
    const location = snapshots[current.filename]?.$locations?.[name]
    if (expected && location) {
      if (actual !== expected) {
        return {
          pass: false,
          message: () => {
            return `Snapshots mismatch\n\nSnapshot name: ${JSON.stringify(name)}\n    at ${
              filenameToSnap(current.filename)
            }:${location.line}:${location.column}\n\n`
              + 'Actual:\n' + (isMultiline(actual)
                ? actual
                : `\n${actual}\n`)
              + '\nExpected:\n'
              + (isMultiline(expected)
                ? expected
                : `\n${expected}\n`)
          },
        }
      } else {
        return {
          pass: true,
          message: () => '',
        }
      }
    }

    return {
      pass: false,
      message: () => {
        return `New snapshot - Run with -u to update.\n${actual}`
      },
    }
  }
}

export async function fetchSnapshots(files: string[], fetchFn: (filename: string) => Promise<string>) {
  const sources = await Promise.allSettled(
    files.map(async filename => ({
      filename,
      body: await fetchFn(filenameToSnap(filename)),
    }))
  ) as PromiseFulfilledResult<{ filename: string; body: string }>[]

  const snapshots: Record<string, Snapshots> = {}

  for (const { value: snapshot } of sources) {
    try {
      const moduleExports = snapshots[snapshot.filename] = {} as Snapshots
      new Function('exports', snapshot.body)(moduleExports)
      moduleExports.$locations = Object.fromEntries(
        Object.keys(moduleExports).map(x => {
          const index = snapshot.body.indexOf(x)
          const lines = snapshot.body.slice(0, index).split('\n')
          const line = lines.length || 1
          const column = lines.at(-1)?.length || 1
          return [x, { line, column }]
        })
      )
    } catch {}
  }

  return snapshots
}

export const snapshotMatcher = {
  toMatchSnapshot: toMatchSnapshot(false),
}

export const snapshotMatcherUpdater = {
  toMatchSnapshot: toMatchSnapshot(true),
}
