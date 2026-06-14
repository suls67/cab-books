-- The app's current server routes write with the project anon client.
-- To match existing hmrc_submissions behavior, disable RLS on annual submissions.
alter table if exists hmrc_annual_submissions
disable row level security;
