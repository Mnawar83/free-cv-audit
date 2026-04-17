# Phase 2 Checklist (Account + Entitlements UX)

This checklist defines the Phase 2 completion scope for account and entitlement UX work.

## Completed in current branch

- [x] Wire all account controls in `index.html` to server APIs (`subscription`, `subscription-billing-portal`, `workspace`).
- [x] Add workspace member list rendering and remove actions.
- [x] Add reactivation flow that restores the latest paid plan when available.
- [x] Add test coverage for workspace flow (`tests/workspace.test.js`).
- [x] Add test coverage for billing portal URL behavior (`tests/subscription-billing-portal.test.js`).
- [x] Lock account controls while account actions are in flight to prevent duplicate submissions.
- [x] Add keyboard UX for workspace invite input (Enter submits invite).

## Remaining (future Phase 2+)

- [ ] Add dedicated client-side integration tests for account panel interactions (browser/e2e harness).
- [ ] Replace internal plan-change shortcut controls with provider checkout entry points in production mode.
- [ ] Add workspace role/status editing controls in the UI.
- [ ] Add audit/event analytics around account actions (upgrade, cancel, reactivate, invite/remove member).
