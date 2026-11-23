CREATE TABLE IF NOT EXISTS platform.project_memberships (
    project_id uuid NOT NULL,
    principal_id uuid NOT NULL,
    member_role text NOT NULL DEFAULT 'member',
    status text NOT NULL DEFAULT 'active',
    joined_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    -- CMS (2026-11-14): a viewer who may change the values of a Site's collections and nothing else. member_role stays 'viewer', so every
    -- check that reads "not a viewer" as "may edit" keeps treating this person as a viewer; only the CMS rule reads this mark.
    content_edit boolean NOT NULL DEFAULT false,
    CONSTRAINT project_memberships_pk PRIMARY KEY (project_id, principal_id),
    CONSTRAINT project_memberships_project_fkey FOREIGN KEY (project_id)
        REFERENCES platform.projects(project_id) ON DELETE RESTRICT,
    CONSTRAINT project_memberships_principal_fkey FOREIGN KEY (principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT project_memberships_role_check CHECK (member_role IN ('owner', 'editor', 'member', 'viewer')),
    CONSTRAINT project_memberships_status_check CHECK (status IN ('active', 'revoked')),
    CONSTRAINT project_memberships_revoked_check CHECK ((status = 'revoked') = (revoked_at IS NOT NULL)),
    CONSTRAINT project_memberships_content_edit_check CHECK (NOT content_edit OR member_role = 'viewer')
);

CREATE OR REPLACE FUNCTION platform.enforce_project_member_human()
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
        RAISE EXCEPTION 'Project membership requires an active Human Principal; Agent access uses Delegation'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS project_memberships_human_guard ON platform.project_memberships;
CREATE TRIGGER project_memberships_human_guard
    BEFORE INSERT OR UPDATE OF principal_id ON platform.project_memberships
    FOR EACH ROW EXECUTE FUNCTION platform.enforce_project_member_human();

COMMENT ON TABLE platform.project_memberships IS 'Active Human membership authority. Agent access is expressed by Delegation, not membership.';
