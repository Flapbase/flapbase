-- An invitation into a Workspace: as its reviewer (確認役), or as a member (2026-10-26). The link carries a random token; only its hash is kept.
-- invite_role 'reviewer' adds a reviewer row; 'admin' / 'member' / 'viewer' add a Workspace membership, or, when project_ids
-- is not empty, memberships in those Projects only (member -> editor, viewer -> viewer).
-- Accepting needs the signed-in person's login email to equal the invited email, so a forwarded link does not admit anyone else.
-- Rows are never deleted: accepting or revoking stamps the row. A pending invitation holds a seat of the plan's member limit.
CREATE TABLE IF NOT EXISTS platform.workspace_reviewer_invitations (
    invitation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    email text NOT NULL,
    display_name text NOT NULL,
    token_hash text NOT NULL,
    status text NOT NULL DEFAULT 'pending',
    invited_by uuid NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    accepted_by uuid,
    accepted_at timestamptz,
    revoked_by uuid,
    revoked_at timestamptz,
    invite_role text NOT NULL DEFAULT 'reviewer',
    project_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
    -- CMS (2026-11-14): stored as invite_role 'viewer' plus this mark, and only with chosen Projects.
    content_edit boolean NOT NULL DEFAULT false,
    CONSTRAINT workspace_reviewer_invitations_pk PRIMARY KEY (invitation_id),
    CONSTRAINT workspace_reviewer_invitations_workspace_fkey FOREIGN KEY (workspace_id)
        REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    CONSTRAINT workspace_reviewer_invitations_invited_by_fkey FOREIGN KEY (invited_by)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT workspace_reviewer_invitations_accepted_by_fkey FOREIGN KEY (accepted_by)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT workspace_reviewer_invitations_revoked_by_fkey FOREIGN KEY (revoked_by)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT workspace_reviewer_invitations_email_check CHECK (
        email = lower(btrim(email)) AND length(email) BETWEEN 3 AND 320 AND email ~ '^[^@[:space:]]+@[^@[:space:]]+$'),
    CONSTRAINT workspace_reviewer_invitations_name_check CHECK (length(btrim(display_name)) BETWEEN 1 AND 80),
    CONSTRAINT workspace_reviewer_invitations_token_check CHECK (token_hash ~ '^sha256:[0-9a-f]{64}$'),
    CONSTRAINT workspace_reviewer_invitations_role_check CHECK (invite_role IN ('reviewer', 'admin', 'member', 'viewer')),
    CONSTRAINT workspace_reviewer_invitations_projects_check CHECK (
        cardinality(project_ids) <= 50 AND (cardinality(project_ids) = 0 OR invite_role IN ('member', 'viewer'))),
    CONSTRAINT workspace_reviewer_invitations_content_edit_check CHECK (
        NOT content_edit OR (invite_role = 'viewer' AND cardinality(project_ids) > 0)),
    CONSTRAINT workspace_reviewer_invitations_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT workspace_reviewer_invitations_status_check CHECK (
        (status = 'pending' AND accepted_at IS NULL AND accepted_by IS NULL AND revoked_at IS NULL AND revoked_by IS NULL)
        OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by IS NOT NULL AND revoked_at IS NULL AND revoked_by IS NULL)
        OR (status = 'revoked' AND revoked_at IS NOT NULL AND revoked_by IS NOT NULL AND accepted_at IS NULL AND accepted_by IS NULL))
);

CREATE UNIQUE INDEX IF NOT EXISTS workspace_reviewer_invitations_token
    ON platform.workspace_reviewer_invitations (token_hash);
-- One open invitation per Workspace and email; inviting again after a revoke adds a new row.
CREATE UNIQUE INDEX IF NOT EXISTS workspace_reviewer_invitations_pending
    ON platform.workspace_reviewer_invitations (workspace_id, email) WHERE status = 'pending';
