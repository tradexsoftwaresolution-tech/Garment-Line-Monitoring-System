# LineMatrix Operations Dashboard

LineMatrix Operations Centre now targets a `React frontend + Spring Boot backend + Supabase` architecture.

The frontend still runs as a Vite single-page app, Supabase remains the managed platform for Postgres/Auth/Storage, and the repository now includes a Spring Boot service that is starting to own import, normalization, reconciliation, and validation APIs.

## Run locally

1. Install dependencies:

   ```bash
   npm install
   ```

2. Start the frontend development server:

   ```bash
   npm run dev
   ```

3. Open `http://localhost:3000`

## Spring backend

1. Install JDK 21 locally.

2. Start the Spring Boot API:

   ```bash
   npm run backend:dev
   ```

3. Set `VITE_BACKEND_URL=http://localhost:8080` in `.env` so the frontend routes import and validation workflows through Spring.

## Supabase setup

1. Copy `.env.example` to `.env` and set:

   ```bash
   VITE_SUPABASE_URL=...
   VITE_SUPABASE_ANON_KEY=...
   VITE_SUPABASE_IMPORTS_BUCKET=imports
   VITE_BACKEND_URL=http://localhost:8080
   ```

2. Apply the SQL migrations in `supabase/migrations/`

3. Seed the local/project database with `supabase/seed.sql`

4. Start the app and sign in with a seeded or real Supabase user profile

5. For Spring Boot, also provide:

   ```bash
   SUPABASE_URL=...
   SUPABASE_ANON_KEY=...
   SUPABASE_SERVICE_ROLE_KEY=...
   SUPABASE_IMPORTS_BUCKET=imports
   SUPABASE_JWT_ISSUER=.../auth/v1
   CORS_ALLOWED_ORIGIN=http://localhost:3000
   ```

## Project areas

- `supabase/`: migrations, seed, local project config
- `backend/`: Spring Boot API and Supabase orchestration layer
- `src/lib/supabase/`: typed client and environment helpers
- `src/lib/backend/`: Spring API client helpers for the frontend
- `src/server/imports/`: import orchestration and normalization services
- `src/server/parsers/`: workbook, PDF, and tabular parsers
- `src/server/reconciliation/`: reconciliation, reporting, and audit service layer
- `docs/`: schema, import flow, and reconciliation rule documentation

## Production build

```bash
npm run build
npm run preview
```
