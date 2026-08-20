const { app, BrowserWindow, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const bridgeProcesses = new Map();
const machineHealth = {
  zkteco: new Map(),
  hikvision: new Map()
};
const CURRENT_CONFIG_VERSION = 3;
let hikvisionBackfillProcess = null;
let mainWindow = null;
let installingDependencies = false;
let quitting = false;

const singleInstanceLock = app.requestSingleInstanceLock();
if (!singleInstanceLock) {
  app.quit();
}

const defaultConfig = {
  configVersion: CURRENT_CONFIG_VERSION,
  backendUrl: "http://localhost:8080",
  bridgeToken: "",
  autoStart: true,
  zkteco: {
    enabled: true,
    deviceIps: "10.10.4.40,10.10.4.41,10.10.4.42,10.10.4.43,10.10.4.46",
    port: 4370,
    password: "0",
    intervalSeconds: 30,
    timeoutSeconds: 8,
    batchSize: 100,
    lookbackHours: 24
  },
  hikvision: {
    enabled: true,
    cameraUrls: "http://10.10.4.101,http://10.10.4.102,http://10.10.4.103,http://10.10.4.104,http://10.10.4.105,http://10.10.4.106,http://10.10.4.107",
    username: "admin",
    password: "",
    intervalSeconds: 5,
    lookbackMinutes: 60,
    maxResults: 30,
    timeoutSeconds: 10
  }
};

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1120,
    height: 780,
    minWidth: 960,
    minHeight: 680,
    title: "Integration Hub LAN Bridge_v2",
    backgroundColor: "#f6f4f3",
    icon: appIconPath(),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  mainWindow.on("close", (event) => {
    if (!quitting && isAnyBridgeRunning()) {
      event.preventDefault();
      mainWindow.hide();
    }
  });
}

if (singleInstanceLock) {
  app.on("second-instance", () => {
    mainWindow?.show();
    mainWindow?.focus();
  });

  app.whenReady().then(() => {
    const config = loadConfig();
    createWindow();
    applyAutoStart(config.autoStart);
    if (config.autoStart) {
      mainWindow.webContents.once("did-finish-load", () => {
        emitLog("app", "Starting enabled bridges automatically.");
        startConfiguredBridges(config);
      });
    }

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createWindow();
        return;
      }
      mainWindow?.show();
    });
  });
}

app.on("before-quit", () => {
  quitting = true;
  stopBridge("zkteco");
  stopBridge("hikvision");
  stopHikvisionBackfill();
});

function appRoot() {
  return app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
}

function appIconPath() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "app.asar", "public", "INTEGRATION-HUb.png")
    : path.join(__dirname, "..", "public", "INTEGRATION-HUb.png");
}

function workersDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "workers")
    : path.join(__dirname, "..", "workers");
}

function userDataPath(...segments) {
  return path.join(app.getPath("userData"), ...segments);
}

function configPath() {
  return userDataPath("bridge-config.json");
}

function stateDir() {
  const dir = userDataPath("state");
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function venvDir() {
  return userDataPath(".venv-bridges");
}

function venvPythonPath() {
  return process.platform === "win32"
    ? path.join(venvDir(), "Scripts", "python.exe")
    : path.join(venvDir(), "bin", "python");
}

function pythonExecutable() {
  const venvPython = venvPythonPath();
  if (fs.existsSync(venvPython)) {
    return venvPython;
  }
  return process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
}

function loadConfig() {
  try {
    if (!fs.existsSync(configPath())) {
      return structuredClone(defaultConfig);
    }
    const raw = JSON.parse(fs.readFileSync(configPath(), "utf8"));
    const config = mergeConfig(defaultConfig, raw);
    if (Number(raw.configVersion || 0) < CURRENT_CONFIG_VERSION) {
      config.configVersion = CURRENT_CONFIG_VERSION;
      config.autoStart = true;
      fs.writeFileSync(configPath(), JSON.stringify(config, null, 2));
    }
    return config;
  } catch (error) {
    emitLog("app", `Could not read config: ${error.message}`);
    return structuredClone(defaultConfig);
  }
}

function saveConfig(config) {
  const nextConfig = mergeConfig(defaultConfig, config || {});
  nextConfig.configVersion = CURRENT_CONFIG_VERSION;
  fs.mkdirSync(path.dirname(configPath()), { recursive: true });
  fs.writeFileSync(configPath(), JSON.stringify(nextConfig, null, 2));
  applyAutoStart(nextConfig.autoStart);
  return nextConfig;
}

function mergeConfig(base, override) {
  const result = structuredClone(base);
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      result[key] &&
      typeof result[key] === "object"
    ) {
      result[key] = { ...result[key], ...value };
    } else {
      result[key] = value;
    }
  }
  return result;
}

