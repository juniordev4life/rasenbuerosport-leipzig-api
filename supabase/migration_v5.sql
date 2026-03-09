-- Migration V5: Add separate image URL columns for passes and defense screenshots
-- Run this in Supabase SQL Editor

ALTER TABLE games ADD COLUMN passes_image_url TEXT;
ALTER TABLE games ADD COLUMN defense_image_url TEXT;
