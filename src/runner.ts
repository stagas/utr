declare const window: Window & typeof globalThis & any

const g = typeof global === 'object' ? global : typeof window === 'object' ? window : globalThis

export interface TestRunnerOptions {
  testNamePattern: string
}

export interface TestResult {
  task?: Task
  error?: any
  status?: 'passed' | 'failed' | 'skipped'
}

export interface Task {
  isGroup: boolean
  isOnly: boolean
  isSkip: boolean

  filename: string
  ownName: string
  namespace: string[]
  title: string
  fn: () => Promise<void>

  snapshots: string[]

  didError: Error
  didNotError: Error
  didSkipError: Error
}

const executer = (isGroup = false, isOnly = false, isSkip = false) =>
  function runTest(ownName: string, fn: () => Promise<void>) {
    const namespace = [...current.namespace, ownName]
    const title = namespace.join(' › ')

    class DidError extends Error {
      name = 'DidError'
    }
    class DidNotError extends Error {
      name = 'DidNotError'
    }
    class DidSkipError extends Error {
      name = 'DidSkipError'
    }

    const didError = new DidError('\n\n  ● ' + title + '\n\n')
    const didNotError = new DidNotError('\n\n  ✓ ' + title + '\n')
    const didSkipError = new DidSkipError('\n\n  ○ ' + title + '\n')

    current.schedule.push({
      filename: current.filename,
      isGroup,
      isOnly,
      isSkip,
      ownName,
      namespace,
      title,
      fn,
      snapshots: [],
      didError,
      didNotError,
      didSkipError,
    })
  }

const describe = executer(true) as any
const it = executer() as any

describe.only = executer(true, true)
describe.skip = executer(true, false, true)
it.only = executer(false, true)
it.skip = executer(false, false, true)

g.describe = describe
g.it = it

g.test = it
g.fit = it.only
g.xit = it.skip
g.fdescribe = describe.only
g.xdescribe = describe.skip

const stack: { task?: Task; schedule: Task[] }[] = [{ schedule: [] }]

const current = {
  filename: '',
  get schedule() {
    return stack.at(-1)!.schedule
  },
  get task() {
    return stack.at(-1)!.task
  },
  get namespace() {
    return current.task?.namespace ?? []
  },
  get tasks() {
    return stack.map(x => x.task).filter(Boolean) as Task[]
  },
  get isOnly() {
    return current.tasks.every(x => !x.isSkip) && current.tasks.some(x => x.isOnly)
  },
  get isSkip() {
    return current.tasks.some(x => x.isSkip)
  },
}

g.current = current

g.runTests = async (filename: string, { testNamePattern }: TestRunnerOptions) => {
  current.filename = filename

  const results: TestResult[] = []

  const queue: { task: Task; isOnly: boolean; isSkip: boolean }[] = []

  const createQueue = (schedule: Task[]) => {
    for (const task of schedule) {
      stack.push({ task, schedule: [] })

      if (task.isGroup || !testNamePattern.length || task.namespace.join(' ').match(new RegExp(testNamePattern))) {
        queue.push({
          task,
          isOnly: current.isOnly,
          isSkip: current.isSkip,
        })
      }

      if (task.isGroup) {
        task.fn()
        createQueue(current.schedule)
      }
      stack.pop()
    }
  }

  createQueue(current.schedule)

  if (queue.some(x => x.isOnly)) {
    queue.forEach(x => {
      if (!x.isOnly) x.isSkip = true
    })
  }

  for (const { task, isSkip } of queue) {
    if (task.isGroup) {
      results.push({ task })
    } else {
      if (isSkip) {
        console.debug(task.didSkipError.stack)
        results.push({
          task,
          status: 'skipped',
        })
      } else {
        try {
          stack.push({ task, schedule: [] })
          await task.fn()
          stack.pop()

          console.warn(task.didNotError.stack)

          results.push({
            task,
            status: 'passed',
          })
        } catch (err) {
          const error = err as Error
          const name = error.name

          Object.defineProperty(error, 'name', { value: 'DidError' })
          const message = error.message
          Object.defineProperty(error, 'message', { value: task.didError.message + name + ': ' + error.message })
          console.error(error.stack)

          if (g.getStackCodeFrame) {
            const matcherResult = (error as any).matcherResult
            const codeFrame = await g.getStackCodeFrame(
              matcherResult?.message?.split('\n')[0]?.split('// ').pop() ?? message,
              error.stack!
            )
            if (codeFrame) console.error('\n' + codeFrame)
          }

          results.push({
            task,
            error: {
              message: error.message,
              stack: error.stack,
              matcherResult: (error as any).matcherResult,
            },
            status: 'failed',
          })
        }
      }
    }
  }

  return results
}
