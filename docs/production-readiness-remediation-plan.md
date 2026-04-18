# Production Readiness Remediation Plan

This plan maps the review findings to concrete repository changes, runtime configuration, and implementation guidance aligned with the current stack (Netlify Functions + static front end).

## 1) Durable run storage and persistence

### Files/components to change
- `netlify/functions/run-store.js`
- `netlify/functions/run-store-durable.js`
- `scripts/durable-run-store-server.js`
- `README.md`
- `netlify/functions/prune-operational-data-scheduled.js`

### Changes required
1. Deploy `scripts/durable-run-store-server.js` to persistent infrastructure (VM/container/managed service).
2. Set `RUN_STORE_DURABLE_URL` and `RUN_STORE_DURABLE_TOKEN` in production.
3. Fail fast in production when durable store is missing (instead of silent fallback).
4. Keep prune job enabled and set retention env vars explicitly.

### Example hard-fail guard in `run-store.js`
```js
const isProduction = process.env.CONTEXT === 'production' || process.env.NODE_ENV === 'production';

if (isProduction && !process.env.RUN_STORE_DURABLE_URL) {
  throw new Error('RUN_STORE_DURABLE_URL is required in production. Refusing non-durable store fallback.');
}
```

---

## 2) Complete environment configuration and secrets management

### Files/components to change
- `README.md`
- `netlify/functions/*` (where `process.env.*` is read)
- `netlify.toml` (only non-secret defaults)
- Netlify environment settings UI / CLI

### Changes required
1. Define a production env var checklist and validation startup script.
2. Add a shared env validation helper that throws on missing critical vars.
3. Keep secrets in Netlify encrypted env vars (never committed).

### Example env validation helper
```js
export function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
}
```

---

## 3) Privacy policy and terms compliance

### Files/components to change
- `privacy-policy.html`
- `terms-and-conditions.html`

### Changes required
1. Enumerate collected data types and purpose/legal basis.
2. Document processors and cross-border transfers.
3. Define retention windows and data subject rights process.
4. Add subscription, refund, liability, disputes, and AI-use clauses.

(Implemented in this patch; see updated legal pages.)

---

## 4) Accessibility and UX improvements

### Files/components to change
- `index.html`
- `assets/js/flows/*.js`
- `assets/*`

### Changes required
1. Add semantic landmarks (`header`, `main`, `nav`, `footer`) and heading hierarchy.
2. Add ARIA labels for icon-only/custom controls.
3. Add keyboard focus management in modal/onboarding flows.
4. Add skip-link and reduced-motion support.
5. Break front-end logic into progressively loaded modules.

### Example focus-trap utility
```js
export function trapFocus(container) {
  const focusable = container.querySelectorAll('a,button,input,select,textarea,[tabindex]:not([tabindex="-1"])');
  const first = focusable[0];
  const last = focusable[focusable.length - 1];
  container.addEventListener('keydown', (event) => {
    if (event.key !== 'Tab') return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}
```

---

## 5) Security hardening and rate-limit enforcement

### Files/components to change
- `netlify.toml`
- `netlify/functions/http-400.js`
- `netlify/functions/audit.js`
- `netlify/functions/init-run.js`
- `netlify/functions/track-event.js`
- `netlify/functions/*session*`, `*webhook*`, `*checkout*`

### Changes required
1. Keep strict response security headers (CSP, HSTS, frame/object restrictions).
2. Enforce payload size/type validation before processing uploads.
3. Set all rate-limit env vars per endpoint class.
4. Add CSRF token checks for browser state-changing routes.
5. Ensure cookies are `HttpOnly`, `Secure`, `SameSite=Lax/Strict`, short TTL.
6. Add Sentry instrumentation around function handlers.

### Example upload validation
```js
if (!contentType.includes('multipart/form-data')) {
  return { statusCode: 415, body: JSON.stringify({ error: 'unsupported_media_type' }) };
}
if (fileSizeBytes > MAX_UPLOAD_BYTES) {
  return { statusCode: 413, body: JSON.stringify({ error: 'payload_too_large' }) };
}
```

---

## 6) Email deliverability and compliance

### Files/components to change
- `netlify/functions/send-cv-email.js`
- `netlify/functions/send-cover-letter-email.js`
- `netlify/functions/retention-email.js`
- DNS provider configuration (SPF/DKIM/DMARC)

