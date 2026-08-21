const RULES = [
  {
    title: "Maximally accessible",
    body: "Anyone can fund the machine from any chain, in any token. It lives on Ethereum, Base, Optimism, and Arbitrum at once, and whatever a backer pays with gets swapped into the ETH and USDC that back it.",
  },
  {
    title: "Uneditable",
    body: "Operations are locked into the machine from deployment. No governance, no admins. What you see is what runs, forever.",
  },
  {
    title: "Splits",
    body: "The machine's keep and its plug ins are carved from issuance as splits, enforced by the revnet on every mint. The rest of each mint goes to the payer.",
  },
  {
    title: "Issuance doublings",
    body: "Funding the machine issues its tokens. The price to issue doubles at your chosen interval. Early funders get more for less.",
  },
  {
    title: "Cash out anytime",
    body: "Tokens cash out for their share of what the machine holds — or borrow against their share to keep an option open. Cashing out pays a 30% tax that stays behind with the holders who stick around. All funds used for issuance back the value of all tokens, and only ever leave through cash outs and loans.",
  },
];

export function HouseRules() {
  return (
    <div className="border-2 border-black bg-white" aria-label="The house rules">
      <h2 className="display m-0 border-b-2 border-black px-[1.3rem] py-[1.1rem] text-[1.2rem] tracking-[.03em]">
        Rules
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
