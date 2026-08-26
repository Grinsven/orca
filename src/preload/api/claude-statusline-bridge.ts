import { ipcRenderer } from 'electron'
import type { ClaudeStatuslineApi, ClaudeStatuslineContextEvent } from './claude-statusline-api'

export const claudeStatuslineApi: ClaudeStatuslineApi = {
  onContext: (callback: (data: ClaudeStatuslineContextEvent) => void): (() => void) => {
    const listener = (_event: Electron.IpcRendererEvent, data: ClaudeStatuslineContextEvent) =>
      callback(data)
    ipcRenderer.on('claudeStatusline:context', listener)
    return () => ipcRenderer.removeListener('claudeStatusline:context', listener)
  }
}