### Changes required
1. Verify sender domain in Resend and enforce verified from-address.
2. Add plain-text fallback and legal footer/contact details.
3. Track bounce/complaint webhooks and suppress repeated sends.
4. Add consent/unsubscribe handling for non-transactional emails.

---

## 7) Monitoring, analytics, and observability

### Files/components to change
- `netlify/functions/queue-health.js`
- `netlify/functions/process-fulfillment-queue-scheduled.js`
- `netlify/functions/process-email-queue-scheduled.js`
- `netlify/functions/*` (logging wrapper)

### Changes required
1. Add structured logs (`requestId`, `runId`, `userId`, `queueName`, `attempt`).
2. Emit metrics from queue processors and failure classes.
3. Add alerting thresholds for stuck queues and webhook failures.
4. Add front-end RUM metrics with consent gating.

---

## 8) Performance optimization

### Files/components to change
- `index.html`
- `assets/js/flows/*.js`
- `assets/*`
- `README.md` performance section

### Changes required
1. Defer non-critical scripts and lazy-load heavy libs (`pdf.js`, `mammoth`, payment SDKs).
2. Move inline JS to module files and chunk by route/flow.
3. Preload critical fonts/images and compress hero assets.
4. Add a Lighthouse CI budget check in CI.

---

## 9) Scalability and queue reliability

### Files/components to change
- `netlify/functions/process-fulfillment-queue.js`
- `netlify/functions/process-email-queue.js`
- `netlify/functions/queue-trigger.js`
- `netlify/functions/queue-health.js`

### Changes required
1. Tune batch sizes and lease durations from production telemetry.
2. Add exponential backoff + dead-letter queue pattern for repeated failures.
3. Gate manual trigger endpoints with `QUEUE_PROCESSOR_SECRET`.
4. Add idempotency keys for payment/email fulfillment updates.

---

## 10) Internationalization and inclusivity

### Files/components to change
- `index.html`
- `assets/js/flows/*.js`
- AI prompt generation (`netlify/functions/audit.js`, `full-audit.js`)

### Changes required
1. Add `locale` preference capture in UI and run metadata.
2. Externalize copy strings into locale maps.
3. Pass locale/region guidance into AI prompts.
4. Add fallback locale and localized legal links.

---

## 11) Legal and ethical use of AI

### Files/components to change
- `index.html` (disclosure surfaces)
- `privacy-policy.html`
- `terms-and-conditions.html`
- `netlify/functions/audit.js`

### Changes required
1. Add clear user disclosure about AI limitations.
2. Add "report problematic suggestion" mechanism.
3. Add prompt guardrails against discriminatory output.
4. Log and review safety incidents for continuous tuning.

---

## 12) Comprehensive testing and CI/CD

### Files/components to change
- `.github/workflows/ci-cd.yml` (added in this patch)
- `tests/*`
- `package.json` scripts (optional cleanup)

### Changes required
1. Run unit/integration tests on push and PR.
2. Add accessibility tests (axe + Playwright/Lighthouse CI).
3. Add dependency and code scanning (`npm audit`, CodeQL/Snyk).
4. Add deployment gates and post-deploy smoke checks.

## Recommended CI/CD flow

1. **PR pipeline**: install deps, run core tests, run accessibility checks, run security scans.
2. **Preview deploy**: Netlify preview URL + smoke tests against preview.
3. **Main branch**: promote on green checks only.
4. **Post-deploy scheduled checks**: queue-health, webhook synthetic checks, retention/prune verification.

See `.github/workflows/ci-cd.yml` for a runnable implementation that uses existing `npm run check:lock-sync`, `npm run test:all`, operational regression tests, dependency audit, and conditional preview/production smoke checks via configured secrets.

---

## Netlify deployment and secret-management best practices

1. Store secrets only in Netlify environment variables (Production/Preview/Dev scopes separated).
2. Rotate `RUN_STORE_DURABLE_TOKEN`, webhook secrets, and API keys periodically.
3. Use least-privilege credentials and separate providers by environment.
4. Add secret scanning in CI and reject committed `.env` files.
5. Keep a runbook for incident response (key rotation, webhook replay, queue drain).

