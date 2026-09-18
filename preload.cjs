const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  onCardShortcut: callback => ipcRenderer.on('card-shortcut', (_, action) => callback(action)),
  bridgeStatus: () => ipcRenderer.invoke('bridge-status'),
  detectBackends: refresh => ipcRenderer.invoke('backends-detect', { refresh: Boolean(refresh) }),
  backendSend: payload => ipcRenderer.invoke('backend-send', payload),
  backendCancel: () => ipcRenderer.send('backend-cancel'),
  backendUsage: payload => ipcRenderer.invoke('backend-usage', payload),
  onBackendEvent: callback => ipcRenderer.on('backend-event', (_, event) => callback(event)),
  petDrag: action => ipcRenderer.send('pet-drag', action),
  petResize: delta => ipcRenderer.send('pet-resize', delta),
  onPetScale: callback => ipcRenderer.on('pet-scale', (_, scale) => callback(scale)),
  fly: () => ipcRenderer.send('pet-fly'), onFly: callback => ipcRenderer.on('pet-fly', (_, state) => callback(state)),
  onCape: callback => { ipcRenderer.on('cape', (_, state) => callback(state)); },
  toggle: () => ipcRenderer.send('toggle'), hide: () => ipcRenderer.send('hide'), quit: () => ipcRenderer.send('quit'),
  copy: text => ipcRenderer.invoke('copy', text), paste: () => ipcRenderer.invoke('paste')
});
