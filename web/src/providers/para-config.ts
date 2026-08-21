"use client";

import { paraConnector } from "@getpara/wagmi-v2-connector";
import ParaWeb, { type Environment } from "@getpara/web-sdk";
import type { Transport } from "viem";
import type { CreateConnectorFn } from "wagmi";

export const PARA_APP = {
  appName: "Telligence",
  appDescription: "Fundraise as machines.",
  appUrl: process.env.NEXT_PUBLIC_SITE_URL ?? "https://telligence.money",
};

/**
 * The patch bay in black and white. Squared off, because nothing on this site
 * has a radius.
 */
export const PARA_THEME = {
  mode: "light" as const,
  backgroundColor: "#FFFFFF",
  foregroundColor: "#000000",
  accentColor: "#000000",
  borderRadius: "none" as const,
};

let client: ParaWeb | undefined;

/** Constructing Para starts its worker/session machinery. Keep the singleton
 * behind a user action so an anonymous page view performs no wallet traffic. */
export function getParaClient(): ParaWeb {
  client ??= new ParaWeb(
    (process.env.NEXT_PUBLIC_PARA_ENV as Environment) || "BETA",
    process.env.NEXT_PUBLIC_PARA_API_KEY ?? "",
  );
  return client;
}

export function createParaWagmiConnector(transports: Record<number, Transport>): CreateConnectorFn {
  // Para's declaration excludes Wagmi's nullable storage branch, although its
  // runtime connector implements the same interface.
  //
  // `disableModal` because the modal is mounted by ParaModalHost, which owns
  // when it opens — the connector only ever runs after auth already settled.
  return paraConnector({
    para: getParaClient(),
    appName: PARA_APP.appName,
    options: {},
    disableModal: true,
    transports,
  }) as unknown as CreateConnectorFn;
}
