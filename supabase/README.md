# Supabase setup

## Apply schema

Migrations live in `migrations/`. Apply each one in order via the Supabase
Dashboard → **SQL Editor** → paste the contents → **Run**. Later migrations
depend on earlier ones.

## Disable email confirmation (dev only)

For local development, disable email confirmation so signup instantly gives
a session:

1. Sidebar → **Authentication** → **Sign In / Providers** → **Email**.
2. Toggle **Confirm email** OFF.
3. Save.

Re-enable this before production.

## Bootstrap the very first admin

Public registration only creates clients and accountants — the `/register`
form has no admin option and the `signUpAction` server action rejects any
attempt to smuggle `role=admin` through metadata.

After the first admin exists, all subsequent admins are created from
`/admin/admins` (an existing admin uses the form there). But there is no
existing admin at launch, so bootstrap the first one via SQL:

1. Register a normal account through `/register` (as client or accountant).
2. In Supabase → **SQL Editor**, run:

   ```sql
   update public.users
      set role = 'admin'
    where email = 'you@example.com';
   ```

3. Log out and log back in — you'll land on `/admin`.

From there use `/admin/admins` to add more admins without touching SQL again.

## Accountant approval

New accountants sign up through `/register` and can log in immediately, but
land on `/accountant/pending` until an admin approves them from
`/admin/accountants`. RLS guards the case queue and take-a-case UPDATE to
require `accountant_profiles.approval_status = 'approved'`.

Accountants that existed before Phase 5 are grandfathered as approved by the
`0007` migration.

## Storage buckets

Migrations create these buckets automatically:

- `case-documents` — private, 50 MB per file (client docs + chat attachments
  under `msg/…` + payout receipts under `receipts/…`).
- `avatars` — public, 5 MB per file. Profile pictures.
