import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import {
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
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
  const bn = lamports instanceof anchor.BN ? lamports : new anchor.BN(lamports.toString());
  const whole = bn.div(new anchor.BN(1_000_000));
  const fractional = bn.mod(new anchor.BN(1_000_000)).toString().padStart(6, "0");
  return `${whole.toString()}.${fractional}`;
};

const expectAnchorError = async (promise: Promise<unknown>, code: string) => {
  try {
    await promise;
    expect.fail(`Expected Anchor error ${code}`);
  } catch (err: any) {
    const anchorError = err?.error ?? err;
    const received = anchorError?.errorCode?.code ?? anchorError?.error?.errorCode?.code;
    expect(received).to.eq(code);
  }
};

describe("subly-solana-program", () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const wallet = provider.wallet as anchor.Wallet;
  const program = anchor.workspace.SublySolanaProgram as Program<SublySolanaProgram>;

  const [configPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    program.programId,
  );
  const [vaultPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault")],
    program.programId,
  );

  let mint: PublicKey;
  let walletTokenAccount: PublicKey;

  before(async () => {
    mint = await createMint(
      provider.connection,
      wallet.payer,
      wallet.publicKey,
      null,
      6,
    );

    const walletAta = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      wallet.payer,
      mint,
      wallet.publicKey,
    );
    walletTokenAccount = walletAta.address;

    const mintAmount = BigInt(50_000_000_000_000); // 50M USDC equivalent
    await mintTo(
      provider.connection,
      wallet.payer,
      mint,
      walletTokenAccount,
      wallet.payer,
      mintAmount,
    );

    await program.methods
      .initialize({ authority: wallet.publicKey })
      .accounts({
        payer: wallet.publicKey,
        usdcMint: mint,
        config: configPda,
        vault: vaultPda,
        systemProgram: SystemProgram.programId,
        tokenProgram: TOKEN_PROGRAM_ID,
        rent: anchor.web3.SYSVAR_RENT_PUBKEY,
      })
      .rpc();
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
      2 * anchor.web3.LAMPORTS_PER_SOL,
    );
    await connection.confirmTransaction({ signature: airdropSig, ...latestBlockhash });

    const userTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      wallet.payer,
      mint,
      user.publicKey,
    );

    const stakeAmount = new anchor.BN(10_000_000_000_000); // 10M USDC with 6 decimals
    await mintTo(
      connection,
      wallet.payer,
      mint,
      userTokenAccount.address,
      wallet.payer,
      stakeAmount.toNumber(),
    );

    const [userStakePda] = PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), user.publicKey.toBuffer()],
      program.programId,
    );

    console.log("Staking", formatUsdc(stakeAmount), "USDC for lock option 0 (30 days)");

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

    const userStakeAccount: any = await program.account.userStake.fetch(userStakePda);
    expect(userStakeAccount.entries.length).to.eq(1);
    const stakeEntry = userStakeAccount.entries[0];
    const accruedBeforeClaim = new anchor.BN(stakeEntry.unrealizedYield);
    console.log("Unrealized yield after sync", formatUsdc(accruedBeforeClaim), "USDC");
    expect(accruedBeforeClaim.gt(new anchor.BN(0))).to.eq(true);

    const configBeforeClaim = await program.account.sublyConfig.fetch(configPda);
    const rewardBefore = configBeforeClaim.rewardPool as anchor.BN;
    console.log("Reward pool before operator claim", formatUsdc(rewardBefore), "USDC");

    const operatorTokenBefore = toBN(
      (await getAccount(connection, walletTokenAccount)).amount,
    );
    console.log(
      "Operator wallet before claim",
      formatUsdc(operatorTokenBefore),
      "USDC",
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
    console.log("Reward pool after operator claim", formatUsdc(rewardAfter), "USDC");
    expect(rewardAfter.lt(rewardBefore)).to.eq(true);

    const operatorTokenAfter = toBN(
      (await getAccount(connection, walletTokenAccount)).amount,
    );
    console.log(
      "Operator wallet after claim",
      formatUsdc(operatorTokenAfter),
      "USDC",
    );
    expect(operatorTokenAfter.gt(operatorTokenBefore)).to.eq(true);

    const userStakeAfterClaim: any = await program.account.userStake.fetch(userStakePda);
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
      "NothingToClaim",
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
      "StakeLocked",
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
          2 * anchor.web3.LAMPORTS_PER_SOL,
        );
        await connection.confirmTransaction({ signature: sig, ...latestBlockhash });

        const ata = await getOrCreateAssociatedTokenAccount(
          connection,
          wallet.payer,
          mint,
          user.publicKey,
        );

        return { user, ata: ata.address };
      }),
    );

    for (const { userIndex, amount, lock } of stakes) {
      const info = userInfos[userIndex];
      await mintTo(
        connection,
        wallet.payer,
        mint,
        info.ata,
        wallet.payer,
        amount.toNumber(),
      );

      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_position"), info.user.publicKey.toBuffer()],
        program.programId,
      );

      console.log(
        `User ${userIndex} staking ${formatUsdc(amount)} USDC (lock option ${lock})`,
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
        program.programId,
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

      const stakeAccount: any = await program.account.userStake.fetch(userStakePda);
      stakeAccount.entries.forEach((entry: any, index: number) => {
        console.log(
          `User ${i} tranche ${index} unrealized`,
          formatUsdc(new anchor.BN(entry.unrealizedYield)),
          "USDC",
        );
        expect(new anchor.BN(entry.unrealizedYield).gt(new anchor.BN(0))).to.eq(true);
      });
    }
  });
});
