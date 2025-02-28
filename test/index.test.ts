import {
  describe,
  expect,
  it,
} from 'vitest'
import renderer from '../src'

describe('src/index.ts', () => {
  it('nodeIntegration:true', () => {
    const plugins = (renderer({ nodeIntegration: true }) as any[]).flat().filter(Boolean)
    const names = [
      '@sillot/vite-plugin-electron-renderer:builtins',
      '@sillot/vite-plugin-electron-renderer:build-config',
      '@sillot/vite-plugin-electron-renderer:optimizer',
      '@sillot/vite-plugin-electron-renderer:cjs-shim',
    ]
    
    expect(plugins.map(p => p.name)).toEqual(names)
  })
  
  it('nodeIntegration:false', () => {
    const plugins = (renderer({ nodeIntegration: false }) as any[]).flat().filter(Boolean)
    const names = [
      '@sillot/vite-plugin-electron-renderer:builtins',
      '@sillot/vite-plugin-electron-renderer:build-config',
      '@sillot/vite-plugin-electron-renderer:optimizer',
    ]

    expect(plugins.map(p => p.name)).toEqual(names)
  })
})
