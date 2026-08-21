/** Shared field styling, so every input on the page looks like the same machine. */
export const FIELD =
  "w-full border-2 border-black bg-white px-[.9rem] py-[.8rem] text-inherit rounded-none appearance-none focus:outline-3 focus:outline-black focus:outline-offset-2";

export const LABEL = "display text-[1.05rem] tracking-[.02em]";

export const HINT = "ml-2 font-sans text-[.85rem] normal-case tracking-normal text-[#555]";

export const LINK_BTN =
  "cursor-pointer border-none bg-transparent p-0 text-[.8rem] text-[#555] underline underline-offset-[3px] hover:text-black";

/** Derived, view-only panels read differently from things you can edit. */
export const READOUT =
  "relative border border-dashed border-[#aaa] bg-[#fbfbfb] before:absolute before:right-[.7rem] before:top-[.45rem] before:text-[.6rem] before:uppercase before:tracking-[.2em] before:text-[#b5b5b5] before:content-['readout']";
