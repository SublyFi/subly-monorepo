import anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import type { Finality } from "@solana/web3.js";

import type { SublyArcium } from "../../target/types/subly_arcium";

const parserCache = new WeakMap<Program<SublyArcium>, anchor.EventParser>();

function getParser(program: Program<SublyArcium>): anchor.EventParser {
  const existing = parserCache.get(program);
  if (existing) {
    return existing;
  }
  const parser = new anchor.EventParser(program.programId, program.coder);
  parserCache.set(program, parser);
  return parser;
}

export async function decodeProgramEvents(
  program: Program<SublyArcium>,
  signature: string,
  commitment: Finality
): Promise<Array<{ name: string; data: any }>> {
  const provider = program.provider as anchor.AnchorProvider;
  const tx = await provider.connection.getTransaction(signature, {
    commitment,
    maxSupportedTransactionVersion: 0,
  });
  if (!tx) {
    return [];
  }
  const logs = tx.meta?.logMessages ?? [];
  if (logs.length === 0) {
    return [];
  }
  const parser = getParser(program);
  const events: Array<{ name: string; data: any }> = [];
  for (const event of parser.parseLogs(logs)) {
    events.push(event as { name: string; data: any });
  }
  return events;
}
