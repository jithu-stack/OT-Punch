// Fill these from Supabase → Project Settings → API.
// The anon key is meant to be public: what each login may see is enforced by row level security.
// NEVER put the service_role key here.
window.STEMHUB_CONFIG = {
  SUPABASE_URL: 'https://azhqeuvusophuldpdexg.supabase.co',
  SUPABASE_ANON_KEY: 'sb_publishable_Jpzpkiq8qb0GlDtK6iE4bQ_TBHYlypE', // publishable key
  TECH_EMAIL_DOMAIN: 'punch.stemhub.in', // must match handle_new_user() in schema.sql
};
