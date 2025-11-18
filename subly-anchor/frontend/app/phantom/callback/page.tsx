"use client";

import { useEffect } from "react";

import { useRouter } from "next/navigation";

export default function PhantomCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    const timer = setTimeout(() => {
      router.replace("/");
    }, 1500);

    return () => clearTimeout(timer);
  }, [router]);

  return (
    <div className="min-h-screen flex items-center justify-center px-6 py-16">
      <div className="text-center space-y-3">
        <h1 className="text-2xl font-semibold">Completing Phantom login...</h1>
        <p className="text-muted-foreground">
          You'll be redirected back to the Subly dashboard momentarily.
        </p>
      </div>
    </div>
  );
}
