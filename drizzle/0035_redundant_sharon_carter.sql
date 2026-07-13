DROP INDEX "storage_objects_object_key_unique_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "storage_objects_object_key_version_unique_idx" ON "storage_objects" USING btree ("object_key","version");--> statement-breakpoint
CREATE INDEX "storage_objects_object_key_idx" ON "storage_objects" USING btree ("object_key");