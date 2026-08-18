const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("bridgeApp", {
  getConfig: () => ipcRenderer.invoke("config:get"),
  saveConfig: (config) => ipcRenderer.invoke("config:save", config),
  status: () => ipcRenderer.invoke("bridge:status"),
  start: (kind, config) => ipcRenderer.invoke("bridge:start", kind, config),
  stop: (kind) => ipcRenderer.invoke("bridge:stop", kind),
  startAll: (config) => ipcRenderer.invoke("bridge:startAll", config),
  stopAll: () => ipcRenderer.invoke("bridge:stopAll"),
  backfillHikvision: (config, range) =>
    ipcRenderer.invoke("bridge:hikvisionBackfill", config, range),
  installDependencies: () => ipcRenderer.invoke("deps:install"),
  setAutoStart: (enabled) => ipcRenderer.invoke("app:setAutoStart", enabled),
  openUserData: () => ipcRenderer.invoke("app:openUserData"),
  testBackend: (config) => ipcRenderer.invoke("bridge:testHealth", config),
  onLog: (callback) => {
    const listener = (_event, line) => callback(line);
    ipcRenderer.on("bridge:log", listener);
    return () => ipcRenderer.removeListener("bridge:log", listener);
  },
  onStatus: (callback) => {
    const listener = (_event, status) => callback(status);
    ipcRenderer.on("bridge:status", listener);
    return () => ipcRenderer.removeListener("bridge:status", listener);
  }
});
