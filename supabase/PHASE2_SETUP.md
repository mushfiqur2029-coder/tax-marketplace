# Phase 2 setup checklist

Complete these three things before I can verify Phase 2 end-to-end.

## 1. Apply the Phase 2 migration

Supabase → **SQL Editor** → **New query** → paste the entire contents of
`migrations/0002_phase2_schema.sql` → **Run**. Should complete without errors.

Adds:
- `intake_answers`, `submitted_at`, `updated_at`, `stripe_checkout_session_id` columns on `cases`
- `is_admin()` helper function
- RLS policies for cases + case_documents (client owner, accountant queue, admin all-access)
- Storage bucket policies for `case-documents`

## 2. Create the Storage bucket

Supabase → **Storage** → **New bucket**
- Name: `case-documents`
- **Private** (leave "Public bucket" unchecked)
- File size limit: 25 MB (matches app-side limit)
- Save

The RLS policies from step 1 already know about this bucket by name.

## 3. Stripe

### Test keys (already need to be pasted into .env.local)
Stripe Dashboard → **Developers → API keys** (test mode toggle on top-right).
- Copy **Publishable key** (`pk_test_...`)
- Copy **Secret key** (`sk_test_...`)

### Local webhook forwarding (Stripe CLI)
Install once: https://stripe.com/docs/stripe-cli#install

Then in a **separate terminal** (this needs to run continuously while testing):

```
stripe login
stripe listen --forward-to localhost:3000/api/stripe/webhook
```

It prints a webhook signing secret like `whsec_...`. Copy that into `.env.local`
as `STRIPE_WEBHOOK_SECRET`.

Keep `stripe listen` running for as long as you're testing.

## 4. Send me the Stripe keys

Paste back:
- `pk_test_...`
- `sk_test_...`
- `whsec_...` (from `stripe listen`)

I'll drop them into `.env.local`, restart the dev server, and run the whole
flow (create case → intake → upload → pay with `4242 4242 4242 4242` → confirm
case marked submitted).
