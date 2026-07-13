DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'start_at'
  ) THEN
    ALTER TABLE "events"
      ALTER COLUMN "start_at" DROP NOT NULL;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'events'
      AND column_name = 'end_at'
  ) THEN
    ALTER TABLE "events"
      ALTER COLUMN "end_at" DROP NOT NULL;
  END IF;
END $$;
