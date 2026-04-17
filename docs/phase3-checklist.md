# Phase 3 Checklist (Account Intelligence & Self-Serve)

This checklist tracks the next-phase account enhancements that build on Phase 2 account, checkout, and workspace controls.

## Completed in current branch

- [x] Add `account-dashboard` server endpoint for authenticated account summary data.
- [x] Add account dashboard UI section (refresh, summary, recent subscriptions, recent runs).
- [x] Wire dashboard refresh into sign-in/sign-out/session refresh flows.
- [x] Add analytics event emission for dashboard refresh (`account_dashboard_refreshed`).
- [x] Add account activity export endpoint with JSON/CSV download support.
- [x] Add dashboard pagination/filter controls for subscriptions and run history.
- [x] Add normalized payment/renewal metadata fields (`lastSuccessfulPaymentAt`, `nextRenewalAt`) to dashboard/export payloads.
- [x] Add backend test coverage for dashboard endpoint (`tests/account-dashboard.test.js`).
- [x] Extend client browser smoke coverage with dashboard wiring checks.
