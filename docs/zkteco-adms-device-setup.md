# ZKTeco ADMS Device Setup

The Spring backend implements a ZKTeco ADMS push receiver under `/iclock`.
Devices are detected only after they call the backend. A cloud-hosted backend cannot scan private
factory LAN IPs such as `10.10.4.40`; the terminal must be configured to push outward.

## Backend URL

Use the public backend origin, without `/iclock` in the value:

```text
https://your-render-backend.onrender.com
```

The device will call these receiver paths itself:

```text
GET  /iclock/cdata?SN=...&options=all
GET  /iclock/getrequest?SN=...
POST /iclock/cdata?SN=...&table=ATTLOG
POST /iclock/devicecmd?SN=...
```

## Environment

Configure these backend variables in Render:

```text
ZKTECO_ADMS_COMM_KEY=
ZKTECO_TIME_ZONE=Asia/Colombo
ZKTECO_ADMS_DELAY_SECONDS=10
ZKTECO_ADMS_SERVER_VERSION=LineMatrix-ZKTeco-ADMS
```

Leave `ZKTECO_ADMS_COMM_KEY` empty unless every device has the same communication key configured.
If a key is used, set the same value on the terminal and in Render.

## Terminal Menu

On each ZKTeco terminal, open the network or communication menu and find Cloud Server, ADMS,
Push, or WDMS settings. The names vary by firmware.

Set:

```text
ADMS / Cloud Server: Enabled
Server Address: your-render-backend.onrender.com
Server Port: 443
HTTPS: Enabled, if available
Domain Mode: Enabled, if available
Protocol: ADMS / Push, if available
Comm Key: same as ZKTECO_ADMS_COMM_KEY, or blank
```

If the device does not support HTTPS, use an HTTP endpoint reachable from the factory network,
or place a local reverse proxy/VPN bridge in the factory LAN.

## Verification

1. In the web app, open `ZKTeco Fingerprint`.
2. Click `Test Receiver`; it should show the receiver is reachable.
3. Configure one terminal and make one fingerprint punch.
4. Refresh the page.
5. The terminal should appear under `Detected Devices`, and the punch should appear under
   `Latest Fingerprint Punches`.

If the receiver is reachable but no device appears, check outbound internet from the terminal VLAN,
DNS/domain mode, HTTPS support, the server port, and the comm key.

## Local Port 4370 Pull Bridge

For terminals that expose the ZKTeco SDK on port `4370`, install and run the local bridge:

```bash
cd backend
python3 -m venv .venv-zkteco
.venv-zkteco/bin/pip install -r requirements-zkteco.txt
.venv-zkteco/bin/python scripts/zkteco_pull_bridge.py
```

The bridge reads attendance logs without changing device users, fingerprints, clocks, or records.
It forwards new punches to the same `/iclock/cdata` receiver used by ADMS push devices.
