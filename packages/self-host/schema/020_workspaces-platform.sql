CREATE TABLE IF NOT EXISTS platform.workspaces (
    workspace_id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_key text NOT NULL,
    -- NULL is retained only for legacy rows without defensible product evidence.
    -- New onboarding paths must supply the billing productKey explicitly.
    product_key text,
    name text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    created_by_principal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workspaces_pk PRIMARY KEY (workspace_id),
    CONSTRAINT workspaces_key_unique UNIQUE (workspace_key),
    CONSTRAINT workspaces_key_check CHECK (workspace_key ~ '^[a-z][a-z0-9-]{1,62}$'),
    CONSTRAINT workspaces_product_key_check CHECK (product_key IS NULL OR
        (product_key = btrim(product_key) AND length(product_key) BETWEEN 1 AND 128)),
    CONSTRAINT workspaces_name_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT workspaces_status_check CHECK (status IN ('active', 'suspended', 'archived')),
    CONSTRAINT workspaces_creator_fkey FOREIGN KEY (created_by_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT
);

CREATE OR REPLACE FUNCTION platform.guard_workspace_product_key()
RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
    IF OLD.product_key IS NOT NULL AND NEW.product_key IS DISTINCT FROM OLD.product_key THEN
        RAISE EXCEPTION 'Workspace product_key is immutable once classified' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS workspaces_product_key_guard ON platform.workspaces;
CREATE TRIGGER workspaces_product_key_guard
BEFORE UPDATE OF product_key ON platform.workspaces
FOR EACH ROW EXECUTE FUNCTION platform.guard_workspace_product_key();
