DROP INDEX IF EXISTS "tenants_slug_unique";
CREATE UNIQUE INDEX "tenants_slug_unique" ON "tenants" USING btree ("slug");

DROP INDEX IF EXISTS "venues_tenant_slug_unique";
DROP INDEX IF EXISTS "venues_slug_unique";
CREATE UNIQUE INDEX "venues_slug_unique" ON "venues" USING btree ("slug");

DROP INDEX IF EXISTS "events_tenant_slug_unique";
DROP INDEX IF EXISTS "events_slug_unique";
CREATE UNIQUE INDEX "events_slug_unique" ON "events" USING btree ("slug");

DROP INDEX IF EXISTS "ticket_types_tenant_slug_unique";
DROP INDEX IF EXISTS "ticket_types_slug_unique";
CREATE UNIQUE INDEX "ticket_types_slug_unique" ON "ticket_types" USING btree ("slug");

DROP INDEX IF EXISTS "categories_slug_unique";
CREATE UNIQUE INDEX "categories_slug_unique" ON "categories" USING btree ("slug");

DROP INDEX IF EXISTS "tags_slug_unique";
CREATE UNIQUE INDEX "tags_slug_unique" ON "tags" USING btree ("slug");

DROP INDEX IF EXISTS "event_series_tenant_slug_unique";
DROP INDEX IF EXISTS "event_series_slug_unique";
CREATE UNIQUE INDEX "event_series_slug_unique" ON "event_series" USING btree ("slug");