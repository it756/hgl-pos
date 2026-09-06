"use client";

import { Suspense, useActionState, useState } from "react";
import { useSearchParams } from "next/navigation";
import { ArrowRight, Eye, EyeOff, Lock, Mail, Store } from "lucide-react";
import { signInWithPassword, type LoginFormState } from "./actions";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import { Button } from "../../components/ui/button";

const initialState: LoginFormState = { error: null };

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}

function LoginForm() {
  const searchParams = useSearchParams();
  const redirectTo = searchParams.get("redirectTo") ?? "/";
  const [state, formAction, pending] = useActionState(signInWithPassword, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background p-md">
      <div className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
        <div className="absolute -left-[10%] -top-[20%] h-[50vw] w-[50vw] rounded-full bg-surface-container-high opacity-60 blur-[100px]" />
        <div className="absolute -right-[10%] top-[60%] h-[40vw] w-[40vw] rounded-full bg-primary-fixed opacity-40 blur-[120px]" />
      </div>

      <div className="z-10 flex w-full max-w-[420px] flex-col rounded-xl border border-surface-container-high bg-surface-container-lowest p-lg shadow-lg">
        <div className="mb-lg flex flex-col items-center">
          <div className="mb-sm flex h-12 w-12 items-center justify-center rounded-lg bg-surface-container text-primary">
            <Store className="h-7 w-7" />
          </div>
          <h1 className="text-headline-lg font-headline-lg font-extrabold tracking-tight text-on-surface">Harvest POS</h1>
          <p className="mt-1 text-center text-body-md font-body-md text-on-surface-variant">Sign in to your account to continue.</p>
        </div>

        <form action={formAction} className="flex flex-col gap-md">
          <input type="hidden" name="redirectTo" value={redirectTo} />

          <div className="flex flex-col gap-1">
            <Label htmlFor="email">Email Address</Label>
            <div className="relative">
              <Mail className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-outline" />
              <Input id="email" name="email" type="email" required autoComplete="username" placeholder="name@store.com" className="pl-10" />
            </div>
          </div>

          <div className="flex flex-col gap-1">
            <div className="flex items-center justify-between">
              <Label htmlFor="password">Password</Label>
              <a href="#" className="text-label-sm font-label-sm font-medium text-primary hover:text-primary-container">
                Forgot Password?
              </a>
            </div>
            <div className="relative">
              <Lock className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-outline" />
              <Input
                id="password"
                name="password"
                type={showPassword ? "text" : "password"}
                required
                autoComplete="current-password"
                placeholder="••••••••"
                className="pl-10 pr-10"
              />
              <button
                type="button"
                aria-label="Toggle password visibility"
                onClick={() => setShowPassword((value) => !value)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-outline transition-colors hover:text-on-surface"
              >
                {showPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
              </button>
            </div>
          </div>

          {state.error !== null && (
            <p role="alert" className="text-body-md font-body-md text-destructive">
              {state.error}
            </p>
          )}

          <Button type="submit" disabled={pending} className="mt-1 w-full">
            {pending ? "Signing in…" : "Sign In"}
            <ArrowRight className="h-5 w-5" />
          </Button>
        </form>

        <div className="mt-xl text-center">
          <p className="text-label-caps font-label-caps text-outline">Supermarket Ops Platform</p>
        </div>
      </div>
    </main>
  );
}

