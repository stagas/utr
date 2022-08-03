import * as fs from 'fs'

import { transformSync } from '@swc-node/core'
import { addHook } from 'pirates'
import sourceMapSupport from 'source-map-support'

const DEFAULT_EXTENSIONS = ['.js', '.jsx', '.ts', '.tsx']
// const DEFAULT_EXTENSIONS = ['.js', '.jsx', '.es6', '.es', '.mjs', '.ts', '.tsx']

const config = JSON.parse(fs.readFileSync('.swcrc', 'utf-8'))
config.sourceMaps = 'inline'

const sourcemaps = new Map<string, any>()

export function compile(
  sourcecode: string,
  filename: string,
) {
  if (filename.endsWith('.d.ts')) return ''
  const { code, map } = transformSync(sourcecode, filename, { swc: config })
  if (map) sourcemaps.set(filename, map)
  return code
}

export function register() {
  sourceMapSupport.install({
    hookRequire: true,
    handleUncaughtExceptions: false,
    environment: 'node',
    retrieveSourceMap(url) {
      if (sourcemaps.has(url)) {
        return {
          url,
          map: sourcemaps.get(url),
        }
      }
      return null
    },
  })
  return addHook((code, filename) => compile(code, filename), {
    exts: DEFAULT_EXTENSIONS,
    // ignoreNodeModules: false,
  })
}

register()