function applyAutoStart(enabled) {
  try {
    app.setLoginItemSettings({ openAtLogin: Boolean(enabled) });
  } catch (error) {
    emitLog("app", `Could not update login item: ${error.message}`);
  }
}

function isAnyBridgeRunning() {
  return (
    [...bridgeProcesses.values()].some((entry) => entry.process && !entry.process.killed) ||
    Boolean(hikvisionBackfillProcess && !hikvisionBackfillProcess.killed)
  );
}

function statusPayload() {
  const config = loadConfig();
  return {
    zkteco: Boolean(bridgeProcesses.get("zkteco")?.process),
    hikvision: Boolean(bridgeProcesses.get("hikvision")?.process),
    hikvisionBackfill: Boolean(hikvisionBackfillProcess),
    installingDependencies,
    python: pythonExecutable(),
    appRoot: appRoot(),
    configPath: configPath(),
    machines: {
      zkteco: machineSummary("zkteco", config),
      hikvision: machineSummary("hikvision", config)
    }
  };
}

function emitStatus() {
  mainWindow?.webContents.send("bridge:status", statusPayload());
}

function emitLog(source, message) {
  const line = {
    source,
    message: String(message || "").trimEnd(),
    at: new Date().toISOString()
  };
  if (line.message) {
    mainWindow?.webContents.send("bridge:log", line);
  }
}

function splitConfiguredValues(value, options = {}) {
  if (!value) {
    return [];
  }
  return String(value)
    .replace(/\r?\n/g, ",")
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (options.trimTrailingSlash ? part.replace(/\/+$/, "") : part));
}

function configuredMachines(kind, config) {
  const raw =
    kind === "zkteco"
      ? config.zkteco?.deviceIps
      : config.hikvision?.cameraUrls;
  return splitConfiguredValues(raw, { trimTrailingSlash: kind === "hikvision" });
}

function normalizeMachineId(kind, value) {
  const trimmed = String(value || "").trim();
  return kind === "hikvision" ? trimmed.replace(/\/+$/, "") : trimmed;
}

function machineLabel(kind, id) {
  if (kind === "zkteco") {
    return id;
  }
  try {
    return new URL(id).hostname || id;
  } catch (_error) {
    return id;
  }
}

function machineSummary(kind, config) {
  const running = Boolean(bridgeProcesses.get(kind)?.process);
  const enabled = Boolean(kind === "zkteco" ? config.zkteco?.enabled : config.hikvision?.enabled);
  const pollSeconds = Number(
    kind === "zkteco" ? config.zkteco?.intervalSeconds : config.hikvision?.intervalSeconds
  ) || 30;
  const staleAfterMs = Math.max(pollSeconds * 3, 60) * 1000;
  const machines = configuredMachines(kind, config).map((id) => {
    const normalizedId = normalizeMachineId(kind, id);
    const health = machineHealth[kind].get(normalizedId);
    let state = "pending";
    let message = "Waiting for first bridge check.";

    if (!enabled) {
      state = "disabled";
      message = "Bridge source is disabled.";
    } else if (!running) {
      state = "stopped";
      message = health?.message || "Bridge is stopped.";
    } else if (health) {
      state = health.state;
      message = health.message;
      if (state === "online" && Date.now() - new Date(health.lastAt).getTime() > staleAfterMs) {
        state = "stale";
        message = "No recent bridge update from this machine.";
      }
    }

    return {
      id: normalizedId,
      label: machineLabel(kind, normalizedId),
      serial: health?.serial || null,
      state,
      message,
      lastAt: health?.lastAt || null
    };
  });

  const counts = machines.reduce(
    (total, machine) => {
      total[machine.state] = (total[machine.state] || 0) + 1;
      return total;
    },
    {}
  );

  return {
    configuredCount: machines.length,
    onlineCount: counts.online || 0,
    attentionCount: (counts.warning || 0) + (counts.stale || 0),
    errorCount: counts.error || 0,
    pendingCount: counts.pending || 0,
    stoppedCount: counts.stopped || 0,
    disabledCount: counts.disabled || 0,
    machines
  };
}

