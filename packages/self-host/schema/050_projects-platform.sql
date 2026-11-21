CREATE TABLE IF NOT EXISTS platform.projects (
    project_id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    description text,
    purpose text NOT NULL DEFAULT 'free' CONSTRAINT projects_purpose_check CHECK (purpose IN ('make','grow','work','free')),
    status text NOT NULL DEFAULT 'active',
    visibility text NOT NULL DEFAULT 'private',
    created_by_principal_id uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    authority_mode text NOT NULL DEFAULT 'cloud' CHECK (authority_mode IN ('repo','cloud')),
    linked_repos jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(linked_repos) = 'array'),
    -- 保護（2026-10-27）: set, the Project's works cannot be deleted or moved out (artifact.guard_protected_project_*).
    protected_at timestamptz,
    protected_by_principal_id uuid,
    CONSTRAINT projects_workspace_identity UNIQUE (workspace_id, project_id),
    CONSTRAINT projects_pk PRIMARY KEY (project_id),
    CONSTRAINT projects_workspace_slug_unique UNIQUE (workspace_id, slug),
    CONSTRAINT projects_workspace_fkey FOREIGN KEY (workspace_id)
        REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    CONSTRAINT projects_creator_fkey FOREIGN KEY (created_by_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT projects_name_check CHECK (length(btrim(name)) > 0),
    CONSTRAINT projects_slug_check CHECK (slug ~ '^[a-z][a-z0-9-]{1,62}$'),
    CONSTRAINT projects_status_check CHECK (status IN ('active', 'archived')),
    CONSTRAINT projects_visibility_check CHECK (visibility IN ('private', 'workspace', 'public')),
    CONSTRAINT projects_protected_by_fkey FOREIGN KEY (protected_by_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT projects_protection_check CHECK ((protected_at IS NULL) = (protected_by_principal_id IS NULL))
);
