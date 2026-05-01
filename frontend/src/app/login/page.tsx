"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Sword, Loader2 } from "lucide-react";

export default function LoginPage() {
  const [username, setUsername] = useState("athlete");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setErr(null);
    try {
      await api.login(username, password);
      router.push("/");
    } catch (e: any) {
      setErr(e?.message || "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 sm:p-6 bg-background">
      {/* Geometric background pattern */}
      <div className="absolute inset-0 pattern-dots opacity-30" />

      <div className="relative w-full max-w-sm">
        {/* Card */}
        <div className="border-4 border-foreground bg-card shadow-hard-lg p-6 sm:p-8 space-y-6">
          {/* Geometric decoration */}
          <div className="absolute top-0 right-0 w-6 h-6 bg-bauhaus-red" />
          <div className="absolute top-0 left-0 w-6 h-6 bg-bauhaus-blue" />
          <div className="absolute bottom-0 right-0 w-6 h-6 bg-bauhaus-yellow" />

          {/* Header */}
          <div className="text-center space-y-3">
            <div className="mx-auto flex h-14 w-14 items-center justify-center border-2 border-foreground bg-bauhaus-yellow shadow-hard-sm">
              <Sword className="h-7 w-7 text-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-black uppercase tracking-tighter">FencingCoach AI</h1>
              <p className="text-sm text-muted-foreground mt-1 font-mono">Sign in to access your training dashboard</p>
            </div>
          </div>

          {/* Form */}
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="username" className="text-2xs font-bold text-foreground uppercase tracking-wider">
                Username
              </label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="username"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="password" className="text-2xs font-bold text-foreground uppercase tracking-wider">
                Password
              </label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                placeholder="Enter your password"
              />
            </div>
            {err && (
              <div className="p-3 border-2 border-bauhaus-red bg-bauhaus-red/5">
                <p className="text-bauhaus-red text-sm font-bold">{err}</p>
              </div>
            )}
            <Button type="submit" disabled={loading} className="w-full" size="lg">
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  SIGNING IN...
                </>
              ) : (
                "SIGN IN"
              )}
            </Button>
          </form>
        </div>

        {/* Footer note */}
        <p className="text-center text-2xs text-muted-foreground mt-4 font-mono font-bold uppercase tracking-wider">
          Private coaching platform
        </p>
      </div>
    </div>
  );
}
