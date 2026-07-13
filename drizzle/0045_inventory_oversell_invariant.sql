-- True oversell invariant: sold + reserved must never exceed total capacity.
-- 0012 added `sold <= total` and `reserved <= total` separately, which still
-- permits up to 2x capacity. This adds the combined constraint that actually
-- prevents overselling at the database level (the last line of defence).
--
-- Added NOT VALID so the migration does not fail on any legacy rows that already
-- drifted (historical cache-sync bug). It is enforced for every INSERT/UPDATE
-- immediately; the scheduled inventory reconciler repairs historical rows, after
-- which the constraint can be VALIDATEd online with:
--   ALTER TABLE ticket_types VALIDATE CONSTRAINT ticket_types_sold_plus_reserved_not_exceed_total;
ALTER TABLE ticket_types
  ADD CONSTRAINT ticket_types_sold_plus_reserved_not_exceed_total
  CHECK (sold_quantity + reserved_quantity <= total_quantity) NOT VALID;
