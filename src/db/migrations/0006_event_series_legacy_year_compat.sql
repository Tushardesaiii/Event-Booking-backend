DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'event_series'
      AND column_name = 'year'
  ) THEN
    ALTER TABLE "event_series"
      ALTER COLUMN "year" DROP NOT NULL;
  END IF;
END $$;
