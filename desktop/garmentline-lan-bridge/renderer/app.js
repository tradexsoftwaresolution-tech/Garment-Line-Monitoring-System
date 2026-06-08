const fields = {
  backendUrl: document.querySelector("#backendUrl"),
  bridgeToken: document.querySelector("#bridgeToken"),
  autoStart: document.querySelector("#autoStart"),
  zktecoEnabled: document.querySelector("#zktecoEnabled"),
  zktecoDeviceIps: document.querySelector("#zktecoDeviceIps"),
  zktecoPort: document.querySelector("#zktecoPort"),
  zktecoPassword: document.querySelector("#zktecoPassword"),
  zktecoInterval: document.querySelector("#zktecoInterval"),
  zktecoTimeout: document.querySelector("#zktecoTimeout"),
  zktecoBatchSize: document.querySelector("#zktecoBatchSize"),
  zktecoLookback: document.querySelector("#zktecoLookback"),
  hikvisionEnabled: document.querySelector("#hikvisionEnabled"),
  hikvisionCameraUrls: document.querySelector("#hikvisionCameraUrls"),
  hikvisionUsername: document.querySelector("#hikvisionUsername"),
  hikvisionPassword: document.querySelector("#hikvisionPassword"),
  hikvisionInterval: document.querySelector("#hikvisionInterval"),
  hikvisionTimeout: document.querySelector("#hikvisionTimeout"),
  hikvisionLookback: document.querySelector("#hikvisionLookback"),
  hikvisionMaxResults: document.querySelector("#hikvisionMaxResults")
};

const buttons = {
  saveConfig: document.querySelector("#saveConfig"),
  installDeps: document.querySelector("#installDeps"),
  testBackend: document.querySelector("#testBackend"),
  startAll: document.querySelector("#startAll"),
  stopAll: document.querySelector("#stopAll"),
  startZkteco: document.querySelector("#startZkteco"),
  stopZkteco: document.querySelector("#stopZkteco"),
  startHikvision: document.querySelector("#startHikvision"),
  stopHikvision: document.querySelector("#stopHikvision"),
  clearLog: document.querySelector("#clearLog"),
  openConfigFolder: document.querySelector("#openConfigFolder")
};

const zktecoStatus = document.querySelector("#zktecoStatus");
const hikvisionStatus = document.querySelector("#hikvisionStatus");
const zktecoMachineSummary = document.querySelector("#zktecoMachineSummary");
const hikvisionMachineSummary = document.querySelector("#hikvisionMachineSummary");
const zktecoMachineList = document.querySelector("#zktecoMachineList");
const hikvisionMachineList = document.querySelector("#hikvisionMachineList");
const pythonPath = document.querySelector("#pythonPath");
const logOutput = document.querySelector("#logOutput");

let latestStatus = {};

