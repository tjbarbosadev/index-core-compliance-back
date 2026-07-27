-- Drop legacy permission group tables (access is now user_permission_overrides only).
-- regulatory_obligations.responsible_group_id (docs/schema.sql only) is dropped if present.

ALTER TABLE IF EXISTS regulatory_obligations DROP COLUMN IF EXISTS responsible_group_id;

DROP TABLE IF EXISTS user_groups;
DROP TABLE IF EXISTS group_permissions;
DROP TABLE IF EXISTS permission_groups;
