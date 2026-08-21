/**
 * The translucent bordered control this site uses for anything you press over
 * the patch bay. Shared so the hero's button and the header's account chip stay
 * the same object at two sizes — they sit on the same backdrop and any drift
 * between them reads as a mistake.
 */
export const CHIP =
  "border-2 border-black bg-white/[.75] uppercase tracking-[.14em] backdrop-blur-[2px] hover:bg-black hover:text-white";

/** Hero scale. */
export const CHIP_LG = `${CHIP} px-[1.1em] py-[.55em] text-[1.05rem] max-[620px]:text-[1.35rem]`;

/** Nav-bar scale. */
export const CHIP_SM = `${CHIP} px-[.9em] py-[.4em] text-[.8rem]`;
