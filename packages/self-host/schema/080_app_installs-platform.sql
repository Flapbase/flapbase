CREATE TABLE IF NOT EXISTS platform.app_installs (
    app_install_id uuid NOT NULL DEFAULT gen_random_uuid(),
    project_id uuid NOT NULL,
    app_key text NOT NULL,
    app_revision text NOT NULL,
    install_config jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'active',
    installed_by_principal_id uuid NOT NULL,
    installed_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT app_installs_pk PRIMARY KEY (app_install_id),
    CONSTRAINT app_installs_project_app_unique UNIQUE (project_id, app_key),
    CONSTRAINT app_installs_project_fkey FOREIGN KEY (project_id)
        REFERENCES platform.projects(project_id) ON DELETE RESTRICT,
    CONSTRAINT app_installs_installer_fkey FOREIGN KEY (installed_by_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT app_installs_key_check CHECK (app_key ~ '^[a-z][a-z0-9._-]{1,190}$'),
    CONSTRAINT app_installs_revision_check CHECK (length(btrim(app_revision)) > 0),
    CONSTRAINT app_installs_config_check CHECK (jsonb_typeof(install_config) = 'object'),
    CONSTRAINT app_installs_status_check CHECK (status IN ('active', 'disabled'))
);
