import Link from "next/link";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";
import { Brand } from "@/components/brand";
import { BlobField } from "@/components/blob-field";
import { ForgotPasswordForm } from "./forgot-password-form";

export default async function ForgotPasswordPage() {
  const me = await getCurrentUser();
  if (me) redirect(`/${me.role}`);

  return (
    <div className="relative min-h-full flex flex-col overflow-hidden">
      <BlobField />
      <header className="relative z-10 mx-auto w-full max-w-6xl px-4 py-6 sm:px-6">
        <Brand />
      </header>
      <main className="relative z-10 flex flex-1 items-center justify-center px-4 py-8 sm:py-12">
        <div className="card-sl w-full max-w-md p-8 sm:p-10">
          <span className="eyebrow">Password reset</span>
          <h1
            className="mt-3 text-3xl"
            style={{ fontFamily: "var(--font-heading)" }}
          >
            Forgot your password?
          </h1>
          <p className="mt-2 text-sm text-slate">
            Enter your email and we&apos;ll send a link to set a new one.
          </p>
          <div className="mt-6">
            <ForgotPasswordForm />
          </div>
          <p className="mt-6 text-sm text-slate">
            Remembered it?{" "}
            <Link
              href="/login"
              className="font-semibold text-navy-deep underline-offset-4 hover:text-sky hover:underline"
            >
              Back to sign in
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
