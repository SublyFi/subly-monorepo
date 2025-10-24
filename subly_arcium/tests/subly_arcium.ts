import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair } from "@solana/web3.js";
import { SublyArcium } from "../target/types/subly_arcium";
import { randomBytes } from "crypto";
import {
  awaitComputationFinalization,
  getArciumEnv,
  getCompDefAccOffset,
  getArciumAccountBaseSeed,
  getArciumProgAddress,
  uploadCircuit,
  buildFinalizeCompDefTx,
  RescueCipher,
  deserializeLE,
  getMXEAccAddress,
  getMempoolAccAddress,
  getCompDefAccAddress,
  getExecutingPoolAccAddress,
  x25519,
  getComputationAccAddress,
  getMXEPublicKey,
} from "@arcium-hq/client";
import * as fs from "fs";
import * as os from "os";
import { expect } from "chai";
import {
  TOKEN_PROGRAM_ID,
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} from "@solana/spl-token";

/**
 * Comprehensive test suite for Subly Arcium subscription management system.
 *
 * This test suite demonstrates the complete workflow of the Subly platform:
 * 1. Initialize the Subly system with encrypted state
 * 2. Register PayPal recipient information (encrypted)
 * 3. Register a subscription service with encrypted metadata
 * 4. Stake USDC tokens for participation
 * 5. Subscribe to a service
 * 6. Find due subscriptions
 * 7. Record subscription payments
 * 8. Unsubscribe from service
 * 9. Unstake USDC tokens
 *
 * All sensitive operations are performed through Arcium's MPC (Multi-Party Computation)
 * network to ensure privacy and confidentiality of user data and subscription details.
 */
