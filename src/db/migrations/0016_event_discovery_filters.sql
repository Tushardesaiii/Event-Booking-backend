CREATE INDEX IF NOT EXISTS "categories_tenant_id_slug_idx" ON "categories" USING btree ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "tags_tenant_id_slug_idx" ON "tags" USING btree ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "event_series_tenant_id_slug_idx" ON "event_series" USING btree ("tenant_id", "slug");
CREATE INDEX IF NOT EXISTS "events_tenant_id_category_id_idx" ON "events" USING btree ("tenant_id", "category_id");
CREATE INDEX IF NOT EXISTS "events_tenant_id_start_date_time_idx" ON "events" USING btree ("tenant_id", "start_date_time");
CREATE INDEX IF NOT EXISTS "event_tags_tenant_id_tag_id_event_id_idx" ON "event_tags" USING btree ("tenant_id", "tag_id", "event_id");