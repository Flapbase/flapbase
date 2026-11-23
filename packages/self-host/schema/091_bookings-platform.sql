-- Generated from the OSS PostgreSQL booking sources. Keep Cloud-only extensions separate.

CREATE TABLE IF NOT EXISTS platform.capability_grants (
    capability_grant_id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    human_principal_id uuid NOT NULL,
    capabilities text[] NOT NULL,
    resource_refs text[] NOT NULL,
    audiences text[] NOT NULL,
    budget_ceiling bigint NOT NULL DEFAULT 0,
    expires_at timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT capability_grants_pk PRIMARY KEY (capability_grant_id),
    CONSTRAINT capability_grants_workspace_fkey FOREIGN KEY (workspace_id)
        REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    CONSTRAINT capability_grants_human_fkey FOREIGN KEY (human_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT capability_grants_capabilities_check CHECK (cardinality(capabilities) > 0),
    CONSTRAINT capability_grants_resources_check CHECK (cardinality(resource_refs) > 0),
    CONSTRAINT capability_grants_audiences_check CHECK (cardinality(audiences) > 0),
    CONSTRAINT capability_grants_budget_check CHECK (budget_ceiling >= 0),
    CONSTRAINT capability_grants_expiry_check CHECK (expires_at IS NULL OR expires_at > created_at),
    CONSTRAINT capability_grants_revoke_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS platform.agent_delegations (
    agent_delegation_id uuid NOT NULL DEFAULT gen_random_uuid(),
    parent_capability_grant_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    owner_human_principal_id uuid NOT NULL,
    agent_principal_id uuid NOT NULL,
    purpose text NOT NULL,
    capabilities text[] NOT NULL,
    resource_refs text[] NOT NULL,
    audiences text[] NOT NULL,
    budget_ceiling bigint NOT NULL DEFAULT 0,
    budget_consumed bigint NOT NULL DEFAULT 0,
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT agent_delegations_pk PRIMARY KEY (agent_delegation_id),
    CONSTRAINT agent_delegations_parent_grant_fkey FOREIGN KEY (parent_capability_grant_id)
        REFERENCES platform.capability_grants(capability_grant_id) ON DELETE RESTRICT,
    CONSTRAINT agent_delegations_workspace_fkey FOREIGN KEY (workspace_id)
        REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    CONSTRAINT agent_delegations_owner_fkey FOREIGN KEY (owner_human_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT agent_delegations_agent_fkey FOREIGN KEY (agent_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT agent_delegations_purpose_check CHECK (
        length(btrim(purpose)) >= 3 AND length(btrim(purpose)) <= 200
    ),
    CONSTRAINT agent_delegations_capabilities_check CHECK (cardinality(capabilities) > 0),
    CONSTRAINT agent_delegations_resources_check CHECK (cardinality(resource_refs) > 0),
    CONSTRAINT agent_delegations_audiences_check CHECK (cardinality(audiences) > 0),
    CONSTRAINT agent_delegations_budget_check CHECK (
        budget_ceiling >= 0 AND budget_consumed >= 0 AND budget_consumed <= budget_ceiling
    ),
    CONSTRAINT agent_delegations_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT agent_delegations_revoke_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE TABLE IF NOT EXISTS platform.connections (
    connection_id uuid NOT NULL DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    owner_human_principal_id uuid NOT NULL,
    client_ref text NOT NULL,
    agent_delegation_id uuid NOT NULL,
    actor_mode text NOT NULL,
    durable_agent_principal_id uuid,
    connection_kind text NOT NULL,
    resource text NOT NULL,
    audience text NOT NULL,
    purpose text NOT NULL,
    credential_ref text,
    status text NOT NULL DEFAULT 'active',
    expires_at timestamptz NOT NULL,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT connections_pk PRIMARY KEY (connection_id),
    CONSTRAINT connections_workspace_fkey FOREIGN KEY (workspace_id)
        REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT,
    CONSTRAINT connections_owner_fkey FOREIGN KEY (owner_human_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT connections_delegation_fkey FOREIGN KEY (agent_delegation_id)
        REFERENCES platform.agent_delegations(agent_delegation_id) ON DELETE RESTRICT,
    CONSTRAINT connections_durable_agent_fkey FOREIGN KEY (durable_agent_principal_id)
        REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    CONSTRAINT connections_actor_mode_check CHECK (actor_mode IN ('durable', 'ephemeral')),
    CONSTRAINT connections_actor_shape_check CHECK (
        actor_mode = 'durable' AND durable_agent_principal_id IS NOT NULL
        OR actor_mode = 'ephemeral' AND durable_agent_principal_id IS NULL
    ),
    CONSTRAINT connections_kind_check CHECK (connection_kind IN ('remote_mcp', 'connector', 'service')),
    CONSTRAINT connections_status_check CHECK (status IN ('active', 'revoked', 'expired')),
    CONSTRAINT connections_client_ref_check CHECK (length(btrim(client_ref)) > 0),
    CONSTRAINT connections_resource_check CHECK (length(btrim(resource)) > 0),
    CONSTRAINT connections_audience_check CHECK (length(btrim(audience)) > 0),
    CONSTRAINT connections_purpose_check CHECK (
        length(btrim(purpose)) >= 3 AND length(btrim(purpose)) <= 200
    ),
    CONSTRAINT connections_expiry_check CHECK (expires_at > created_at),
    CONSTRAINT connections_revoke_check CHECK (revoked_at IS NULL OR revoked_at >= created_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS connections_active_client_resource_uidx
    ON platform.connections (client_ref, owner_human_principal_id, workspace_id, resource)
    WHERE status = 'active';

CREATE OR REPLACE FUNCTION platform.enforce_human_capability_grant()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM identity.principals human
        WHERE human.principal_id = NEW.human_principal_id
          AND human.principal_kind = 'human'
          AND human.status = 'active'
    ) OR NOT EXISTS (
        SELECT 1 FROM platform.workspace_members member
        WHERE member.workspace_id = NEW.workspace_id
          AND member.principal_id = NEW.human_principal_id
          AND member.status = 'active'
    ) THEN
        RAISE EXCEPTION 'Capability Grant requires an active Human Workspace member'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform.enforce_agent_delegation_ceiling()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
    parent_grant platform.capability_grants%ROWTYPE;
BEGIN
    IF TG_OP = 'UPDATE' AND NEW.revoked_at IS NOT NULL
       AND (to_jsonb(NEW) - 'revoked_at') = (to_jsonb(OLD) - 'revoked_at') THEN
        IF OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at THEN
            RAISE EXCEPTION 'Agent Delegation revocation is final' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
    END IF;
    IF TG_OP = 'UPDATE' AND NEW.budget_consumed < OLD.budget_consumed THEN
        RAISE EXCEPTION 'Agent Delegation consumption cannot decrease' USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND OLD.revoked_at IS NOT NULL THEN
        RAISE EXCEPTION 'Revoked Agent Delegation cannot change' USING ERRCODE = '23514';
    END IF;
    SELECT * INTO parent_grant
      FROM platform.capability_grants
     WHERE capability_grant_id = NEW.parent_capability_grant_id;
    IF NOT FOUND
       OR parent_grant.workspace_id <> NEW.workspace_id
       OR parent_grant.human_principal_id <> NEW.owner_human_principal_id
       OR parent_grant.revoked_at IS NOT NULL
       OR (parent_grant.expires_at IS NOT NULL AND parent_grant.expires_at <= now())
       OR NOT (NEW.capabilities <@ parent_grant.capabilities)
       OR NOT (NEW.resource_refs <@ parent_grant.resource_refs)
       OR NOT (NEW.audiences <@ parent_grant.audiences)
       OR NEW.budget_ceiling > parent_grant.budget_ceiling
       OR (parent_grant.expires_at IS NOT NULL AND NEW.expires_at > parent_grant.expires_at)
       OR NOT EXISTS (
           SELECT 1 FROM identity.principals agent
           WHERE agent.principal_id = NEW.agent_principal_id
             AND agent.principal_kind = 'agent'
             AND agent.owner_human_principal_id = NEW.owner_human_principal_id
             AND agent.status = 'active'
       ) THEN
        RAISE EXCEPTION 'Agent Delegation must remain inside Human Owner Capability Grant'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (
        NEW.parent_capability_grant_id IS DISTINCT FROM OLD.parent_capability_grant_id
        OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.owner_human_principal_id IS DISTINCT FROM OLD.owner_human_principal_id
        OR NEW.agent_principal_id IS DISTINCT FROM OLD.agent_principal_id
        OR NOT (NEW.capabilities <@ OLD.capabilities)
        OR NOT (NEW.resource_refs <@ OLD.resource_refs)
        OR NOT (NEW.audiences <@ OLD.audiences)
        OR NEW.budget_ceiling > OLD.budget_ceiling
        OR NEW.expires_at > OLD.expires_at
    ) THEN
        RAISE EXCEPTION 'Existing Agent Delegation cannot be rebound or amplified'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION platform.enforce_connection_binding()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO ''
AS $$
DECLARE
    delegation platform.agent_delegations%ROWTYPE;
BEGIN
    SELECT * INTO delegation
      FROM platform.agent_delegations
     WHERE agent_delegation_id = NEW.agent_delegation_id;
    IF NOT FOUND
       OR delegation.workspace_id <> NEW.workspace_id
       OR delegation.owner_human_principal_id <> NEW.owner_human_principal_id
       OR delegation.revoked_at IS NOT NULL
       OR delegation.expires_at <= now()
       OR NEW.expires_at > delegation.expires_at
       OR NEW.resource <> ALL (delegation.resource_refs)
       OR NEW.audience <> ALL (delegation.audiences)
       OR (NEW.actor_mode = 'durable' AND NEW.durable_agent_principal_id <> delegation.agent_principal_id) THEN
        RAISE EXCEPTION 'Connection must remain inside its current Agent Delegation'
            USING ERRCODE = '23514';
    END IF;
    IF TG_OP = 'UPDATE' AND (
        NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
        OR NEW.owner_human_principal_id IS DISTINCT FROM OLD.owner_human_principal_id
        OR NEW.client_ref IS DISTINCT FROM OLD.client_ref
        OR NEW.agent_delegation_id IS DISTINCT FROM OLD.agent_delegation_id
        OR NEW.actor_mode IS DISTINCT FROM OLD.actor_mode
        OR NEW.durable_agent_principal_id IS DISTINCT FROM OLD.durable_agent_principal_id
        OR NEW.resource IS DISTINCT FROM OLD.resource
        OR NEW.audience IS DISTINCT FROM OLD.audience
        OR NEW.expires_at > OLD.expires_at
    ) THEN
        RAISE EXCEPTION 'Existing Connection cannot be rebound or amplified'
            USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS capability_grants_human_guard ON platform.capability_grants;
CREATE TRIGGER capability_grants_human_guard
    BEFORE INSERT OR UPDATE ON platform.capability_grants
    FOR EACH ROW EXECUTE FUNCTION platform.enforce_human_capability_grant();

DROP TRIGGER IF EXISTS agent_delegations_ceiling_guard ON platform.agent_delegations;
CREATE TRIGGER agent_delegations_ceiling_guard
    BEFORE INSERT OR UPDATE ON platform.agent_delegations
    FOR EACH ROW EXECUTE FUNCTION platform.enforce_agent_delegation_ceiling();

DROP TRIGGER IF EXISTS connections_binding_guard ON platform.connections;
CREATE TRIGGER connections_binding_guard
    BEFORE INSERT OR UPDATE ON platform.connections
    FOR EACH ROW EXECUTE FUNCTION platform.enforce_connection_binding();

COMMENT ON TABLE platform.capability_grants IS 'Human Workspace authority ceiling. It contains no credential material.';
COMMENT ON TABLE platform.agent_delegations IS 'Bounded Agent authority derived from one Human Capability Grant.';
COMMENT ON TABLE platform.connections IS
    'Secret-free Client connection metadata. OAuth Client registration never creates a Principal.';

CREATE TABLE IF NOT EXISTS platform.booking_hosts (
 host_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 principal_id uuid NOT NULL REFERENCES identity.principals(principal_id),
 product_key text NOT NULL DEFAULT 'flapbase' CHECK(product_key ~ '^[a-z][a-z0-9-]{1,30}$'),
 display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 1 AND 80),
 time_zone text NOT NULL DEFAULT 'Asia/Tokyo' CHECK(length(time_zone) BETWEEN 1 AND 64),
 -- {"1":[["09:00","12:00"],["13:00","18:00"]],…,"7":[]}（ISO の曜日 1=月〜7=日）。
 weekly_hours jsonb NOT NULL DEFAULT '{}',
 -- [{"date":"2026-11-10","hours":[]}]（hours が空ならその日は休み）。
 exceptions jsonb NOT NULL DEFAULT '[]',
 -- 予定を作る専用のカレンダー（Google の id）。接続は platform.connections（client_ref='flapbase:booking'）から引き、ここには持たない。
 calendar_id text CHECK(calendar_id IS NULL OR length(calendar_id) BETWEEN 1 AND 300),
 calendar_state text NOT NULL DEFAULT 'none' CHECK(calendar_state IN ('none','connected','reauth_required')),
 -- 確定の直前に Google の空きを確かめられないとき: required は受けない、best_effort は受ける。
 calendar_check text NOT NULL DEFAULT 'required' CHECK(calendar_check IN ('required','best_effort')),
 all_day_busy boolean NOT NULL DEFAULT true,
 -- 決済の受取先（Stripe の連結アカウントの参照だけ。本人確認の情報は持たない）。
 -- ready は Stripe で決済を受けられる（charges_enabled）。source は Timenode から作った（created）か、持っていたアカウントを OAuth でつないだ（oauth）か。
 payment_account_ref text CHECK(payment_account_ref IS NULL OR payment_account_ref ~ '^acct_[A-Za-z0-9]{6,64}$'),
 payment_account_state text NOT NULL DEFAULT 'none' CHECK(payment_account_state IN ('none','onboarding','ready','restricted')),
 payment_account_source text CHECK(payment_account_source IS NULL OR payment_account_source IN ('created','oauth')),
 -- 有料の受付の審査（運営）。approved になるまで有料のメニューは受け付けない。
 payment_review_state text NOT NULL DEFAULT 'pending' CHECK(payment_review_state IN ('pending','approved','rejected')),
 payment_reviewed_at timestamptz,
 payment_reviewed_by uuid REFERENCES identity.principals(principal_id),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','paused')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,principal_id),
 CHECK((payment_account_state='none')=(payment_account_ref IS NULL)),
 CHECK((payment_account_ref IS NULL)=(payment_account_source IS NULL)),
 CHECK((payment_review_state='pending')=(payment_reviewed_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS booking_hosts_payment_account ON platform.booking_hosts(payment_account_ref) WHERE payment_account_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.booking_offers (
 offer_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 host_id uuid NOT NULL REFERENCES platform.booking_hosts(host_id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 120),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=2000),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','active','archived')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,idempotency_key)
);
CREATE INDEX IF NOT EXISTS booking_offers_host ON platform.booking_offers(host_id,status);

-- 版は書き換えない（足すだけ）。
CREATE TABLE IF NOT EXISTS platform.booking_offer_revisions (
 offer_id uuid NOT NULL REFERENCES platform.booking_offers(offer_id),
 revision integer NOT NULL CHECK(revision>=1),
 duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 480),
 start_step_minutes integer NOT NULL DEFAULT 30 CHECK(start_step_minutes BETWEEN 5 AND 240),
 buffer_before_minutes integer NOT NULL DEFAULT 0 CHECK(buffer_before_minutes BETWEEN 0 AND 240),
 buffer_after_minutes integer NOT NULL DEFAULT 0 CHECK(buffer_after_minutes BETWEEN 0 AND 240),
 min_notice_minutes integer NOT NULL DEFAULT 180 CHECK(min_notice_minutes BETWEEN 0 AND 43200),
 horizon_days integer NOT NULL DEFAULT 30 CHECK(horizon_days BETWEEN 1 AND 365),
 -- 0 は無料。有料は Stripe の下限を考えて 100 円から。
 price_amount bigint NOT NULL DEFAULT 0 CHECK(price_amount=0 OR price_amount BETWEEN 100 AND 10000000),
 currency text NOT NULL DEFAULT 'JPY' CHECK(currency='JPY'),
 -- 期限（開始の何分前まで）の前に利用者が取り消すと全額を返す。期限のあとは払った額の late_cancel_refund_percent を返す。開始後は取り消せない。
 cancel_deadline_minutes integer NOT NULL DEFAULT 1440 CHECK(cancel_deadline_minutes BETWEEN 0 AND 20160),
 late_cancel_refund_percent integer NOT NULL DEFAULT 0 CHECK(late_cancel_refund_percent BETWEEN 0 AND 100),
 allow_reschedule boolean NOT NULL DEFAULT true,
 max_reschedules integer NOT NULL DEFAULT 2 CHECK(max_reschedules BETWEEN 0 AND 5),
 -- 初回の無料の体験: その提供者で初めての予約の1回目だけ料金 0。
 first_time_free boolean NOT NULL DEFAULT false,
 meeting_kind text NOT NULL DEFAULT 'google_meet' CHECK(meeting_kind IN ('google_meet','custom_url','none')),
 meeting_url text CHECK(meeting_url IS NULL OR (meeting_url ~ '^https://\S+$' AND length(meeting_url)<=2000)),
 send_calendar_invite boolean NOT NULL DEFAULT true,
 repeat_allowed boolean NOT NULL DEFAULT false,
 repeat_max_count integer NOT NULL DEFAULT 12 CHECK(repeat_max_count BETWEEN 2 AND 26),
 -- 少人数の同時参加数。予約版に固定し、以後の設定変更で既存の予約を変えない。
 capacity integer NOT NULL DEFAULT 1 CHECK(capacity BETWEEN 1 AND 1000),
 -- 予約ページはリンクを知る人だけへ渡す初期値。検索・タイムラインの掲載はこの Flapp では行わない。
 page_private boolean NOT NULL DEFAULT true,
 -- この版だけの受付の時間（なければ提供者の宣言）。
 weekly_hours jsonb,
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(offer_id,revision),
 CHECK((meeting_kind='custom_url')=(meeting_url IS NOT NULL))
);

-- 繰り返しの日程（毎週・隔週、回数）。回はそれぞれ1件の予約で、料金も1回ずつ。
CREATE TABLE IF NOT EXISTS platform.booking_series (
 series_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 offer_id uuid NOT NULL REFERENCES platform.booking_offers(offer_id),
 customer_principal_id uuid NOT NULL REFERENCES identity.principals(principal_id),
 interval_weeks integer NOT NULL CHECK(interval_weeks IN (1,2)),
 occurrence_count integer NOT NULL CHECK(occurrence_count BETWEEN 2 AND 26),
 status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','stopped')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 stopped_at timestamptz,
 CHECK((status='stopped')=(stopped_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS platform.bookings (
 booking_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 host_id uuid NOT NULL REFERENCES platform.booking_hosts(host_id),
 offer_id uuid NOT NULL,
 offer_revision integer NOT NULL,
 customer_principal_id uuid NOT NULL REFERENCES identity.principals(principal_id),
 series_id uuid REFERENCES platform.booking_series(series_id),
 occurrence integer NOT NULL DEFAULT 1 CHECK(occurrence BETWEEN 1 AND 26),
 status text NOT NULL CHECK(status IN ('held','confirmed','cancelled','expired')),
 -- 利用者に見せる時間（starts_at〜ends_at）と、占有する区間（前後の空きを含む）。
 starts_at timestamptz NOT NULL,
 ends_at timestamptz NOT NULL,
 block_start timestamptz NOT NULL,
 block_end timestamptz NOT NULL,
 hold_expires_at timestamptz,
 -- 支払い（成立した版から決めた額。0 は払わない）。手数料は成立の時点の率（基点。1/10000）。
 amount bigint NOT NULL CHECK(amount>=0),
 currency text NOT NULL DEFAULT 'JPY' CHECK(currency='JPY'),
 fee_bps integer NOT NULL DEFAULT 0 CHECK(fee_bps BETWEEN 0 AND 5000),
 payment_state text NOT NULL CHECK(payment_state IN ('none','pending','paid','refund_pending','refunded','refund_failed')),
 -- 決済を作った連結アカウント（direct charges。返金・照会・不審請求はこのアカウントの上で行う）。
 payment_account_ref text CHECK(payment_account_ref IS NULL OR payment_account_ref ~ '^acct_[A-Za-z0-9]{6,64}$'),
 checkout_ref text UNIQUE CHECK(checkout_ref IS NULL OR checkout_ref ~ '^cs_[A-Za-z0-9_]{6,200}$'),
 payment_ref text CHECK(payment_ref IS NULL OR payment_ref ~ '^pi_[A-Za-z0-9_]{6,200}$'),
 paid_amount bigint NOT NULL DEFAULT 0 CHECK(paid_amount>=0),
 refund_amount bigint NOT NULL DEFAULT 0 CHECK(refund_amount>=0),
 refund_ref text CHECK(refund_ref IS NULL OR refund_ref ~ '^re_[A-Za-z0-9_]{6,200}$'),
 -- 返金のときに Timenode の手数料（application fee）も同じ割合で戻すか。取消しの決まりで決める（booking_cancel）。
 refund_fee boolean NOT NULL DEFAULT true,
 -- 不審請求の申し立て（Stripe の dispute の状態をそのまま）。対応は提供者が Stripe のダッシュボードで行う。
 dispute_ref text CHECK(dispute_ref IS NULL OR dispute_ref ~ '^du_[A-Za-z0-9_]{6,200}$'),
 dispute_state text CHECK(dispute_state IS NULL OR dispute_state IN ('warning_needs_response','warning_under_review','warning_closed','needs_response','under_review','won','lost','prevented')),
 dispute_amount bigint CHECK(dispute_amount IS NULL OR dispute_amount>=0),
 dispute_due_by timestamptz,
 refund_attempts integer NOT NULL DEFAULT 0 CHECK(refund_attempts BETWEEN 0 AND 100),
 refund_claimed_until timestamptz,
 paid_at timestamptz,
 -- カレンダーの予定（Fulfillment）: 予定の id は予約の id から決まる（platform.booking_event_id）。
 calendar_state text NOT NULL DEFAULT 'none' CHECK(calendar_state IN ('none','pending','synced','delete_pending','deleted','failed')),
 calendar_attempts integer NOT NULL DEFAULT 0 CHECK(calendar_attempts BETWEEN 0 AND 100),
 calendar_claimed_until timestamptz,
 calendar_event_link text CHECK(calendar_event_link IS NULL OR (calendar_event_link ~ '^https://\S+$' AND length(calendar_event_link)<=2000)),
 meet_url text CHECK(meet_url IS NULL OR (meet_url ~ '^https://\S+$' AND length(meet_url)<=2000)),
 reschedule_count integer NOT NULL DEFAULT 0 CHECK(reschedule_count BETWEEN 0 AND 100),
 outcome text CHECK(outcome IS NULL OR outcome IN ('attended','no_show','host_issue')),
 cancelled_by text CHECK(cancelled_by IS NULL OR cancelled_by IN ('customer','host','system')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 confirmed_at timestamptz,
 cancelled_at timestamptz,
 FOREIGN KEY(offer_id,offer_revision) REFERENCES platform.booking_offer_revisions(offer_id,revision),
 UNIQUE(customer_principal_id,idempotency_key,occurrence),
 CHECK(ends_at>starts_at AND block_start<=starts_at AND block_end>=ends_at),
 CHECK((status='held')=(hold_expires_at IS NOT NULL)),
 CHECK((status='cancelled')=(cancelled_at IS NOT NULL AND cancelled_by IS NOT NULL)),
 CHECK((amount=0)=(payment_state='none' AND paid_amount=0) OR amount>0),
 CHECK(refund_amount<=paid_amount)
);
CREATE INDEX IF NOT EXISTS bookings_host_time ON platform.bookings(host_id,block_start) WHERE status IN ('held','confirmed');
CREATE INDEX IF NOT EXISTS bookings_customer ON platform.bookings(customer_principal_id,starts_at DESC);
CREATE INDEX IF NOT EXISTS bookings_workspace_time ON platform.bookings(workspace_id,starts_at);
CREATE INDEX IF NOT EXISTS bookings_holds_due ON platform.bookings(hold_expires_at) WHERE status='held';
CREATE INDEX IF NOT EXISTS bookings_calendar_due ON platform.bookings(updated_at) WHERE calendar_state IN ('pending','delete_pending');
CREATE INDEX IF NOT EXISTS bookings_refund_due ON platform.bookings(updated_at) WHERE payment_state='refund_pending';

CREATE TABLE IF NOT EXISTS platform.booking_changes (
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 booking_id uuid NOT NULL REFERENCES platform.bookings(booking_id),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 kind text NOT NULL CHECK(kind IN ('held','confirmed','cancelled','expired','rescheduled','outcome','paid','refund','disputed')),
 actor_kind text NOT NULL CHECK(actor_kind IN ('customer','host','system')),
 actor_principal_id uuid REFERENCES identity.principals(principal_id),
 detail jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(detail)='object' AND octet_length(detail::text)<=4096),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS booking_changes_booking ON platform.booking_changes(booking_id,occurred_at);

-- 案内とリマインドの Outbox。宛先は送るときに本人（identity.principals）から引き、ここには持たない。
CREATE TABLE IF NOT EXISTS platform.booking_notices (
 notice_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 booking_id uuid NOT NULL REFERENCES platform.bookings(booking_id),
 kind text NOT NULL CHECK(kind IN ('booking.confirmed','booking.cancelled','booking.rescheduled','booking.reminder','booking.payment_due','booking.released','booking.calendar_failed','booking.disputed')),
 recipient text NOT NULL CHECK(recipient IN ('customer','host')),
 due_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dedupe_key text NOT NULL UNIQUE CHECK(length(dedupe_key) BETWEEN 1 AND 200),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','held','failed','cancelled')),
 held_reason text CHECK(held_reason IS NULL OR held_reason IN ('sender_unconfigured','recipient_missing','stale')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 claimed_at timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='held')=(held_reason IS NOT NULL)),
 CHECK((state='sent')=(sent_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS booking_notices_due ON platform.booking_notices(due_at) WHERE state IN ('pending','sending');
CREATE INDEX IF NOT EXISTS booking_notices_booking ON platform.booking_notices(booking_id);

CREATE OR REPLACE FUNCTION platform.booking_windows_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT jsonb_typeof(p)='array' AND jsonb_array_length(p)<=6 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p) w
  WHERE jsonb_typeof(w)<>'array' OR jsonb_array_length(w)<>2 OR NOT (w->>0 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$') OR NOT (w->>1 ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$|^24:00$')
   OR (w->>0)>=(w->>1))
$$;

CREATE OR REPLACE FUNCTION platform.booking_hours_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT jsonb_typeof(p)='object' AND NOT EXISTS(SELECT 1 FROM jsonb_each(p) d WHERE d.key !~ '^[1-7]$' OR NOT platform.booking_windows_valid(d.value))
$$;

CREATE OR REPLACE FUNCTION platform.booking_exceptions_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT jsonb_typeof(p)='array' AND jsonb_array_length(p)<=366 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p) e
  WHERE jsonb_typeof(e)<>'object' OR NOT (e->>'date' ~ '^\d{4}-\d{2}-\d{2}$') OR NOT platform.booking_windows_valid(coalesce(e->'hours','null'::jsonb)))
  AND (SELECT count(DISTINCT e->>'date') FROM jsonb_array_elements(p) e)=jsonb_array_length(p)
$$;

CREATE OR REPLACE FUNCTION platform.booking_price_tier_valid(p_amount bigint) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT p_amount=ANY(ARRAY[0,500,1000,2000,3000,5000,8000,10000,15000,20000,30000,50000]::bigint[])
$$;

CREATE OR REPLACE FUNCTION platform.booking_member(p_actor uuid, p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM platform.workspace_members m JOIN platform.workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
  JOIN identity.principals p ON p.principal_id=m.principal_id AND p.status='active' AND p.principal_kind='human'
  WHERE m.workspace_id=p_workspace AND m.principal_id=p_actor AND m.status='active' AND m.member_role IN ('owner','admin','member'))
$$;

CREATE OR REPLACE FUNCTION platform.booking_calendar_connection(p_host uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT c.connection_id FROM platform.booking_hosts h JOIN platform.connections c ON c.workspace_id=h.workspace_id AND c.owner_human_principal_id=h.principal_id
  AND c.client_ref='flapbase:booking' AND c.resource='provider:google_calendar' AND c.status='active' AND c.expires_at>now() AND c.credential_ref IS NOT NULL
 WHERE h.host_id=p_host LIMIT 1
$$;

CREATE OR REPLACE FUNCTION platform.booking_slot_allowed(h platform.booking_hosts, r platform.booking_offer_revisions, p_start timestamptz, p_check_horizon boolean) RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path TO '' AS $$
DECLARE local_ts timestamp:=p_start AT TIME ZONE h.time_zone; day date:=local_ts::date; hours jsonb; w jsonb; ws timestamptz; we timestamptz;
BEGIN
 IF p_start<now()+make_interval(mins=>r.min_notice_minutes) THEN RETURN false; END IF;
 IF p_check_horizon AND p_start>now()+make_interval(days=>r.horizon_days) THEN RETURN false; END IF;
 SELECT e->'hours' INTO hours FROM jsonb_array_elements(h.exceptions) e WHERE e->>'date'=day::text LIMIT 1;
 IF hours IS NULL THEN hours:=coalesce(coalesce(r.weekly_hours,h.weekly_hours)->(extract(isodow FROM local_ts)::integer::text),'[]'); END IF;
 FOR w IN SELECT * FROM jsonb_array_elements(hours) LOOP
  ws:=(day+(w->>0)::time) AT TIME ZONE h.time_zone;
  we:=CASE WHEN w->>1='24:00' THEN (day+1)::timestamp AT TIME ZONE h.time_zone ELSE (day+(w->>1)::time) AT TIME ZONE h.time_zone END;
  IF p_start>=ws AND p_start+make_interval(mins=>r.duration_minutes)<=we
   AND (extract(epoch FROM p_start-ws)::bigint % (r.start_step_minutes*60))=0 THEN RETURN true; END IF;
 END LOOP;
 RETURN false;
END $$;

CREATE OR REPLACE FUNCTION platform.booking_overlaps(p_host uuid, p_start timestamptz, p_end timestamptz, p_self uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.bookings b WHERE b.host_id=p_host AND b.booking_id IS DISTINCT FROM p_self
  AND (b.status='confirmed' OR (b.status='held' AND b.hold_expires_at>now()))
  AND tstzrange(b.block_start,b.block_end,'[)') && tstzrange(p_start,p_end,'[)'))
$$;

CREATE OR REPLACE FUNCTION platform.booking_host_save(p_actor uuid, p_workspace uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE id uuid; tz text:=coalesce(p->>'timeZone','Asia/Tokyo'); hours jsonb:=coalesce(p->'weeklyHours','{}'); ex jsonb:=coalesce(p->'exceptions','[]');
BEGIN
 IF NOT platform.booking_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_catalog.pg_timezone_names z WHERE z.name=tz) OR NOT platform.booking_hours_valid(hours) OR NOT platform.booking_exceptions_valid(ex)
  OR length(btrim(coalesce(p->>'displayName','')))NOT BETWEEN 1 AND 80 OR coalesce(p->>'productKey','flapbase') !~ '^[a-z][a-z0-9-]{1,30}$'
  OR coalesce(p->>'calendarCheck','required') NOT IN ('required','best_effort') OR coalesce(p->>'status','active') NOT IN ('active','paused')
  THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO platform.booking_hosts(workspace_id,principal_id,product_key,display_name,time_zone,weekly_hours,exceptions,calendar_check,all_day_busy,status)
 VALUES(p_workspace,p_actor,coalesce(p->>'productKey','flapbase'),btrim(p->>'displayName'),tz,hours,ex,coalesce(p->>'calendarCheck','required'),
  coalesce((p->>'allDayBusy')::boolean,true),coalesce(p->>'status','active'))
 ON CONFLICT(workspace_id,principal_id) DO UPDATE SET display_name=EXCLUDED.display_name,time_zone=EXCLUDED.time_zone,weekly_hours=EXCLUDED.weekly_hours,
  exceptions=EXCLUDED.exceptions,calendar_check=EXCLUDED.calendar_check,all_day_busy=EXCLUDED.all_day_busy,status=EXCLUDED.status,updated_at=clock_timestamp()
 RETURNING host_id INTO id;
 RETURN jsonb_build_object('hostId',id);
END $$;

CREATE OR REPLACE FUNCTION platform.booking_offer_save(p_actor uuid, p_workspace uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE host platform.booking_hosts; o platform.booking_offers; cur platform.booking_offer_revisions; nr platform.booking_offer_revisions; id uuid:=(p->>'offerId')::uuid;
 key text:=p->>'idempotencyKey'; created boolean:=false;
BEGIN
 IF NOT platform.booking_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF key IS NULL OR length(key) NOT BETWEEN 1 AND 200 OR length(btrim(coalesce(p->>'title',''))) NOT BETWEEN 1 AND 120 OR length(coalesce(p->>'description',''))>2000
  OR coalesce(p->>'status','draft') NOT IN ('draft','active','archived') OR (p ? 'priceAmount' AND NOT platform.booking_price_tier_valid((p->>'priceAmount')::bigint))
  OR (p->'weeklyHours' IS NOT NULL AND jsonb_typeof(p->'weeklyHours')<>'null' AND NOT platform.booking_hours_valid(p->'weeklyHours'))
  THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO host FROM platform.booking_hosts WHERE workspace_id=p_workspace AND principal_id=p_actor;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_HOST_REQUIRED' USING ERRCODE='22023'; END IF;
 IF id IS NULL THEN
  SELECT * INTO o FROM platform.booking_offers WHERE workspace_id=p_workspace AND idempotency_key=key;
  IF NOT FOUND THEN
   INSERT INTO platform.booking_offers(workspace_id,host_id,title,description,status,revision,idempotency_key,created_by)
   VALUES(p_workspace,host.host_id,btrim(p->>'title'),coalesce(p->>'description',''),coalesce(p->>'status','draft'),1,key,p_actor) RETURNING * INTO o;
   created:=true;
  END IF;
 ELSE
  SELECT * INTO o FROM platform.booking_offers WHERE offer_id=id AND workspace_id=p_workspace FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
  UPDATE platform.booking_offers SET title=btrim(p->>'title'),description=coalesce(p->>'description',''),status=coalesce(p->>'status',o.status),updated_at=clock_timestamp()
   WHERE offer_id=o.offer_id RETURNING * INTO o;
 END IF;
 SELECT * INTO cur FROM platform.booking_offer_revisions WHERE offer_id=o.offer_id AND revision=o.revision;
 nr.offer_id:=o.offer_id; nr.created_by:=p_actor; nr.currency:='JPY';
 nr.duration_minutes:=coalesce((p->>'durationMinutes')::integer,cur.duration_minutes,30);
 nr.start_step_minutes:=coalesce((p->>'startStepMinutes')::integer,cur.start_step_minutes,30);
 nr.buffer_before_minutes:=coalesce((p->>'bufferBeforeMinutes')::integer,cur.buffer_before_minutes,0);
 nr.buffer_after_minutes:=coalesce((p->>'bufferAfterMinutes')::integer,cur.buffer_after_minutes,0);
 nr.min_notice_minutes:=coalesce((p->>'minNoticeMinutes')::integer,cur.min_notice_minutes,180);
 nr.horizon_days:=coalesce((p->>'horizonDays')::integer,cur.horizon_days,30);
 nr.price_amount:=coalesce((p->>'priceAmount')::bigint,cur.price_amount,0);
 nr.cancel_deadline_minutes:=coalesce((p->>'cancelDeadlineMinutes')::integer,cur.cancel_deadline_minutes,1440);
 nr.late_cancel_refund_percent:=coalesce((p->>'lateCancelRefundPercent')::integer,cur.late_cancel_refund_percent,0);
 nr.allow_reschedule:=coalesce((p->>'allowReschedule')::boolean,cur.allow_reschedule,true);
 nr.max_reschedules:=coalesce((p->>'maxReschedules')::integer,cur.max_reschedules,2);
 nr.first_time_free:=coalesce((p->>'firstTimeFree')::boolean,cur.first_time_free,false);
 nr.meeting_kind:=coalesce(p->>'meetingKind',cur.meeting_kind,'google_meet');
 nr.meeting_url:=CASE WHEN nr.meeting_kind='custom_url' THEN coalesce(p->>'meetingUrl',cur.meeting_url) END;
 nr.send_calendar_invite:=coalesce((p->>'sendCalendarInvite')::boolean,cur.send_calendar_invite,true);
 nr.repeat_allowed:=coalesce((p->>'repeatAllowed')::boolean,cur.repeat_allowed,false);
 nr.repeat_max_count:=coalesce((p->>'repeatMaxCount')::integer,cur.repeat_max_count,12);
 nr.capacity:=coalesce((p->>'capacity')::integer,cur.capacity,1);
 nr.page_private:=coalesce((p->>'pagePrivate')::boolean,cur.page_private,true);
 nr.weekly_hours:=CASE WHEN p ? 'weeklyHours' THEN nullif(p->'weeklyHours','null'::jsonb) ELSE cur.weekly_hours END;
 IF cur.offer_id IS NULL OR (nr.duration_minutes,nr.start_step_minutes,nr.buffer_before_minutes,nr.buffer_after_minutes,nr.min_notice_minutes,nr.horizon_days,nr.price_amount,
   nr.cancel_deadline_minutes,nr.late_cancel_refund_percent,nr.allow_reschedule,nr.max_reschedules,nr.first_time_free,nr.meeting_kind,nr.meeting_url,nr.send_calendar_invite,
   nr.repeat_allowed,nr.repeat_max_count,nr.capacity,nr.page_private,nr.weekly_hours::text)
  IS DISTINCT FROM (cur.duration_minutes,cur.start_step_minutes,cur.buffer_before_minutes,cur.buffer_after_minutes,cur.min_notice_minutes,cur.horizon_days,cur.price_amount,
   cur.cancel_deadline_minutes,cur.late_cancel_refund_percent,cur.allow_reschedule,cur.max_reschedules,cur.first_time_free,cur.meeting_kind,cur.meeting_url,cur.send_calendar_invite,
   cur.repeat_allowed,cur.repeat_max_count,cur.capacity,cur.page_private,cur.weekly_hours::text) THEN
  nr.revision:=CASE WHEN cur.offer_id IS NULL THEN 1 ELSE o.revision+1 END;
  BEGIN
   INSERT INTO platform.booking_offer_revisions(offer_id,revision,duration_minutes,start_step_minutes,buffer_before_minutes,buffer_after_minutes,min_notice_minutes,horizon_days,
    price_amount,currency,cancel_deadline_minutes,late_cancel_refund_percent,allow_reschedule,max_reschedules,first_time_free,meeting_kind,meeting_url,send_calendar_invite,
    repeat_allowed,repeat_max_count,capacity,page_private,weekly_hours,created_by)
   VALUES(nr.offer_id,nr.revision,nr.duration_minutes,nr.start_step_minutes,nr.buffer_before_minutes,nr.buffer_after_minutes,nr.min_notice_minutes,nr.horizon_days,
    nr.price_amount,nr.currency,nr.cancel_deadline_minutes,nr.late_cancel_refund_percent,nr.allow_reschedule,nr.max_reschedules,nr.first_time_free,nr.meeting_kind,nr.meeting_url,
    nr.send_calendar_invite,nr.repeat_allowed,nr.repeat_max_count,nr.capacity,nr.page_private,nr.weekly_hours,nr.created_by);
  EXCEPTION WHEN check_violation THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END;
  UPDATE platform.booking_offers SET revision=nr.revision,updated_at=clock_timestamp() WHERE offer_id=o.offer_id;
  RETURN jsonb_build_object('offerId',o.offer_id,'revision',nr.revision,'created',created);
 END IF;
 RETURN jsonb_build_object('offerId',o.offer_id,'revision',o.revision,'created',created);
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION platform.booking_paid_ready(h platform.booking_hosts) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT h.payment_account_state='ready' AND h.payment_review_state='approved' AND h.payment_account_ref IS NOT NULL
$$;

CREATE OR REPLACE FUNCTION platform.booking_offer_json(o platform.booking_offers, r platform.booking_offer_revisions) RETURNS jsonb
LANGUAGE sql STABLE SET search_path TO '' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',o.offer_id,'title',o.title,'description',o.description,'status',o.status,'revision',r.revision,
  'durationMinutes',r.duration_minutes,'startStepMinutes',r.start_step_minutes,'bufferBeforeMinutes',r.buffer_before_minutes,'bufferAfterMinutes',r.buffer_after_minutes,
  'minNoticeMinutes',r.min_notice_minutes,'horizonDays',r.horizon_days,'priceAmount',r.price_amount,'currency',r.currency,'cancelDeadlineMinutes',r.cancel_deadline_minutes,
  'lateCancelRefundPercent',r.late_cancel_refund_percent,'allowReschedule',r.allow_reschedule,'maxReschedules',r.max_reschedules,'firstTimeFree',r.first_time_free,
  'meetingKind',r.meeting_kind,'sendCalendarInvite',r.send_calendar_invite,'repeatAllowed',r.repeat_allowed,'repeatMaxCount',r.repeat_max_count,'capacity',r.capacity,'pagePrivate',r.page_private,'weeklyHours',r.weekly_hours))
$$;

CREATE OR REPLACE FUNCTION platform.booking_offer_public(p_offer uuid, p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE o platform.booking_offers; r platform.booking_offer_revisions; h platform.booking_hosts;
BEGIN
 SELECT * INTO o FROM platform.booking_offers WHERE offer_id=p_offer AND status='active';
 IF NOT FOUND OR p_to<=p_from OR p_to-p_from>interval '62 days' THEN RETURN NULL; END IF;
 SELECT * INTO h FROM platform.booking_hosts WHERE host_id=o.host_id AND status='active';
 IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM platform.workspaces w WHERE w.workspace_id=h.workspace_id AND w.status='active') THEN RETURN NULL; END IF;
 SELECT * INTO r FROM platform.booking_offer_revisions WHERE offer_id=o.offer_id AND revision=o.revision;
 RETURN jsonb_build_object('offer',platform.booking_offer_json(o,r),
  'host',jsonb_build_object('id',h.host_id,'displayName',h.display_name,'timeZone',h.time_zone,'weeklyHours',h.weekly_hours,'exceptions',h.exceptions,'productKey',h.product_key,
   'paymentReady',platform.booking_paid_ready(h)),
  'calendar',jsonb_strip_nulls(jsonb_build_object('workspaceId',h.workspace_id,'connectionId',platform.booking_calendar_connection(h.host_id),'calendarId',h.calendar_id,
  'check',h.calendar_check,'allDayBusy',h.all_day_busy,'state',h.calendar_state)),
  'occupied',coalesce((SELECT jsonb_agg(jsonb_build_array(b.block_start,b.block_end) ORDER BY b.block_start) FROM platform.bookings b
   WHERE b.host_id=h.host_id AND (b.status='confirmed' OR (b.status='held' AND b.hold_expires_at>now()))
   AND (b.offer_id<>o.offer_id OR (SELECT count(*) FROM platform.bookings same WHERE same.host_id=b.host_id AND same.offer_id=b.offer_id AND same.starts_at=b.starts_at
     AND (same.status='confirmed' OR (same.status='held' AND same.hold_expires_at>now())))>=r.capacity)
   AND b.block_end>p_from AND b.block_start<p_to),'[]'));
END $$;

CREATE OR REPLACE FUNCTION platform.booking_json(b platform.bookings, p_for_host boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',b.booking_id,'workspaceId',b.workspace_id,'offerId',b.offer_id,'offerRevision',b.offer_revision,'offerTitle',o.title,'hostName',h.display_name,
  'timeZone',h.time_zone,'status',b.status,'startsAt',b.starts_at,'endsAt',b.ends_at,'holdExpiresAt',b.hold_expires_at,'amount',b.amount,'currency',b.currency,
  'paymentState',b.payment_state,'paidAmount',nullif(b.paid_amount,0),'refundAmount',nullif(b.refund_amount,0),'seriesId',b.series_id,'occurrence',CASE WHEN b.series_id IS NOT NULL THEN b.occurrence END,
  'meetUrl',CASE WHEN b.status='confirmed' THEN coalesce(b.meet_url,r.meeting_url) END,'calendarState',CASE WHEN p_for_host THEN b.calendar_state END,
  'calendarEventLink',CASE WHEN p_for_host THEN b.calendar_event_link END,'outcome',b.outcome,'cancelledBy',b.cancelled_by,'disputeState',CASE WHEN p_for_host THEN b.dispute_state END,'disputeDueBy',CASE WHEN p_for_host THEN b.dispute_due_by END,'rescheduleCount',b.reschedule_count,
  'cancelDeadline',b.starts_at-make_interval(mins=>r.cancel_deadline_minutes),'lateCancelRefundPercent',r.late_cancel_refund_percent,
  'canReschedule',r.allow_reschedule AND b.reschedule_count<r.max_reschedules,
  'customerEmail',CASE WHEN p_for_host THEN (SELECT c.email FROM identity.principals c WHERE c.principal_id=b.customer_principal_id) END,
  'customerName',CASE WHEN p_for_host THEN (SELECT c.display_name FROM identity.principals c WHERE c.principal_id=b.customer_principal_id) END))
 FROM platform.booking_offers o, platform.booking_hosts h, platform.booking_offer_revisions r
 WHERE o.offer_id=b.offer_id AND h.host_id=b.host_id AND r.offer_id=b.offer_id AND r.revision=b.offer_revision
$$;

CREATE OR REPLACE FUNCTION platform.my_bookings(p_customer uuid, p_include_past boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(jsonb_agg(platform.booking_json(b,false) ORDER BY b.starts_at),'[]') FROM (SELECT * FROM platform.bookings x
  WHERE x.customer_principal_id=p_customer AND x.status IN ('held','confirmed','cancelled') AND (p_include_past OR x.ends_at>now()-interval '1 day')
  ORDER BY x.starts_at DESC LIMIT 200) b
$$;

CREATE OR REPLACE FUNCTION platform.my_booking(p_customer uuid, p_booking uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT platform.booking_json(b,false) FROM platform.bookings b WHERE b.booking_id=p_booking AND b.customer_principal_id=p_customer
$$;

CREATE OR REPLACE FUNCTION platform.booking_host_view(p_actor uuid, p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE h platform.booking_hosts;
BEGIN
 IF NOT platform.booking_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM platform.booking_hosts WHERE workspace_id=p_workspace AND principal_id=p_actor;
 IF NOT FOUND THEN RETURN jsonb_build_object('host',NULL,'offers','[]'::jsonb); END IF;
 RETURN jsonb_build_object('host',jsonb_strip_nulls(jsonb_build_object('id',h.host_id,'productKey',h.product_key,'displayName',h.display_name,'timeZone',h.time_zone,
   'weeklyHours',h.weekly_hours,'exceptions',h.exceptions,'calendarCheck',h.calendar_check,'allDayBusy',h.all_day_busy,'status',h.status,
   'calendarConnected',platform.booking_calendar_connection(h.host_id) IS NOT NULL,'calendarState',h.calendar_state,'calendarId',h.calendar_id,
   'paymentAccountState',h.payment_account_state,'paymentAccountSource',h.payment_account_source,'paymentReviewState',h.payment_review_state,
   'paidReady',platform.booking_paid_ready(h))),
  'offers',coalesce((SELECT jsonb_agg(platform.booking_offer_json(o,r) ORDER BY o.created_at) FROM platform.booking_offers o
   JOIN platform.booking_offer_revisions r ON r.offer_id=o.offer_id AND r.revision=o.revision WHERE o.host_id=h.host_id AND o.status<>'archived'),'[]'));
END $$;

CREATE OR REPLACE FUNCTION platform.booking_list(p_actor uuid, p_workspace uuid, p_from timestamptz, p_to timestamptz) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.booking_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_to<=p_from OR p_to-p_from>interval '93 days' THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 RETURN coalesce((SELECT jsonb_agg(platform.booking_json(b,true) ORDER BY b.starts_at) FROM platform.bookings b
  WHERE b.workspace_id=p_workspace AND b.status IN ('held','confirmed','cancelled') AND b.starts_at<p_to AND b.ends_at>p_from),'[]');
END $$;

CREATE OR REPLACE FUNCTION platform.booking_after_confirm(p_booking uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b platform.bookings; r platform.booking_offer_revisions;
BEGIN
 SELECT * INTO b FROM platform.bookings WHERE booking_id=p_booking;
 SELECT * INTO r FROM platform.booking_offer_revisions WHERE offer_id=b.offer_id AND revision=b.offer_revision;
 IF platform.booking_calendar_connection(b.host_id) IS NOT NULL THEN
  UPDATE platform.bookings SET calendar_state='pending',calendar_attempts=0,updated_at=clock_timestamp() WHERE booking_id=b.booking_id;
 END IF;
 INSERT INTO platform.booking_notices(workspace_id,booking_id,kind,recipient,dedupe_key)
 SELECT b.workspace_id,b.booking_id,'booking.confirmed',who,'booking-confirmed:'||b.booking_id::text||':'||who FROM unnest(ARRAY['customer','host']) who
 ON CONFLICT(dedupe_key) DO NOTHING;
 PERFORM platform.booking_schedule_reminders(b.booking_id);
END $$;

CREATE OR REPLACE FUNCTION platform.booking_schedule_reminders(p_booking uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b platform.bookings; stamp text;
BEGIN
 SELECT * INTO b FROM platform.bookings WHERE booking_id=p_booking;
 stamp:=extract(epoch FROM b.starts_at)::bigint::text;
 UPDATE platform.booking_notices SET state='cancelled' WHERE booking_id=b.booking_id AND kind='booking.reminder' AND state='pending' AND dedupe_key NOT LIKE '%:'||stamp;
 IF b.status<>'confirmed' THEN RETURN; END IF;
 INSERT INTO platform.booking_notices(workspace_id,booking_id,kind,recipient,due_at,dedupe_key)
 SELECT b.workspace_id,b.booking_id,'booking.reminder','customer',b.starts_at-lead,'booking-reminder:'||b.booking_id::text||':'||extract(epoch FROM lead)::bigint::text||':'||stamp
 FROM unnest(ARRAY[interval '24 hours',interval '1 hour']) lead WHERE b.starts_at-lead>now()
 ON CONFLICT(dedupe_key) DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION platform.booking_hold(p_customer uuid, p_offer uuid, p jsonb, p_fee_bps integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE o platform.booking_offers; r platform.booking_offer_revisions; h platform.booking_hosts; key text:=p->>'idempotencyKey'; first_start timestamptz;
 n integer:=1; every integer:=1; k integer; s timestamptz; series uuid; id uuid; amt bigint; free_first boolean; out jsonb:='[]'; existing jsonb; hold timestamptz;
BEGIN
 IF p ? 'repeat' THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT EXISTS(SELECT 1 FROM identity.principals c WHERE c.principal_id=p_customer AND c.principal_kind='human' AND c.status='active' AND c.email IS NOT NULL)
  THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF key IS NULL OR length(key) NOT BETWEEN 1 AND 200 OR p_fee_bps NOT BETWEEN 0 AND 5000 THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 first_start:=(p->>'startsAt')::timestamptz;
 IF p ? 'repeat' THEN n:=(p->'repeat'->>'count')::integer; every:=coalesce((p->'repeat'->>'intervalWeeks')::integer,1); END IF;
 SELECT * INTO o FROM platform.booking_offers WHERE offer_id=p_offer AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT * INTO h FROM platform.booking_hosts WHERE host_id=o.host_id AND status='active';
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('booking-host:'||h.host_id::text,0));
 SELECT jsonb_agg(jsonb_build_object('id',b.booking_id,'status',b.status,'startsAt',b.starts_at,'amount',b.amount) ORDER BY b.occurrence) INTO existing
  FROM platform.bookings b WHERE b.customer_principal_id=p_customer AND b.idempotency_key=key;
 IF existing IS NOT NULL THEN
  RETURN jsonb_build_object('bookings',existing,'bookingId',existing->0->>'id','created',false,
   'paymentRequired',(existing->0->>'status')='held' AND (existing->0->>'amount')::bigint>0);
 END IF;
 SELECT * INTO r FROM platform.booking_offer_revisions WHERE offer_id=o.offer_id AND revision=o.revision;
 IF n IS NULL OR n<1 OR every NOT IN (1,2) OR (n>1 AND (NOT r.repeat_allowed OR n>r.repeat_max_count)) THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF r.price_amount>0 AND NOT platform.booking_paid_ready(h) THEN RAISE EXCEPTION 'BOOKING_PAYMENT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 free_first:=r.first_time_free AND NOT EXISTS(SELECT 1 FROM platform.bookings b WHERE b.host_id=h.host_id AND b.customer_principal_id=p_customer
  AND (b.status='confirmed' OR (b.status='cancelled' AND b.cancelled_by='customer') OR (b.status='held' AND b.hold_expires_at>now())));
 IF n>1 THEN
  INSERT INTO platform.booking_series(workspace_id,offer_id,customer_principal_id,interval_weeks,occurrence_count) VALUES(h.workspace_id,o.offer_id,p_customer,every,n) RETURNING series_id INTO series;
 END IF;
 FOR k IN 1..n LOOP
  -- 提供者の地域の壁時計で同じ曜日・同じ時刻（夏時間の地域でもずれない）。
  s:=((first_start AT TIME ZONE h.time_zone)+make_interval(days=>7*every*(k-1))) AT TIME ZONE h.time_zone;
  IF NOT platform.booking_slot_allowed(h,r,s,k=1) THEN RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
  -- 同じ Offer・同じ開始時刻だけは版の定員まで同席できる。別の Offer や時刻がずれる予約は、従来どおり提供者の時間を占有する。
  IF EXISTS(SELECT 1 FROM platform.bookings b WHERE b.host_id=h.host_id AND (b.status='confirmed' OR (b.status='held' AND b.hold_expires_at>now()))
    AND b.block_start<s+make_interval(mins=>r.duration_minutes+r.buffer_after_minutes) AND b.block_end>s-make_interval(mins=>r.buffer_before_minutes)
    AND NOT (b.offer_id=o.offer_id AND b.starts_at=s))
   OR (SELECT count(*) FROM platform.bookings b WHERE b.host_id=h.host_id AND b.offer_id=o.offer_id AND b.starts_at=s
    AND (b.status='confirmed' OR (b.status='held' AND b.hold_expires_at>now())))>=r.capacity
   THEN RAISE EXCEPTION 'BOOKING_SLOT_TAKEN' USING ERRCODE='40001'; END IF;
  amt:=CASE WHEN k=1 AND free_first THEN 0 ELSE r.price_amount END;
  hold:=CASE WHEN amt=0 THEN NULL WHEN k=1 THEN clock_timestamp()+interval '30 minutes' ELSE s-interval '3 days' END;
  INSERT INTO platform.bookings(workspace_id,host_id,offer_id,offer_revision,customer_principal_id,series_id,occurrence,status,starts_at,ends_at,block_start,block_end,
   hold_expires_at,amount,fee_bps,payment_state,idempotency_key,confirmed_at)
  VALUES(h.workspace_id,h.host_id,o.offer_id,r.revision,p_customer,series,k,CASE WHEN amt=0 THEN 'confirmed' ELSE 'held' END,s,s+make_interval(mins=>r.duration_minutes),
   s-make_interval(mins=>r.buffer_before_minutes),s+make_interval(mins=>r.duration_minutes+r.buffer_after_minutes),hold,amt,CASE WHEN amt=0 THEN 0 ELSE p_fee_bps END,
   CASE WHEN amt=0 THEN 'none' ELSE 'pending' END,key,CASE WHEN amt=0 THEN clock_timestamp() END)
  RETURNING booking_id INTO id;
  INSERT INTO platform.booking_changes(booking_id,workspace_id,kind,actor_kind,actor_principal_id,detail)
   VALUES(id,h.workspace_id,CASE WHEN amt=0 THEN 'confirmed' ELSE 'held' END,'customer',p_customer,jsonb_build_object('startsAt',s,'amount',amt));
  IF amt=0 THEN PERFORM platform.booking_after_confirm(id);
  ELSIF k>1 THEN
   INSERT INTO platform.booking_notices(workspace_id,booking_id,kind,recipient,due_at,dedupe_key)
    VALUES(h.workspace_id,id,'booking.payment_due','customer',greatest(clock_timestamp(),s-interval '7 days'),'booking-payment-due:'||id::text) ON CONFLICT(dedupe_key) DO NOTHING;
  END IF;
  out:=out||jsonb_build_object('id',id,'status',CASE WHEN amt=0 THEN 'confirmed' ELSE 'held' END,'startsAt',s,'amount',amt);
 END LOOP;
 RETURN jsonb_strip_nulls(jsonb_build_object('bookings',out,'bookingId',out->0->>'id','seriesId',series,'created',true,'workspaceId',h.workspace_id,
  'paymentRequired',(out->0->>'status')='held'));
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR numeric_value_out_of_range
 THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION platform.booking_cancel(p_actor uuid, p_booking uuid, p_by text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b platform.bookings; r platform.booking_offer_revisions; refund bigint:=0;
BEGIN
 SELECT * INTO b FROM platform.bookings WHERE booking_id=p_booking FOR UPDATE;
 IF NOT FOUND OR (p_by='customer' AND b.customer_principal_id<>p_actor) OR (p_by='host' AND NOT platform.booking_member(p_actor,b.workspace_id)) OR p_by NOT IN ('customer','host')
  THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF b.status='cancelled' THEN RETURN jsonb_build_object('bookingId',b.booking_id,'cancelled',false,'refundAmount',b.refund_amount,'workspaceId',b.workspace_id); END IF;
 IF b.status NOT IN ('held','confirmed') OR (p_by='customer' AND b.starts_at<=now()) OR (p_by='host' AND b.ends_at<=now()) THEN RAISE EXCEPTION 'BOOKING_STATE_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO r FROM platform.booking_offer_revisions WHERE offer_id=b.offer_id AND revision=b.offer_revision;
 IF b.payment_state='paid' THEN
  refund:=CASE WHEN p_by='host' OR now()<b.starts_at-make_interval(mins=>r.cancel_deadline_minutes) THEN b.paid_amount
   ELSE (b.paid_amount*r.late_cancel_refund_percent)/100 END;
 END IF;
 -- Timenode の手数料は、返す代金と同じ割合で戻す（refund_application_fee）。提供者の都合・期限の前の取消しは全額を返すので手数料も全額が戻り、
 -- 期限のあとの取消しは、提供者が受け取る取消し料の分だけ手数料が残る（案。Owner が決める）。
 UPDATE platform.bookings SET status='cancelled',cancelled_by=p_by,cancelled_at=clock_timestamp(),hold_expires_at=NULL,refund_amount=refund,refund_fee=true,
  payment_state=CASE WHEN refund>0 THEN 'refund_pending' ELSE payment_state END,
  calendar_state=CASE WHEN calendar_state IN ('synced','pending','failed') THEN 'delete_pending' ELSE calendar_state END,calendar_attempts=0,updated_at=clock_timestamp()
  WHERE booking_id=b.booking_id;
 INSERT INTO platform.booking_changes(booking_id,workspace_id,kind,actor_kind,actor_principal_id,detail)
  VALUES(b.booking_id,b.workspace_id,'cancelled',p_by,p_actor,jsonb_build_object('refundAmount',refund));
 UPDATE platform.booking_notices SET state='cancelled' WHERE booking_id=b.booking_id AND state='pending' AND kind IN ('booking.reminder','booking.payment_due');
 IF b.status='confirmed' THEN
  INSERT INTO platform.booking_notices(workspace_id,booking_id,kind,recipient,dedupe_key)
  SELECT b.workspace_id,b.booking_id,'booking.cancelled',who,'booking-cancelled:'||b.booking_id::text||':'||who FROM unnest(ARRAY['customer','host']) who ON CONFLICT(dedupe_key) DO NOTHING;
 END IF;
 RETURN jsonb_build_object('bookingId',b.booking_id,'cancelled',true,'refundAmount',refund,'workspaceId',b.workspace_id,'checkoutRef',b.checkout_ref);
END $$;

CREATE OR REPLACE FUNCTION platform.booking_reschedule(p_actor uuid, p_booking uuid, p_by text, p_start timestamptz) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b platform.bookings; r platform.booking_offer_revisions; h platform.booking_hosts;
BEGIN
 SELECT host_id INTO b.host_id FROM platform.bookings WHERE booking_id=p_booking;
 IF NOT FOUND THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('booking-host:'||b.host_id::text,0));
 SELECT * INTO b FROM platform.bookings WHERE booking_id=p_booking FOR UPDATE;
 IF (p_by='customer' AND b.customer_principal_id<>p_actor) OR (p_by='host' AND NOT platform.booking_member(p_actor,b.workspace_id)) OR p_by NOT IN ('customer','host')
  THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT * INTO r FROM platform.booking_offer_revisions WHERE offer_id=b.offer_id AND revision=b.offer_revision;
 SELECT * INTO h FROM platform.booking_hosts WHERE host_id=b.host_id;
 IF b.starts_at=p_start AND b.status='confirmed' THEN RETURN jsonb_build_object('bookingId',b.booking_id,'moved',false,'workspaceId',b.workspace_id); END IF;
 IF b.status<>'confirmed' OR (p_by='host' AND b.ends_at<=now())
  OR (p_by='customer' AND (NOT r.allow_reschedule OR b.reschedule_count>=r.max_reschedules OR now()>=b.starts_at-make_interval(mins=>r.cancel_deadline_minutes)))
  THEN RAISE EXCEPTION 'BOOKING_STATE_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT platform.booking_slot_allowed(h,r,p_start,b.series_id IS NULL OR b.occurrence=1) THEN RAISE EXCEPTION 'BOOKING_SLOT_UNAVAILABLE' USING ERRCODE='22023'; END IF;
 IF platform.booking_overlaps(b.host_id,p_start-make_interval(mins=>r.buffer_before_minutes),p_start+make_interval(mins=>r.duration_minutes+r.buffer_after_minutes),b.booking_id)
  THEN RAISE EXCEPTION 'BOOKING_SLOT_TAKEN' USING ERRCODE='40001'; END IF;
 UPDATE platform.bookings SET starts_at=p_start,ends_at=p_start+make_interval(mins=>r.duration_minutes),block_start=p_start-make_interval(mins=>r.buffer_before_minutes),
  block_end=p_start+make_interval(mins=>r.duration_minutes+r.buffer_after_minutes),reschedule_count=reschedule_count+CASE WHEN p_by='customer' THEN 1 ELSE 0 END,
  calendar_state=CASE WHEN calendar_state IN ('synced','failed','pending') THEN 'pending' ELSE calendar_state END,calendar_attempts=0,updated_at=clock_timestamp()
  WHERE booking_id=b.booking_id;
 INSERT INTO platform.booking_changes(booking_id,workspace_id,kind,actor_kind,actor_principal_id,detail)
  VALUES(b.booking_id,b.workspace_id,'rescheduled',p_by,p_actor,jsonb_build_object('from',b.starts_at,'to',p_start));
 INSERT INTO platform.booking_notices(workspace_id,booking_id,kind,recipient,dedupe_key)
 SELECT b.workspace_id,b.booking_id,'booking.rescheduled',who,'booking-rescheduled:'||b.booking_id::text||':'||extract(epoch FROM p_start)::bigint::text||':'||who
 FROM unnest(ARRAY['customer','host']) who ON CONFLICT(dedupe_key) DO NOTHING;
 PERFORM platform.booking_schedule_reminders(b.booking_id);
 RETURN jsonb_build_object('bookingId',b.booking_id,'moved',true,'startsAt',p_start,'workspaceId',b.workspace_id);
EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023';
END $$;

CREATE OR REPLACE FUNCTION platform.booking_set_outcome(p_actor uuid, p_booking uuid, p_outcome text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE b platform.bookings;
BEGIN
 SELECT * INTO b FROM platform.bookings WHERE booking_id=p_booking FOR UPDATE;
 IF NOT FOUND OR NOT platform.booking_member(p_actor,b.workspace_id) THEN RAISE EXCEPTION 'BOOKING_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF b.status<>'confirmed' OR b.starts_at>now() OR p_outcome NOT IN ('attended','no_show','host_issue') THEN RAISE EXCEPTION 'BOOKING_STATE_INVALID' USING ERRCODE='22023'; END IF;
 IF b.outcome IS NOT DISTINCT FROM p_outcome THEN RETURN jsonb_build_object('bookingId',b.booking_id,'outcome',p_outcome,'changed',false,'workspaceId',b.workspace_id); END IF;
 UPDATE platform.bookings SET outcome=p_outcome,updated_at=clock_timestamp() WHERE booking_id=b.booking_id;
 INSERT INTO platform.booking_changes(booking_id,workspace_id,kind,actor_kind,actor_principal_id,detail)
  VALUES(b.booking_id,b.workspace_id,'outcome','host',p_actor,jsonb_build_object('outcome',p_outcome));
 RETURN jsonb_build_object('bookingId',b.booking_id,'outcome',p_outcome,'changed',true,'workspaceId',b.workspace_id);
END $$;

CREATE OR REPLACE FUNCTION platform.booking_notice_claim(p_ids uuid[], p_limit integer)
RETURNS TABLE(notice_id uuid, kind text, recipient_kind text, recipient text, booking_id uuid, status text, starts_at timestamptz, ends_at timestamptz, time_zone text,
 offer_title text, host_name text, product_key text, meet_url text, amount bigint, refund_amount bigint, cancel_deadline timestamptz, hold_expires_at timestamptz, cancelled_by text,
 dispute_state text, dispute_due_by timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
BEGIN
 RETURN QUERY WITH picked AS (
  SELECT n.notice_id FROM platform.booking_notices n
  WHERE (n.state='pending' OR (n.state='sending' AND n.claimed_at<clock_timestamp()-interval '10 minutes')) AND n.due_at<=clock_timestamp()
   AND (p_ids IS NULL OR n.notice_id=ANY(p_ids))
  ORDER BY n.due_at LIMIT least(greatest(coalesce(p_limit,20),1),100) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE platform.booking_notices n SET state='sending',claimed_at=clock_timestamp(),attempts=n.attempts+1 FROM picked WHERE n.notice_id=picked.notice_id
  RETURNING n.*
 )
 SELECT c.notice_id,c.kind,c.recipient,CASE c.recipient WHEN 'customer' THEN cu.email ELSE ho.email END,b.booking_id,b.status,b.starts_at,b.ends_at,h.time_zone,
  o.title,h.display_name,h.product_key,coalesce(b.meet_url,r.meeting_url),b.amount,b.refund_amount,b.starts_at-make_interval(mins=>r.cancel_deadline_minutes),
  b.hold_expires_at,b.cancelled_by,b.dispute_state,b.dispute_due_by
 FROM claimed c JOIN platform.bookings b ON b.booking_id=c.booking_id JOIN platform.booking_hosts h ON h.host_id=b.host_id
 JOIN platform.booking_offers o ON o.offer_id=b.offer_id JOIN platform.booking_offer_revisions r ON r.offer_id=b.offer_id AND r.revision=b.offer_revision
 LEFT JOIN identity.principals cu ON cu.principal_id=b.customer_principal_id AND cu.status='active'
 LEFT JOIN identity.principals ho ON ho.principal_id=h.principal_id AND ho.status='active';
END $$;

CREATE OR REPLACE FUNCTION platform.booking_notice_finish(p_notice uuid, p_result text, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE n platform.booking_notices; next_state text;
BEGIN
 IF p_result NOT IN ('sent','held','retry') THEN RAISE EXCEPTION 'BOOKING_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO n FROM platform.booking_notices x WHERE x.notice_id=p_notice AND x.state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 next_state:=CASE WHEN p_result='retry' AND n.attempts>=5 THEN 'failed' WHEN p_result='retry' THEN 'pending' ELSE p_result END;
 UPDATE platform.booking_notices SET state=next_state,held_reason=CASE WHEN next_state='held' THEN coalesce(p_reason,'sender_unconfigured') END,
  sent_at=CASE WHEN next_state='sent' THEN clock_timestamp() END WHERE notice_id=p_notice;
 RETURN next_state;
END $$;

-- Booking-owned meeting projection. Project identity is captured at allocation, not at payment/calendar completion.
ALTER TABLE platform.booking_offers ADD COLUMN IF NOT EXISTS project_id uuid;
ALTER TABLE platform.bookings ADD COLUMN IF NOT EXISTS project_id uuid;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='platform.booking_offers'::regclass AND conname='booking_offers_project_fkey') THEN
  ALTER TABLE platform.booking_offers ADD CONSTRAINT booking_offers_project_fkey FOREIGN KEY(workspace_id,project_id) REFERENCES platform.projects(workspace_id,project_id);
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid='platform.bookings'::regclass AND conname='bookings_project_fkey') THEN
  ALTER TABLE platform.bookings ADD CONSTRAINT bookings_project_fkey FOREIGN KEY(workspace_id,project_id) REFERENCES platform.projects(workspace_id,project_id);
 END IF;
END $$;

CREATE OR REPLACE FUNCTION platform.booking_offer_project_set(p_actor uuid,p_workspace uuid,p_offer uuid,p_project uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.booking_member(p_actor,p_workspace) OR NOT EXISTS(
  SELECT 1 FROM platform.booking_offers o JOIN platform.booking_hosts h USING(host_id)
   WHERE o.offer_id=p_offer AND o.workspace_id=p_workspace AND h.principal_id=p_actor
 ) THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_project IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM platform.projects p WHERE p.project_id=p_project AND p.workspace_id=p_workspace AND p.status='active' AND p.visibility IN ('private','workspace')
   AND (p.created_by_principal_id=p_actor OR EXISTS(SELECT 1 FROM platform.project_memberships m WHERE m.project_id=p.project_id
    AND m.principal_id=p_actor AND m.status='active' AND m.member_role IN ('owner','editor')))
 ) THEN RAISE EXCEPTION 'BOOKING_FORBIDDEN' USING ERRCODE='42501'; END IF;
 UPDATE platform.booking_offers SET project_id=p_project WHERE offer_id=p_offer;
END $$;

CREATE OR REPLACE FUNCTION platform.booking_project_capture() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 SELECT project_id INTO NEW.project_id FROM platform.booking_offers WHERE offer_id=NEW.offer_id;
 RETURN NEW;
END $$;

CREATE OR REPLACE TRIGGER bookings_project_capture BEFORE INSERT ON platform.bookings
 FOR EACH ROW EXECUTE FUNCTION platform.booking_project_capture();

REVOKE ALL ON FUNCTION platform.booking_windows_valid(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_hours_valid(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_exceptions_valid(jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_price_tier_valid(bigint) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_member(uuid,uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_calendar_connection(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_slot_allowed(platform.booking_hosts,platform.booking_offer_revisions,timestamptz,boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_overlaps(uuid,timestamptz,timestamptz,uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_host_save(uuid,uuid,jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_offer_save(uuid,uuid,jsonb) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_paid_ready(platform.booking_hosts) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_offer_json(platform.booking_offers,platform.booking_offer_revisions) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_offer_public(uuid,timestamptz,timestamptz) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_json(platform.bookings,boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.my_bookings(uuid,boolean) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.my_booking(uuid,uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_host_view(uuid,uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_list(uuid,uuid,timestamptz,timestamptz) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_after_confirm(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_schedule_reminders(uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_hold(uuid,uuid,jsonb,integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_cancel(uuid,uuid,text) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_reschedule(uuid,uuid,text,timestamptz) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_set_outcome(uuid,uuid,text) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_notice_claim(uuid[],integer) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_notice_finish(uuid,text,text) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_offer_project_set(uuid,uuid,uuid,uuid) FROM PUBLIC;

REVOKE ALL ON FUNCTION platform.booking_project_capture() FROM PUBLIC;
