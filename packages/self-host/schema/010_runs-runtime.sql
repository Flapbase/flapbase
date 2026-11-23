CREATE TABLE IF NOT EXISTS runtime.runs (
    run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT, actor_ref text NOT NULL,
    workflow_ref text NOT NULL, status text NOT NULL DEFAULT 'queued', input_digest text, output_digest text,
    started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    project_id uuid,
    workflow_id uuid,
    CONSTRAINT runs_project_identity UNIQUE (project_id, run_id),
    CONSTRAINT runs_project_workspace_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES platform.projects(workspace_id, project_id) ON DELETE RESTRICT,
    CONSTRAINT runs_workflow_project_fkey FOREIGN KEY (project_id, workflow_id) REFERENCES platform.workflows(project_id, workflow_id) ON DELETE RESTRICT,
    CONSTRAINT runs_workflow_requires_project CHECK (workflow_id IS NULL OR project_id IS NOT NULL),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 65536),
    CHECK (status IN ('queued','running','waiting','succeeded','failed','cancelled','reconciling')), CHECK (length(btrim(workflow_ref)) > 0),
    CHECK (length(btrim(actor_ref)) > 0), CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);
