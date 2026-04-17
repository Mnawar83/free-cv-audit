# Phase 3 Checklist (Account Intelligence & Self-Serve)

This checklist tracks the next-phase account enhancements that build on Phase 2 account, checkout, and workspace controls.

## Completed in current branch

- [x] Add `account-dashboard` server endpoint for authenticated account summary data.
- [x] Add account dashboard UI section (refresh, summary, recent subscriptions, recent runs).
- [x] Wire dashboard refresh into sign-in/sign-out/session refresh flows.
- [x] Add analytics event emission for dashboard refresh (`account_dashboard_refreshed`).
- [x] Add backend test coverage for dashboard endpoint (`tests/account-dashboard.test.js`).
- [x] Extend client browser smoke coverage with dashboard wiring checks.

## Remaining (future Phase 3+)

- [ ] Add downloadable account activity export (JSON/CSV) with signed URL or authenticated endpoint.
- [ ] Add pagination/filter controls for dashboard subscriptions and run history.
- [ ] Add “last successful payment” and “next renewal” fields once provider APIs expose normalized metadata.
