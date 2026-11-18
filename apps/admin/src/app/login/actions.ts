"use server";

import type { Route } from "next";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "../../lib/supabase/server";

export type LoginFormState = { error: string | null };

export async function signInWithPassword(_prevState: LoginFormState, formData: FormData): Promise<LoginFormState> {
  const email = readFormField(formData, "email");
  const password = readFormField(formData, "password");
  const redirectToInput = readFormField(formData, "redirectTo");
  const redirectTo = redirectToInput.startsWith("/") ? redirectToInput : "/";

  if (email === "" || password === "") {
    return { error: "Email and password are required." };
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error !== null) {
    console.log(error)
    return { error: "Invalid email or password." + (error.message ? ` (${error.message})` : "") };
  
  }

  redirect(redirectTo as Route);
}

function readFormField(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === "string" ? value : "";
}