describe("SublyArcium", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());
  const program = anchor.workspace.SublyArcium as Program<SublyArcium>;
  const provider = anchor.getProvider();

  const arciumEnv = getArciumEnv();

  // Extend timeout for MPC computations
  const TEST_TIMEOUT = 300000; // 5 minutes

  it("Test complete Subly subscription flow", async function () {
    // Set timeout for this specific test
    this.timeout(TEST_TIMEOUT);

    const owner = readKpJson(`${os.homedir()}/.config/solana/id.json`);
    const serviceCreator = Keypair.generate();
    const subscriber = Keypair.generate();

    console.log("Owner address:", owner.publicKey.toBase58());
    console.log(
      "Service creator address:",
      serviceCreator.publicKey.toBase58()
    );
    console.log("Subscriber address:", subscriber.publicKey.toBase58());

    // Airdrop to service creator
    console.log("Airdropping funds to service creator");
    const airdropCreatorTx = await provider.connection.requestAirdrop(
      serviceCreator.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction({
      signature: airdropCreatorTx,
      blockhash: (await provider.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: (
        await provider.connection.getLatestBlockhash()
      ).lastValidBlockHeight,
    });

    // Airdrop to subscriber
    console.log("Airdropping funds to subscriber");
    const airdropSubscriberTx = await provider.connection.requestAirdrop(
      subscriber.publicKey,
      5 * anchor.web3.LAMPORTS_PER_SOL
    );
    await provider.connection.confirmTransaction({
      signature: airdropSubscriberTx,
      blockhash: (await provider.connection.getLatestBlockhash()).blockhash,
      lastValidBlockHeight: (
        await provider.connection.getLatestBlockhash()
      ).lastValidBlockHeight,
    });

    const mxePublicKey = await getMXEPublicKeyWithRetry(
      provider as anchor.AnchorProvider,
      program.programId
    );

    console.log("MXE x25519 pubkey is", mxePublicKey);

    // Initialize computation definitions
    console.log("Initializing computation definitions...");
    await Promise.all([
      initInitializeCompDef(program, owner, false, false).then((sig) =>
        console.log("Initialize CompDef Init Sig:", sig)
      ),
      initInitializeUserStakeCompDef(program, owner, false, false).then((sig) =>
        console.log("Initialize User Stake CompDef Init Sig:", sig)
      ),
      initRegisterPaypalRecipientCompDef(program, owner, false, false).then(
        (sig) => console.log("Register PayPal CompDef Init Sig:", sig)
      ),
      initRegisterSubscriptionServiceCompDef(program, owner, false, false).then(
        (sig) => console.log("Register Service CompDef Init Sig:", sig)
      ),
      initSubscribeServiceCompDef(program, owner, false, false).then((sig) =>
        console.log("Subscribe Service CompDef Init Sig:", sig)
      ),
      initStakeCompDef(program, owner, false, false).then((sig) =>
        console.log("Stake CompDef Init Sig:", sig)
      ),
      initUnstakeCompDef(program, owner, false, false).then((sig) =>
        console.log("Unstake CompDef Init Sig:", sig)
      ),
      initUnsubscribeServiceCompDef(program, owner, false, false).then((sig) =>
        console.log("Unsubscribe Service CompDef Init Sig:", sig)
      ),
      initRecordSubscriptionPaymentCompDef(program, owner, false, false).then(
        (sig) => console.log("Record Payment CompDef Init Sig:", sig)
      ),
      initFindDueSubscriptionsCompDef(program, owner, false, false).then(
        (sig) => console.log("Find Due Subscriptions CompDef Init Sig:", sig)
      ),
    ]);

    console.log("All computation definitions initialized");

    // Create USDC mint
    console.log("Creating USDC mint");
    const usdcMint = await createMint(
      provider.connection,
      owner,
      owner.publicKey,
      null,
      6
    );
    console.log("USDC Mint:", usdcMint.toBase58());

    // Step 1: Initialize the Subly system
    console.log("\n=== Step 1: Initialize Subly System ===");
    const configPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("config")],
      program.programId
    )[0];

    const vaultPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("vault"), usdcMint.toBuffer()],
      program.programId
    )[0];

    const subscriptionRegistryPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("subscription_registry")],
      program.programId
    )[0];

    const initComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const initSig = await program.methods
      .initialize(initComputationOffset, {
        authority: owner.publicKey,
      })
      .accountsPartial({
        payer: owner.publicKey,
        usdcMint: usdcMint,
        config: configPDA,
        vault: vaultPDA,
        subscriptionRegistry: subscriptionRegistryPDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          initComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("initialize_subly")).readUInt32LE()
        ),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    console.log("Initialize transaction signature:", initSig);

    console.log("Waiting for initialize computation to finalize...");
    const initFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      initComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Initialize finalize signature:", initFinalizeSig);

    // Step 2: Register PayPal recipient for subscriber
    console.log("\n=== Step 2: Register PayPal Recipient ===");
    const userSubscriptionsPDA = PublicKey.findProgramAddressSync(
      [Buffer.from("user_subscriptions"), subscriber.publicKey.toBuffer()],
      program.programId
    )[0];

    // Setup encryption for PayPal recipient info
    const privateKey = x25519.utils.randomSecretKey();
    const publicKey = x25519.getPublicKey(privateKey);
    const sharedSecret = x25519.getSharedSecret(privateKey, mxePublicKey);
    const cipher = new RescueCipher(sharedSecret);

    const recipientType = "email"; // Email type
    const receiverEmail = "user@example.com";

    const paypalComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const registerPaypalSig = await program.methods
      .registerPaypalRecipient(paypalComputationOffset, {
        recipientType,
        receiver: receiverEmail,
      })
      .accountsPartial({
        payer: subscriber.publicKey,
        userSubscriptions: userSubscriptionsPDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          paypalComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(
            getCompDefAccOffset("register_paypal_recipient_subly")
          ).readUInt32LE()
        ),
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Register PayPal signature:", registerPaypalSig);

    console.log("Waiting for PayPal registration to finalize...");
    const paypalFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      paypalComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Register PayPal finalize signature:", paypalFinalizeSig);

    // Step 3: Register a subscription service
    console.log("\n=== Step 3: Register Subscription Service ===");
    const subscriptionRegistry =
      await program.account.subscriptionRegistry.fetch(subscriptionRegistryPDA);
    const nextServiceId = subscriptionRegistry.nextServiceId;

    const subscriptionServicePDA = PublicKey.findProgramAddressSync(
      [
        Buffer.from("subscription_registry"),
        nextServiceId.toArrayLike(Buffer, "le", 8),
      ],
      program.programId
    )[0];

    const serviceHashLow = new anchor.BN("1234567890");
    const serviceHashHigh = new anchor.BN("9876543210");
    const monthlyPriceUsdc = new anchor.BN(10_000000); // 10 USDC
    const billingIntervalSecs = new anchor.BN(2592000); // 30 days
    const metadataHashLow = new anchor.BN("1111222233334444");
    const metadataHashHigh = new anchor.BN("5555666677778888");

    const registerServiceComputationOffset = new anchor.BN(
      randomBytes(8),
      "hex"
    );

    const registerServiceSig = await program.methods
      .registerSubscriptionService(registerServiceComputationOffset, {
        serviceHashLow,
        serviceHashHigh,
        monthlyPriceUsdc,
        billingIntervalSecs,
        metadataHashLow,
        metadataHashHigh,
      })
      .accountsPartial({
        payer: serviceCreator.publicKey,
        creator: serviceCreator.publicKey,
        subscriptionRegistry: subscriptionRegistryPDA,
        subscriptionService: subscriptionServicePDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          registerServiceComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(
            getCompDefAccOffset("register_subscription_service_subly")
          ).readUInt32LE()
        ),
      })
      .signers([serviceCreator])
      .rpc({ commitment: "confirmed" });

    console.log("Register service signature:", registerServiceSig);

    console.log("Waiting for service registration to finalize...");
    const registerServiceFinalizeSig =
      await awaitComputationFinalizationWithRetry(
        provider as anchor.AnchorProvider,
        registerServiceComputationOffset,
        program.programId,
        "confirmed"
      );
    console.log(
      "Register service finalize signature:",
      registerServiceFinalizeSig
    );

    // Step 3.5: Initialize User Stake Account
    console.log("\n=== Step 3.5: Initialize User Stake Account ===");
    const userStakePDA = PublicKey.findProgramAddressSync(
      [Buffer.from("user_position"), subscriber.publicKey.toBuffer()],
      program.programId
    )[0];

    console.log("User Stake PDA:", userStakePDA.toBase58());

    const initUserStakeComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const initUserStakeSig = await program.methods
      .initializeUserStake(initUserStakeComputationOffset)
      .accountsPartial({
        payer: subscriber.publicKey,
        user: subscriber.publicKey,
        userStake: userStakePDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          initUserStakeComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(
            getCompDefAccOffset("initialize_user_stake_subly")
          ).readUInt32LE()
        ),
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Initialize user stake signature:", initUserStakeSig);

    console.log("Waiting for user stake initialization to finalize...");
    const initUserStakeFinalizeSig =
      await awaitComputationFinalizationWithRetry(
        provider as anchor.AnchorProvider,
        initUserStakeComputationOffset,
        program.programId,
        "confirmed"
      );
    console.log(
      "Initialize user stake finalize signature:",
      initUserStakeFinalizeSig
    );

    // Step 4: Stake USDC
    console.log("\n=== Step 4: Stake USDC ===");

    console.log("User Stake PDA:", userStakePDA.toBase58());

    // Create token account for subscriber and mint tokens
    const subscriberTokenAccount = await getOrCreateAssociatedTokenAccount(
      provider.connection,
      subscriber,
      usdcMint,
      subscriber.publicKey
    );

    // Mint 1000 USDC to subscriber
    await mintTo(
      provider.connection,
      owner,
      usdcMint,
      subscriberTokenAccount.address,
      owner,
      1000_000000
    );

    console.log("Minted 1000 USDC to subscriber");

    const stakeAmount = new anchor.BN(100_000000); // 100 USDC
    const lockOption = 1; // Lock option (see constants)

    const stakeComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const stakeSig = await program.methods
      .stake(stakeComputationOffset, {
        amount: stakeAmount,
        lockOption,
      })
      .accountsPartial({
        payer: subscriber.publicKey,
        config: configPDA,
        user: subscriber.publicKey,
        userStake: userStakePDA,
        userTokenAccount: subscriberTokenAccount.address,
        vault: vaultPDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          stakeComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("stake_subly")).readUInt32LE()
        ),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Stake transaction signature:", stakeSig);

    console.log("Waiting for stake computation to finalize...");
    const stakeFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      stakeComputationOffset,
      program.programId,
      "confirmed",
      10, // max retries
      5000 // 5 seconds between retries
    );
    console.log("Stake finalize signature:", stakeFinalizeSig);

    // Step 5: Subscribe to service
    console.log("\n=== Step 5: Subscribe to Service ===");
    const contractSeed = randomBytes(32);
    const subscriptionContractPDA = PublicKey.findProgramAddressSync(
      [
        Buffer.from("user_contract"),
        subscriber.publicKey.toBuffer(),
        contractSeed,
      ],
      program.programId
    )[0];

    const subscribeComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const subscribeSig = await program.methods
      .subscribeService(subscribeComputationOffset, {
        serviceId: nextServiceId,
        contractSeed: Array.from(contractSeed),
      })
      .accountsPartial({
        payer: subscriber.publicKey,
        user: subscriber.publicKey,
        subscriptionRegistry: subscriptionRegistryPDA,
        subscriptionService: subscriptionServicePDA,
        subscriptionContract: subscriptionContractPDA,
        userSubscriptions: userSubscriptionsPDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          subscribeComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(
            getCompDefAccOffset("subscribe_service_subly")
          ).readUInt32LE()
        ),
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Subscribe transaction signature:", subscribeSig);

    console.log("Waiting for subscription to finalize...");
    const subscribeFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      subscribeComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Subscribe finalize signature:", subscribeFinalizeSig);

    // Step 6: Find due subscriptions
    console.log("\n=== Step 6: Find Due Subscriptions ===");
    const findDueComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const findDueSig = await program.methods
      .findDueSubscriptions(findDueComputationOffset, {
        contractSeed: Array.from(contractSeed),
      })
      .accountsPartial({
        payer: subscriber.publicKey,
        user: subscriber.publicKey,
        userSubscriptions: userSubscriptionsPDA,
        subscriptionContract: subscriptionContractPDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          findDueComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(
            getCompDefAccOffset("find_due_subscriptions_subly")
          ).readUInt32LE()
        ),
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Find due subscriptions signature:", findDueSig);

    console.log("Waiting for find due subscriptions to finalize...");
    const findDueFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      findDueComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log(
      "Find due subscriptions finalize signature:",
      findDueFinalizeSig
    );

    // Step 7: Record subscription payment
    console.log("\n=== Step 7: Record Subscription Payment ===");
    const paymentComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const paymentSig = await program.methods
      .recordSubscriptionPayment(paymentComputationOffset, {
        contractSeed: Array.from(contractSeed),
        paymentTs: null, // Will use current time
      })
      .accountsPartial({
        payer: subscriber.publicKey,
        config: configPDA,
        user: subscriber.publicKey,
        userSubscriptions: userSubscriptionsPDA,
        subscriptionContract: subscriptionContractPDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          paymentComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(
            getCompDefAccOffset("record_subscription_payment_subly")
          ).readUInt32LE()
        ),
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Record payment signature:", paymentSig);

    console.log("Waiting for payment recording to finalize...");
    const paymentFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      paymentComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Record payment finalize signature:", paymentFinalizeSig);

    // Step 8: Unsubscribe from service
    console.log("\n=== Step 8: Unsubscribe from Service ===");
    const unsubscribeComputationOffset = new anchor.BN(randomBytes(8), "hex");

    const unsubscribeSig = await program.methods
      .unsubscribeService(unsubscribeComputationOffset, {
        contractSeed: Array.from(contractSeed),
      })
      .accountsPartial({
        payer: subscriber.publicKey,
        user: subscriber.publicKey,
        userSubscriptions: userSubscriptionsPDA,
        subscriptionContract: subscriptionContractPDA,
        computationAccount: getComputationAccAddress(
          program.programId,
          unsubscribeComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(
            getCompDefAccOffset("unsubscribe_service_subly")
          ).readUInt32LE()
        ),
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Unsubscribe signature:", unsubscribeSig);

    console.log("Waiting for unsubscribe to finalize...");
    const unsubscribeFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      unsubscribeComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Unsubscribe finalize signature:", unsubscribeFinalizeSig);

    // Step 9: Unstake USDC (after lock period)
    console.log("\n=== Step 9: Unstake USDC ===");
    // Wait for lock period to expire (in real scenario, this would require waiting)
    const unstakeComputationOffset = new anchor.BN(randomBytes(8), "hex");
    const unstakeAmount = new anchor.BN(50_000000); // 50 USDC

    const unstakeSig = await program.methods
      .unstake(unstakeComputationOffset, {
        amount: unstakeAmount,
      })
      .accountsPartial({
        payer: subscriber.publicKey,
        config: configPDA,
        user: subscriber.publicKey,
        userStake: userStakePDA,
        vault: vaultPDA,
        userTokenAccount: subscriberTokenAccount.address,
        computationAccount: getComputationAccAddress(
          program.programId,
          unstakeComputationOffset
        ),
        clusterAccount: arciumEnv.arciumClusterPubkey,
        mxeAccount: getMXEAccAddress(program.programId),
        mempoolAccount: getMempoolAccAddress(program.programId),
        executingPool: getExecutingPoolAccAddress(program.programId),
        compDefAccount: getCompDefAccAddress(
          program.programId,
          Buffer.from(getCompDefAccOffset("unstake_subly")).readUInt32LE()
        ),
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .signers([subscriber])
      .rpc({ commitment: "confirmed" });

    console.log("Unstake signature:", unstakeSig);

    console.log("Waiting for unstake to finalize...");
    const unstakeFinalizeSig = await awaitComputationFinalizationWithRetry(
      provider as anchor.AnchorProvider,
      unstakeComputationOffset,
      program.programId,
      "confirmed"
    );
    console.log("Unstake finalize signature:", unstakeFinalizeSig);

    console.log("\n=== All Tests Completed Successfully ===");
  });

  // Helper functions for initializing computation definitions
  async function initInitializeCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("initialize_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initInitializeSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/initialize_subly.arcis");
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "initialize_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initRegisterPaypalRecipientCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("register_paypal_recipient_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initRegisterPaypalRecipientSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync(
        "build/register_paypal_recipient_subly.arcis"
      );
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "register_paypal_recipient_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initRegisterSubscriptionServiceCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("register_subscription_service_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initRegisterSubscriptionServiceSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync(
        "build/register_subscription_service_subly.arcis"
      );
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "register_subscription_service_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initSubscribeServiceCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("subscribe_service_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initSubscribeServiceSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/subscribe_service_subly.arcis");
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "subscribe_service_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initInitializeUserStakeCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("initialize_user_stake_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initInitializeUserStakeSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync(
        "build/initialize_user_stake_subly.arcis"
      );
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "initialize_user_stake_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initStakeCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("stake_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initStakeSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/stake_subly.arcis");
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "stake_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initInitializeUserStakeCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("initialize_user_stake_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initInitializeUserStakeSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync(
        "build/initialize_user_stake_subly.arcis"
      );
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "initialize_user_stake_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initUnstakeCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("unstake_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initUnstakeSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync("build/unstake_subly.arcis");
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "unstake_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initUnsubscribeServiceCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("unsubscribe_service_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initUnsubscribeServiceSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync(
        "build/unsubscribe_service_subly.arcis"
      );
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "unsubscribe_service_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initRecordSubscriptionPaymentCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("record_subscription_payment_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initRecordSubscriptionPaymentSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync(
        "build/record_subscription_payment_subly.arcis"
      );
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "record_subscription_payment_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }

  async function initFindDueSubscriptionsCompDef(
    program: Program<SublyArcium>,
    owner: anchor.web3.Keypair,
    uploadRawCircuit: boolean,
    offchainSource: boolean
  ): Promise<string> {
    const baseSeedCompDefAcc = getArciumAccountBaseSeed(
      "ComputationDefinitionAccount"
    );
    const offset = getCompDefAccOffset("find_due_subscriptions_subly");

    const compDefPDA = PublicKey.findProgramAddressSync(
      [baseSeedCompDefAcc, program.programId.toBuffer(), offset],
      getArciumProgAddress()
    )[0];

    const sig = await program.methods
      .initFindDueSubscriptionsSublyCompDef()
      .accounts({
        compDefAccount: compDefPDA,
        payer: owner.publicKey,
        mxeAccount: getMXEAccAddress(program.programId),
      })
      .signers([owner])
      .rpc({ commitment: "confirmed" });

    if (uploadRawCircuit) {
      const rawCircuit = fs.readFileSync(
        "build/find_due_subscriptions_subly.arcis"
      );
      await uploadCircuit(
        provider as anchor.AnchorProvider,
        "find_due_subscriptions_subly",
        program.programId,
        rawCircuit,
        true
      );
    } else if (!offchainSource) {
      const finalizeTx = await buildFinalizeCompDefTx(
        provider as anchor.AnchorProvider,
        Buffer.from(offset).readUInt32LE(),
        program.programId
      );
      const latestBlockhash = await provider.connection.getLatestBlockhash();
      finalizeTx.recentBlockhash = latestBlockhash.blockhash;
      finalizeTx.lastValidBlockHeight = latestBlockhash.lastValidBlockHeight;
      finalizeTx.sign(owner);
      await provider.sendAndConfirm(finalizeTx);
    }
    return sig;
  }
});

// Utility functions
async function checkComputationStatus(
  provider: anchor.AnchorProvider,
  computationOffset: anchor.BN,
  programId: PublicKey
): Promise<void> {
  try {
    const computationAddress = getComputationAccAddress(
      programId,
      computationOffset
    );
    const accountInfo = await provider.connection.getAccountInfo(
      computationAddress
    );

    if (!accountInfo) {
      console.log("  ⚠ Computation account does not exist");
      return;
    }

    console.log("  ℹ Computation account exists");
    console.log("    - Owner:", accountInfo.owner.toBase58());
    console.log("    - Data length:", accountInfo.data.length);
    console.log("    - Lamports:", accountInfo.lamports);
  } catch (error) {
    console.log("  ⚠ Error checking computation status:", error);
  }
}

async function awaitComputationFinalizationWithRetry(
  provider: anchor.AnchorProvider,
  computationOffset: anchor.BN,
  programId: PublicKey,
  commitment: "confirmed" | "finalized" = "confirmed",
  maxRetries: number = 10,
  retryDelayMs: number = 5000
): Promise<string> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(
        `Attempting computation finalization (attempt ${attempt}/${maxRetries})...`
      );

      // Check computation account status before attempting finalization
      await checkComputationStatus(provider, computationOffset, programId);

      // Add timeout wrapper to awaitComputationFinalization
      const timeoutMs = 30000; // 30 seconds timeout per attempt
      const sig = await Promise.race([
        awaitComputationFinalization(
          provider,
          computationOffset,
          programId,
          commitment
        ),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(`Timeout after ${timeoutMs}ms`)),
            timeoutMs
          )
        ),
      ]);

      console.log(`✓ Computation finalized successfully on attempt ${attempt}`);
      return sig;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      console.log(`✗ Attempt ${attempt} failed: ${errorMsg}`);

      if (attempt < maxRetries) {
        console.log(`  Retrying in ${retryDelayMs}ms...`);
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
      } else {
        throw new Error(
          `Failed to finalize computation after ${maxRetries} attempts. Last error: ${errorMsg}`
        );
      }
    }
  }

  throw new Error(
    `Failed to finalize computation after ${maxRetries} attempts`
  );
}

async function getMXEPublicKeyWithRetry(
  provider: anchor.AnchorProvider,
  programId: PublicKey,
  maxRetries: number = 10,
  retryDelayMs: number = 500
): Promise<Uint8Array> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const mxePublicKey = await getMXEPublicKey(provider, programId);
      if (mxePublicKey) {
        return mxePublicKey;
      }
    } catch (error) {
      console.log(`Attempt ${attempt} failed to fetch MXE public key:`, error);
    }

    if (attempt < maxRetries) {
      console.log(
        `Retrying in ${retryDelayMs}ms... (attempt ${attempt}/${maxRetries})`
      );
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
  }

  throw new Error(
    `Failed to fetch MXE public key after ${maxRetries} attempts`
  );
}

function readKpJson(path: string): anchor.web3.Keypair {
  return anchor.web3.Keypair.fromSecretKey(
    Buffer.from(JSON.parse(require("fs").readFileSync(path, "utf-8")))
  );
}
