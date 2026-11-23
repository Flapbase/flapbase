CREATE TABLE IF NOT EXISTS runtime.idempotency_keys (
    workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    idempotency_key text NOT NULL, request_digest text NOT NULL, response_digest text, response jsonb,
    created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY (workspace_id, idempotency_key),
    CHECK (length(btrim(idempotency_key)) > 0),
    CHECK (response IS NULL OR (jsonb_typeof(response) = 'object' AND octet_length(response::text) <= 1048576 AND response_digest IS NOT NULL))
);