function observeMachineLog(kind, line) {
  const parsed = parseMachineLog(kind, line);
  if (!parsed) {
    return;
  }
  machineHealth[kind].set(normalizeMachineId(kind, parsed.id), {
    state: parsed.state,
    message: parsed.message,
    serial: parsed.serial || null,
    lastAt: new Date().toISOString()
  });
}

function parseMachineLog(kind, line) {
  if (kind === "zkteco") {
    const match = String(line).match(/^([^\s:]+)(?: \(([^)]+)\))?: (.+)$/);
    if (!match) {
      return null;
    }
    const message = match[3];
    if (message.startsWith("failed to read attendance:")) {
      return { id: match[1], serial: match[2], state: "error", message };
    }
    if (message.startsWith("failed to post ")) {
      return { id: match[1], serial: match[2], state: "warning", message };
    }
    if (message === "no new punches." || message.startsWith("posted ")) {
      return { id: match[1], serial: match[2], state: "online", message };
    }
    return null;
  }

  const match = String(line).match(
    /^(.*?): (failed to fetch events: .+|no new face events\.|failed to post \d+ events: .+|posted \d+ face events\.)$/
  );
  if (!match) {
    return null;
  }
  const message = match[2];
  if (message.startsWith("failed to fetch events:")) {
    return { id: match[1], state: "error", message };
  }
  if (message.startsWith("failed to post ")) {
    return { id: match[1], state: "warning", message };
  }
  if (message === "no new face events." || message.startsWith("posted ")) {
    return { id: match[1], state: "online", message };
  }
  return null;
}

function startBridge(kind, configInput) {
  if (bridgeProcesses.get(kind)?.process) {
    return statusPayload();
  }

  const config = saveConfig(configInput || loadConfig());
  machineHealth[kind].clear();
  const script =
    kind === "zkteco"
      ? path.join(workersDir(), "zkteco_bridge.py")
      : path.join(workersDir(), "hikvision_bridge.py");

  const child = spawn(pythonExecutable(), [script], {
    cwd: appRoot(),
    env: workerEnv(kind, config),
    stdio: ["ignore", "pipe", "pipe"]
  });

  bridgeProcesses.set(kind, { process: child, startedAt: Date.now() });
  emitLog("app", `Started ${kind} bridge with ${pythonExecutable()}.`);
  emitStatus();

  child.stdout.on("data", (data) => {
    splitLines(data).forEach((line) => {
      observeMachineLog(kind, line);
      emitLog(kind, line);
    });
  });
  child.stderr.on("data", (data) => {
    splitLines(data).forEach((line) => {
      observeMachineLog(kind, line);
      emitLog(kind, line);
    });
  });
  child.on("exit", (code, signal) => {
    bridgeProcesses.delete(kind);
    emitLog("app", `${kind} bridge stopped${signal ? ` by ${signal}` : ` with code ${code}`}.`);
    emitStatus();
  });

  return statusPayload();
}

function stopBridge(kind) {
  const entry = bridgeProcesses.get(kind);
  if (!entry?.process) {
    return statusPayload();
  }
  entry.process.kill();
  bridgeProcesses.delete(kind);
  emitLog("app", `Stopping ${kind} bridge.`);
  emitStatus();
  return statusPayload();
}

function startConfiguredBridges(configInput) {
  const config = saveConfig(configInput || loadConfig());
  if (config.zkteco.enabled) {
    startBridge("zkteco", config);
  }
  if (config.hikvision.enabled) {
    startBridge("hikvision", config);
  }
  return statusPayload();
}

