-- Add check constraints to prevent sold/reserved underflow and overflow
ALTER TABLE ticket_types
  ADD CONSTRAINT ticket_types_sold_quantity_non_negative CHECK (sold_quantity >= 0),
  ADD CONSTRAINT ticket_types_reserved_quantity_non_negative CHECK (reserved_quantity >= 0),
  ADD CONSTRAINT ticket_types_sold_not_exceed_total CHECK (sold_quantity <= total_quantity),
  ADD CONSTRAINT ticket_types_reserved_not_exceed_total CHECK (reserved_quantity <= total_quantity);
