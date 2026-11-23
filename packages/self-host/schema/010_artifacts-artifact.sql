CREATE TABLE IF NOT EXISTS artifact.artifacts (
    artifact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT, artifact_key text NOT NULL,
    media_type text, opaque_ref text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
    project_id uuid,
    UNIQUE (workspace_id, artifact_key), CHECK (length(btrim(opaque_ref)) > 0)
);

-- Storage locators are not Artifact identifiers. Resolve an imported immutable object without an alias ID or a Workspace-wide scan.
CREATE INDEX IF NOT EXISTS artifacts_workspace_opaque_ref_idx ON artifact.artifacts(workspace_id,opaque_ref);

CREATE INDEX IF NOT EXISTS artifacts_workspace_project_idx ON artifact.artifacts(workspace_id, project_id);
