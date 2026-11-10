# SDK core 6.2.0 adoption (2026-11-10)

- [x] Bump @bananapus/nana-sdk-core to 6.2.0 (plugin uses no react package).
- [x] Failing-first tests in web/test/relayr-deploy.test.ts: a lost lock writes nothing and opens no wallet (direct send, authorization signature, payment send, clear); a wallet outcome returned after the lock is lost (hash or definite-unsent) is applied under a fresh lock only to the same attempt.
- [x] Pass the lock handle into `run()`; `persist` becomes async and runs `lock.assertHeld()` before `saveMachineDeployment`; await every caller (`step`, `save`, `abandon`, `resign`, `readRecords`, `refreshSuperseded`).
- [x] `assertHeld` before `signTypedData` (no save sits between `walletFor` and the signature). The two `sendTransaction` calls are fenced by the save that immediately precedes each with no await in between.
- [x] Keep the wallet's outcome after a lost lock, as the SDK's `fund()` does with `keep`/`restoreUnsent`: the late change is applied under a fresh lock once the old one ends, only while the saved record is still this attempt (same id; direct step still the no-hash marker; relayr journal still `payment-signing` with the same quote and payments).
- [x] Fence `clearMachineDeployment` before `removeItem`.
- [x] `npm run check` and `npm run build` under Node 22+, commit, push, draft PR.

## Plan refinement

- **Objective:** No plugin journal write, wallet call or clear runs after this tab lost the deployment lock, and no hash or definite-unsent the wallet returned is dropped because of it.
- **System fit:** The SDK owns the lock handle (`browserLocks`, `assertHeld`, `LockLostError`) and the keep pattern; plugin only threads the handle to its one save and its raw wallet calls. Wallet calls stay on the raw wagmi client that `walletFor` already checks, because the SDK `fence` option only applies inside its wallet adapter.
- **Reuse and simplicity:** No new module. One `persist(onLost?)` holds the fence and the late-change slot; `settle` reuses `browserLocks`, `loadMachineDeployment` and `saveMachineDeployment`. Only the two post-wallet outcomes are kept; later saves are re-derived from the chain on resume.
- **Evidence and unknowns:** Read the released 6.2.0 `locks.d.ts`, `fencedLocks` (a handed handle passes through, so tests can lose a lock), `fund()` keep/restoreUnsent in safeRelayr.js, and `proveSavedRelayrPayment` (its `onReverted` is sync and always followed by a throw of `RelayrPaymentRevertedError`, so its save moves to the catch). Run wrapper #296 does not apply: plugin uses no `useReviewedRun`.
- **Verification:** New tests fail on 9a77381 plus the bump and pass after; full `npm run check` (typecheck, lint, knip, vitest) and `npm run build` on Node 22+.
- **Resource budget:** One source file plus deploy-session.ts and one test file, no budget change.

## Review

- 7 of the 8 new lost-lock tests failed before the source change; one (a refused direct send kept as unsent) passed trivially before fencing and guards the keep path. The payment-hash test hung before the fix and cascaded "already running" into three later tests; all 56 file tests pass after.
- `npm run check` on Node 22.23.4: typecheck, lint, knip, 275 tests pass. `npm run build` on Node 22.23.4.
- `.next/cache` was not cleared (a delete hook blocks `rm -rf`); 6.2.0 is a newly published version, so the same-version tarball cache trap does not apply.
