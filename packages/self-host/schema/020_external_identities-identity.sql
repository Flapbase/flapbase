CREATE TABLE IF NOT EXISTS identity.external_identities (
    external_identity_id uuid NOT NULL DEFAULT gen_random_uuid(),
    principal_id uuid NOT NULL,
    provider text NOT NULL,
    provider_subject text NOT NULL,
    status text NOT NULL DEFAULT 'active',
    linked_at timestamptz NOT NULL DEFAULT now(),
    retired_at timestamptz,
    CONSTRAINT external_identities_pk PRIMARY KEY (external_identity_id),
    CONSTRAINT external_identities_principal_fkey FOREIGN KEY (principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT external_identities_provider_subject_key UNIQUE (provider, provider_subject),
    CONSTRAINT external_identities_status_check CHECK (status IN ('active', 'retired')),
    CONSTRAINT external_identities_provider_check CHECK (length(btrim(provider)) > 0),
    CONSTRAINT external_identities_subject_check CHECK (length(btrim(provider_subject)) > 0)
);

COMMENT ON TABLE identity.external_identities IS
    'Non-secret mapping from provider identity subjects to canonical Principals.';