function validateBackfillRequest(range, config) {
  const from = String(range?.from || "").trim();
  const to = String(range?.to || "").trim();
  const localDateTimePattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
  if (!localDateTimePattern.test(from) || !localDateTimePattern.test(to)) {
    throw new Error("Select a valid recovery start and end date/time.");
  }
  if (from >= to) {
    throw new Error("Recovery end time must be after the start time.");
  }

  const configuredCameraUrls = splitConfiguredValues(config.hikvision?.cameraUrls, {
    trimTrailingSlash: true
  });
  const requestedCameraUrl = normalizeMachineId("hikvision", range?.cameraUrl);
  if (requestedCameraUrl && !configuredCameraUrls.includes(requestedCameraUrl)) {
    throw new Error("The selected camera is not in the configured Hikvision camera list.");
  }
  return { from, to, cameraUrl: requestedCameraUrl };
}

function startHikvisionBackfill(configInput, rangeInput) {
  if (hikvisionBackfillProcess) {
    throw new Error("A Hikvision recovery is already running.");
  }

  const config = saveConfig(configInput || loadConfig());
  const range = validateBackfillRequest(rangeInput, config);
  if (!config.hikvision.enabled) {
    throw new Error("Enable Hikvision before pulling missed events.");
  }
  if (!String(config.hikvision.cameraUrls || "").trim()) {
    throw new Error("Configure at least one Hikvision camera URL.");
  }
  if (!String(config.backendUrl || "").trim() || !String(config.bridgeToken || "").trim()) {
    throw new Error("Backend URL and bridge token are required.");
  }

  const script = path.join(workersDir(), "hikvision_bridge.py");
  const child = spawn(pythonExecutable(), [script], {
    cwd: appRoot(),
    env: {
      ...workerEnv("hikvision", config),
      HIKVISION_BACKFILL_FROM: range.from,
      HIKVISION_BACKFILL_TO: range.to,
      HIKVISION_BACKFILL_CAMERA_URLS: range.cameraUrl
    },
    stdio: ["ignore", "pipe", "pipe"]
  });

  hikvisionBackfillProcess = child;
  emitLog(
    "hikvision-recovery",
    `Pulling ${range.cameraUrl || "all configured cameras"} from ${range.from} to ${range.to} (Asia/Colombo).`
  );
  emitStatus();

  child.stdout.on("data", (data) => {
    splitLines(data).forEach((line) => emitLog("hikvision-recovery", line));
  });
  child.stderr.on("data", (data) => {
    splitLines(data).forEach((line) => emitLog("hikvision-recovery", line));
  });
  child.on("error", (error) => {
    if (hikvisionBackfillProcess === child) {
      hikvisionBackfillProcess = null;
    }
    emitLog("hikvision-recovery", `Could not start recovery: ${error.message}`);
    emitStatus();
  });
  child.on("exit", (code, signal) => {
    if (hikvisionBackfillProcess === child) {
      hikvisionBackfillProcess = null;
    }
    emitLog(
      "hikvision-recovery",
      signal ? `Recovery stopped by ${signal}.` : code === 0 ? "Recovery completed." : `Recovery failed with code ${code}.`
    );
    emitStatus();
  });

  return statusPayload();
}

function stopHikvisionBackfill() {
  if (!hikvisionBackfillProcess) {
    return statusPayload();
  }
  hikvisionBackfillProcess.kill();
  hikvisionBackfillProcess = null;
  emitLog("hikvision-recovery", "Stopping recovery.");
  emitStatus();
  return statusPayload();
}

