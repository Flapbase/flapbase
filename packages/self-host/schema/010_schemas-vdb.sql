CREATE TABLE IF NOT EXISTS vdb.schemas (
    schema_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    blueprint_ref text NOT NULL, blueprint_revision text NOT NULL, blueprint_digest text NOT NULL,
    allowed_access text[] NOT NULL DEFAULT ARRAY['workspace']::text[],
    default_access text NOT NULL DEFAULT 'workspace',
    CONSTRAINT schemas_access_check CHECK (cardinality(allowed_access) BETWEEN 1 AND 3 AND array_position(allowed_access,NULL) IS NULL AND allowed_access <@ ARRAY['private','project','workspace']::text[] AND default_access = ANY(allowed_access)),
    projection_version text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (workspace_id, blueprint_ref, blueprint_revision),
    CHECK (blueprint_digest ~ '^[0-9a-fA-F]{64}$'), CHECK (length(btrim(blueprint_ref)) > 0)
);
