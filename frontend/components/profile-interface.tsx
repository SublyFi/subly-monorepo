"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Edit, Mail, CheckCircle, XCircle } from "lucide-react"

interface PayPalInfo {
  type: "email" | "paypal_id" | "phone" | "user_handle"
  value: string
  isVerified: boolean
}

export function ProfileInterface() {
  const [paypalInfo, setPaypalInfo] = useState<PayPalInfo | null>(null)
  const [isEditingPaypal, setIsEditingPaypal] = useState(false)
  const [paypalType, setPaypalType] = useState<"email" | "paypal_id" | "phone" | "user_handle">("email")
  const [paypalValue, setPaypalValue] = useState("")

  const handleSavePaypal = () => {
    setPaypalInfo({
      type: paypalType,
      value: paypalValue,
      isVerified: false, // Would need verification
    })
    setIsEditingPaypal(false)
    setPaypalValue("")
  }

  const handleCancelEdit = () => {
    setPaypalValue(paypalInfo?.value || "")
    setPaypalType(paypalInfo?.type || "email")
    setIsEditingPaypal(false)
  }

  const getPayPalTypeLabel = (type: string) => {
    switch (type) {
      case "email":
        return "Email Address"
      case "paypal_id":
        return "PayPal ID"
      case "phone":
        return "Phone Number"
      case "user_handle":
        return "User Handle"
      default:
        return "Email Address"
    }
  }

  const getPlaceholder = (type: string) => {
    switch (type) {
      case "email":
        return "your-email@example.com"
      case "paypal_id":
        return "your-paypal-id"
      case "phone":
        return "+1234567890"
      case "user_handle":
        return "@username"
      default:
        return "your-email@example.com"
    }
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6 px-4 sm:px-6 py-6 sm:py-8">
      {/* Profile Header */}
      <Card>
        <CardHeader className="px-4 sm:px-6">
          <CardTitle className="text-xl sm:text-2xl">Profile Settings</CardTitle>
          <p className="text-sm sm:text-base text-muted-foreground">Manage your PayPal payout information</p>
        </CardHeader>
      </Card>

      <Card>
        <CardHeader className="px-4 sm:px-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-0">
            <CardTitle className="text-lg sm:text-xl">PayPal Payouts</CardTitle>
            {paypalInfo && !isEditingPaypal && (
              <Button variant="outline" size="sm" onClick={() => setIsEditingPaypal(true)}>
                <Edit className="w-4 h-4 mr-2" />
                Edit
              </Button>
            )}
          </div>
        </CardHeader>
        <CardContent className="space-y-4 px-4 sm:px-6">
          {!paypalInfo && !isEditingPaypal ? (
            <div className="text-center py-6 sm:py-8">
              <Mail className="w-10 h-10 sm:w-12 sm:h-12 text-muted-foreground mx-auto mb-3 sm:mb-4" />
              <p className="text-sm sm:text-base text-muted-foreground mb-3 sm:mb-4">
                No PayPal payout method configured
              </p>
              <p className="text-xs sm:text-sm text-muted-foreground mb-4 sm:mb-6 px-4">
                Add your PayPal information to receive subscription payments from your yield
              </p>
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4 mb-4 sm:mb-6 mx-4 sm:mx-0">
                <p className="text-xs sm:text-sm text-blue-800 font-medium">
                  Please use PayPal Sandbox environment information for testing
                </p>
              </div>
              <Button onClick={() => setIsEditingPaypal(true)} className="text-sm sm:text-base">
                Add PayPal Payout
              </Button>
            </div>
          ) : isEditingPaypal ? (
            <div className="space-y-4">
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 sm:p-4">
                <p className="text-xs sm:text-sm text-blue-800 font-medium">
                  Please enter PayPal Sandbox environment information for testing purposes
                </p>
              </div>
              <div>
                <label className="text-sm font-medium">Payout Method</label>
                <Select
                  value={paypalType}
                  onValueChange={(value: "email" | "paypal_id" | "phone" | "user_handle") => setPaypalType(value)}
                >
                  <SelectTrigger className="mt-2">
                    <SelectValue placeholder="Select payout method" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="email">Email Address</SelectItem>
                    <SelectItem value="paypal_id">PayPal ID</SelectItem>
                    <SelectItem value="phone">Phone Number</SelectItem>
                    <SelectItem value="user_handle">User Handle</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <label className="text-sm font-medium">{getPayPalTypeLabel(paypalType)}</label>
                <Input
                  type={paypalType === "email" ? "email" : paypalType === "phone" ? "tel" : "text"}
                  placeholder={getPlaceholder(paypalType)}
                  value={paypalValue}
                  onChange={(e) => setPaypalValue(e.target.value)}
                  className="mt-2"
                />
              </div>
              <div className="flex flex-col sm:flex-row gap-2 sm:gap-2 sm:space-x-0">
                <Button onClick={handleSavePaypal} disabled={!paypalValue} className="w-full sm:w-auto">
                  Save PayPal Info
                </Button>
                <Button variant="outline" onClick={handleCancelEdit} className="w-full sm:w-auto bg-transparent">
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 bg-muted/50 rounded-lg gap-3 sm:gap-0">
              <div className="flex items-center space-x-3">
                <Mail className="w-5 h-5 text-muted-foreground flex-shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-sm sm:text-base truncate">{paypalInfo.value}</p>
                  <p className="text-xs sm:text-sm text-muted-foreground">{getPayPalTypeLabel(paypalInfo.type)}</p>
                  <div className="flex items-center space-x-2 mt-1">
                    {paypalInfo.isVerified ? (
                      <>
                        <CheckCircle className="w-4 h-4 text-green-500" />
                        <span className="text-xs sm:text-sm text-green-600">Verified</span>
                      </>
                    ) : (
                      <>
                        <XCircle className="w-4 h-4 text-yellow-500" />
                        <span className="text-xs sm:text-sm text-yellow-600">Pending Verification</span>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
