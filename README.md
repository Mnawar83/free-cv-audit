# Free CV Audit

## Performance checks (Lighthouse + Core Web Vitals)

Use Chrome Lighthouse after deploying preview changes:

1. Open the page in Chrome.
2. Open DevTools → **Lighthouse**.
3. Run **Mobile** and **Desktop** audits with **Performance** selected.
4. Compare the report before/after changes.

### What to watch

- **LCP (Largest Contentful Paint):** how quickly the main content appears.  
  Target: **≤ 2.5s**.
- **INP (Interaction to Next Paint):** responsiveness after user input.  
  Target: **≤ 200ms**.
- **CLS (Cumulative Layout Shift):** visual stability as content loads.  
  Target: **≤ 0.1**.

### Interpreting results

- If **LCP** is high, prioritize reducing render-blocking resources and optimizing media.
- If **INP** is high, reduce long-running JavaScript work on the main thread.
- If **CLS** is high, reserve dimensions for images/components and avoid layout jumps.


## Fulfillment & Payment Ops

This project includes a paid-fulfillment flow (PayPal/WhishPay), secure fulfillment sessions, and queued post-payment email delivery.

### Required environment variables

- `FULFILLMENT_SESSION_SECRET`: required for signing and validating fulfillment session cookies.
- `RESEND_API_KEY`: required for OTP email delivery (`fulfillment-link-session`) and CV email sends.
- `PAYPAL_WEBHOOK_SHARED_SECRET`: required to validate PayPal webhook signatures.
- `WHISHPAY_WEBHOOK_SHARED_SECRET`: required to validate WhishPay webhook signatures.

### Strongly recommended environment variables

- `URL` (or `DEPLOY_PRIME_URL` / `DEPLOY_URL` fallback): used to build absolute links for CV delivery and reissue endpoints.
- `RUN_STORE_DURABLE_URL` and `RUN_STORE_DURABLE_TOKEN`: use durable run-store backend outside local/dev file-backed mode.

### Optional fulfillment/security tuning

- `FULFILLMENT_LINK_SEND_CODE` (default `true`): set to `false` only in controlled local/testing scenarios.
- `FULFILLMENT_LINK_RETURN_DEBUG_CODE` (default `false`): set to `true` only for local/testing debug flows.
- `FULFILLMENT_LINK_RATE_LIMIT_WINDOW_MS`, `FULFILLMENT_LINK_RATE_LIMIT_MAX`
- `FULFILLMENT_LINK_CODE_MAX_ATTEMPTS`
- `FULFILLMENT_STATUS_RATE_LIMIT_WINDOW_MS`, `FULFILLMENT_STATUS_RATE_LIMIT_MAX`
- `FULFILLMENT_RESEND_RATE_LIMIT_WINDOW_MS`, `FULFILLMENT_RESEND_RATE_LIMIT_MAX`
- `FULFILLMENT_REISSUE_RATE_LIMIT_WINDOW_MS`, `FULFILLMENT_REISSUE_RATE_LIMIT_MAX`
- `WEBHOOK_SIGNATURE_MAX_AGE_MS`
- `FULFILLMENT_ACCESS_TOKEN_TTL_MS`

### Optional queue tuning

- `FULFILLMENT_QUEUE_BATCH_SIZE`, `FULFILLMENT_QUEUE_MAX_ATTEMPTS`
- `CV_EMAIL_QUEUE_BATCH_SIZE`, `CV_EMAIL_QUEUE_MAX_ATTEMPTS`, `CV_EMAIL_QUEUE_PROCESSING_LEASE_MS`
- `CV_EMAIL_ASYNC_MODE`
- `QUEUE_PROCESSOR_SECRET` (required for queue processors, including scheduled runners and direct/manual calls)

### Scheduled processing

- Fulfillment queue scheduled runner is defined in `process-fulfillment-queue-scheduled.js` and runs every 2 minutes.
- Keep the scheduled function enabled in Netlify so paid fulfillments are retried and delivered even when webhooks are delayed.

### Quick smoke tests

Run fulfillment-focused tests after changing payment/session code:

```bash
node tests/fulfillment-functions.test.js
node tests/fulfillment-queue.test.js
node tests/process-fulfillment-queue-scheduled.test.js
node tests/paypal-webhook.test.js
node tests/whishpay-webhook.test.js
node tests/send-cv-email.test.js
node tests/prune-operational-data.test.js
```
