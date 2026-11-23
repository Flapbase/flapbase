CREATE TABLE IF NOT EXISTS platform.app_revision_locks (
    app_install_id uuid NOT NULL,
    app_key text NOT NULL,
    app_revision text NOT NULL,
    resolved_digest text NOT NULL,
    locked_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_revision_locks_pk PRIMARY KEY (app_install_id),
    CONSTRAINT app_revision_locks_install_fkey FOREIGN KEY (app_install_id)
        REFERENCES platform.app_installs(app_install_id) ON DELETE RESTRICT,
    CONSTRAINT app_revision_locks_key_check CHECK (app_key ~ '^[a-z][a-z0-9._-]{1,190}$'),
    CONSTRAINT app_revision_locks_revision_check CHECK (length(btrim(app_revision)) > 0),
    CONSTRAINT app_revision_locks_digest_check CHECK (resolved_digest ~ '^[0-9a-fA-F]{64}$'),
    CONSTRAINT app_revision_locks_install_identity_unique UNIQUE (app_install_id, app_key, app_revision)
);
