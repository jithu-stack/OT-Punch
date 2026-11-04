// Fill these from Supabase → Project Settings → API.
// The anon key is meant to be public: what each login may see is enforced by row level security.
// NEVER put the service_role key here.
window.STEMHUB_CONFIG = {
  SUPABASE_URL: 'https://YOUR-PROJECT.supabase.co',
  SUPABASE_ANON_KEY: 'YOUR-ANON-KEY',
  TECH_EMAIL_DOMAIN: 'punch.stemhub.in', // must match handle_new_user() in schema.sql
};