function workerEnv(kind, config) {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED: "1",
    BRIDGE_STATE_DIR: stateDir(),
    BRIDGE_SHARED_TOKEN: config.bridgeToken || "",
    BRIDGE_TIME_ZONE: "Asia/Colombo"
  };

  if (kind === "zkteco") {
    Object.assign(env, {
      ZKTECO_BRIDGE_BACKEND_URL: config.backendUrl || "",
      ZKTECO_DEVICE_IPS: config.zkteco.deviceIps || "",
      ZKTECO_PORT: String(config.zkteco.port || 4370),
      ZKTECO_PASSWORD: String(config.zkteco.password || "0"),
      ZKTECO_INTERVAL_SECONDS: String(config.zkteco.intervalSeconds || 30),
      ZKTECO_TIMEOUT_SECONDS: String(config.zkteco.timeoutSeconds || 8),
      ZKTECO_BATCH_SIZE: String(config.zkteco.batchSize || 100),
      ZKTECO_LOOKBACK_HOURS: String(config.zkteco.lookbackHours || 24)
    });
  } else {
    Object.assign(env, {
      HIKVISION_BRIDGE_BACKEND_URL: config.backendUrl || "",
      HIKVISION_CAMERA_URLS: config.hikvision.cameraUrls || "",
      HIKVISION_USERNAME: config.hikvision.username || "",
      HIKVISION_PASSWORD: config.hikvision.password || "",
      HIKVISION_INTERVAL_SECONDS: String(config.hikvision.intervalSeconds || 5),
      HIKVISION_LOOKBACK_MINUTES: String(config.hikvision.lookbackMinutes || 60),
      HIKVISION_MAX_RESULTS: String(config.hikvision.maxResults || 30),
      HIKVISION_TIMEOUT_SECONDS: String(config.hikvision.timeoutSeconds || 10)
    });
  }

  return env;
}

function splitLines(data) {
  return String(data).split(/\r?\n/).filter((line) => line.trim().length > 0);
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, options);
    child.stdout?.on("data", (data) => splitLines(data).forEach((line) => emitLog("deps", line)));
    child.stderr?.on("data", (data) => splitLines(data).forEach((line) => emitLog("deps", line)));
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(`${command} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

async function installDependencies() {
  if (installingDependencies) {
    return statusPayload();
  }
  installingDependencies = true;
  emitStatus();
  try {
    fs.mkdirSync(venvDir(), { recursive: true });
    const basePython = process.env.PYTHON_PATH || (process.platform === "win32" ? "python" : "python3");
    emitLog("deps", `Creating Python environment at ${venvDir()}.`);
    await runCommand(basePython, ["-m", "venv", venvDir()], { cwd: appRoot() });
    emitLog("deps", "Installing worker packages.");
    await runCommand(
      venvPythonPath(),
      ["-m", "pip", "install", "--upgrade", "pip", "-r", path.join(workersDir(), "requirements.txt")],
      { cwd: appRoot() }
    );
    emitLog("deps", "Python bridge dependencies are ready.");
  } finally {
    installingDependencies = false;
    emitStatus();
  }
  return statusPayload();
}

function bridgeHealthUrl(backendUrl) {
  return new URL("/api/bridge/health", backendUrl.endsWith("/") ? backendUrl : `${backendUrl}/`).toString();
}

ipcMain.handle("config:get", () => loadConfig());
ipcMain.handle("config:save", (_event, config) => saveConfig(config));
ipcMain.handle("bridge:status", () => statusPayload());
ipcMain.handle("bridge:start", (_event, kind, config) => startBridge(kind, config));
ipcMain.handle("bridge:stop", (_event, kind) => stopBridge(kind));
ipcMain.handle("bridge:startAll", (_event, config) => {
  return startConfiguredBridges(config);
});
ipcMain.handle("bridge:stopAll", () => {
  stopBridge("zkteco");
  stopBridge("hikvision");
  stopHikvisionBackfill();
  return statusPayload();
});
ipcMain.handle("bridge:hikvisionBackfill", (_event, config, range) =>
  startHikvisionBackfill(config, range)
);
ipcMain.handle("deps:install", () => installDependencies());
ipcMain.handle("app:setAutoStart", (_event, enabled) => {
  const config = loadConfig();
  config.autoStart = Boolean(enabled);
  return saveConfig(config);
});
ipcMain.handle("app:openUserData", () => shell.openPath(app.getPath("userData")));
ipcMain.handle("bridge:testHealth", async (_event, configInput) => {
  const config = saveConfig(configInput || loadConfig());
  const response = await fetch(bridgeHealthUrl(config.backendUrl), {
    headers: {
      "X-Bridge-Token": config.bridgeToken || ""
    }
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`Backend returned ${response.status}: ${text}`);
  }
  emitLog("app", "Backend bridge health check passed.");
  return text;
});
