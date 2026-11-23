CREATE TABLE IF NOT EXISTS vdb.mutation_receipts (
    receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT, actor_ref text NOT NULL,
    operation text NOT NULL, target_ref text NOT NULL, request_digest text NOT NULL, result_digest text,
    created_at timestamptz NOT NULL DEFAULT now(), CHECK (length(btrim(actor_ref)) > 0), CHECK (length(btrim(operation)) > 0)
);
