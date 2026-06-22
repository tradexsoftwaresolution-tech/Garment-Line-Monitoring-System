# Deployment With LAN Devices

The production deployment has three pieces:

1. Netlify hosts the Vite frontend.
2. Render hosts the Spring Boot backend.
3. One always-on computer inside the factory LAN runs local device bridges or network tunnels.

Render cannot directly connect to private factory IPs such as `10.10.4.40` or `10.10.4.101`.
Anything that talks to LAN-only devices must either run inside the factory LAN or use a secure
VPN/reverse tunnel.

## Netlify Frontend

Build settings:

```text
Build command: npm run build
Publish directory: dist
```

Environment variables:

```text
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-or-publishable-key
VITE_SUPABASE_IMPORTS_BUCKET=imports
VITE_BACKEND_URL=https://your-render-backend.onrender.com
```

Do not set `SUPABASE_SERVICE_ROLE_KEY` in Netlify. Anything prefixed with `VITE_` is browser-visible.

## Render Backend

Create a Docker web service from this repository:

```text
Dockerfile path: ./backend/Dockerfile
Docker context: ./backend
Health check path: /actuator/health
```

Environment variables:

```text
SUPABASE_URL=https://your-project-ref.supabase.co
SUPABASE_ANON_KEY=your-anon-or-publishable-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
SUPABASE_IMPORTS_BUCKET=imports
SUPABASE_JWT_ISSUER=https://your-project-ref.supabase.co/auth/v1
CORS_ALLOWED_ORIGINS=https://your-netlify-site.netlify.app,http://localhost:3000
HIKVISION_CAMERA_URLS=http://10.10.4.101,http://10.10.4.102,http://10.10.4.103,http://10.10.4.104,http://10.10.4.105,http://10.10.4.106,http://10.10.4.107
HIKVISION_USERNAME=admin
HIKVISION_PASSWORD=your-camera-password
HIKVISION_POLL_INTERVAL_SECONDS=3
HIKVISION_LOOKBACK_MINUTES=60
HIKVISION_BRIDGE_TOKEN=change-this-long-random-token
ZKTECO_ADMS_COMM_KEY=
ZKTECO_TIME_ZONE=Asia/Colombo
ZKTECO_ADMS_DELAY_SECONDS=10
ZKTECO_ADMS_SERVER_VERSION=LineMatrix-ZKTeco-ADMS
```

Leave `ZKTECO_ADMS_COMM_KEY` empty unless you configure the same key on the devices or bridge.

The `HIKVISION_CAMERA_URLS` values above only work when the backend process can reach the factory
LAN. They will not work from Render unless you add VPN/reverse-tunnel connectivity.

## ZKTeco Factory LAN Bridge

Run this on a computer that stays inside the factory LAN, not on Render:

```bash
cd backend
python3 -m venv .venv-lan-bridges
.venv-lan-bridges/bin/pip install -r requirements-lan-bridges.txt
ZKTECO_PULL_BACKEND_URL=https://your-render-backend.onrender.com \
.venv-lan-bridges/bin/python scripts/zkteco_pull_bridge.py --device-timeout 60 --batch-size 100 --interval 30
```

This machine must be able to reach:

```text
10.10.4.40:4370
10.10.4.41:4370
10.10.4.42:4370
10.10.4.43:4370
10.10.4.46:4370
https://your-render-backend.onrender.com
```

The bridge reads attendance records from the terminals and posts them to:

```text
https://your-render-backend.onrender.com/iclock/cdata
```

Keep the bridge process running for live sync.

## Hikvision Factory LAN Bridge

The hosted backend accepts LAN camera events at:

```text
POST /api/hikvision/bridge/events
```

The request must include:

```text
X-Hikvision-Bridge-Token: same value as HIKVISION_BRIDGE_TOKEN on Render
```

Run this on the same factory LAN computer:

```bash
cd backend
HIKVISION_BRIDGE_BACKEND_URL=https://your-render-backend.onrender.com \
HIKVISION_BRIDGE_TOKEN=change-this-long-random-token \
HIKVISION_USERNAME=admin \
HIKVISION_PASSWORD=your-camera-password \
.venv-lan-bridges/bin/python scripts/hikvision_lan_bridge.py --interval 3 --lookback-minutes 60
```

The bridge polls:

```text
GET  /ISAPI/System/deviceInfo
POST /ISAPI/AccessControl/AcsEvent?format=json
```

The configured camera endpoints are:

```text
10.10.4.101:80 or 443
10.10.4.102:80 or 443
10.10.4.103:80 or 443
10.10.4.104:80 or 443
10.10.4.105:80 or 443
10.10.4.106:80 or 443
10.10.4.107:80 or 443
```

Local scan result on 2026-06-08:

```text
10.10.4.101 reachable on 80, 443, 8000
10.10.4.102 unreachable
10.10.4.103 reachable on 80, 443, 8000
10.10.4.104 reachable on 80, 443, 8000
10.10.4.105 reachable on 80, 443, 8000
10.10.4.106 reachable on 80, 443, 8000
10.10.4.107 reachable on 80, 443, 8000
```

Use one of these production patterns:

1. Preferred: keep Render as the hosted backend and run `scripts/hikvision_lan_bridge.py` inside the factory LAN.
2. Alternative: keep the Spring backend on an always-on factory LAN computer and expose it through a secure HTTPS tunnel.
3. Alternative: keep Render as the backend and add a secure VPN/reverse tunnel so Render can reach the camera URLs.

Do not expose Hikvision camera web ports directly to the public internet.
