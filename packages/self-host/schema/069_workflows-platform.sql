CREATE TABLE IF NOT EXISTS platform.workflows (
    workflow_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    goal text,
    shape text NOT NULL DEFAULT 'project' CHECK (shape IN ('project','operation')),
    owner_principal_id uuid REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    is_default boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','archived')),
    transitions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transitions) = 'array'),
    definition_ref text CHECK (definition_ref IS NULL OR (length(btrim(definition_ref)) > 0 AND definition_ref <> 'latest')),
    period_start timestamptz,
    period_end timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workflows_project_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES platform.projects(workspace_id, project_id) ON DELETE RESTRICT,
    CONSTRAINT workflows_project_identity UNIQUE (project_id, workflow_id),
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS workflows_default_per_project ON platform.workflows (project_id) WHERE is_default;
