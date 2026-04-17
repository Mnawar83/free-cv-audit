# Phase 2 Checklist (Account + Entitlements UX)

This checklist defines the Phase 2 completion scope for account and entitlement UX work.

## Completed in current branch

- [x] Wire all account controls in `index.html` to server APIs (`subscription`, `subscription-billing-portal`, `workspace`).
- [x] Add workspace member list rendering and remove actions.
- [x] Add workspace role/status editing controls and PATCH updates from the account UI.
- [x] Add reactivation flow that restores the latest paid plan when available.
- [x] Add test coverage for workspace flow (`tests/workspace.test.js`).
- [x] Add test coverage for billing portal URL behavior (`tests/subscription-billing-portal.test.js`).
- [x] Lock account controls while account actions are in flight to prevent duplicate submissions.
- [x] Add keyboard UX for workspace invite input (Enter submits invite).
- [x] Add client-side account UI coverage (`tests/browser-account-controls-e2e.test.js`).
- [x] Wire production plan changes to a checkout resolver endpoint (`subscription-checkout`) with local fallback.
- [x] Add account/workspace action analytics events and allow ingestion in `track-event`.
