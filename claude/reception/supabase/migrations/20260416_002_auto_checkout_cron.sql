-- Enable pg_cron extension for auto-checkout
-- Note: pg_cron is available on Supabase Pro plan and local dev
-- On free plan, use Vercel Cron or external scheduler instead

-- Auto-checkout: runs every hour, closes visits older than 24 hours
-- To enable on Supabase local: uncomment the following lines
-- CREATE EXTENSION IF NOT EXISTS pg_cron;
-- SELECT cron.schedule(
--   'auto-checkout-stale-visits',
--   '0 * * * *',  -- every hour
--   $$SELECT auto_checkout_stale_visits()$$
-- );

-- For now, the auto_checkout_stale_visits() function from migration 001
-- can be called via:
-- 1. Vercel Cron Job (recommended for free plan)
-- 2. Supabase Edge Function with cron trigger
-- 3. External scheduler calling the function via REST API
