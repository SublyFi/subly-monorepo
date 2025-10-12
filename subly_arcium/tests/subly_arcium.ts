import * as anchor from "@coral-xyz/anchor";
import type { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  SystemProgram,
  PublicKey,
  LAMPORTS_PER_SOL,
  Transaction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  buildFinalizeCompDefTx,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  getArciumProgramReadonly,
  getClockAccAddress,
  getCompDefAccOffset,
  getComputationAccAddress,
  getExecutingPoolAccAddress,
  getMXEAccAddress,
  getMempoolAccAddress,
  getClusterAccAddress,
} from "@arcium-hq/client";

import type { SublyArcium } from "../target/types/subly_arcium";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const randomOffset = () => new anchor.BN(randomBytes(8));

const expectAnchorError = async (
  action: () => Promise<unknown>,
  code: string
) => {
  try {
    await action();
    expect.fail(`Expected Anchor error ${code}`);
  } catch (err: any) {
    const anchorError = err?.error ?? err;
    const received =
      anchorError?.errorCode?.code ?? anchorError?.error?.errorCode?.code;
    expect(received).to.eq(code);
  }
};

describe("subly_arcium end-to-end", () => {
  anchor.setProvider(anchor.AnchorProvider.env());

  const provider = anchor.getProvider() as anchor.AnchorProvider;
  const wallet = provider.wallet as anchor.Wallet;
  const program = anchor.workspace
    .SublyArcium as Program<SublyArcium>;

  const arciumProgramId = getArciumProgAddress();
  const compDefSeed = getArciumAccountBaseSeed("ComputationDefinitionAccount");
  const signPda = PublicKey.findProgramAddressSync(
    [Buffer.from("SignerAccount")],
    arciumProgramId
  )[0];
  const mxeAccount = getMXEAccAddress(program.programId);
  const mempoolAccount = getMempoolAccAddress(program.programId);
  const executingPool = getExecutingPoolAccAddress(program.programId);
  const poolAccount = new PublicKey("7MGSS4iKNM4sVib7bDZDJhVqB6EcchPwVnTKenCY1jt3");
  const clockAccount = getClockAccAddress();

  const compDefAddressCache = new Map<string, PublicKey>();
  const compDefOffsetCache = new Map<string, number>();

  let clusterAccount: PublicKey;
  let mint: PublicKey;
  let userKeypair: Keypair;
  let userTokenAccount: PublicKey;
  let authorityTokenAccount: PublicKey;
  let configPda: PublicKey;
  let registryPda: PublicKey;
  let vaultPda: PublicKey;
  let userStakePda: PublicKey;
  let userSubscriptionsPda: PublicKey;
  let subscriptionServicePda: PublicKey;
  let currentServiceId = 0;
  let activeSubscriptionId = 0;

  const awaitEvent = async (eventName: string, timeoutMs = 60000) => {
    let listenerId: number | undefined;
    let timeoutId: NodeJS.Timeout | undefined;
    try {
      return await new Promise<any>((resolve, reject) => {
        listenerId = program.addEventListener(eventName as any, (event) => {
          if (timeoutId) {
            clearTimeout(timeoutId);
          }
          resolve(event);
        });
        timeoutId = setTimeout(() => {
          if (listenerId !== undefined) {
            program.removeEventListener(listenerId).catch(() => undefined);
          }
          reject(new Error(`Timed out waiting for ${eventName}`));
        }, timeoutMs);
      });
    } finally {
      if (listenerId !== undefined) {
        await program.removeEventListener(listenerId).catch(() => undefined);
      }
    }
  };

  const getCompDefAddress = (label: string) => {
    if (compDefAddressCache.has(label)) {
      return compDefAddressCache.get(label)!;
    }
    const offsetBytes = getCompDefAccOffset(label);
    const compDefPda = PublicKey.findProgramAddressSync(
      [compDefSeed, program.programId.toBuffer(), offsetBytes],
      arciumProgramId
    )[0];
    compDefAddressCache.set(label, compDefPda);
    const offsetNumber = Buffer.from(offsetBytes).readUInt32LE();
    compDefOffsetCache.set(label, offsetNumber);
    return compDefPda;
  };

  const ensureCompDef = async (
    label: string,
    initMethod: string
  ): Promise<void> => {
    const compDefPda = getCompDefAddress(label);
    try {
      await (program.account as any).computationDefinitionAccount.fetch(
        compDefPda
      );
      return;
    } catch {
      // continue to initialise
    }

    const init = (program.methods as any)[initMethod];
    if (!init) {
      throw new Error(`Missing initializer for ${label}`);
    }

    await init()
      .accounts({
        compDefAccount: compDefPda,
        payer: wallet.publicKey,
        mxeAccount,
        arciumProgram: arciumProgramId,
        systemProgram: SystemProgram.programId,
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });

    const offset = compDefOffsetCache.get(label)!;
    const finalizeTx: Transaction = await buildFinalizeCompDefTx(
      provider,
      offset,
      program.programId
    );
    const { blockhash, lastValidBlockHeight } =
      await provider.connection.getLatestBlockhash();
    finalizeTx.recentBlockhash = blockhash;
    finalizeTx.lastValidBlockHeight = lastValidBlockHeight;
    finalizeTx.feePayer = wallet.publicKey;
    finalizeTx.sign(wallet.payer);
    await provider.sendAndConfirm(finalizeTx, [wallet.payer], {
      commitment: "confirmed",
    });

    await sleep(500);
  };

  const baseArciumAccounts = (
    label: string,
    computationOffset: anchor.BN
  ) => ({
    signPdaAccount: signPda,
    mxeAccount,
    mempoolAccount,
    executingPool,
    computationAccount: getComputationAccAddress(
      program.programId,
      computationOffset
    ),
    compDefAccount: getCompDefAddress(label),
    clusterAccount,
    poolAccount,
    clockAccount,
    arciumProgram: arciumProgramId,
    systemProgram: SystemProgram.programId,
  });

  const compDefsToInit: Array<{ label: string; method: string }> = [
    { label: "initialize_subly", method: "initInitializeSublyCompDef" },
    {
      label: "register_paypal_recipient_subly",
      method: "initRegisterPaypalRecipientSublyCompDef",
    },
    {
      label: "get_paypal_recipient_subly",
      method: "initGetPaypalRecipientSublyCompDef",
    },
    {
      label: "register_subscription_service_subly",
      method: "initRegisterSubscriptionServiceSublyCompDef",
    },
    {
      label: "get_subscription_services_subly",
      method: "initGetSubscriptionServicesSublyCompDef",
    },
    {
      label: "subscribe_service_subly",
      method: "initSubscribeServiceSublyCompDef",
    },
    { label: "stake_subly", method: "initStakeSublyCompDef" },
    { label: "fund_rewards_subly", method: "initFundRewardsSublyCompDef" },
    { label: "sync_yield_subly", method: "initSyncYieldSublyCompDef" },
    { label: "claim_user_subly", method: "initClaimUserSublyCompDef" },
    {
      label: "claim_operator_subly",
      method: "initClaimOperatorSublyCompDef",
    },
    {
      label: "unsubscribe_service_subly",
      method: "initUnsubscribeServiceSublyCompDef",
    },
    {
      label: "record_subscription_payment_subly",
      method: "initRecordSubscriptionPaymentSublyCompDef",
    },
    {
      label: "find_due_subscriptions_subly",
      method: "initFindDueSubscriptionsSublyCompDef",
    },
    { label: "get_user_stake_subly", method: "initGetUserStakeSublyCompDef" },
    {
      label: "get_user_subscriptions_subly",
      method: "initGetUserSubscriptionsSublyCompDef",
    },
    {
      label: "get_user_available_services_subly",
      method: "initGetUserAvailableServicesSublyCompDef",
    },
    { label: "unstake_subly", method: "initUnstakeSublyCompDef" },
  ];

  before(async function () {
    this.timeout(240_000);

    userKeypair = Keypair.generate();
    const signature = await provider.connection.requestAirdrop(
      userKeypair.publicKey,
      5 * LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction(signature, "confirmed");

    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );

    const userAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      userKeypair.publicKey
    );
    const authorityAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      wallet.publicKey
    );

    userTokenAccount = userAta.address;
    authorityTokenAccount = authorityAta.address;

    const initialMintAmount = BigInt(10_000_000_000); // 10,000 USDC (6 decimals)
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      userTokenAccount,
      wallet.payer,
      initialMintAmount
    );
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      authorityTokenAccount,
      wallet.payer,
      initialMintAmount
    );

    configPda = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    )[0];
    registryPda = PublicKey.findProgramAddressSync(
      [Buffer.from("subscription_registry")],
      program.programId
    )[0];
    vaultPda = PublicKey.findProgramAddressSync(
      [Buffer.from("vault")],
      program.programId
    )[0];
    userStakePda = PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), userKeypair.publicKey.toBuffer()],
      program.programId
    )[0];
    userSubscriptionsPda = PublicKey.findProgramAddressSync(
      [Buffer.from("user_subscriptions"), userKeypair.publicKey.toBuffer()],
      program.programId
    )[0];

    const arciumProgram = getArciumProgramReadonly(provider);
    const mxeState: any = await arciumProgram.account.mxeAccount.fetch(
      mxeAccount
    );
    let clusterIndex = 0;
    if (mxeState.cluster !== null && mxeState.cluster !== undefined) {
      clusterIndex = Number(mxeState.cluster);
    }
    clusterAccount = getClusterAccAddress(clusterIndex);

    for (const def of compDefsToInit) {
      await ensureCompDef(def.label, def.method);
    }

    const initOffset = randomOffset();
    await program.methods
      .initialize(initOffset, { authority: wallet.publicKey })
      .accounts({
        payer: wallet.publicKey,
        usdcMint: mint,
        config: configPda,
        subscriptionRegistry: registryPda,
        vault: vaultPda,
        signPdaAccount: signPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
        ...baseArciumAccounts("initialize_subly", initOffset),
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      initOffset,
      program.programId,
      "confirmed"
    );

    const configAccount: any = await program.account.sublyConfig.fetch(
      configPda
    );
    expect(configAccount.authority.toBase58()).to.eq(
      wallet.publicKey.toBase58()
    );
  });

  it("registers and retrieves PayPal recipient", async function () {
    this.timeout(120_000);

    const registerOffset = randomOffset();
    const registerEvt = awaitEvent("payPalRecipientRegistered");

    await program.methods
      .registerPaypalRecipient(registerOffset, {
        recipientType: "EMAIL",
        receiver: "user@example.com",
      })
      .accounts({
        payer: userKeypair.publicKey,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "register_paypal_recipient_subly",
          registerOffset
        ),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      registerOffset,
      program.programId,
      "confirmed"
    );

    const registered = await registerEvt;
    expect(registered.user.toBase58()).to.eq(
      userKeypair.publicKey.toBase58()
    );
    expect(registered.recipientType).to.eq("EMAIL");

    const fetchOffset = randomOffset();
    const fetchEvt = awaitEvent("payPalRecipientFetched");

    await program.methods
      .getPaypalRecipient(fetchOffset)
      .accounts({
        payer: userKeypair.publicKey,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts("get_paypal_recipient_subly", fetchOffset),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      fetchOffset,
      program.programId,
      "confirmed"
    );

    const fetched = await fetchEvt;
    expect(fetched.configured).to.eq(true);
  });

  it("registers a subscription service and lists registry state", async function () {
    this.timeout(120_000);

    const registerOffset = randomOffset();
    const serviceIdBytes = Buffer.alloc(8);
    serviceIdBytes.writeBigUInt64LE(BigInt(currentServiceId));
    subscriptionServicePda = PublicKey.findProgramAddressSync(
      [Buffer.from("subscription_registry"), serviceIdBytes],
      program.programId
    )[0];
    const registerEvent = awaitEvent("subscriptionServiceRegistered");

    await program.methods
      .registerSubscriptionService(registerOffset, {
        name: "Subly Premium",
        monthlyPriceUsdc: new anchor.BN(25_000_000), // 25 USDC
        details: "Premium plan with encrypted billing",
        logoUrl: "https://example.com/logo.png",
        provider: "Subly Labs",
      })
      .accounts({
        payer: wallet.publicKey,
        creator: wallet.publicKey,
        subscriptionRegistry: registryPda,
        subscriptionService: subscriptionServicePda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "register_subscription_service_subly",
          registerOffset
        ),
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      registerOffset,
      program.programId,
      "confirmed"
    );

    const serviceEvt = await registerEvent;
    expect(serviceEvt.monthlyPriceUsdc.toNumber()).to.eq(25_000_000);

    const registryAccount: any = await program.account.subscriptionRegistry.fetch(
      registryPda
    );
    currentServiceId = Number(registryAccount.nextServiceId) - 1;
    expect(currentServiceId).to.be.gte(0);

    const fetchOffset = randomOffset();
    const listEvent = awaitEvent("subscriptionServicesFetched");

    await program.methods
      .getSubscriptionServices(fetchOffset)
      .accounts({
        payer: wallet.publicKey,
        subscriptionRegistry: registryPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "get_subscription_services_subly",
          fetchOffset
        ),
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      fetchOffset,
      program.programId,
      "confirmed"
    );

    const listed = await listEvent;
    expect(listed.serviceCount).to.be.gte(1);
  });

  it("stakes funds, syncs yield, and funds rewards", async function () {
    this.timeout(150_000);

    const stakeOffset = randomOffset();

    await program.methods
      .stake(stakeOffset, {
        amount: new anchor.BN(1_000_000_000), // 1,000 USDC
        lockOption: 0,
      })
      .accounts({
        payer: userKeypair.publicKey,
        config: configPda,
        user: userKeypair.publicKey,
        userStake: userStakePda,
        userTokenAccount: userTokenAccount,
        vault: vaultPda,
        signPdaAccount: signPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...baseArciumAccounts("stake_subly", stakeOffset),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      stakeOffset,
      program.programId,
      "confirmed"
    );

    const syncOffset = randomOffset();
    const syncEvent = awaitEvent("yieldSnapshot");

    await program.methods
      .syncYield(syncOffset)
      .accounts({
        payer: userKeypair.publicKey,
        config: configPda,
        user: userKeypair.publicKey,
        userStake: userStakePda,
        signPdaAccount: signPda,
        ...baseArciumAccounts("sync_yield_subly", syncOffset),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      syncOffset,
      program.programId,
      "confirmed"
    );

    await syncEvent;

    const fundOffset = randomOffset();
    const fundEvent = awaitEvent("rewardPoolFunded");

    await program.methods
      .fundRewards(fundOffset, new anchor.BN(500_000_000))
      .accounts({
        payer: wallet.publicKey,
        config: configPda,
        funderTokenAccount: authorityTokenAccount,
        vault: vaultPda,
        signPdaAccount: signPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        ...baseArciumAccounts("fund_rewards_subly", fundOffset),
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      fundOffset,
      program.programId,
      "confirmed"
    );

    await fundEvent;
  });

  it("subscribes to the service and fetches account views", async function () {
    this.timeout(150_000);

    const subscribeOffset = randomOffset();
    const subscribeEvent = awaitEvent("subscriptionActivated");

    await program.methods
      .subscribeService(subscribeOffset, {
        serviceId: new anchor.BN(currentServiceId),
      })
      .accounts({
        payer: userKeypair.publicKey,
        config: configPda,
        subscriptionRegistry: registryPda,
        subscriptionService: subscriptionServicePda,
        user: userKeypair.publicKey,
        userStake: userStakePda,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts("subscribe_service_subly", subscribeOffset),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      subscribeOffset,
      program.programId,
      "confirmed"
    );

    const activated = await subscribeEvent;
    activeSubscriptionId = activated.subscriptionId.toNumber();
    expect(activated.serviceId.toNumber()).to.eq(currentServiceId);

    const getSubsOffset = randomOffset();
    const subscriptionsEvent = awaitEvent("userSubscriptionsFetched");

    await program.methods
      .getUserSubscriptions(getSubsOffset)
      .accounts({
        payer: userKeypair.publicKey,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "get_user_subscriptions_subly",
          getSubsOffset
        ),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      getSubsOffset,
      program.programId,
      "confirmed"
    );

    await subscriptionsEvent;

    const availableOffset = randomOffset();
    const availableEvent = awaitEvent("userAvailableServicesFetched");

    await program.methods
      .getUserAvailableServices(availableOffset)
      .accounts({
        payer: userKeypair.publicKey,
        config: configPda,
        userStake: userStakePda,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "get_user_available_services_subly",
          availableOffset
        ),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      availableOffset,
      program.programId,
      "confirmed"
    );

    await availableEvent;
  });

  it("detects due subscriptions and records payments", async function () {
    this.timeout(150_000);

    const dueOffset = randomOffset();
    const dueEvent = awaitEvent("subscriptionsDueForUser");

    await program.methods
      .findDueSubscriptions(dueOffset, { lookAheadSeconds: new anchor.BN(0) })
      .accounts({
        payer: userKeypair.publicKey,
        config: configPda,
        user: userKeypair.publicKey,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "find_due_subscriptions_subly",
          dueOffset
        ),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      dueOffset,
      program.programId,
      "confirmed"
    );

    const dueInfo = await dueEvent;
    expect(dueInfo.user.toBase58()).to.eq(
      userKeypair.publicKey.toBase58()
    );

    const paymentOffset = randomOffset();
    const paymentEvent = awaitEvent("subscriptionPaymentRecorded");

    await program.methods
      .recordSubscriptionPayment(paymentOffset, {
        subscriptionId: new anchor.BN(activeSubscriptionId),
        paymentTs: null,
      })
      .accounts({
        payer: wallet.publicKey,
        config: configPda,
        user: userKeypair.publicKey,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "record_subscription_payment_subly",
          paymentOffset
        ),
      })
      .signers([wallet.payer])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      paymentOffset,
      program.programId,
      "confirmed"
    );

    const paymentInfo = await paymentEvent;
    expect(paymentInfo.subscriptionId.toNumber()).to.eq(
      activeSubscriptionId
    );
  });

  it("attempts user and operator claims (expecting no yield yet)", async function () {
    this.timeout(150_000);

    const claimUserOffset = randomOffset();
    await expectAnchorError(
      () =>
        program.methods
          .claimUser(claimUserOffset, new anchor.BN(0))
          .accounts({
            payer: userKeypair.publicKey,
            config: configPda,
            user: userKeypair.publicKey,
            userStake: userStakePda,
            vault: vaultPda,
            userTokenAccount: userTokenAccount,
            signPdaAccount: signPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            ...baseArciumAccounts("claim_user_subly", claimUserOffset),
          })
          .signers([userKeypair])
          .rpc({ commitment: "confirmed" }),
      "NothingToClaim"
    );

    const claimOperatorOffset = randomOffset();
    await expectAnchorError(
      () =>
        program.methods
          .claimOperator(claimOperatorOffset, new anchor.BN(0))
          .accounts({
            payer: wallet.publicKey,
            authority: wallet.publicKey,
            config: configPda,
            userStake: userStakePda,
            vault: vaultPda,
            authorityTokenAccount: authorityTokenAccount,
            signPdaAccount: signPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            ...baseArciumAccounts(
              "claim_operator_subly",
              claimOperatorOffset
            ),
          })
          .signers([wallet.payer])
          .rpc({ commitment: "confirmed" }),
      "NothingToClaim"
    );
  });

  it("fetches user stake view", async function () {
    this.timeout(120_000);

    const stakeViewOffset = randomOffset();
    const stakeEvent = awaitEvent("userStakeFetched");

    await program.methods
      .getUserStake(stakeViewOffset)
      .accounts({
        payer: userKeypair.publicKey,
        userStake: userStakePda,
        signPdaAccount: signPda,
        ...baseArciumAccounts("get_user_stake_subly", stakeViewOffset),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      stakeViewOffset,
      program.programId,
      "confirmed"
    );

    await stakeEvent;
  });

  it("requests cancellation and attempts premature unstake", async function () {
    this.timeout(150_000);

    const unsubscribeOffset = randomOffset();
    const cancelEvent = awaitEvent("subscriptionCancellationRequested");

    await program.methods
      .unsubscribeService(unsubscribeOffset, {
        subscriptionId: new anchor.BN(activeSubscriptionId),
      })
      .accounts({
        payer: userKeypair.publicKey,
        user: userKeypair.publicKey,
        userSubscriptions: userSubscriptionsPda,
        signPdaAccount: signPda,
        ...baseArciumAccounts(
          "unsubscribe_service_subly",
          unsubscribeOffset
        ),
      })
      .signers([userKeypair])
      .rpc({ commitment: "confirmed" });

    await awaitComputationFinalization(
      provider,
      unsubscribeOffset,
      program.programId,
      "confirmed"
    );

    await cancelEvent;

    const unstakeOffset = randomOffset();
    await expectAnchorError(
      () =>
        program.methods
          .unstake(unstakeOffset, { trancheId: new anchor.BN(0) })
          .accounts({
            payer: userKeypair.publicKey,
            config: configPda,
            user: userKeypair.publicKey,
            userStake: userStakePda,
            userTokenAccount: userTokenAccount,
            vault: vaultPda,
            signPdaAccount: signPda,
            tokenProgram: TOKEN_PROGRAM_ID,
            ...baseArciumAccounts("unstake_subly", unstakeOffset),
          })
          .signers([userKeypair])
          .rpc({ commitment: "confirmed" }),
      "NothingToUnstake"
    );
  });

  it("retains vault balance after operations", async () => {
    const vaultAccount = await getAccount(provider.connection, vaultPda);
    expect(vaultAccount.mint.toBase58()).to.eq(mint.toBase58());
  });
});
