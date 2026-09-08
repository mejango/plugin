import { CASH_OUT_TAX_PERCENT } from "@/lib/plugin/house";

const rules = (cashOutTaxPercent: number) => [
  {
    title: "Maximally accessible",
    body: "Fund the machine with ETH or USDC on the chains you choose. Other tokens can be accepted when a supported swap route is available.",
  },
  {
    title: "Fixed economic rules",
    body: "The issuance schedule, keep percentage, and cash-out tax setting are locked at deployment. The operator can still update the machine’s profile, shop, and unlocked keep recipients.",
  },
  {
    title: "Splits",
    body: "The keep is a share of newly issued machine tokens, with the rest going to the payer. It is not a cash withdrawal. Recipients can sell, cash out, or borrow against their tokens.",
  },
  {
    title: "Issuance doublings",
    body: "Funding the machine issues its tokens. The price to issue doubles at your chosen interval. Earlier funders get more for their money, earlier splits get more too.",
  },
  {
    title: "Cash out anytime",
    body: `Holders can cash out their tokens or borrow against them. The cash-out tax setting is ${cashOutTaxPercent}%; it is not a flat deduction. The amount returned depends on the share being cashed out, available backing, and fees. The operator cannot freely withdraw the backing.`,
  },
];

export function HouseRules({ cashOutTaxPercent = CASH_OUT_TAX_PERCENT }: { cashOutTaxPercent?: number }) {
  const RULES = rules(cashOutTaxPercent);
  return (
    <div className="border-2 border-black bg-white" aria-label="The house rules">
      <h2 className="display m-0 border-b-2 border-black px-[1.3rem] py-[1.1rem] text-[1.2rem] tracking-[.03em]">
        How it works
      </h2>
      <ul className="m-0 list-none p-0">
        {RULES.map((rule) => (
          <li key={rule.title} className="border-t border-[#e5e5e5] px-[1.3rem] py-4 first:border-t-0">
            <b className="display mb-1 block tracking-[.01em]">{rule.title}</b>
            <span className="block text-[.95rem] text-[#555]">{rule.body}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
