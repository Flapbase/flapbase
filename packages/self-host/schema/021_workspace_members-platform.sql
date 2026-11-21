CREATE TABLE IF NOT EXISTS platform.workspace_members (
    workspace_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    member_role text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    joined_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    CONSTRAINT workspace_members_pk PRIMARY KEY (workspace_id, principal_id),
    CONSTRAINT workspace_members_workspace_fkey FOREIGN KEY (workspace_id)
        REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    CONSTRAINT workspace_members_principal_fkey FOREIGN KEY (principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT workspace_members_role_check CHECK (member_role IN ('owner', 'admin', 'member', 'viewer')),
    CONSTRAINT workspace_members_status_check CHECK (status IN ('active', 'revoked'))
);

CREATE OR REPLACE FUNCTION platform.enforce_workspace_member_human()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM identity.principals human
        WHERE human.principal_id = NEW.principal_id
          AND human.principal_kind = 'human'
          AND human.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Workspace membership requires an active Human Principal; Agent access uses Delegation'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS workspace_members_human_guard ON platform.workspace_members;
CREATE TRIGGER workspace_members_human_guard
    BEFORE INSERT OR UPDATE OF principal_id ON platform.workspace_members
    FOR EACH ROW EXECUTE FUNCTION platform.enforce_workspace_member_human();

COMMENT ON TABLE platform.workspaces IS 'Provider-neutral Workspace authority.';
COMMENT ON TABLE platform.workspace_members IS 'Active Human membership authority. Agent access is expressed by Delegation, not membership.';
