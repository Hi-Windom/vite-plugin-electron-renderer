import { ipcRenderer } from 'electron'
import fs from 'fs'

console.log('Electron API:\n', ipcRenderer)
console.log('Node.js API:\n', fs)
