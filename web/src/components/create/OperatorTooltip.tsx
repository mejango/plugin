const POWERS = [
  "Change the machine's name, logo, and description",
  "Change the token's name and symbol",
  "Repoint the keep at different recipients — never enlarge it",
  "Add, remove, and re-price shop items, mint them free, set discounts",
  "Pick the buyback market pool and its price-averaging window",
  "Choose which approved terminals take payments, including the any-token router",
  "Extend the machine to new approved chains; pause a bridge that looks unsafe",
  "Sign messages on behalf of the machine's token",
  "Hand the operator role to another address",
];

/** What "operates" actually grants — the same list the protocol enforces. */
export function OperatorTooltip() {
  return (
    <span tabIndex={0} className="group relative cursor-help underline decoration-dotted underline-offset-2 outline-none">
      privileges
      <span
        role="tooltip"
        className="pointer-events-none absolute left-0 top-[calc(100%+6px)] z-10 hidden w-[min(340px,80vw)] border-2 border-black bg-white p-[.9rem_1rem] text-[.8rem] leading-relaxed normal-case tracking-normal shadow-[4px_4px_0_#000] group-hover:block group-focus:block group-focus-within:block"
      >
        <b className="display mb-1 block">The operator can</b>
        <ul className="mb-[.7rem] ml-0 list-disc pl-[1.1rem]">
          {POWERS.map((power) => (
            <li key={power} className="my-[.15rem] text-[#555]">
              {power}
            </li>
          ))}
        </ul>
        <b>It can never</b> rewrite issuance, cash-out rules, or the stage schedule — and never withdraw the
        machine&apos;s funds.
      </span>
    </span>
  );
}
