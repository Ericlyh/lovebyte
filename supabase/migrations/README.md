# Supabase migrations

SQL migrations for the LoveByte Cloud project. Apply in numeric order.

## Apply via Supabase CLI

```bash
# One-time: link the CLI to your Cloud project
supabase login
supabase link --project-ref <project-ref-from-dashboard-url>

# Apply
supabase db push

# Or apply a single migration manually
psql "$DATABASE_URL" -f 0001_initial_schema.sql
```

## Apply via the Dashboard SQL editor

1. Open `https://supabase.com/dashboard/project/<your-project>/sql`
2. Paste the contents of `0001_initial_schema.sql`
3. Run

## After the schema is applied

```bash
# Generate TypeScript types for src/lib/supabase/types.ts
supabase gen types typescript --linked > src/lib/supabase/types.ts
```

Then re-add the `<Database>` generic to `createClient()` / `createServerClient()`
calls in `src/lib/supabase/{client,server}.ts`.

## Storage bucket

After the tables exist, create the `lovebyte-media` bucket in the dashboard
(Storage → New bucket → name `lovebyte-media`, Private). Media uploads go
through `/api/upload` which signs PUT URLs to this bucket.
