CREATE TABLE IF NOT EXISTS vdb.records (
    record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), schema_id uuid NOT NULL REFERENCES vdb.schemas(schema_id) ON DELETE RESTRICT,
    access text NOT NULL,
    owner_principal_id uuid REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    project_id uuid REFERENCES platform.projects(project_id) ON DELETE RESTRICT,
    CONSTRAINT records_access_check CHECK (access IN ('private','project','workspace') AND (access <> 'private' OR owner_principal_id IS NOT NULL) AND (access <> 'project' OR project_id IS NOT NULL)),
    record_key text NOT NULL, data jsonb NOT NULL DEFAULT '{}'::jsonb, version bigint NOT NULL DEFAULT 1,
    created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
    UNIQUE (schema_id, record_key), CHECK (version > 0), CHECK (length(btrim(record_key)) > 0)
);
