const fs = require("node:fs");
const path = require("node:path");

const appDir = path.resolve(__dirname, "..");
const repoRoot = path.resolve(appDir, "..", "..");

function parseEnvFile(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  const values = {};
  for (const rawLine of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) {
      continue;
    }

    const index = line.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = line.slice(0, index).trim();
    let value = line.slice(index + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function envValue(env, ...names) {
  for (const name of names) {
    const value = process.env[name] || env[name];
    if (value && String(value).trim()) {
      return String(value).trim();
    }
  }
  return "";
}

function isLocalBackendUrl(value) {
  if (!value) {
    return true;
  }
  try {
    const hostname = new URL(value).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch (_error) {
    return true;
  }
}

function inferRenderBackendUrl() {
  const renderPath = path.join(repoRoot, "render.yaml");
  if (!fs.existsSync(renderPath)) {
    return "";
  }

  const match = fs.readFileSync(renderPath, "utf8").match(/^\s*name:\s*([a-z0-9-]+)\s*$/im);
  return match ? `https://${match[1]}.onrender.com` : "";
}

function numberValue(value, fallback) {
  if (value === undefined || value === null || String(value).trim() === "") {
    return fallback;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

const env = {
  ...parseEnvFile(path.join(repoRoot, ".env")),
  ...parseEnvFile(path.join(repoRoot, "backend", ".env")),
  ...parseEnvFile(path.join(appDir, ".env"))
};

let backendUrl = envValue(env, "GARMENTLINE_BRIDGE_BACKEND_URL", "HIKVISION_BRIDGE_BACKEND_URL", "VITE_BACKEND_URL");
if (isLocalBackendUrl(backendUrl)) {
  backendUrl = inferRenderBackendUrl() || backendUrl;
}

const defaultConfig = {
  backendUrl,
  bridgeToken: envValue(env, "GARMENTLINE_BRIDGE_TOKEN", "BRIDGE_SHARED_TOKEN", "HIKVISION_BRIDGE_TOKEN"),
  autoStart: true,
  zkteco: {
    enabled: true,
    deviceIps: envValue(env, "GARMENTLINE_ZKTECO_DEVICE_IPS", "ZKTECO_DEVICE_IPS") ||
      "10.10.4.40,10.10.4.41,10.10.4.42,10.10.4.43,10.10.4.46",
    port: numberValue(envValue(env, "GARMENTLINE_ZKTECO_PORT", "ZKTECO_PORT"), 4370),
    password: envValue(env, "GARMENTLINE_ZKTECO_PASSWORD", "ZKTECO_PASSWORD") || "0",
    intervalSeconds: numberValue(envValue(env, "GARMENTLINE_ZKTECO_INTERVAL_SECONDS", "ZKTECO_INTERVAL_SECONDS"), 30),
    timeoutSeconds: numberValue(envValue(env, "GARMENTLINE_ZKTECO_TIMEOUT_SECONDS", "ZKTECO_TIMEOUT_SECONDS"), 8),
    batchSize: numberValue(envValue(env, "GARMENTLINE_ZKTECO_BATCH_SIZE", "ZKTECO_BATCH_SIZE"), 100),
    lookbackHours: numberValue(envValue(env, "GARMENTLINE_ZKTECO_LOOKBACK_HOURS", "ZKTECO_LOOKBACK_HOURS"), 24)
  },
  hikvision: {
    enabled: true,
    cameraUrls: envValue(env, "GARMENTLINE_HIKVISION_CAMERA_URLS", "HIKVISION_CAMERA_URLS") ||
      "http://10.10.4.101,http://10.10.4.102,http://10.10.4.103,http://10.10.4.104,http://10.10.4.105,http://10.10.4.106,http://10.10.4.107",
    username: envValue(env, "GARMENTLINE_HIKVISION_USERNAME", "HIKVISION_USERNAME") || "admin",
    password: envValue(env, "GARMENTLINE_HIKVISION_PASSWORD", "HIKVISION_PASSWORD"),
    intervalSeconds: numberValue(envValue(env, "GARMENTLINE_HIKVISION_INTERVAL_SECONDS", "HIKVISION_INTERVAL_SECONDS", "HIKVISION_POLL_INTERVAL_SECONDS"), 5),
    timeoutSeconds: numberValue(envValue(env, "GARMENTLINE_HIKVISION_TIMEOUT_SECONDS", "HIKVISION_TIMEOUT_SECONDS"), 10),
    lookbackMinutes: numberValue(envValue(env, "GARMENTLINE_HIKVISION_LOOKBACK_MINUTES", "HIKVISION_LOOKBACK_MINUTES"), 60),
    maxResults: numberValue(envValue(env, "GARMENTLINE_HIKVISION_MAX_RESULTS", "HIKVISION_MAX_RESULTS"), 30)
  }
};

const outputPath = path.join(appDir, "build", "default-config.json");
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, JSON.stringify(defaultConfig, null, 2));

const masked = {
  ...defaultConfig,
  bridgeToken: defaultConfig.bridgeToken ? "[configured]" : "",
  hikvision: {
    ...defaultConfig.hikvision,
    password: defaultConfig.hikvision.password ? "[configured]" : ""
  }
};
console.log(`Wrote ${path.relative(repoRoot, outputPath)}`);
console.log(JSON.stringify(masked, null, 2));
