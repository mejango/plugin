import {
  createSavedAttemptRecovery,
  createWriteHold,
  type SavedAttempt,
  type SavedAttemptOutcome,
  type WriteHoldClient,
} from "@bananapus/nana-sdk-core/review";

/** The app's one SDK write hold, which saved-attempt recovery reads. */
export const writeHolds = createWriteHold();

/** The app's one saved-attempt recovery over it: a Relayr deploy payment the app can't authenticate. */
export const savedAttempts = createSavedAttemptRecovery({ hold: writeHolds });

/**
 * A saved attempt the SDK's recovery is showing (held, or its one check): the
 * flow stops there, before any preparation, until it settles or the user
 * retires it (SavedAttemptRecovery).
 */
class SavedAttemptShownError extends Error {
  readonly name = "SavedAttemptShownError";
  constructor(readonly attempt: SavedAttempt<unknown>, line: string) {
    super(line);
  }
}

/**
 * The SDK's recovery of a saved attempt, right after a flow finds it: `done`
 * and `none` come back for the flow to follow; a hold or a check stops the
 * flow with SavedAttemptShownError, whose attempt the page shows.
 */
export async function recoverSaved<T>(
  attempt: SavedAttempt<T>,
  client: WriteHoldClient,
  /** The flow's own line for where it stopped; the SDK's otherwise. The page shows the SDK's copy either way. */
  line?: string,
): Promise<Extract<SavedAttemptOutcome<T>, { status: "done" | "none" }>> {
  const outcome = await savedAttempts.recover(attempt, client);
  if (outcome.status === "held") throw new SavedAttemptShownError(attempt as SavedAttempt<unknown>, line ?? outcome.state.line);
  if (outcome.status === "check") throw new SavedAttemptShownError(attempt as SavedAttempt<unknown>, line ?? outcome.line);
  return outcome;
}

/** Attempts whose user took the SDK's warned exit over storage this browser can't read. */
const unreadableConsent = new WeakSet<object>();

/**
 * Run the SDK's warned exit (unreadableAction) for `attempt`: while it runs, a
 * journal re-read that fails still lets it retire, in this tab alone. Only this
 * explicit action ever does; a read exception otherwise never counts as released.
 */
export async function withUnreadableConsent<T>(attempt: object, run: () => Promise<T>): Promise<T> {
  unreadableConsent.add(attempt);
  try {
    return await run();
  } finally {
    unreadableConsent.delete(attempt);
  }
}

/** A journal re-read for confirmRetirable: false when it reads a kept success, and a failed read retires only under the warned exit. */
export function strictRetirable(attempt: () => object, read: () => boolean): () => Promise<boolean> {
  return async () => {
    try {
      return read();
    } catch {
      return unreadableConsent.has(attempt());
    }
  };
}
