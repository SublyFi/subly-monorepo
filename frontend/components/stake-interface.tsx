"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Badge } from "@/components/ui/badge"

export function StakeInterface() {
  const [stakeAmount, setStakeAmount] = useState("")
  const [unstakeAmount, setUnstakeAmount] = useState("")
  const [selectedLockPeriod, setSelectedLockPeriod] = useState("12month")

  const lockPeriods = [
    { id: "1month", label: "1 Month", active: false },
    { id: "3month", label: "3 Months", active: false },
    { id: "6month", label: "6 Months", active: false },
    { id: "12month", label: "12 Months", active: true, apy: "10%" },
  ]

  const quickAmounts = ["100", "500", "1000", "5000"]

  const handleQuickAmount = (amount: string, type: "stake" | "unstake") => {
    if (type === "stake") {
      setStakeAmount(amount)
    } else {
      setUnstakeAmount(amount)
    }
  }

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
              subscriptions, so you don't have to pay.
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
                </div>

                <div className="flex flex-wrap gap-2 sm:gap-3">
                  {quickAmounts.map((amount) => (
                    <Button
                      key={amount}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickAmount(amount, "stake")}
                      className="px-3 sm:px-4 py-2 font-medium text-sm"
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
                      disabled={!period.active}
                      className={`p-4 sm:p-6 rounded-xl border-2 transition-all duration-200 ${
                        period.active
                          ? selectedLockPeriod === period.id
                            ? "border-primary bg-primary/5 shadow-sm"
                            : "border-border hover:border-primary/50 hover:shadow-sm"
                          : "border-border bg-muted/30 cursor-not-allowed opacity-50"
                      }`}
                    >
                      <div className="text-center space-y-1 sm:space-y-2">
                        <p className="font-semibold text-foreground text-sm sm:text-base">{period.label}</p>
                        {period.active ? (
                          <>
                            <p className="text-base sm:text-lg font-bold text-accent">{period.apy}</p>
                            <p className="text-xs text-muted-foreground">APY</p>
                          </>
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
                          ${stakeAmount ? (Number.parseFloat(stakeAmount) * 0.1).toFixed(2) : "0.00"}
                        </span>
                      </div>
                      <div className="flex justify-between items-center">
                        <span className="text-xs sm:text-sm text-muted-foreground">Monthly Available</span>
                        <span className="font-semibold text-accent text-sm sm:text-base">
                          ${stakeAmount ? ((Number.parseFloat(stakeAmount) * 0.1) / 12).toFixed(2) : "0.00"}
                        </span>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>

              <Button
                className="w-full h-12 sm:h-14 text-base sm:text-lg font-semibold"
                disabled={!stakeAmount || Number.parseFloat(stakeAmount) <= 0}
              >
                Stake USDC
              </Button>
            </TabsContent>

            <TabsContent value="unstake" className="space-y-6 sm:space-y-8 mt-6 sm:mt-8">
              <div className="space-y-4">
                <div>
                  <label className="text-sm font-semibold text-foreground mb-3 block">Amount to Unstake (USDC)</label>
                  <div className="relative">
                    <Input
                      type="number"
                      placeholder="0.00"
                      value={unstakeAmount}
                      onChange={(e) => setUnstakeAmount(e.target.value)}
                      className="text-lg sm:text-xl h-12 sm:h-14 pl-4 pr-16 border-2 focus:border-primary"
                    />
                    <div className="absolute right-4 top-1/2 -translate-y-1/2 text-sm font-medium text-muted-foreground">
                      USDC
                    </div>
                  </div>
                  <p className="text-xs sm:text-sm text-muted-foreground mt-2">Available to unstake: $0.00 USDC</p>
                </div>

                <div className="flex flex-wrap gap-2 sm:gap-3">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setUnstakeAmount("0")}
                    className="px-3 sm:px-4 py-2 font-medium text-sm"
                  >
                    Max
                  </Button>
                  {quickAmounts.map((amount) => (
                    <Button
                      key={amount}
                      variant="outline"
                      size="sm"
                      onClick={() => handleQuickAmount(amount, "unstake")}
                      className="px-3 sm:px-4 py-2 font-medium text-sm"
                    >
                      ${amount}
                    </Button>
                  ))}
                </div>
              </div>

              <Button
                variant="destructive"
                className="w-full h-12 sm:h-14 text-base sm:text-lg font-semibold"
                disabled={!unstakeAmount || Number.parseFloat(unstakeAmount) <= 0}
              >
                Unstake USDC
              </Button>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  )
}
