import { builtinModules } from 'node:module'
import type {
  Alias,
  Plugin,
  UserConfig,
} from 'vite'
import type { ExternalOption, RollupOptions } from 'rollup'

export const builtins = [
  'electron',
  ...builtinModules.filter(m => !m.startsWith('_')),
  ...builtinModules.filter(m => !m.startsWith('_')).map(mod => `node:${mod}`),
]

export default function buildConfig(nodeIntegration?: boolean): Plugin[] {
  return [
    {
      name: '@sillot/vite-plugin-electron-renderer:builtins',
      config(config) {
        const aliases: Alias[] = [
          // Always polyfill electron.
          {
            find: 'electron',
            replacement: '@sillot/vite-plugin-electron-renderer/builtins/electron',
          },
          ...(nodeIntegration ? builtins
            .filter(m => m !== 'electron')
            .filter(m => !m.startsWith('node:'))
            .map<Alias>(m => ({
              find: new RegExp(`^(node:)?${m}$`),
              replacement: `@sillot/vite-plugin-electron-renderer/builtins/${m}`,
            })) : []),
        ]

        modifyAlias(config, aliases)
        modifyOptimizeDeps(
          config,
          nodeIntegration
            ? builtins.concat(aliases.map(({ replacement }) => replacement))
            : [
              'electron',
              '@sillot/vite-plugin-electron-renderer/builtins/electron',
            ],
        )
      },
    },
    {
      name: '@sillot/vite-plugin-electron-renderer:build-config',
      apply: 'build',
      config(config) {
        // Make sure that Electron can be loaded into the local file using `loadFile` after packaging
        config.base ??= './'

        config.build ??= {}

        // TODO: init `config.build.target`
        // https://github.com/vitejs/vite/pull/8843

        // https://github.com/electron-vite/electron-vite-vue/issues/107
        config.build.cssCodeSplit ??= false

        // TODO: compatible with custom assetsDir
        // This will guarantee the proper loading of static resources, such as images, `worker.js`
        // The `.js` file can be loaded correctly with cjs-shim.ts
        config.build.assetsDir ??= ''

        if (nodeIntegration) {
          config.build.rollupOptions ??= {}
          config.build.rollupOptions.external = withExternal(config.build.rollupOptions.external)
          setOutputFormat(config.build.rollupOptions)
        }
      },
    },
  ]
}

function withExternal(external?: ExternalOption) {
  if (
    Array.isArray(external) ||
    typeof external === 'string' ||
    external instanceof RegExp
  ) {
    // @ts-ignore
    external = builtins.concat(external)
  } else if (typeof external === 'function') {
    const original = external
    external = function externalFn(source, importer, isResolved) {
      if (builtins.includes(source)) {
        return true
      }
      return original(source, importer, isResolved)
    }
  } else {
    external = builtins
  }
  return external
}

// At present, Electron can only support CommonJs
function setOutputFormat(rollupOptions: RollupOptions) {
  rollupOptions.output ??= {}
  if (Array.isArray(rollupOptions.output)) {
    for (const o of rollupOptions.output) {
      o.format ??= 'cjs'
    }
  } else {
    rollupOptions.output.format ??= 'cjs'
  }
}

export function modifyOptimizeDeps(config: UserConfig, exclude: string[]) {
  config.optimizeDeps ??= {}
  config.optimizeDeps.exclude ??= []
  config.optimizeDeps.exclude.push(...exclude.filter(e => !config.optimizeDeps?.exclude?.includes(e)))
}

export function modifyAlias(config: UserConfig, aliases: Alias[]) {
  config.resolve ??= {}
  config.resolve.alias ??= []
  if (Object.prototype.toString.call(config.resolve.alias) === '[object Object]') {
    config.resolve.alias = Object
      .entries(config.resolve.alias)
      .reduce<Alias[]>((memo, [find, replacement]) => memo.concat({ find, replacement }), [])
  }
  (config.resolve.alias as Alias[]).push(...aliases)
}
