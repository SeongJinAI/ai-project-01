const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('desktop', {
  onCardShortcut: callback => ipcRenderer.on('card-shortcut', (_, action) => callback(action)),
  bridgeStatus: () => ipcRenderer.invoke('bridge-status'),
  bridgeSend: prompt => ipcRenderer.invoke('bridge-send', prompt),
  bridgeCancel: () => ipcRenderer.send('bridge-cancel'),
  onBridgeEvent: callback => ipcRenderer.on('bridge-event', (_, event) => callback(event)),
  petDrag: action => ipcRenderer.send('pet-drag', action),
  petResize: delta => ipcRenderer.send('pet-resize', delta),
  onPetScale: callback => ipcRenderer.on('pet-scale', (_, scale) => callback(scale)),
  fly: () => ipcRenderer.send('pet-fly'), onFly: callback => ipcRenderer.on('pet-fly', (_, state) => callback(state)),
  onCape: callback => { ipcRenderer.on('cape', (_, state) => callback(state)); },
  toggle: () => ipcRenderer.send('toggle'), hide: () => ipcRenderer.send('hide'), quit: () => ipcRenderer.send('quit'),
  copy: text => ipcRenderer.invoke('copy', text), paste: () => ipcRenderer.invoke('paste')
});
