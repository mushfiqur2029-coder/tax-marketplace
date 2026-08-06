// Public bucket, so we don't need signed URLs for reads.
// Storing just the path in the DB and building the public URL client- or
// server-side lets us switch buckets later without a data migration.

const BASE = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

export function avatarUrl(path: string | null | undefined): string | null {
  if (!path) return null;
  return `${BASE}/storage/v1/object/public/avatars/${path}`;
}
