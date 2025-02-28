import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { createRequire, builtinModules } from 'node:module'
import type { Alias, Plugin } from 'vite'
import libEsm from 'lib-esm'
import { COLOURS, node_modules as find_node_modules } from 'vite-plugin-utils/function'
import {
  builtins,
  modifyAlias,
  modifyOptimizeDeps,
} from './build-config'

export type DepOptimizationOptions = {
  include?: (string | {
    name: string
    /**
     * Explicitly specify the module type
     * - `commonjs` - Only the ESM code snippet is wrapped
     * - `module` - First build the code as cjs via esbuild, then wrap the ESM code snippet
     */
    type?: "commonjs" | "module"
  })[]
  buildOptions?: import('esbuild').BuildOptions
  // TODO: consider support webpack 🤔
  // webpack?: import('webpack').Configuration
}

const cjs_require = createRequire(import.meta.url)
const CACHE_DIR = './@sillot/vite-electron-renderer'

let node_modules_path: string
let cache: Cache

export default function optimizer(options: DepOptimizationOptions = {}): Plugin {
  const { include, buildOptions } = options

  return {
    name: '@sillot/vite-plugin-electron-renderer:optimizer',
    // At `vite build` phase, Node.js npm-pkgs can be built correctly by Vite.
    // TODO: consider support `vite build` phase, like Vite v3.0.0
    apply: 'serve',
    async config(config) {
      if (!include?.length) return

      node_modules_path = find_node_modules(config.root ? path.resolve(config.root) : process.cwd())[0]
      cache = new Cache(path.join(node_modules_path, CACHE_DIR))

      const deps: {
        esm?: string
        cjs?: string
        filename?: string
      }[] = []
      const aliases: Alias[] = []
      const optimizeDepsExclude = []

      for (const item of include) {
        let name: string
        let type: string | undefined
        if (typeof item === 'string') {
          name = item
        } else {
          name = item.name
          type = item.type
        }
        if (type === 'module') {
          deps.push({ esm: name })
          continue
        }
        if (type === 'commonjs') {
          deps.push({ cjs: name })
          continue
        }
        if (builtins.includes(name)) {
          // Process in `vite-plugin-electron-renderer:builtins` plugin
          continue
        }

        const pkgJson = path.join(node_modules_path, name, 'package.json')
        if (fs.existsSync(pkgJson)) {
          // bare module
          const pkg = cjs_require(pkgJson)
          if (pkg.type === 'module') {
            deps.push({ esm: name })
            continue
          }
          deps.push({ cjs: name })
          continue
        }

        const pkgPath = path.join(node_modules_path, name)
        try {
          // dirname or filename 🤔
          // `foo/bar` or `foo/bar/index.js`
          const filename = cjs_require.resolve(pkgPath)
          if (path.extname(filename) === '.mjs') {
            deps.push({ esm: name, filename })
            continue
          }
          deps.push({ cjs: name, filename })
          continue
        } catch (error) {
          console.log(COLOURS.red('Can not resolve path:'), pkgPath)
        }
      }

      for (const dep of deps) {
        if (!dep.filename) {
          const module = (dep.cjs || dep.esm) as string
          try {
            // TODO: resolve(, [paths condition])
            dep.filename = cjs_require.resolve(module)
          } catch (error) {
            console.log(COLOURS.red('Can not resolve module:'), module)
          }
        }
        if (!dep.filename) {
          continue
        }

        if (dep.cjs) {
          cjsBundling({
            name: dep.cjs,
            require: dep.cjs,
            requireId: dep.filename,
          })
        } else if (dep.esm) {
          esmBundling({
            name: dep.esm,
            entry: dep.filename,
            buildOptions,
          })
        }

        const name = dep.cjs || dep.esm
        if (name) {
          optimizeDepsExclude.push(name)
          const { destname } = dest(name)
          aliases.push({ find: name, replacement: destname })
        }
      }

      modifyAlias(config, aliases)
      modifyOptimizeDeps(config, optimizeDepsExclude)
    },
  }
}

function cjsBundling(args: {
  name: string
  require: string
  requireId: string
}) {
  const { name, require, requireId } = args
  const { destpath, destname } = dest(name)
  if (cache.checkHash(destname)) return

  const { exports } = libEsm({ exports: Object.keys(cjs_require(requireId)) })
  const code = `const _M_ = require("${require}");\n${exports}`

  !fs.existsSync(destpath) && fs.mkdirSync(destpath, { recursive: true })
  fs.writeFileSync(destname, code)
  cache.writeCache(destname)
  console.log(COLOURS.cyan('Pre-bundling:'), COLOURS.yellow(name))
}

async function esmBundling(args: {
  name: string,
  entry: string,
  buildOptions?: import('esbuild').BuildOptions,
}) {
  const { name, entry, buildOptions } = args
  const { name_cjs, destname_cjs } = dest(name)
  if (cache.checkHash(destname_cjs)) return

  let esbuild: typeof import('esbuild')
  try {
    esbuild = await import('esbuild')
  } catch {
    throw new Error('[Pre-Bundling] dependency "esbuild". Did you install it?')
  }

  return esbuild.build({
    entryPoints: [entry],
    outfile: destname_cjs,
    target: 'node14',
    format: 'cjs',
    bundle: true,
    sourcemap: true,
    external: [
      ...builtinModules,
      ...builtinModules.map(mod => `node:${mod}`),
    ],
    ...buildOptions,
  }).then(result => {
    if (!result.errors.length) {
      cache.writeCache(destname_cjs)
      cjsBundling({
        name,
        require: `${CACHE_DIR}/${name}/${name_cjs}`,
        requireId: destname_cjs,
      })
    }
    return result
  })
}

function dest(name: string) {
  const destpath = path.join(node_modules_path, CACHE_DIR, name)
  const name_js = 'index.js'
  const name_cjs = 'index.cjs'
  !fs.existsSync(destpath) && fs.mkdirSync(destpath, { recursive: true })
  return {
    destpath,
    name_js,
    name_cjs,
    destname: path.join(destpath, name_js),
    destname_cjs: path.join(destpath, name_cjs),
  }
}

// ----------------------------------------

export interface ICache {
  timestamp?: number
  optimized?: {
    [filename: string]: {
      hash: string
    }
  }
}

class Cache {
  static getHash(filename: string) {
    return crypto.createHash('md5').update(fs.readFileSync(filename)).digest('hex')
  }

  constructor(
    public root: string,
    public cacheFile = path.join(root, '_metadata.json'),
  ) {
    // TODO: cleanup meta
  }

  checkHash(filename: string) {
    if (!fs.existsSync(filename)) {
      return false
    }
    let hash: string
    try {
      hash = Cache.getHash(filename)
    } catch {
      return false
    }
    const { optimized = {} } = this.readCache()
    for (const [file, meta] of Object.entries(optimized)) {
      if (filename === file && hash === meta.hash) {
        return true
      }
    }
    return false
  }

  readCache(): ICache {
    try {
      return JSON.parse(fs.readFileSync(this.cacheFile, 'utf8'))
    } catch {
      return {}
    }
  }

  writeCache(filename: string) {
    if (!fs.existsSync(filename)) {
      throw new Error(`${filename} is not exist!`)
    }
    const { optimized = {} } = this.readCache()
    const newCache: ICache = {
      timestamp: Date.now(),
      optimized: {
        ...optimized,
        [filename]: {
          hash: Cache.getHash(filename),
        },
      },
    }
    fs.writeFileSync(this.cacheFile, JSON.stringify(newCache, null, 2))
  }
}
