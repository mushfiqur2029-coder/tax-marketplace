import { Brand } from "@/components/brand";
import { BlobField } from "@/components/blob-field";
import { ResetPasswordForm } from "./reset-password-form";

// Landing page for the recovery link in the reset-password email. Supabase
// hands the token off in the URL hash (#access_token=...&type=recovery),
// which the client-side Supabase SDK picks up automatically and persists as
// a session cookie. Once that's done, updateUser({ password }) is authorized
// against that recovery session.
//
// This page must not redirect the "already signed in" state — the recovery
// session IS a signed-in state, and redirecting away would lock the user
// out of completing their reset. If they later navigate here without a
// token, the form's own updateUser call will fail with a clear error.

export default async function ResetPasswordPage() {
  return (
    <div className="relative min-h-full flex flex-col overflow-hidden">
      <BlobField />
      <header className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Brand />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
        <div className="card-sl w-full max-w-md p-8 sm:p-10">
          <span className="eyebrow">Set new password</span>
          <h1
            className="mt-3 text-3xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Choose a new password
          </h1>
          <p className="mt-2 text-sm text-slate">
            You&apos;re signed in temporarily from the reset link. Pick a
            new password — you&apos;ll be sent back to the login page after.
          </p>
          <div className="mt-6">
            <ResetPasswordForm />
          </div>
        </div>
      </main>
    </div>
  );
}
