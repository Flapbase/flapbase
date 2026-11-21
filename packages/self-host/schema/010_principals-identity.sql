CREATE TABLE IF NOT EXISTS identity.principals (
    principal_id uuid NOT NULL DEFAULT gen_random_uuid(),
    principal_kind text NOT NULL,
    -- Verified Human login email. Agents leave this NULL. Values are stored
    -- normalized so one email resolves to one Human Principal.
    email text,
    -- Optional verified receiving address; never used to resolve login identity.
    communication_email text,
    communication_email_verified_at timestamptz,
    -- Optional shared Human profile shown across Flapbase products.
    display_name text,
    bio text,
    avatar_url text,
    profile_updated_at timestamptz,
    owner_human_principal_id uuid,
    namespace_path text,
    durable_reason text,
    status text NOT NULL DEFAULT 'active',
    flapbase_pending_reason text,
    created_by text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT principals_pk PRIMARY KEY (principal_id),
    CONSTRAINT principals_kind_check CHECK (principal_kind IN ('human', 'agent')),
    CONSTRAINT principals_status_check CHECK (status IN ('active', 'suspended', 'retired')),
    CONSTRAINT principals_flapbase_pending_reason_check CHECK (
        flapbase_pending_reason IN ('invite_required','capacity_reached')
    ),
    CONSTRAINT principals_email_normalized_check CHECK (email IS NULL OR email = lower(btrim(email))),
    CONSTRAINT principals_communication_email_check CHECK (
        (communication_email IS NULL AND communication_email_verified_at IS NULL)
        OR (principal_kind = 'human' AND communication_email IS NOT NULL
            AND communication_email_verified_at IS NOT NULL
            AND communication_email = lower(btrim(communication_email))
            AND length(communication_email) <= 254
            AND communication_email ~ '^[^[:space:]@]+@[^[:space:]@]+[.][^[:space:]@]+$')
    ),
    CONSTRAINT principals_profile_check CHECK (
        (display_name IS NULL AND bio IS NULL AND avatar_url IS NULL)
        OR principal_kind = 'human'
    ),
    CONSTRAINT principals_display_name_check CHECK (
        display_name IS NULL OR (display_name = btrim(display_name) AND char_length(display_name) BETWEEN 1 AND 80)
    ),
    CONSTRAINT principals_bio_check CHECK (bio IS NULL OR char_length(bio) BETWEEN 1 AND 500),
    CONSTRAINT principals_avatar_url_check CHECK (
        avatar_url IS NULL
        OR avatar_url ~ ('^https://assets[.]flapbase[.]com/personal/' || principal_id::text || '/avatar[.](jpg|jpeg|png|webp|gif)([?]v=[0-9]{1,16})?$')
    ),
    CONSTRAINT principals_human_shape_check CHECK (
        principal_kind <> 'human'
        OR owner_human_principal_id IS NULL AND namespace_path IS NULL AND durable_reason IS NULL
    ),
    CONSTRAINT principals_agent_shape_check CHECK (
        principal_kind <> 'agent'
        OR owner_human_principal_id IS NOT NULL
        AND namespace_path ~ '^agent\.[a-z0-9][a-z0-9._-]{1,190}$'
        AND (durable_reason IN (
            'stable_role',
            'independent_scope',
            'independent_budget',
            'durable_memory',
            'independent_revocation',
            'handoff_target'
        ))
    ),
    CONSTRAINT principals_owner_not_self_check CHECK (owner_human_principal_id IS DISTINCT FROM principal_id),
    CONSTRAINT principals_owner_human_fkey FOREIGN KEY (owner_human_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT
);

CREATE UNIQUE INDEX IF NOT EXISTS principals_owner_agent_namespace_uidx
    ON identity.principals (owner_human_principal_id, namespace_path)
    WHERE principal_kind = 'agent';

CREATE UNIQUE INDEX IF NOT EXISTS principals_human_email_uidx
    ON identity.principals (lower(btrim(email)))
    WHERE principal_kind = 'human' AND email IS NOT NULL;

CREATE OR REPLACE FUNCTION identity.enforce_principal_owner_kind()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    IF NEW.principal_kind = 'agent' AND NOT EXISTS (
        SELECT 1
        FROM identity.principals owner
        WHERE owner.principal_id = NEW.owner_human_principal_id
          AND owner.principal_kind = 'human'
          AND owner.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Durable Agent Principal requires one active Human Owner'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION identity.enforce_principal_anchor_immutable()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    IF OLD.principal_id IS DISTINCT FROM NEW.principal_id
       OR OLD.principal_kind IS DISTINCT FROM NEW.principal_kind
       OR OLD.owner_human_principal_id IS DISTINCT FROM NEW.owner_human_principal_id
       OR OLD.namespace_path IS DISTINCT FROM NEW.namespace_path
       OR OLD.durable_reason IS DISTINCT FROM NEW.durable_reason
       OR OLD.created_by IS DISTINCT FROM NEW.created_by
       OR OLD.created_at IS DISTINCT FROM NEW.created_at THEN
        RAISE EXCEPTION 'Principal identity anchor fields are immutable'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS principals_owner_kind_guard ON identity.principals;
CREATE TRIGGER principals_owner_kind_guard
    BEFORE INSERT OR UPDATE OF principal_kind, owner_human_principal_id, namespace_path, durable_reason, status
    ON identity.principals
    FOR EACH ROW EXECUTE FUNCTION identity.enforce_principal_owner_kind();

DROP TRIGGER IF EXISTS principals_anchor_immutable_guard ON identity.principals;
CREATE TRIGGER principals_anchor_immutable_guard
    BEFORE UPDATE ON identity.principals
    FOR EACH ROW EXECUTE FUNCTION identity.enforce_principal_anchor_immutable();

COMMENT ON TABLE identity.principals IS
    'Immutable Human and durable Agent identity anchors. Ephemeral actors are runtime refs, not Principal rows.';

COMMENT ON COLUMN identity.principals.email IS
    'Verified Human login email, normalized to lower-case and unique across Human Principals.';

COMMENT ON COLUMN identity.principals.display_name IS
    'Optional shared Human display name chosen by the person; not a login identifier or legal name.';

COMMENT ON COLUMN identity.principals.avatar_url IS
    'Optional shared Human avatar under the person''s own assets.flapbase.com personal prefix.';

COMMENT ON COLUMN identity.principals.communication_email IS
    'Verified receiving address for service communications; NULL uses the verified login email. Not a login identifier or marketing consent.';
