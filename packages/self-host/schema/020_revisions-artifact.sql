CREATE TABLE IF NOT EXISTS artifact.artifact_revisions (
    artifact_revision_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), artifact_id uuid NOT NULL REFERENCES artifact.artifacts(artifact_id) ON DELETE RESTRICT,
    revision_number bigint NOT NULL, opaque_ref text NOT NULL, content_digest text NOT NULL, metadata jsonb NOT NULL DEFAULT '{}'::jsonb, library_metadata jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), UNIQUE (artifact_id, revision_number), CHECK (revision_number > 0), CHECK (content_digest ~ '^[0-9a-fA-F]{64}$')
);