function numberValue(input, fallback) {
  const parsed = Number(input.value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function formConfig() {
  return {
    backendUrl: fields.backendUrl.value.trim(),
    bridgeToken: fields.bridgeToken.value,
    autoStart: fields.autoStart.checked,
    zkteco: {
      enabled: fields.zktecoEnabled.checked,
      deviceIps: fields.zktecoDeviceIps.value.trim(),
      port: numberValue(fields.zktecoPort, 4370),
      password: fields.zktecoPassword.value,
      intervalSeconds: numberValue(fields.zktecoInterval, 30),
      timeoutSeconds: numberValue(fields.zktecoTimeout, 8),
      batchSize: numberValue(fields.zktecoBatchSize, 100),
      lookbackHours: numberValue(fields.zktecoLookback, 24)
    },
    hikvision: {
      enabled: fields.hikvisionEnabled.checked,
      cameraUrls: fields.hikvisionCameraUrls.value.trim(),
      username: fields.hikvisionUsername.value.trim(),
      password: fields.hikvisionPassword.value,
      intervalSeconds: numberValue(fields.hikvisionInterval, 5),
      timeoutSeconds: numberValue(fields.hikvisionTimeout, 10),
      lookbackMinutes: numberValue(fields.hikvisionLookback, 60),
      maxResults: numberValue(fields.hikvisionMaxResults, 30)
    }
  };
}

function hasText(value) {
  return String(value || "").trim().length > 0;
}

function readableError(error) {
  const message = error?.message || String(error);
  return message.replace(/^Error invoking remote method '[^']+': Error: /, "");
}

function validateUrl(value) {
  try {
    return Boolean(new URL(value));
  } catch (_error) {
    return false;
  }
}

function validateStartConfig(kind, config) {
  const errors = [];
  const wantsZkteco = kind === "zkteco" || (kind === "all" && config.zkteco.enabled);
  const wantsHikvision = kind === "hikvision" || (kind === "all" && config.hikvision.enabled);

  if (hasText(config.backendUrl) && !validateUrl(config.backendUrl)) {
    errors.push("Backend URL must be a full URL, for example http://localhost:8080 or https://your-backend.onrender.com.");
  }
  if (wantsZkteco && !hasText(config.zkteco.deviceIps)) {
    errors.push("At least one ZKTeco device IP is required.");
  }
  if (wantsHikvision) {
    if (!hasText(config.hikvision.cameraUrls)) {
      errors.push("At least one Hikvision camera URL is required.");
    }
    if (!hasText(config.hikvision.username)) {
      errors.push("Hikvision username is required.");
    }
    if (!hasText(config.hikvision.password)) {
      errors.push("Hikvision password is required.");
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join(" "));
  }
}

function fillForm(config) {
  fields.backendUrl.value = config.backendUrl || "";
  fields.bridgeToken.value = config.bridgeToken || "";
  fields.autoStart.checked = Boolean(config.autoStart);
  fields.zktecoEnabled.checked = Boolean(config.zkteco?.enabled);
  fields.zktecoDeviceIps.value = config.zkteco?.deviceIps || "";
  fields.zktecoPort.value = config.zkteco?.port ?? 4370;
  fields.zktecoPassword.value = config.zkteco?.password || "";
  fields.zktecoInterval.value = config.zkteco?.intervalSeconds ?? 30;
  fields.zktecoTimeout.value = config.zkteco?.timeoutSeconds ?? 8;
  fields.zktecoBatchSize.value = config.zkteco?.batchSize ?? 100;
  fields.zktecoLookback.value = config.zkteco?.lookbackHours ?? 24;
  fields.hikvisionEnabled.checked = Boolean(config.hikvision?.enabled);
  fields.hikvisionCameraUrls.value = config.hikvision?.cameraUrls || "";
  fields.hikvisionUsername.value = config.hikvision?.username || "";
  fields.hikvisionPassword.value = config.hikvision?.password || "";
  fields.hikvisionInterval.value = config.hikvision?.intervalSeconds ?? 5;
  fields.hikvisionTimeout.value = config.hikvision?.timeoutSeconds ?? 10;
  fields.hikvisionLookback.value = config.hikvision?.lookbackMinutes ?? 60;
  fields.hikvisionMaxResults.value = config.hikvision?.maxResults ?? 30;
}

function appendLog(line) {
  const at = line.at ? new Date(line.at).toLocaleTimeString() : new Date().toLocaleTimeString();
  logOutput.textContent += `[${at}] ${line.source}: ${line.message}\n`;
  logOutput.scrollTop = logOutput.scrollHeight;
}

function setBusy(button, busy, label) {
  button.disabled = busy;
  if (label) {
    button.textContent = label;
  }
}

function machineStateLabel(state) {
  const labels = {
    online: "Working",
    warning: "Attention",
    stale: "Stale",
    error: "Error",
    pending: "Pending",
    stopped: "Stopped",
    disabled: "Disabled"
  };
  return labels[state] || "Pending";
}

function formatStatusTime(value) {
  if (!value) {
    return "No check yet";
  }
  return new Date(value).toLocaleTimeString();
}

function serviceStatusLabel(name, running, summary) {
  if (!summary?.configuredCount) {
    return `${name} no machines`;
  }
  if (!running) {
    return `${name} stopped - ${summary.configuredCount} configured`;
  }
  return `${name} ${summary.onlineCount}/${summary.configuredCount} working`;
}

function statusTone(summary) {
  if (!summary?.configuredCount) {
    return "neutral";
  }
  if (summary.errorCount > 0) {
    return "error";
  }
  if (summary.attentionCount > 0 || summary.pendingCount > 0) {
    return "warning";
  }
  if (summary.onlineCount > 0) {
    return "running";
  }
  return "neutral";
}

function applyStatusTone(element, tone) {
  element.classList.toggle("running", tone === "running");
  element.classList.toggle("warning", tone === "warning");
  element.classList.toggle("error", tone === "error");
}

function renderMachineCondition(kind, summary) {
  const summaryElement = kind === "zkteco" ? zktecoMachineSummary : hikvisionMachineSummary;
  const listElement = kind === "zkteco" ? zktecoMachineList : hikvisionMachineList;
  const serviceLabel = kind === "zkteco" ? "fingerprint" : "face recognition";

  if (!summary?.configuredCount) {
    summaryElement.textContent = `No ${serviceLabel} machines configured.`;
    listElement.innerHTML = "";
    return;
  }

  const parts = [
    `${summary.onlineCount} working`,
    `${summary.pendingCount} pending`,
    `${summary.attentionCount} attention`,
    `${summary.errorCount} error`
  ];
  summaryElement.textContent = `${parts.join(" | ")} out of ${summary.configuredCount} configured.`;
  listElement.innerHTML = summary.machines
    .map(
      (machine) => `
        <div class="machine-row ${machine.state}">
          <span class="machine-dot" aria-hidden="true"></span>
          <div class="machine-main">
            <div class="machine-title">${escapeHtml(machine.label || machine.id)}</div>
            <div class="machine-subtitle">${escapeHtml(machine.id)}</div>
            ${machine.serial ? `<div class="machine-subtitle">Serial ${escapeHtml(machine.serial)}</div>` : ""}
          </div>
          <div class="machine-state">
            <span class="machine-badge ${machine.state}">${machineStateLabel(machine.state)}</span>
            <span class="machine-time">${formatStatusTime(machine.lastAt)}</span>
          </div>
          <div class="machine-message">${escapeHtml(machine.message || "Waiting for bridge check.")}</div>
        </div>
      `
    )
    .join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function updateStatus(status) {
  latestStatus = status || {};
  const zktecoSummary = latestStatus.machines?.zkteco;
  const hikvisionSummary = latestStatus.machines?.hikvision;
  zktecoStatus.textContent = serviceStatusLabel("ZKTeco", latestStatus.zkteco, zktecoSummary);
  applyStatusTone(zktecoStatus, latestStatus.zkteco ? statusTone(zktecoSummary) : "neutral");
  hikvisionStatus.textContent = serviceStatusLabel("Hikvision Face", latestStatus.hikvision, hikvisionSummary);
  applyStatusTone(hikvisionStatus, latestStatus.hikvision ? statusTone(hikvisionSummary) : "neutral");
  pythonPath.textContent = latestStatus.python || "Not checked";
  renderMachineCondition("zkteco", zktecoSummary);
  renderMachineCondition("hikvision", hikvisionSummary);

  buttons.installDeps.disabled = Boolean(latestStatus.installingDependencies);
  buttons.startZkteco.disabled = Boolean(latestStatus.zkteco);
  buttons.stopZkteco.disabled = !latestStatus.zkteco;
  buttons.startHikvision.disabled = Boolean(latestStatus.hikvision);
  buttons.stopHikvision.disabled = !latestStatus.hikvision;
}

async function saveCurrentConfig() {
  const saved = await window.bridgeApp.saveConfig(formConfig());
  fillForm(saved);
  appendLog({ source: "app", message: "Configuration saved." });
  return saved;
}

async function runAction(button, workingLabel, action) {
  const original = button.textContent;
  try {
    setBusy(button, true, workingLabel);
    const result = await action();
    updateStatus(await window.bridgeApp.status());
    return result;
  } catch (error) {
    appendLog({ source: "app", message: readableError(error) });
  } finally {
    setBusy(button, false, original);
  }
}

buttons.saveConfig.addEventListener("click", () => {
  void runAction(buttons.saveConfig, "Saving", saveCurrentConfig);
});

buttons.installDeps.addEventListener("click", () => {
  void runAction(buttons.installDeps, "Installing", async () => {
    await saveCurrentConfig();
    return window.bridgeApp.installDependencies();
  });
});

buttons.testBackend.addEventListener("click", () => {
  void runAction(buttons.testBackend, "Testing", async () => {
    await window.bridgeApp.testBackend(formConfig());
    appendLog({ source: "app", message: "Backend bridge endpoint is reachable." });
  });
});

buttons.startAll.addEventListener("click", () => {
  void runAction(buttons.startAll, "Starting", () => {
    const config = formConfig();
    validateStartConfig("all", config);
    return window.bridgeApp.startAll(config);
  });
});

buttons.stopAll.addEventListener("click", () => {
  void runAction(buttons.stopAll, "Stopping", () => window.bridgeApp.stopAll());
});

buttons.startZkteco.addEventListener("click", () => {
  void runAction(buttons.startZkteco, "Starting", () => {
    const config = formConfig();
    validateStartConfig("zkteco", config);
    return window.bridgeApp.start("zkteco", config);
  });
});

buttons.stopZkteco.addEventListener("click", () => {
  void runAction(buttons.stopZkteco, "Stopping", () => window.bridgeApp.stop("zkteco"));
});

buttons.startHikvision.addEventListener("click", () => {
  void runAction(buttons.startHikvision, "Starting", () => {
    const config = formConfig();
    validateStartConfig("hikvision", config);
    return window.bridgeApp.start("hikvision", config);
  });
});

buttons.stopHikvision.addEventListener("click", () => {
  void runAction(buttons.stopHikvision, "Stopping", () => window.bridgeApp.stop("hikvision"));
});

buttons.clearLog.addEventListener("click", () => {
  logOutput.textContent = "";
});

buttons.openConfigFolder.addEventListener("click", () => {
  void window.bridgeApp.openUserData();
});

fields.autoStart.addEventListener("change", async () => {
  await window.bridgeApp.setAutoStart(fields.autoStart.checked);
  appendLog({
    source: "app",
    message: fields.autoStart.checked ? "Open at login enabled." : "Open at login disabled."
  });
});

window.bridgeApp.onLog(appendLog);
window.bridgeApp.onStatus(updateStatus);

async function init() {
  fillForm(await window.bridgeApp.getConfig());
  updateStatus(await window.bridgeApp.status());
  setInterval(async () => updateStatus(await window.bridgeApp.status()), 2500);
}

void init();
