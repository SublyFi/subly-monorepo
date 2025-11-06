"use client"

import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { X, Mail, Shield, CheckCircle, AlertCircle } from "lucide-react"

interface PayPalSetupModalProps {
  isOpen: boolean
  onClose: () => void
  onSave: (email: string) => void
}

export function PayPalSetupModal({ isOpen, onClose, onSave }: PayPalSetupModalProps) {
  const [email, setEmail] = useState("")
  const [isVerifying, setIsVerifying] = useState(false)
  const [errors, setErrors] = useState<string[]>([])

  if (!isOpen) return null

  const validateEmail = (email: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/
    return emailRegex.test(email)
  }

  const handleSave = async () => {
    setErrors([])

    if (!email) {
      setErrors(["Email address is required"])
      return
    }

    if (!validateEmail(email)) {
      setErrors(["Please enter a valid email address"])
      return
    }

    setIsVerifying(true)

    // Simulate verification process
    setTimeout(() => {
      setIsVerifying(false)
      onSave(email)
      onClose()
    }, 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center space-x-2">
              <Mail className="w-5 h-5" />
              <span>Setup PayPal Account</span>
            </CardTitle>
            <Button variant="ghost" size="sm" onClick={onClose} className="h-8 w-8 p-0">
              <X className="w-4 h-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Information Section */}
          <div className="bg-blue-50 dark:bg-blue-900/20 p-4 rounded-lg">
            <div className="flex items-start space-x-3">
              <Shield className="w-5 h-5 text-blue-600 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-blue-800 dark:text-blue-200">Secure PayPal Integration</p>
                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                  Your PayPal email will be used to receive subscription payments from your staking yield. We never
                  store your PayPal password or payment details.
                </p>
              </div>
            </div>
          </div>

          {/* Email Input */}
          <div className="space-y-2">
            <label className="text-sm font-medium">PayPal Email Address</label>
            <Input
              type="email"
              placeholder="your-email@example.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className={errors.length > 0 ? "border-red-500" : ""}
            />
            {errors.map((error, index) => (
              <div key={index} className="flex items-center space-x-2 text-sm text-red-600">
                <AlertCircle className="w-4 h-4" />
                <span>{error}</span>
              </div>
            ))}
          </div>

          {/* Benefits List */}
          <div className="space-y-3">
            <p className="text-sm font-medium">Benefits of PayPal Integration:</p>
            <div className="space-y-2">
              {[
                "Automatic subscription payments from your yield",
                "No manual payment processing required",
                "Secure and encrypted transactions",
                "Real-time payment notifications",
              ].map((benefit, index) => (
                <div key={index} className="flex items-center space-x-2 text-sm">
                  <CheckCircle className="w-4 h-4 text-green-500" />
                  <span>{benefit}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Action Buttons */}
          <div className="flex space-x-2 pt-4">
            <Button variant="outline" className="flex-1 bg-transparent" onClick={onClose} disabled={isVerifying}>
              Cancel
            </Button>
            <Button className="flex-1" onClick={handleSave} disabled={isVerifying || !email}>
              {isVerifying ? (
                <div className="flex items-center space-x-2">
                  <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  <span>Verifying...</span>
                </div>
              ) : (
                "Save PayPal Info"
              )}
            </Button>
          </div>

          {/* Security Notice */}
          <div className="text-xs text-muted-foreground text-center pt-2 border-t">
            <p>
              By adding your PayPal email, you agree to receive automated payments for your subscriptions. You can
              update or remove this information at any time in your profile settings.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
