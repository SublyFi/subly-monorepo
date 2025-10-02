"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { usePrivy } from "@privy-io/react-auth"
import { useSignAndSendTransaction, useWallets } from "@privy-io/react-auth/solana"
import { Connection, PublicKey } from "@solana/web3.js"
import bs58 from "bs58"
import { Loader2 } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Input } from "@/components/ui/input"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  fetchSublyConfig,
  fetchUserStakeEntries,
  formatUsdcAmountDisplay,
  formatUsdcFromSmallestToDisplay,
  parseUsdcAmount,
  prepareStakeTransaction,
  prepareUnstakeTransaction,
  type StakeEntrySummary,
} from "@/lib/subly"
import { getAssociatedTokenAddress } from "@solana/spl-token"

const DEVNET_ENDPOINT =
  process.env.NEXT_PUBLIC_SOLANA_RPC_ENDPOINT ?? "https://api.devnet.solana.com"

export function StakeInterface() {
  const [stakeAmount, setStakeAmount] = useState("")
  const [selectedLockPeriod, setSelectedLockPeriod] = useState("12month")
  const [isStaking, setIsStaking] = useState(false)
  const [isUnstaking, setIsUnstaking] = useState(false)
  const [isFetchingTranches, setIsFetchingTranches] = useState(false)
  const [availableTranches, setAvailableTranches] = useState<StakeEntrySummary[]>([])
  const [selectedTrancheId, setSelectedTrancheId] = useState<number | null>(null)
  const [usdcBalance, setUsdcBalance] = useState<bigint>(0n)
  const [isBalanceLoading, setIsBalanceLoading] = useState(false)

  const { ready, authenticated } = usePrivy()
  const { wallets, ready: walletsReady } = useWallets()
  const { signAndSendTransaction } = useSignAndSendTransaction()

  const activeWallet = wallets[0]
  const walletConnected =
    ready && authenticated && walletsReady && Boolean(activeWallet?.address)

  const connection = useMemo(
    () => new Connection(DEVNET_ENDPOINT, "confirmed"),
    [],
  )

  const lockPeriods = [
    { id: "1month", label: "1 Month", active: false },
    { id: "3month", label: "3 Months", active: false },
    { id: "6month", label: "6 Months", active: false },
    { id: "12month", label: "12 Months", active: true, apy: "10%" },
  ]

  const quickAmounts = ["100", "500", "1000", "5000"]

  const handleQuickStakeAmount = (amount: string) => {
    setStakeAmount(amount)
  }

  const resetTranches = useCallback(() => {
    setAvailableTranches([])
    setSelectedTrancheId(null)
  }, [])

  const loadBalance = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address) {
      setUsdcBalance(0n)
      return
    }

    try {
      setIsBalanceLoading(true)
      const config = await fetchSublyConfig(connection)
      const userPk = new PublicKey(activeWallet.address)
      const ata = await getAssociatedTokenAddress(config.usdcMint, userPk)
      const balance = await connection
        .getTokenAccountBalance(ata)
        .catch(() => null)

      if (!balance) {
        setUsdcBalance(0n)
        return
      }

      setUsdcBalance(BigInt(balance.value.amount))
    } catch (error) {
      console.error("Failed to fetch USDC balance", error)
      setUsdcBalance(0n)
    } finally {
      setIsBalanceLoading(false)
    }
  }, [activeWallet, connection, walletConnected])

  const loadTranches = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address) {
      resetTranches()
      return
    }

    try {
      setIsFetchingTranches(true)
      const userPk = new PublicKey(activeWallet.address)
      const entries = await fetchUserStakeEntries(connection, userPk)
      const now = Math.floor(Date.now() / 1000)

      const matured = entries.filter(
        (entry) => entry.principal > 0n && entry.lockEndTs !== 0 && entry.lockEndTs <= now,
      )

      setAvailableTranches(matured)
      setSelectedTrancheId((prev) => {
        if (matured.length === 0) {
          return null
        }

        if (matured.some((entry) => entry.trancheId === prev)) {
          return prev ?? matured[0].trancheId
        }

        const first = matured[0]
        return first ? first.trancheId : null
      })
    } catch (error) {
      console.error("Failed to fetch stake entries", error)
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to fetch available tranches. Please try again.",
      )
    } finally {
      setIsFetchingTranches(false)
    }
  }, [activeWallet, connection, resetTranches, walletConnected])

  const selectedTranche = useMemo(
    () => availableTranches.find((entry) => entry.trancheId === selectedTrancheId) ?? null,
    [availableTranches, selectedTrancheId],
  )

  const handleStake = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address) {
      toast.error("Connect a wallet before staking")
      return
    }

    try {
      setIsStaking(true)

      const amount = parseUsdcAmount(stakeAmount)
      const userPublicKey = new PublicKey(activeWallet.address)
      const formattedStakeAmount = formatUsdcAmountDisplay(stakeAmount || "0")

      const { transaction, blockhash } = await prepareStakeTransaction(
        connection,
        userPublicKey,
        amount,
      )

      const serialized = transaction.serialize({ requireAllSignatures: false })
      const { signature } = await signAndSendTransaction({
        transaction: serialized,
        wallet: activeWallet,
        chain: "solana:devnet",
      })

      const signatureString = bs58.encode(signature)

      await connection.confirmTransaction(
        {
          signature: signatureString,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        },
        "confirmed",
      )

      toast.success(`Staked ${formattedStakeAmount} USDC`, {
        description: `${signatureString.slice(0, 8)}…${signatureString.slice(-8)}`,
        action: {
          label: "Explorer",
          onClick: () =>
            window.open(
              `https://explorer.solana.com/tx/${signatureString}?cluster=devnet`,
              "_blank",
              "noopener,noreferrer",
            ),
        },
      })

      setStakeAmount("")
      await Promise.all([loadTranches(), loadBalance()])
    } catch (error) {
      console.error("Failed to stake USDC", error)
      toast.error(
        error instanceof Error
          ? error.message
          : "Failed to stake USDC. Please try again.",
      )
    } finally {
      setIsStaking(false)
    }
  }, [
    activeWallet,
    connection,
    loadBalance,
    loadTranches,
    signAndSendTransaction,
    stakeAmount,
    walletConnected,
  ])

  const handleUnstake = useCallback(async () => {
    if (!walletConnected || !activeWallet?.address || selectedTrancheId === null) {
      toast.error("Select a tranche to unstake")
      return
    }

    try {
      setIsUnstaking(true)
      const userPublicKey = new PublicKey(activeWallet.address)

      const { transaction, blockhash } = await prepareUnstakeTransaction(
        connection,
        userPublicKey,
        selectedTrancheId,
      )

      const serialized = transaction.serialize({ requireAllSignatures: false })
      const { signature } = await signAndSendTransaction({
        transaction: serialized,
        wallet: activeWallet,
        chain: "solana:devnet",
      })

      const signatureString = bs58.encode(signature)

      await connection.confirmTransaction(
        {
          signature: signatureString,
          blockhash: blockhash.blockhash,
          lastValidBlockHeight: blockhash.lastValidBlockHeight,
        },
        "confirmed",
      )

      const principalText = selectedTranche
        ? formatUsdcFromSmallestToDisplay(selectedTranche.principal)
        : undefined

      toast.success(
        principalText
          ? `Unstaked tranche #${selectedTrancheId} (${principalText} USDC)`
          : `Unstaked tranche #${selectedTrancheId}`,
        {
          description: `${signatureString.slice(0, 8)}…${signatureString.slice(-8)}`,
          action: {
            label: "Explorer",
            onClick: () =>
              window.open(
                `https://explorer.solana.com/tx/${signatureString}?cluster=devnet`,
                "_blank",
                "noopener,noreferrer",
              ),
          },
        },
      )

      await Promise.all([loadTranches(), loadBalance()])
    } catch (error) {
      console.error("Failed to unstake", error)
      toast.error(
        error instanceof Error ? error.message : "Failed to unstake. Please try again.",
      )
    } finally {
      setIsUnstaking(false)
    }
  }, [
    activeWallet,
    connection,
    loadBalance,
    loadTranches,
    selectedTranche,
    selectedTrancheId,
    signAndSendTransaction,
    walletConnected,
  ])

  useEffect(() => {
    if (!walletConnected) {
      resetTranches()
      setUsdcBalance(0n)
      return
    }

    void loadTranches()
    void loadBalance()
  }, [loadBalance, loadTranches, resetTranches, walletConnected]);

  return (
    <div className="max-w-5xl mx-auto space-y-6 sm:space-y-8 px-4 sm:px-6 py-6 sm:py-8">
      <Card className="shadow-lg border-0 bg-gradient-to-br from-primary/10 via-accent/5 to-primary/5 relative overflow-hidden">
        <div className="absolute inset-0 bg-gradient-to-r from-primary/5 to-transparent"></div>
        <CardContent className="p-6 sm:p-8 lg:p-12 text-center relative z-10">
          <div className="space-y-4 sm:space-y-6">
            <div className="inline-flex items-center px-3 sm:px-4 py-2 bg-primary/10 rounded-full text-xs sm:text-sm font-medium text-primary mb-2 sm:mb-4">
              🔒 privacy-first PayFi protocol
            </div>
            <h1 className="text-3xl sm:text-4xl md:text-5xl lg:text-6xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent leading-tight">
              Subscribe Now,
              <br />
              Pay Never
            </h1>
            <div className="w-16 sm:w-24 h-1 bg-gradient-to-r from-primary to-accent mx-auto rounded-full"></div>
          </div>
        </CardContent>
      </Card>

      <Card className="shadow-sm border-0">
        <CardHeader className="pb-4 sm:pb-6 px-4 sm:px-6 lg:px-8">
          <div className="space-y-2">
            <CardTitle className="text-xl sm:text-2xl font-bold text-foreground">Stake USDC</CardTitle>
            <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">
              Subly turns yield into cash and pays it to your PayPal to cover subscriptions. Your yield covers your
              subscriptions, so you don&apos;t have to pay.
            </p>
          </div>
        </CardHeader>
        <CardContent className="px-4 sm:px-6 lg:px-8 pb-6 sm:pb-8">
          <Tabs defaultValue="stake" className="w-full">
            <TabsList className="grid w-full grid-cols-2 h-10 sm:h-12 p-1 bg-muted/50">
              <TabsTrigger value="stake" className="font-medium text-sm sm:text-base">
                Stake
              </TabsTrigger>
              <TabsTrigger value="unstake" className="font-medium text-sm sm:text-base">
                Unstake
              </TabsTrigger>
            </TabsList>

            <TabsContent value="stake" className="space-y-6 sm:space-y-8 mt-6 sm:mt-8">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-foreground mb-3 block">Amount (USDC)</label>
                  <div className="relative">
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={stakeAmount}
                      onChange={(e) => setStakeAmount(e.target.value)}
                      className="text-lg sm:text-xl h-12 sm:h-14 pl-4 pr-16 border-2 focus:border-primary"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      USDC
                    </div>
                  </div>
                  <div className="flex items-center justify-between mt-2 text-xs sm:text-sm text-muted-foreground">
                    <span>Wallet Balance</span>
                    {walletConnected ? (
                      isBalanceLoading ? (
                        <span className="flex items-center gap-2">
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          <span>Loading…</span>
                        </span>
                      ) : (
                        <span className="font-semibold text-foreground">
                          {formatUsdcFromSmallestToDisplay(usdcBalance)} USDC
                        </span>
                      )
                    ) : (
                      <span>Connect wallet</span>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap gap-2 sm:gap-3">
                  {quickAmounts.map((amount) => (
                    <Button
                      key={amount}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickStakeAmount(amount)}
                      className="px-3 sm:px-4 py-2 font-medium text-sm"
                      disabled={isStaking}
                    >
                      ${amount}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-4">
                <label className="text-sm font-semibold text-foreground block">Lock Period</label>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
                  {lockPeriods.map((period) => (
                    <button
                      key={period.id}
                      onClick={() => period.active && setSelectedLockPeriod(period.id)}
                      className={`border rounded-lg py-3 px-4 sm:py-4 sm:px-5 text-left transition-all duration-200 ${
                        selectedLockPeriod === period.id && period.active
                          ? "border-primary bg-primary/10"
                          : "border-border bg-card/60 hover:border-primary/40"
                      } ${period.active ? "cursor-pointer" : "cursor-not-allowed opacity-50"}`}
                      disabled={!period.active || isStaking}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-sm sm:text-base text-foreground">
                          {period.label}
                        </span>
                        {period.apy ? (
                          <Badge variant="secondary" className="text-xs">
                            APY {period.apy}
                          </Badge>
                        ) : (
                          <Badge variant="secondary" className="text-xs">
                            Coming Soon
                          </Badge>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              <Card className="bg-muted/30 border-0">
                <CardContent className="p-4 sm:p-6">
                  <div className="space-y-3 sm:space-y-4">
                    <h4 className="font-semibold text-foreground text-sm sm:text-base">Estimated Returns</h4>
                    <div className="space-y-2 sm:space-y-3">
                      <div className="flex justify-between items-center">
                        <span className="text-xs sm:text-sm text-muted-foreground">Annual Yield</span>
                        <span className="font-semibold text-foreground text-sm sm:text-base">
                          {formatUsdcAmountDisplay(
                            stakeAmount ? Number.parseFloat(stakeAmount) * 0.1 : 0,
                          )} USDC
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs sm:text-sm text-muted-foreground">Monthly Available</span>
                        <span className="font-semibold text-accent text-sm sm:text-base">
                          {formatUsdcAmountDisplay(
                            stakeAmount ? (Number.parseFloat(stakeAmount) * 0.1) / 12 : 0,
                          )} USDC
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button
                className="w-full h-12 sm:h-14 text-base sm:text-lg font-semibold"
                disabled={!stakeAmount || isStaking || !walletConnected}
                onClick={handleStake}
              >
                {isStaking ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Staking…
                  </span>
                ) : (
                  "Stake USDC"
                )}
              </Button>
            </TabsContent>

            <TabsContent value="unstake" className="space-y-6 sm:space-y-8 mt-6 sm:mt-8">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-sm font-semibold text-foreground">Unlocked Tranches</label>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void loadTranches()}
                    disabled={isFetchingTranches || isUnstaking}
                  >
                    {isFetchingTranches ? (
                      <span className="flex items-center gap-2 text-xs">
                        <Loader2 className="h-3 w-3 animate-spin" /> Refreshing
                      </span>
                    ) : (
                      "Refresh"
                    )}
                  </Button>
                </div>

                {isFetchingTranches && (
                  <div className="flex items-center justify-center py-10 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                  </div>
                )}

                {!isFetchingTranches && availableTranches.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    No unlocked tranches available yet. Stakes become available after the selected lock period.
                  </p>
                )}

                {!isFetchingTranches && availableTranches.length > 0 && (
                  <div className="space-y-3">
                    {availableTranches.map((entry) => {
                      const principal = formatUsdcFromSmallestToDisplay(entry.principal)
                      const unlockDate = new Date(entry.lockEndTs * 1000)
                      const isSelected = selectedTrancheId === entry.trancheId

                      return (
                        <button
                          key={entry.trancheId}
                          onClick={() => setSelectedTrancheId(entry.trancheId)}
                          className={`w-full border rounded-lg px-4 py-3 text-left transition-all duration-200 ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-card/60 hover:border-primary/40"
                          }`}
                          disabled={isUnstaking}
                        >
                          <div className="flex items-center justify-between">
                            <div>
                              <p className="font-semibold text-sm text-foreground">
                                Tranche #{entry.trancheId}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Principal: {principal} USDC
                              </p>
                            </div>
                            <div className="text-xs text-muted-foreground">
                              Unlocked on {unlockDate.toLocaleDateString()}
                            </div>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                )}

                {selectedTranche && (
                  <Card className="bg-muted/30 border-0">
                    <CardContent className="p-4">
                      <p className="text-sm text-muted-foreground">
                        You are unstaking tranche #{selectedTranche.trancheId} with
                        <span className="font-semibold text-foreground">
                          {" "}
                          {formatUsdcFromSmallestToDisplay(selectedTranche.principal)} USDC
                        </span>{" "}principal.
                      </p>
                    </CardContent>
                  </Card>
                )}
              </div>

              <Button
                variant="destructive"
                className="w-full h-12 sm:h-14 text-base sm:text-lg font-semibold"
                onClick={handleUnstake}
                disabled={!selectedTranche || isUnstaking || isFetchingTranches || !walletConnected}
              >
                {isUnstaking ? (
                  <span className="flex items-center justify-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" /> Unstaking…
                  </span>
                ) : (
                  "Unstake"
                )}
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
