/** 0x1234…abcd — enough to recognise a wallet without shouting it. */
export function shortAddress(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}
