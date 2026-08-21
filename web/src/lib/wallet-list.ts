/** The shape of a Wagmi connector this module needs. */
type Listable = { id: string; name: string; icon?: string | undefined };

/**
 * The wallets to offer, in the order to offer them.
 *
 * Two things get in the way of just listing Wagmi's connectors:
 *
 * The generic `injected` connector duplicates whatever EIP-6963 already
 * announced by name, so it is only worth showing when nothing was announced.
 *
 * Coinbase ships both a browser extension (announced over EIP-6963) and an
 * SDK connector we configure ourselves, under the same name and different
 * ids — so an id-based filter lets both through and the user sees "Coinbase"
 * twice. Collapsing by name fixes that, and the announced one wins because
 * only a discovered provider carries an icon.
 */
export function offerableWallets<T extends Listable>(connectors: readonly T[]): T[] {
  const external = connectors.filter((connector) => connector.id !== "para");
  const discovered = external.filter((connector) => connector.id !== "injected");
  const usable = discovered.length ? discovered : external;

  return usable.reduce<T[]>((kept, connector) => {
    const clash = kept.findIndex(
      (other) => other.name.toLowerCase() === connector.name.toLowerCase(),
    );
    if (clash === -1) return [...kept, connector];
    if (!kept[clash].icon && connector.icon) kept[clash] = connector;
    return kept;
  }, []);
}
