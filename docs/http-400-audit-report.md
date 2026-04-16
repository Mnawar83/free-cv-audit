# HTTP 400 Audit Report (FreeCVAudit)

## Scope
Frontend + Netlify Functions for:
- CV upload
- Free audit
- Payment initiation
- Payment verification
- Queue processing trigger
- Cover letter generation
- LinkedIn optimization
- Email sending

## Root causes identified
1. **Inconsistent input validation** across functions (some used generic `field is required`).
2. **No structured diagnostics** before HTTP 400 responses.
3. **Missing Content-Type guardrails** for JSON-only endpoints.
4. **Frontend upload checks were incomplete** (no empty/size limit validation).
5. **Technical backend messages bubbled to UI** without safe message mapping.

## Fix summary
### Shared backend improvements
- Added `netlify/functions/http-400.js` with:
  - correlation/request ID extraction
  - content-type normalization
  - payload-key-only logging
  - structured 400 helper (`badRequest`)
  - JSON parser with explicit unsupported content type / invalid JSON errors

### Frontend improvements
- Added CV upload validation for:
  - empty file
  - max size (5 MB)
  - unsupported file types
- Added API error-to-user-message mapping for safe UX while preserving backend detail in logs.

## Endpoint audit matrix

| Endpoint | Method | Expected Headers | Expected Body Fields | Validation Rules | 400 Return Points (current) |
|---|---|---|---|---|---|
| `/.netlify/functions/init-run` | POST | `Content-Type: application/json` | `cvText` | required, non-empty, min 50 chars | invalid JSON, unsupported content-type, missing/short `cvText` |
| `/.netlify/functions/audit` | POST | `Content-Type: application/json` | `cvText` | required non-empty | invalid JSON, unsupported content-type, missing `cvText` |
| `/.netlify/functions/full-audit` | POST | `Content-Type: application/json` | `runId` | required non-empty | invalid JSON, unsupported content-type, missing `runId` |
| `/.netlify/functions/paypal-create-order` | POST | `Content-Type: application/json` | `runId`, `email` | both required non-empty | invalid JSON, unsupported content-type, missing `runId`/`email` |
| `/.netlify/functions/whishpay-create-payment` | POST | `Content-Type: application/json` | `runId`, `email` | both required non-empty | invalid JSON, unsupported content-type, missing `runId`/`email` |
| `/.netlify/functions/paypal-capture-order` | POST | `Content-Type: application/json` | `orderID` (+optional `runId`,`email`) | `orderID` required | invalid JSON, unsupported content-type, missing `orderID` |
| `/.netlify/functions/whishpay-check-status` | POST | `Content-Type: application/json` | `externalId` (+optional `runId`,`email`) | `externalId` required | invalid JSON, unsupported content-type, missing `externalId` |
| `/.netlify/functions/paypal-linkedin-create-order` | POST | `Content-Type: application/json` | `runId` | required | invalid JSON, unsupported content-type, missing `runId` |
| `/.netlify/functions/paypal-linkedin-capture-order` | POST | `Content-Type: application/json` | `runId`, `orderID` | both required, capture payload integrity required | invalid JSON, unsupported content-type, missing `runId`/`orderID`, invalid capture details |
| `/.netlify/functions/whishpay-linkedin-create-payment` | POST | `Content-Type: application/json` | `runId` | required | invalid JSON, unsupported content-type, missing `runId` |
| `/.netlify/functions/whishpay-linkedin-check-status` | POST | `Content-Type: application/json` | `runId`, `externalId` | both required | invalid JSON, unsupported content-type, missing `runId`/`externalId` |
| `/.netlify/functions/paypal-cover-letter-create-order` | POST | `Content-Type: application/json` | `runId` | required | invalid JSON, unsupported content-type, missing `runId` |
| `/.netlify/functions/paypal-cover-letter-capture-order` | POST | `Content-Type: application/json` | `runId`, `orderID` | both required, capture payload integrity required | invalid JSON, unsupported content-type, missing `runId`/`orderID`, invalid capture details |
| `/.netlify/functions/whishpay-cover-letter-create-payment` | POST | `Content-Type: application/json` | `runId` | required | invalid JSON, unsupported content-type, missing `runId` |
| `/.netlify/functions/whishpay-cover-letter-check-status` | POST | `Content-Type: application/json` | `runId`, `externalId` | both required | invalid JSON, unsupported content-type, missing `runId`/`externalId` |
| `/.netlify/functions/linkedin-upsell-init` | POST | `Content-Type: application/json` | `runId`, `providedLinkedInUrl` | both required non-empty | invalid JSON, unsupported content-type, missing `runId`/`providedLinkedInUrl` |
| `/.netlify/functions/cover-letter-init` | POST | `Content-Type: application/json` | `runId`, `jobLink` | both required non-empty | invalid JSON, unsupported content-type, missing `runId`/`jobLink` |
| `/.netlify/functions/cover-letter-fetch-job` | POST | `Content-Type: application/json` | `runId`, `jobLink` | both required | invalid JSON, unsupported content-type, missing `runId`/`jobLink` |
| `/.netlify/functions/cover-letter-generate-docx` | POST | query string `runId` | N/A | runId required, run must include `revised_cv_text` | missing `runId`, missing `revised_cv_text` |
| `/.netlify/functions/linkedin-generate-docx` | POST | query string `runId` | N/A | runId required, run must include `revised_cv_text` | missing `runId`, missing `revised_cv_text` |
| `/.netlify/functions/send-cv-email` | POST | `Content-Type: application/json` | `email`,`cvUrl`,`runId` (+optional `artifactToken`) | required fields non-empty; if `artifactToken` absent system falls back to slow-path token recovery/minting | invalid JSON, unsupported content-type, missing email, missing CV URL, missing runId |
| `/.netlify/functions/send-linkedin-email` | POST | `Content-Type: application/json` | `email`,`pdfUrl` | required non-empty | invalid JSON, unsupported content-type, missing email, missing pdfUrl |
| `/.netlify/functions/send-cover-letter-email` | POST | `Content-Type: application/json` | `email`,`pdfUrl` | required non-empty | invalid JSON, unsupported content-type, missing email, missing pdfUrl |

## Queue processing trigger
- `queue-trigger.js` is an internal helper module and does not expose a public HTTP handler. It currently does not emit 400 responses directly.

## Structured logging format now emitted before every 400
`[http-400] { functionName, route, contentType, payloadKeys, missingFields, invalidFields, correlationId, message }`

## Remaining risks
1. Some legacy endpoints outside this scope may still return generic 400 errors.
2. MIME-type validation is frontend-side for CV upload (file extraction still happens client-side); server-side upload endpoint does not exist yet.
3. Query-string driven endpoints (e.g., docx generation) still rely on URL params, not JSON schema validation.
4. Correlation IDs are generated when absent; upstream clients should send stable IDs (`x-correlation-id`) for end-to-end tracing.
