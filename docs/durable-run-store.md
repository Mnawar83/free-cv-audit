# Durable run-store endpoint

This project can use an external durable JSON store via:

- `RUN_STORE_DURABLE_URL`
  - can also be set to a root-relative path (for example `/.netlify/functions/run-store-durable`) when `URL`/`DEPLOY_PRIME_URL`/`DEPLOY_URL` is available
- `RUN_STORE_DURABLE_TOKEN` (optional bearer token)

`netlify/functions/run-store.js` already supports reading/writing this endpoint with optimistic concurrency (`If-None-Match: *` / `If-Match: <etag>`). It also retries transient durable endpoint failures (429/502/503/504) before surfacing an error.

## Provided endpoint implementation

A ready-to-deploy Node endpoint is included at:

- `scripts/durable-run-store-server.js`

It implements:

- `GET /` → `200` + JSON + `ETag` (or `404` when empty)
- `PUT /` with `If-None-Match: *` for first write
- `PUT /` with `If-Match: <etag>` for compare-and-swap updates
- `401` when `RUN_STORE_DURABLE_TOKEN` is configured and auth is missing/invalid
- `412` on precondition failure

## Quick start (host this endpoint anywhere durable)

1. Deploy `scripts/durable-run-store-server.js` to a service with persistent disk (Render/Railway/Fly/etc.).
2. Set endpoint environment variables on that service:
   - `RUN_STORE_DURABLE_TOKEN=<strong-random-token>`
   - `DURABLE_RUN_STORE_PATH=/persistent-disk/run-store.json`
3. Get the HTTPS URL for that service.
4. In Netlify site env vars, set:
   - `RUN_STORE_DURABLE_URL=https://<your-service-host>/`
   - `RUN_STORE_DURABLE_TOKEN=<same-strong-random-token>`
5. Redeploy Netlify.

## Local verification

Run the endpoint locally:

```bash
RUN_STORE_DURABLE_TOKEN=dev-token node scripts/durable-run-store-server.js
```

Then point Netlify functions (or tests) to:

- `RUN_STORE_DURABLE_URL=http://127.0.0.1:8787/`
- `RUN_STORE_DURABLE_TOKEN=dev-token`

## Netlify Blobs function option

If you want to keep durable storage fully inside Netlify, deploy `netlify/functions/run-store-durable.js` and set:

- `RUN_STORE_DURABLE_URL=/.netlify/functions/run-store-durable`
- `RUN_STORE_DURABLE_TOKEN=<token-or-empty>`

This function stores the run-store JSON in Netlify Blobs and supports the same ETag-based optimistic concurrency contract expected by `run-store.js`.
