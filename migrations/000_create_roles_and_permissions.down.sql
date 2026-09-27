-- Rollback: 000_create_roles_and_permissions
-- Drops roles, permissions, and role_permissions tables

DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS permissions;
DROP TABLE IF EXISTS roles;

