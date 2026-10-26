// 웹 화면(렌더러)에 노출하는 최소 API. 토큰은 쓰기 전용이라 화면에서 다시 읽을 수 없다.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  getInfo: () => ipcRenderer.invoke('desktop:info'),
  setToken: (token) => ipcRenderer.invoke('desktop:set-token', String(token ?? '')),
  clearToken: () => ipcRenderer.invoke('desktop:clear-token'),
  checkForUpdates: () => ipcRenderer.invoke('desktop:check-update'),
  onUpdateStatus: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on('desktop:update-status', handler);
    return () => ipcRenderer.removeListener('desktop:update-status', handler);
  },
});
