import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { Keypair, PublicKey, SystemProgram } from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getAccount,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";
import { expect } from "chai";

import { SublySolanaProgram } from "../target/types/subly_solana_program";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const toBN = (value: bigint) => new anchor.BN(value.toString());
const formatUsdc = (lamports: anchor.BN | number | bigint) => {
  const bn =
    lamports instanceof anchor.BN
      ? lamports
      : new anchor.BN(lamports.toString());
  const whole = bn.div(new anchor.BN(1_000_000));
  const fractional = bn
    .mod(new anchor.BN(1_000_000))
    .toString()
    .padStart(6, "0");
  return `${whole.toString()}.${fractional}`;
};

const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.fail(`Expected Anchor error ${code}`);
  } catch (err: any) {
    const anchorError = err?.error ?? err;
    const received =
      anchorError?.errorCode?.code ?? anchorError?.error?.errorCode?.code;
    expect(received).to.eq(code);
  }
};

describe("subly-solana-program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet;
  const program = anchor.workspace
    .SublySolanaProgram as Program<SublySolanaProgram>;
  const eventCoder = new anchor.BorshEventCoder(program.idl);

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId
  );
  const [subscriptionRegistryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("subscription_registry")],
    program.programId
  );
  const [walletSubscriptionsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("user_subscriptions"), wallet.publicKey.toBuffer()],
    program.programId
  );

  let mint: PublicKey;
  let walletTokenAccount: PublicKey;
  let premiumServiceId: number;
  let streamingServiceId: number;
  let musicServiceId: number;
  let ultraServiceId: number;

  const fetchEventsForSignature = async (signature: string) => {
    let attempts = 0;
    let tx = null;
    while (attempts < 5 && !tx) {
      tx = await provider.connection.getTransaction(signature, {
        commitment: "confirmed",
      });
      if (!tx) {
        await sleep(200);
      }
      attempts += 1;
    }
    const logs = tx?.meta?.logMessages ?? [];
    const events: Array<{ name: string; data: any }> = [];
    for (const log of logs) {
      if (!log.startsWith("Program data: ")) {
        continue;
      }
      const encoded = log.slice("Program data: ".length);
      try {
        const decoded = eventCoder.decode(encoded);
        if (decoded) {
          events.push(decoded as { name: string; data: any });
        }
      } catch (_err) {
        // ignore non-event logs
      }
    }
    return events;
  };

  before(async () => {
    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6
    );

    const walletAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      wallet.publicKey
    );
    walletTokenAccount = walletAta.address;

    const mintAmount = BigInt(50_000_000_000_000); // 50M USDC equivalent
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      walletTokenAccount,
      wallet.payer,
      mintAmount
    );

    await program.methods
      .initialize({ authority: wallet.publicKey })
      .accounts({
        payer: wallet.publicKey,
        usdcMint: mint,
        config: configPda,
        subscriptionRegistry: subscriptionRegistryPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
  });

  it("registers and fetches subscription services", async () => {
    const servicesToRegister = [
      {
        name: "Subly Premium",
        monthlyPriceUsdc: new anchor.BN(15_000_000),
        details: "Premium plan with exclusive benefits",
        logoUrl: "https://example.com/logo.png",
        provider: "Subly Labs",
      },
      {
        name: "Stream Vault",
        monthlyPriceUsdc: new anchor.BN(30_000_000),
        details: "All the latest shows in one place",
        logoUrl: "https://example.com/stream.png",
        provider: "Vault Media",
      },
      {
        name: "Music Box",
        monthlyPriceUsdc: new anchor.BN(30_000_000),
        details: "Unlimited music for every mood",
        logoUrl: "https://example.com/music.png",
        provider: "Music Box Inc.",
      },
      {
        name: "Ultra Elite Concierge",
        monthlyPriceUsdc: new anchor.BN(90_000_000_000), // 90k USDC equivalent
        details: "White-glove concierge for power users",
        logoUrl: "https://example.com/ultra.png",
        provider: "Ultra Services",
      },
    ];

    for (const service of servicesToRegister) {
      await program.methods
        .registerSubscriptionService(service)
        .accounts({
          payer: wallet.publicKey,
          subscriptionRegistry: subscriptionRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
    }

    await program.methods
      .getSubscriptionServices()
      .accounts({
        subscriptionRegistry: subscriptionRegistryPda,
      })
      .rpc();

    const registry: any = await program.account.subscriptionRegistry.fetch(
      subscriptionRegistryPda
    );
    expect(registry.services.length).to.eq(4);

    const [premium, stream, music, ultra] = registry.services;

    premiumServiceId = premium.id.toNumber();
    streamingServiceId = stream.id.toNumber();
    musicServiceId = music.id.toNumber();
    ultraServiceId = ultra.id.toNumber();

    expect(premium.name).to.eq("Subly Premium");
    expect(premium.monthlyPriceUsdc.toNumber()).to.eq(15_000_000);
    expect(premium.provider).to.eq("Subly Labs");

    expect(stream.name).to.eq("Stream Vault");
    expect(stream.monthlyPriceUsdc.toNumber()).to.eq(30_000_000);
    expect(stream.provider).to.eq("Vault Media");

    expect(music.name).to.eq("Music Box");
    expect(music.monthlyPriceUsdc.toNumber()).to.eq(30_000_000);
    expect(music.provider).to.eq("Music Box Inc.");

    expect(ultra.name).to.eq("Ultra Elite Concierge");
    expect(ultra.monthlyPriceUsdc.toString()).to.eq("90000000000");
    expect(ultra.provider).to.eq("Ultra Services");
  });

  it("rejects services that exceed the configured metadata limits", async () => {
    const longName = "A".repeat(65); // 1 char over MAX_SERVICE_NAME_LEN
    await expectAnchorError(
      program.methods
        .registerSubscriptionService({
          name: longName,
          monthlyPriceUsdc: new anchor.BN(5_000_000),
          details: "Too long name", // shorter fields stay within limits
          logoUrl: "https://example.com/logo.png",
          provider: "Subly Labs",
        })
        .accounts({
          payer: wallet.publicKey,
          subscriptionRegistry: subscriptionRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .rpc(),
      "StringTooLong"
    );
  });

  it("registers PayPal recipient info for the provider wallet", async () => {
    await program.methods
      .registerPaypalRecipient({
        recipientType: "PHONE",
        receiver: "91-734-234-1234",
      })
      .accounts({
        user: wallet.publicKey,
        userSubscriptions: walletSubscriptionsPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const walletSubscriptions: any = await program.account.userSubscriptions.fetch(
      walletSubscriptionsPda
    );
    expect(walletSubscriptions.paypalConfigured).to.eq(true);
    expect(walletSubscriptions.paypalRecipientType.phone).to.deep.eq({});
    expect(walletSubscriptions.paypalReceiver).to.eq("91-734-234-1234");

    const fetchSig = await program.methods
      .getPaypalRecipient()
      .accounts({
        user: wallet.publicKey,
        userSubscriptions: walletSubscriptionsPda,
      })
      .rpc();

    const fetchEvents = await fetchEventsForSignature(fetchSig);
    const fetched = fetchEvents.find(
      (event) => event.name.toLowerCase() === "paypalrecipientfetched"
    );
    expect(fetched, "PayPalRecipientFetched event missing").to.not.eq(undefined);
    expect(fetched!.data.user.toBase58()).to.eq(wallet.publicKey.toBase58());
    expect(fetched!.data.configured).to.eq(true);
    expect(fetched!.data.recipientType).to.eq("PHONE");
    expect(fetched!.data.receiver).to.eq("91-734-234-1234");
  });

  it("stakes, accrues yield, allows operator claim, and enforces user lock", async () => {
    const fundAmount = new anchor.BN(5_000_000_000_000); // 5k USDC for rewards
    console.log("Funding reward pool", formatUsdc(fundAmount), "USDC");
    await program.methods
      .fundRewards(fundAmount)
      .accounts({
        config: configPda,
        funder: wallet.publicKey,
        funderTokenAccount: walletTokenAccount,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const user = Keypair.generate();
    const connection = provider.connection;
    const latestBlockhash = await connection.getLatestBlockhash();
    const airdropSig = await connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction({
      signature: airdropSig,
      ...latestBlockhash,
    });

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mint,
      user.publicKey
    );

    const stakeAmount = new anchor.BN(10_000_000_000_000); // 10M USDC with 6 decimals
    await mintTo(
      connection,
      wallet.payer,
      mint,
      userTokenAccount.address,
      wallet.payer,
      stakeAmount.toNumber()
    );

    const [userStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), user.publicKey.toBuffer()],
      program.programId
    );

    console.log(
      "Staking",
      formatUsdc(stakeAmount),
      "USDC for lock option 0 (30 days)"
    );

    await program.methods
      .stake(stakeAmount, 0)
      .accounts({
        config: configPda,
        user: user.publicKey,
        userPosition: userStakePda,
        userTokenAccount: userTokenAccount.address,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    await sleep(1500);

    console.log("Syncing yield to capture accrued rewards");

    await program.methods
      .syncYield()
      .accounts({
        config: configPda,
        user: user.publicKey,
        userPosition: userStakePda,
      })
      .signers([user])
      .rpc();

    const userStakeAccount: any = await program.account.userStake.fetch(
      userStakePda
    );
    expect(userStakeAccount.entries.length).to.eq(1);
    const stakeEntry = userStakeAccount.entries[0];
    const accruedBeforeClaim = new anchor.BN(stakeEntry.unrealizedYield);
    console.log(
      "Unrealized yield after sync",
      formatUsdc(accruedBeforeClaim),
      "USDC"
    );
    expect(accruedBeforeClaim.gt(new anchor.BN(0))).to.eq(true);

    const configBeforeClaim = await program.account.sublyConfig.fetch(
      configPda
    );
    const rewardBefore = configBeforeClaim.rewardPool as anchor.BN;
    console.log(
      "Reward pool before operator claim",
      formatUsdc(rewardBefore),
      "USDC"
    );

    const operatorTokenBefore = toBN(
      (await getAccount(connection, walletTokenAccount)).amount
    );
    console.log(
      "Operator wallet before claim",
      formatUsdc(operatorTokenBefore),
      "USDC"
    );

    console.log("Operator claiming unrealized yield");

    await program.methods
      .claimOperator(new anchor.BN(0))
      .accounts({
        config: configPda,
        authority: wallet.publicKey,
        userPosition: userStakePda,
        vault: vaultPda,
        authorityTokenAccount: walletTokenAccount,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    const configAfterClaim = await program.account.sublyConfig.fetch(configPda);
    const rewardAfter = configAfterClaim.rewardPool as anchor.BN;
    console.log(
      "Reward pool after operator claim",
      formatUsdc(rewardAfter),
      "USDC"
    );
    expect(rewardAfter.lt(rewardBefore)).to.eq(true);

    const operatorTokenAfter = toBN(
      (await getAccount(connection, walletTokenAccount)).amount
    );
    console.log(
      "Operator wallet after claim",
      formatUsdc(operatorTokenAfter),
      "USDC"
    );
    expect(operatorTokenAfter.gt(operatorTokenBefore)).to.eq(true);

    const userStakeAfterClaim: any = await program.account.userStake.fetch(
      userStakePda
    );
    const entryAfterClaim = userStakeAfterClaim.entries[0];
    const operatorClaimed = new anchor.BN(entryAfterClaim.claimedOperator);
    console.log("Operator claimed yield", formatUsdc(operatorClaimed), "USDC");
    expect(operatorClaimed.gt(new anchor.BN(0))).to.eq(true);

    await expectAnchorError(
      program.methods
        .claimUser(new anchor.BN(0))
        .accounts({
          config: configPda,
          user: user.publicKey,
          userPosition: userStakePda,
          vault: vaultPda,
          userTokenAccount: userTokenAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc(),
      "NothingToClaim"
    );

    console.log("Attempted early user claim -> blocked as expected");

    await expectAnchorError(
      program.methods
        .unstake(new anchor.BN(0))
        .accounts({
          config: configPda,
          user: user.publicKey,
          userPosition: userStakePda,
          vault: vaultPda,
          userTokenAccount: userTokenAccount.address,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .signers([user])
        .rpc(),
      "StakeLocked"
    );

    console.log("Attempted early unstake -> blocked as expected");
  });

  it("handles multiple users staking multiple times with independent yield", async () => {
    const connection = provider.connection;

    const users = [Keypair.generate(), Keypair.generate()];
    const stakes = [
      { userIndex: 0, amount: new anchor.BN(2_500_000_000_000), lock: 0 },
      { userIndex: 0, amount: new anchor.BN(1_000_000_000_000), lock: 1 },
      { userIndex: 1, amount: new anchor.BN(3_000_000_000_000), lock: 3 },
    ];

    const userInfos = await Promise.all(
      users.map(async (user) => {
        const latestBlockhash = await connection.getLatestBlockhash();
        const sig = await connection.requestAirdrop(
          user.publicKey,
          2 * anchor.web3.LAMPORTS_PER_SOL
        );
        await connection.confirmTransaction({
          signature: sig,
          ...latestBlockhash,
        });

        const ata = await getOrCreateAssociatedTokenAccount(
          connection,
          wallet.payer,
          mint,
          user.publicKey
        );

        return { user, ata: ata.address };
      })
    );

    for (const { userIndex, amount, lock } of stakes) {
      const info = userInfos[userIndex];
      await mintTo(
        connection,
        wallet.payer,
        mint,
        info.ata,
        wallet.payer,
        amount.toNumber()
      );

      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), info.user.publicKey.toBuffer()],
        program.programId
      );

      console.log(
        `User ${userIndex} staking ${formatUsdc(
          amount
        )} USDC (lock option ${lock})`
      );

      await program.methods
        .stake(amount, lock)
        .accounts({
          config: configPda,
          user: info.user.publicKey,
          userPosition: userStakePda,
          userTokenAccount: info.ata,
          vault: vaultPda,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .signers([info.user])
        .rpc();
    }

    await sleep(1500);

    for (let i = 0; i < users.length; i += 1) {
      const info = userInfos[i];
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), info.user.publicKey.toBuffer()],
        program.programId
      );

      await program.methods
        .syncYield()
        .accounts({
          config: configPda,
          user: info.user.publicKey,
          userPosition: userStakePda,
        })
        .signers([info.user])
        .rpc();

      const stakeAccount: any = await program.account.userStake.fetch(
        userStakePda
      );
      stakeAccount.entries.forEach((entry: any, index: number) => {
        console.log(
          `User ${i} tranche ${index} unrealized`,
          formatUsdc(new anchor.BN(entry.unrealizedYield)),
          "USDC"
        );
        expect(new anchor.BN(entry.unrealizedYield).gt(new anchor.BN(0))).to.eq(
          true
        );
      });
    }
  });

  it("fetches the current stake summary for a user", async () => {
    const connection = provider.connection;
    const user = Keypair.generate();

    const latestBlockhash = await connection.getLatestBlockhash();
    const sig = await connection.requestAirdrop(
      user.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction({
      signature: sig,
      ...latestBlockhash,
    });

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mint,
      user.publicKey
    );

    const stakeAmount = new anchor.BN(5_000_000_000_000);
    await mintTo(
      connection,
      wallet.payer,
      mint,
      userTokenAccount.address,
      wallet.payer,
      stakeAmount.toNumber()
    );

    const [userStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), user.publicKey.toBuffer()],
      program.programId
    );

    await program.methods
      .stake(stakeAmount, 0)
      .accounts({
        config: configPda,
        user: user.publicKey,
        userPosition: userStakePda,
        userTokenAccount: userTokenAccount.address,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const signature = await program.methods
      .getUserStake()
      .accounts({
        config: configPda,
        user: user.publicKey,
        userPosition: userStakePda,
      })
      .signers([user])
      .rpc();

    const events = await fetchEventsForSignature(signature);
    const fetched = events.find(
      (event) => event.name.toLowerCase() === "userstakefetched"
    );

    expect(fetched).to.not.eq(undefined);
    const data = fetched!.data;
    const totalPrincipal = new anchor.BN(data.totalPrincipal.toString());
    expect(totalPrincipal.eq(stakeAmount)).to.eq(true);

    expect(data.stakeEntries.length).to.eq(1);
    const firstEntry = data.stakeEntries[0];
    const trancheId = new anchor.BN(firstEntry.trancheId.toString());
    const principal = new anchor.BN(firstEntry.principal.toString());
    expect(trancheId.eq(new anchor.BN(0))).to.eq(true);
    expect(principal.eq(stakeAmount)).to.eq(true);
  });

  it("subscribes within budget and blocks new contracts until pending payments settle", async () => {
    expect(streamingServiceId).to.not.eq(undefined);
    expect(musicServiceId).to.not.eq(undefined);
    expect(premiumServiceId).to.not.eq(undefined);

    const subscriptionUser = Keypair.generate();
    const connection = provider.connection;
    const latestBlockhash = await connection.getLatestBlockhash();
    const airdropSig = await connection.requestAirdrop(
      subscriptionUser.publicKey,
      2 * anchor.web3.LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction({
      signature: airdropSig,
      ...latestBlockhash,
    });

    const subscriptionTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mint,
      subscriptionUser.publicKey
    );

    const stakeAmount = new anchor.BN(7_200_000_000); // 7,200 USDC with 6 decimals
    await mintTo(
      connection,
      wallet.payer,
      mint,
      subscriptionTokenAccount.address,
      wallet.payer,
      stakeAmount.toNumber()
    );

    const [subscriptionUserStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), subscriptionUser.publicKey.toBuffer()],
      program.programId
    );
    const [subscriptionUserSubscriptionsPda] = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_subscriptions"),
        subscriptionUser.publicKey.toBuffer(),
      ],
      program.programId
    );

    await program.methods
      .registerPaypalRecipient({
        recipientType: "PHONE",
        receiver: "91-734-234-1234",
      })
      .accounts({
        user: subscriptionUser.publicKey,
        userSubscriptions: subscriptionUserSubscriptionsPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([subscriptionUser])
      .rpc();
    await program.methods
      .stake(stakeAmount, 0)
      .accounts({
        config: configPda,
        user: subscriptionUser.publicKey,
        userPosition: subscriptionUserStakePda,
        userTokenAccount: subscriptionTokenAccount.address,
        vault: vaultPda,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .signers([subscriptionUser])
      .rpc();
    const pullAvailableSummary = async () => {
      await program.methods
        .getUserAvailableServices()
        .accounts({
          config: configPda,
          user: subscriptionUser.publicKey,
          userPosition: subscriptionUserStakePda,
          userSubscriptions: subscriptionUserSubscriptionsPda,
          subscriptionRegistry: subscriptionRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([subscriptionUser])
        .rpc();

      const [configAccount, userStakeAccount, userSubscriptionsAccount, registryAccount] =
        await Promise.all([
          program.account.sublyConfig.fetch(configPda),
          program.account.userStake.fetch(subscriptionUserStakePda),
          program.account.userSubscriptions.fetch(subscriptionUserSubscriptionsPda),
          program.account.subscriptionRegistry.fetch(subscriptionRegistryPda),
        ]);

      const totalPrincipal = BigInt(userStakeAccount.totalPrincipal.toString());
      const apyBps = BigInt(configAccount.apyBps);
      const monthlyBudget = totalPrincipal * apyBps / BigInt(10_000) / BigInt(12);

      const committed =
        BigInt(userSubscriptionsAccount.totalActiveCommitment.toString()) +
        BigInt(userSubscriptionsAccount.totalPendingCommitment.toString());
      const availableBudget = monthlyBudget > committed ? monthlyBudget - committed : 0n;

      const activeOrPendingServiceIds = new Set(
        userSubscriptionsAccount.subscriptions
          .filter((sub: any) => {
            const statusKey = Object.keys(sub.status)[0];
            return (
              (statusKey === "active" || statusKey === "pendingCancellation") &&
              BigInt(sub.monthlyPriceUsdc.toString()) > 0n
            );
          })
          .map((sub: any) => sub.serviceId.toString())
      );

      const availableServiceIds = registryAccount.services
        .filter((service: any) => {
          const price = BigInt(service.monthlyPriceUsdc.toString());
          const idStr = service.id.toString();
          return price <= availableBudget && !activeOrPendingServiceIds.has(idStr);
        })
        .map((service: any) => Number(service.id));

      availableServiceIds.sort((a, b) => a - b);

      return { availableBudget, availableServiceIds };
    };

    const summaryBefore = await pullAvailableSummary();
    expect(summaryBefore.availableBudget.toString()).to.eq("60000000");
    expect(summaryBefore.availableServiceIds).to.deep.eq(
      [premiumServiceId!, streamingServiceId!, musicServiceId!].sort()
    );

    const firstSubscribeSig = await program.methods
      .subscribeService({ serviceId: new anchor.BN(streamingServiceId!) })
      .accounts({
        config: configPda,
        user: subscriptionUser.publicKey,
        userPosition: subscriptionUserStakePda,
        userSubscriptions: subscriptionUserSubscriptionsPda,
        subscriptionRegistry: subscriptionRegistryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([subscriptionUser])
      .rpc();
    const firstSubscribeEvents = await fetchEventsForSignature(firstSubscribeSig);
    const activationEvent = firstSubscribeEvents.find(
      (event) => event.name.toLowerCase() === "subscriptionactivated"
    )?.data;
    expect(activationEvent, "SubscriptionActivated event missing").to.not.eq(
      undefined
    );
    expect(activationEvent.user.toBase58()).to.eq(
      subscriptionUser.publicKey.toBase58()
    );
    expect(activationEvent.recipientType).to.eq("PHONE");
    expect(activationEvent.receiver).to.eq("91-734-234-1234");
    expect(activationEvent.monthlyPriceUsdc.toString()).to.eq("30000000");

    const lookAheadSeconds = new anchor.BN(40 * 24 * 60 * 60);
    const firstDueSig = await program.methods
      .findDueSubscriptions({ lookAheadSeconds })
      .accounts({
        config: configPda,
        subscriptionRegistry: subscriptionRegistryPda,
      })
      .remainingAccounts([
        {
          pubkey: subscriptionUserSubscriptionsPda,
          isSigner: false,
          isWritable: false,
        },
      ])
      .rpc();
    const firstDueEvents = await fetchEventsForSignature(firstDueSig);
    const firstDue = firstDueEvents.find(
      (event) => event.name.toLowerCase() === "subscriptionsdue"
    )?.data;
    expect(firstDue, "SubscriptionsDue event missing").to.not.eq(undefined);
    expect(firstDue.entries.length).to.eq(1);
    const firstDueEntry = firstDue.entries[0];
    expect(firstDueEntry.user.toBase58()).to.eq(
      subscriptionUser.publicKey.toBase58()
    );
    expect(firstDueEntry.serviceId.toNumber()).to.eq(streamingServiceId);
    expect(firstDueEntry.monthlyPriceUsdc.toString()).to.eq("30000000");
    expect(firstDueEntry.recipientType).to.eq("PHONE");
    expect(firstDueEntry.receiver).to.eq("91-734-234-1234");
    const streamingSubscriptionId = firstDueEntry.subscriptionId.toNumber();

    await program.methods
      .subscribeService({ serviceId: new anchor.BN(musicServiceId!) })
      .accounts({
        config: configPda,
        user: subscriptionUser.publicKey,
        userPosition: subscriptionUserStakePda,
        userSubscriptions: subscriptionUserSubscriptionsPda,
        subscriptionRegistry: subscriptionRegistryPda,
        systemProgram: SystemProgram.programId,
      })
      .signers([subscriptionUser])
      .rpc();
    const summaryAfterActive = await pullAvailableSummary();
    expect(summaryAfterActive.availableBudget.toString()).to.eq("0");
    expect(summaryAfterActive.availableServiceIds).to.deep.eq([]);
    const secondDueSig = await program.methods
      .findDueSubscriptions({ lookAheadSeconds })
      .accounts({
        config: configPda,
        subscriptionRegistry: subscriptionRegistryPda,
      })
      .remainingAccounts([
        {
          pubkey: subscriptionUserSubscriptionsPda,
          isSigner: false,
          isWritable: false,
        },
      ])
      .rpc();
    const secondDueEvents = await fetchEventsForSignature(secondDueSig);
    const secondDue = secondDueEvents.find(
      (event) => event.name.toLowerCase() === "subscriptionsdue"
    )?.data;
    expect(secondDue, "SubscriptionsDue event missing").to.not.eq(undefined);
    expect(secondDue.entries.length).to.eq(2);
    const secondDueServiceIds = secondDue.entries
      .map((entry: any) => entry.serviceId.toNumber())
      .sort((a: number, b: number) => a - b);
    expect(secondDueServiceIds).to.deep.eq(
      [streamingServiceId!, musicServiceId!].sort((a, b) => a - b)
    );
    const paymentSig = await program.methods
      .recordSubscriptionPayment({
        subscriptionId: new anchor.BN(streamingSubscriptionId),
        paymentTs: null,
      })
      .accounts({
        config: configPda,
        operator: wallet.publicKey,
        user: subscriptionUser.publicKey,
        userSubscriptions: subscriptionUserSubscriptionsPda,
      })
      .rpc();
    const paymentEvents = await fetchEventsForSignature(paymentSig);
    const paymentEvent = paymentEvents.find(
      (event) => event.name.toLowerCase() === "subscriptionpaymentrecorded"
    )?.data;
    expect(paymentEvent, "SubscriptionPaymentRecorded event missing").to.not.eq(
      undefined
    );
    expect(paymentEvent.subscriptionId.toNumber()).to.eq(streamingSubscriptionId);
    expect(paymentEvent.status).to.eq("ACTIVE");

    const postPaymentDueSig = await program.methods
      .findDueSubscriptions({ lookAheadSeconds })
      .accounts({
        config: configPda,
        subscriptionRegistry: subscriptionRegistryPda,
      })
      .remainingAccounts([
        {
          pubkey: subscriptionUserSubscriptionsPda,
          isSigner: false,
          isWritable: false,
        },
      ])
      .rpc();
    const postPaymentEvents = await fetchEventsForSignature(postPaymentDueSig);
    const postPaymentDue = postPaymentEvents.find(
      (event) => event.name.toLowerCase() === "subscriptionsdue"
    )?.data;
    expect(postPaymentDue, "SubscriptionsDue event missing after payment").to.not.eq(
      undefined
    );
    expect(postPaymentDue.entries.length).to.eq(1);
    expect(postPaymentDue.entries[0].serviceId.toNumber()).to.eq(musicServiceId);
    const subscriptionsAfterActivate: any =
      await program.account.userSubscriptions.fetch(
        subscriptionUserSubscriptionsPda
      );
    expect(subscriptionsAfterActivate.totalActiveCommitment.toString()).to.eq(
      "60000000"
    );
    expect(subscriptionsAfterActivate.totalPendingCommitment.toString()).to.eq(
      "0"
    );
    expect(subscriptionsAfterActivate.subscriptions.length).to.eq(2);

    const listSig = await program.methods
      .getUserSubscriptions()
      .accounts({
        user: subscriptionUser.publicKey,
        userSubscriptions: subscriptionUserSubscriptionsPda,
        subscriptionRegistry: subscriptionRegistryPda,
      })
      .signers([subscriptionUser])
      .rpc();
    const listEvents = await fetchEventsForSignature(listSig);
    const listed = listEvents.find(
      (event) => event.name.toLowerCase() === "usersubscriptionsfetched"
    );
    expect(listed, "UserSubscriptionsFetched event missing").to.not.eq(undefined);
    const listedData = listed!.data;
    expect(listedData.user.toBase58()).to.eq(
      subscriptionUser.publicKey.toBase58()
    );
    expect(listedData.subscriptions.length).to.eq(2);
    const listedIds = listedData.subscriptions
      .map((entry: any) => Number(entry.serviceId.toString()))
      .sort((a: number, b: number) => a - b);
    expect(listedIds).to.deep.eq(
      [streamingServiceId!, musicServiceId!].sort((a, b) => a - b)
    );
    const streamingFromList = listedData.subscriptions.find(
      (entry: any) => Number(entry.serviceId.toString()) === streamingServiceId
    );
    expect(streamingFromList.serviceName).to.eq("Stream Vault");
    expect(streamingFromList.serviceProvider).to.eq("Vault Media");
    expect(streamingFromList.status).to.eq("ACTIVE");
    expect(streamingFromList.monthlyPriceUsdc.toString()).to.eq("30000000");

    await expectAnchorError(
      program.methods
        .subscribeService({ serviceId: new anchor.BN(premiumServiceId!) })
        .accounts({
          config: configPda,
          user: subscriptionUser.publicKey,
          userPosition: subscriptionUserStakePda,
          userSubscriptions: subscriptionUserSubscriptionsPda,
          subscriptionRegistry: subscriptionRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([subscriptionUser])
        .rpc(),
      "SubscriptionBudgetExceeded"
    );
    const streamingSubscription = subscriptionsAfterActivate.subscriptions.find(
      (sub: any) => sub.serviceId.toNumber() === streamingServiceId
    );
    expect(streamingSubscription).to.not.eq(undefined);

    await program.methods
      .unsubscribeService({ subscriptionId: streamingSubscription.id })
      .accounts({
        user: subscriptionUser.publicKey,
        userSubscriptions: subscriptionUserSubscriptionsPda,
      })
      .signers([subscriptionUser])
      .rpc();
    const subscriptionsAfterUnsubscribe: any =
      await program.account.userSubscriptions.fetch(
        subscriptionUserSubscriptionsPda
      );
    expect(
      subscriptionsAfterUnsubscribe.totalActiveCommitment.toString()
    ).to.eq("30000000");
    expect(
      subscriptionsAfterUnsubscribe.totalPendingCommitment.toString()
    ).to.eq("30000000");
    const pendingSubscription =
      subscriptionsAfterUnsubscribe.subscriptions.find(
        (sub: any) => sub.serviceId.toNumber() === streamingServiceId
      );
    expect(pendingSubscription).to.not.eq(undefined);
    expect(
      Object.prototype.hasOwnProperty.call(
        pendingSubscription.status,
        "pendingCancellation"
      )
    ).to.eq(true);
    const summaryWhilePending = await pullAvailableSummary();
    expect(summaryWhilePending.availableBudget.toString()).to.eq("0");
    expect(summaryWhilePending.availableServiceIds).to.deep.eq([]);

    const listAfterUnsubscribeSig = await program.methods
      .getUserSubscriptions()
      .accounts({
        user: subscriptionUser.publicKey,
        userSubscriptions: subscriptionUserSubscriptionsPda,
        subscriptionRegistry: subscriptionRegistryPda,
      })
      .signers([subscriptionUser])
      .rpc();
    const listAfterEvents = await fetchEventsForSignature(listAfterUnsubscribeSig);
    const afterListed = listAfterEvents.find(
      (event) => event.name.toLowerCase() === "usersubscriptionsfetched"
    );
    expect(afterListed, "UserSubscriptionsFetched event missing post-unsubscribe").to.not.eq(
      undefined
    );
    const afterData = afterListed!.data;
    const streamingStatus = afterData.subscriptions.find(
      (entry: any) => Number(entry.serviceId.toString()) === streamingServiceId
    )?.status;
    const musicStatus = afterData.subscriptions.find(
      (entry: any) => Number(entry.serviceId.toString()) === musicServiceId
    )?.status;
    expect(streamingStatus).to.eq("PENDING_CANCELLATION");
    expect(musicStatus).to.eq("ACTIVE");

    await expectAnchorError(
      program.methods
        .subscribeService({ serviceId: new anchor.BN(premiumServiceId!) })
        .accounts({
          config: configPda,
          user: subscriptionUser.publicKey,
          userPosition: subscriptionUserStakePda,
          userSubscriptions: subscriptionUserSubscriptionsPda,
          subscriptionRegistry: subscriptionRegistryPda,
          systemProgram: SystemProgram.programId,
        })
        .signers([subscriptionUser])
        .rpc(),
      "SubscriptionBudgetExceeded"
    );
  });
});
