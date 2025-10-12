import anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { randomBytes } from "crypto";

import {
  awaitComputationFinalization,
  buildFinalizeCompDefTx,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getArciumProgramReadonly,
  getClockAccAddress,
  getClusterAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
} from "@arcium-hq/client";

import type { SublyArcium } from "../../target/types/subly_arcium";

type Commitment = anchor.web3.Commitment;

type EnsureCompDefFn = (label: string, initMethod: string) => Promise<void>;

type BaseAccountFn = (label: string, offset: anchor.BN) => Record<string, PublicKey>;

export type ArciumContext = {
  provider: anchor.AnchorProvider;
  program: Program<SublyArcium>;
  wallet: anchor.Wallet;
  arciumProgramId: PublicKey;
  signPda: PublicKey;
  mxeAccount: PublicKey;
  mempoolAccount: PublicKey;
  executingPool: PublicKey;
  clusterAccount: PublicKey;
  poolAccount: PublicKey;
  clockAccount: PublicKey;
  ensureCompDef: EnsureCompDefFn;
  baseAccounts: BaseAccountFn;
  defaultCommitment: Commitment;
};

const SIGNER_SEED = Buffer.from("SignerAccount");
const FEE_POOL_ADDRESS = new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3");

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export async function createArciumContext(
  program: Program<SublyArcium>,
  commitment?: Commitment
): Promise<ArciumContext> {
  const provider = program.provider as anchor.AnchorProvider;
  const wallet = provider.wallet as anchor.Wallet;

  const arciumProgramId = getArciumProgAddress();
  const signPda = PublicKey.findProgramAddressSync([SIGNER_SEED], arciumProgramId)[0];
  const compDefSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");

  const mxeAccount = getMXEAccAddress(program.programId);
  const mempoolAccount = getMempoolAccAddress(program.programId);
  const executingPool = getExecutingPoolAccAddress(program.programId);
  const clockAccount = getClockAccAddress();

  const arciumProgram = getArciumProgramReadonly(provider);
  const mxeState: any = await arciumProgram.account.mxeAccount.fetch(mxeAccount);
  const clusterIndex = Number(mxeState.cluster ?? 0);
  const clusterAccount = getClusterAccAddress(clusterIndex);

  const commitmentLevel = commitment ?? ((process.env.COMMITMENT as Commitment) || "confirmed");

  const compDefAddressCache = new Map<string, PublicKey>();
  const compDefOffsetCache = new Map<string, number>();

  const getCompDefAddress = (label: string) => {
    const cached = compDefAddressCache.get(label);
    if (cached) {
      return cached;
    }
    const offsetBytes = getCompDefAccOffset(label);
    const compDefPda = PublicKey.findProgramAddressSync(
      [compDefSeed, program.programId.toBuffer(), offsetBytes],
      arciumProgramId
    )[0];
    compDefAddressCache.set(label, compDefPda);
    compDefOffsetCache.set(label, Buffer.from(offsetBytes).readUInt32LE());
    return compDefPda;
  };

  const ensureCompDef: EnsureCompDefFn = async (label, initMethod) => {
    const compDefAccount = getCompDefAddress(label);
    try {
      await (program.account as any).computationDefinitionAccount.fetch(compDefAccount);
      return;
    } catch (_err) {
      // fallthrough to initialize and finalize
    }

    const method = (program.methods as any)[initMethod];
    if (typeof method !== "function") {
      throw new Error(`Program is missing initializer '${initMethod}' for computation '${label}'`);
    }

    await method()
      .accounts({
        compDefAccount,
        payer: wallet.publicKey,
        mxeAccount,
        arciumProgram: arciumProgramId,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet.payer])
      .rpc({ commitment: commitmentLevel });

    const offset = compDefOffsetCache.get(label);
    if (offset === undefined) {
      throw new Error(`Failed to cache computation offset for ${label}`);
    }

    const finalizeTx = await buildFinalizeCompDefTx(provider, offset, program.programId);
    const { blockhash, lastValidBlockHeight } = await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = blockhash;
    finalizeTx.lastValidBlockHeight = lastValidBlockHeight;
    finalizeTx.feePayer = wallet.publicKey;
    finalizeTx.sign(wallet.payer);
    await provider.sendAndConfirm(finalizeTx, [wallet.payer], {
      commitment: commitmentLevel,
    });

    await sleep(500);
  };

  const baseAccounts: BaseAccountFn = (label, offset) => ({
    signPdaAccount: signPda,
    mxeAccount,
    mempoolAccount,
    executingPool,
    computationAccount: getComputationAccAddress(program.programId, offset),
    compDefAccount: getCompDefAddress(label),
    clusterAccount,
    poolAccount: FEE_POOL_ADDRESS,
    clockAccount,
    arciumProgram: arciumProgramId,
  });

  return {
    provider,
    program,
    wallet,
    arciumProgramId,
    signPda,
    mxeAccount,
    mempoolAccount,
    executingPool,
    clusterAccount,
    poolAccount: FEE_POOL_ADDRESS,
    clockAccount,
    ensureCompDef,
    baseAccounts,
    defaultCommitment: commitmentLevel,
  };
}

export async function waitForFinalization(
  ctx: ArciumContext,
  computationOffset: anchor.BN,
  commitment?: Commitment
): Promise<string> {
  const level = commitment ?? ctx.defaultCommitment;
  return awaitComputationFinalization(ctx.provider, computationOffset, ctx.program.programId, level);
}

export function randomComputationOffset(): anchor.BN {
  return new anchor.BN(randomBytes(8));
}
