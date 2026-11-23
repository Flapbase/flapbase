-- Generated from the existing CRM, cases and customer portal SQL. Do not edit directly.

CREATE TABLE IF NOT EXISTS platform.workflows (
    workflow_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL,
    project_id uuid NOT NULL,
    name text NOT NULL CHECK (length(btrim(name)) > 0),
    goal text,
    shape text NOT NULL DEFAULT 'project' CHECK (shape IN ('project','operation')),
    owner_principal_id uuid REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
    is_default boolean NOT NULL DEFAULT false,
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','completed','archived')),
    transitions jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(transitions) = 'array'),
    definition_ref text CHECK (definition_ref IS NULL OR (length(btrim(definition_ref)) > 0 AND definition_ref <> 'latest')),
    period_start timestamptz,
    period_end timestamptz,
    version bigint NOT NULL DEFAULT 1 CHECK (version > 0),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT workflows_project_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES platform.projects(workspace_id, project_id) ON DELETE RESTRICT,
    CONSTRAINT workflows_project_identity UNIQUE (project_id, workflow_id),
    CHECK (period_end IS NULL OR period_start IS NULL OR period_end >= period_start)
);
CREATE UNIQUE INDEX IF NOT EXISTS workflows_default_per_project ON platform.workflows (project_id) WHERE is_default;

-- Shared Platform inbox and subscription metadata. Provider material lives in Credential Vault.
CREATE TABLE IF NOT EXISTS platform.notifications (
 notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 project_id uuid NOT NULL REFERENCES platform.projects(project_id) ON DELETE RESTRICT,
 recipient_principal_id uuid NOT NULL REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
 kind text NOT NULL CHECK(length(kind) BETWEEN 1 AND 100),
 title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200),
 body text NOT NULL CHECK(length(body) BETWEEN 1 AND 2000),
 action_label text NOT NULL CHECK(length(action_label) BETWEEN 1 AND 80),
 href text NOT NULL CHECK(length(href) BETWEEN 1 AND 1024 AND href LIKE '/%' AND href NOT LIKE '//%'),
 dedupe_key text NOT NULL CHECK(length(dedupe_key) BETWEEN 1 AND 256),
 created_at timestamptz NOT NULL DEFAULT now(),
 read_at timestamptz,
 UNIQUE(recipient_principal_id,project_id,dedupe_key),
 UNIQUE(notification_id,recipient_principal_id)
);
CREATE INDEX IF NOT EXISTS notifications_recipient_order ON platform.notifications(recipient_principal_id,created_at DESC,notification_id DESC);
CREATE TABLE IF NOT EXISTS platform.notification_subscriptions (
 subscription_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES identity.principals(principal_id) ON DELETE RESTRICT,
 transport text NOT NULL DEFAULT 'web_push' CHECK(transport IN ('web_push','apns','fcm')),
 fingerprint text NOT NULL UNIQUE CHECK(length(fingerprint)=64),
 credential_ref text NOT NULL CHECK(credential_ref LIKE 'vault:v1:%'),
 created_at timestamptz NOT NULL DEFAULT now(),
 revoked_at timestamptz
);
REVOKE ALL ON platform.notifications,platform.notification_subscriptions FROM PUBLIC;
COMMENT ON TABLE platform.notifications IS 'Shared Human inbox; server checks active Principal, Workspace and Project authority on creation, read and delivery.';
COMMENT ON TABLE platform.notification_subscriptions IS 'Shared transport consent metadata only. No endpoint, auth key or native token; Credential Vault owns provider material.';

CREATE TABLE IF NOT EXISTS runtime.runs (
    run_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id) ON DELETE RESTRICT, actor_ref text NOT NULL,
    workflow_ref text NOT NULL, status text NOT NULL DEFAULT 'queued', input_digest text, output_digest text,
    started_at timestamptz, finished_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
    project_id uuid,
    workflow_id uuid,
    CONSTRAINT runs_project_identity UNIQUE (project_id, run_id),
    CONSTRAINT runs_project_workspace_fkey FOREIGN KEY (workspace_id, project_id) REFERENCES platform.projects(workspace_id, project_id) ON DELETE RESTRICT,
    CONSTRAINT runs_workflow_project_fkey FOREIGN KEY (project_id, workflow_id) REFERENCES platform.workflows(project_id, workflow_id) ON DELETE RESTRICT,
    CONSTRAINT runs_workflow_requires_project CHECK (workflow_id IS NULL OR project_id IS NOT NULL),
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb, updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(metadata) = 'object' AND octet_length(metadata::text) <= 65536),
    CHECK (status IN ('queued','running','waiting','succeeded','failed','cancelled','reconciling')), CHECK (length(btrim(workflow_ref)) > 0),
    CHECK (length(btrim(actor_ref)) > 0), CHECK (finished_at IS NULL OR started_at IS NULL OR finished_at >= started_at)
);

CREATE TABLE IF NOT EXISTS runtime.receipts (
    receipt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid REFERENCES runtime.runs(run_id) ON DELETE RESTRICT,
    operation text NOT NULL, result text NOT NULL, evidence jsonb NOT NULL DEFAULT '{}'::jsonb, created_at timestamptz NOT NULL DEFAULT now(),
    CHECK (jsonb_typeof(evidence) = 'object' AND octet_length(evidence::text) <= 1048576)
);

-- 顧客・見込客のコア（インストール不要）。2026-10-27 Owner: 基盤に結びつく標準の Flapp は物理＋エイリアス。
-- 人・会社・問い合わせ（本文なし）・出来事・同意・連絡先・案内。本文は各入口の表に残り、その表の消去に従う。
-- 書けるのは下の SECURITY DEFINER の関数だけ。flap-api は読みだけ（ワークスペースのメンバーかを API が先に確かめる）。

CREATE TABLE IF NOT EXISTS platform.organizations (
 organization_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 name text NOT NULL CHECK(length(btrim(name)) BETWEEN 1 AND 200),
 name_normalized text NOT NULL CHECK(length(name_normalized) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(workspace_id,name_normalized)
);

-- One person per Workspace and normalized email (077: the visitor's own input field only; never linked to identity.principals).
CREATE TABLE IF NOT EXISTS platform.contacts (
 contact_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 display_name text CHECK(display_name IS NULL OR length(display_name) BETWEEN 1 AND 200),
 email_normalized text CHECK(email_normalized IS NULL OR (email_normalized=lower(btrim(email_normalized)) AND email_normalized ~ '^[^@\s]+@[^@\s]+$' AND length(email_normalized)<=320)),
 phone text CHECK(phone IS NULL OR length(phone)<=40),
 organization_id uuid REFERENCES platform.organizations(organization_id),
 stage text CHECK(stage IN ('inquiry','qualified','opportunity','won','lost','disqualified')),
 source text CHECK(source IS NULL OR source ~ '^[a-z][a-z-]{1,40}$'),
 last_contacted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retention_until timestamptz NOT NULL,
 erased_at timestamptz,
 -- Columns a business brought from its own table that have no field of their own, by table name (DB アプリの割り当て).
 extras jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(extras)='object' AND octet_length(extras::text)<=32768),
 -- When the smart tags last looked at this person; a newer updated_at asks them to look again.
 tags_evaluated_at timestamptz,
 legacy_record_id uuid UNIQUE,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(erased_at IS NULL OR (display_name IS NULL AND email_normalized IS NULL AND phone IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS contacts_workspace_email ON platform.contacts(workspace_id,email_normalized) WHERE email_normalized IS NOT NULL;
CREATE INDEX IF NOT EXISTS contacts_recent ON platform.contacts(workspace_id,last_contacted_at DESC) WHERE erased_at IS NULL;
CREATE INDEX IF NOT EXISTS contacts_retention ON platform.contacts(retention_until) WHERE erased_at IS NULL;

-- A thin inquiry: the entrance's own row keeps the words; this keeps the reference, the person and the derived stage.
CREATE TABLE IF NOT EXISTS platform.inquiries (
 inquiry_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 source_ref text NOT NULL CHECK(source_ref ~ '^[a-z][a-z-]{1,40}:[A-Za-z0-9_-]{1,80}$' OR source_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 entrance text NOT NULL CHECK(entrance ~ '^[a-z][a-z-]{1,40}$'),
 contact_id uuid REFERENCES platform.contacts(contact_id),
 project_id uuid,
 stage text NOT NULL CHECK(stage IN ('inquiry','qualified','opportunity','won','lost','disqualified')),
 entry_ref text CHECK(entry_ref IS NULL OR length(entry_ref)<=200),
 received_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,project_id) REFERENCES platform.projects(workspace_id,project_id),
 UNIQUE(workspace_id,source_ref)
);
CREATE INDEX IF NOT EXISTS inquiries_contact ON platform.inquiries(contact_id) WHERE contact_id IS NOT NULL;

-- Stage moves per inquiry, touches per contact, and segment entries/exits (kind segment, reasons entered|exited,
-- source_ref segment:<id>). No personal data. Shared with the qualified-lead loop and the workflow triggers.
CREATE TABLE IF NOT EXISTS platform.outcome_events (
 event_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 project_id uuid,
 kind text NOT NULL CHECK(kind IN ('stage','touch','segment')),
 source_ref text NOT NULL CHECK(source_ref ~ '^[a-z][a-z-]{1,40}:[A-Za-z0-9_-]{1,80}$' OR source_ref ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'),
 contact_ref uuid REFERENCES platform.contacts(contact_id),
 stage text CHECK(stage IN ('inquiry','qualified','opportunity','won','lost','disqualified')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 entry_ref text CHECK(entry_ref IS NULL OR length(entry_ref)<=200),
 rule_version text CHECK(rule_version IS NULL OR length(rule_version)<=80),
 definition_decision_id uuid,
 reasons text[] NOT NULL DEFAULT '{}' CHECK(cardinality(reasons)<=20),
 confidence numeric CHECK(confidence IS NULL OR confidence BETWEEN 0 AND 1),
 decided_by text CHECK(decided_by IN ('rule','model','human')),
 actor_principal_id uuid REFERENCES identity.principals(principal_id),
 value_band text CHECK(value_band IS NULL OR length(value_band)<=40),
 retention_days integer CHECK(retention_days IS NULL OR retention_days>0),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,project_id) REFERENCES platform.projects(workspace_id,project_id),
 UNIQUE(workspace_id,idempotency_key),
 CHECK((kind='stage')=(stage IS NOT NULL)),
 CHECK(kind='touch' OR decided_by IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS outcome_events_source ON platform.outcome_events(workspace_id,source_ref,occurred_at);
CREATE INDEX IF NOT EXISTS outcome_events_contact ON platform.outcome_events(contact_ref,occurred_at) WHERE contact_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS outcome_events_recent ON platform.outcome_events(workspace_id,occurred_at DESC);

-- Consent and stop per person, channel and purpose. The evidence is a runtime receipt with no address in it.
CREATE TABLE IF NOT EXISTS platform.contact_consents (
 contact_id uuid NOT NULL REFERENCES platform.contacts(contact_id),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 channel text NOT NULL CHECK(channel IN ('email','line')),
 purpose text NOT NULL CHECK(purpose IN ('announcements')),
 status text NOT NULL CHECK(status IN ('granted','withdrawn')),
 evidence_receipt_id uuid NOT NULL REFERENCES runtime.receipts(receipt_id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(contact_id,channel,purpose)
);

-- Identifiers the person gave on a channel (LINE user id). Read only to hand a send to the credential broker.
CREATE TABLE IF NOT EXISTS platform.contact_points (
 contact_id uuid NOT NULL REFERENCES platform.contacts(contact_id),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 channel text NOT NULL CHECK(channel IN ('line')),
 value text NOT NULL CHECK(length(value) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(contact_id,channel),
 UNIQUE(workspace_id,channel,value)
);

-- お知らせ: one version and its per-recipient results.
CREATE TABLE IF NOT EXISTS platform.announcements (
 announcement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 channel text NOT NULL CHECK(channel IN ('email','line')),
 audience text NOT NULL CHECK(audience IN ('consented','line-friends')),
 subject text CHECK(subject IS NULL OR length(subject) BETWEEN 1 AND 200),
 body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 20000),
 body_digest text NOT NULL CHECK(body_digest ~ '^[0-9a-f]{64}$'),
 filter jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(filter)='object' AND octet_length(filter::text)<=4096),
 -- 特定電子メール法: who sends, where they are and how to reach them, shown at the end of every mail.
 sender_name text CHECK(sender_name IS NULL OR length(btrim(sender_name)) BETWEEN 1 AND 200),
 sender_address text CHECK(sender_address IS NULL OR length(btrim(sender_address)) BETWEEN 1 AND 200),
 sender_contact text CHECK(sender_contact IS NULL OR length(btrim(sender_contact)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sending','sent','failed')),
 counts jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(counts)='object'),
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 finished_at timestamptz,
 UNIQUE(workspace_id,idempotency_key),
 CHECK((channel='email')=(subject IS NOT NULL)),
 CHECK(channel<>'email' OR (sender_name IS NOT NULL AND sender_address IS NOT NULL AND sender_contact IS NOT NULL)),
 CHECK(audience<>'line-friends' OR channel='line')
);
CREATE TABLE IF NOT EXISTS platform.announcement_deliveries (
 announcement_id uuid NOT NULL REFERENCES platform.announcements(announcement_id),
 contact_id uuid NOT NULL REFERENCES platform.contacts(contact_id),
 -- uncertain: the send was handed out and it is not known whether the provider took it. It is never offered again
 -- (2026-11-14 Owner), so the stop link of a mail that did arrive keeps working.
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','sent','skipped','failed','uncertain')),
 reason text CHECK(reason IS NULL OR reason ~ '^[a-z][a-z0-9_-]{1,60}$'),
 provider_ref text CHECK(provider_ref IS NULL OR length(provider_ref)<=200),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 -- The stop link's token is random per send; only its hash is kept.
 stop_token_hash text UNIQUE CHECK(stop_token_hash IS NULL OR stop_token_hash ~ '^[0-9a-f]{64}$'),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(announcement_id,contact_id)
);
CREATE INDEX IF NOT EXISTS announcement_deliveries_queued ON platform.announcement_deliveries(announcement_id) WHERE status='queued';

-- 消す期限: 同意も成約もない人は、最後の接点から90日（2026-10-27 Owner）。Business プランで変えられるようにする口。
-- 範囲は Owner が決めるまで 90 日で固定。feature-catalog の crm.contact-retention を参照。
CREATE OR REPLACE FUNCTION platform.contact_retention_days(p_workspace uuid) RETURNS integer
LANGUAGE sql STABLE SET search_path TO '' AS $$ SELECT 90 $$;

CREATE OR REPLACE FUNCTION platform.outcome_stage_step(p text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE p WHEN 'inquiry' THEN 1 WHEN 'qualified' THEN 2 WHEN 'opportunity' THEN 3 WHEN 'won' THEN 4 WHEN 'lost' THEN 5 WHEN 'disqualified' THEN 5 END
$$;
CREATE OR REPLACE FUNCTION platform.outcome_stage_rank(p text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE p WHEN 'won' THEN 6 WHEN 'opportunity' THEN 5 WHEN 'qualified' THEN 4 WHEN 'inquiry' THEN 3 WHEN 'lost' THEN 2 WHEN 'disqualified' THEN 1 END
$$;

-- Each inquiry's stage is its latest stage event; the person's stage is the most advanced among their inquiries.
CREATE OR REPLACE FUNCTION platform.refresh_outcome_stage(p_workspace uuid, p_source text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE latest text; who uuid; best text;
BEGIN
 SELECT e.stage INTO latest FROM platform.outcome_events e WHERE e.workspace_id=p_workspace AND e.source_ref=p_source AND e.kind='stage' ORDER BY e.occurred_at DESC,e.created_at DESC LIMIT 1;
 IF latest IS NULL THEN RETURN; END IF;
 UPDATE platform.inquiries SET stage=latest WHERE workspace_id=p_workspace AND source_ref=p_source AND stage<>latest;
 SELECT contact_id INTO who FROM platform.inquiries WHERE workspace_id=p_workspace AND source_ref=p_source;
 IF who IS NULL THEN RETURN; END IF;
 SELECT i.stage INTO best FROM platform.inquiries i WHERE i.contact_id=who ORDER BY platform.outcome_stage_rank(i.stage) DESC LIMIT 1;
 UPDATE platform.contacts SET stage=best,updated_at=clock_timestamp() WHERE contact_id=who AND stage IS DISTINCT FROM best;
END $$;

-- Records an opt-in or a stop as evidence, then the current state. A stop holds until a new explicit opt-in.
CREATE OR REPLACE FUNCTION platform.record_contact_consent(p_workspace uuid, p_contact uuid, p_channel text, p_status text, p_source text, p_at timestamptz DEFAULT clock_timestamp())
RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE current text; run uuid; evidence uuid;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM platform.contacts c WHERE c.contact_id=p_contact AND c.workspace_id=p_workspace AND c.erased_at IS NULL) THEN RAISE EXCEPTION 'CONTACT_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT status INTO current FROM platform.contact_consents WHERE contact_id=p_contact AND channel=p_channel AND purpose='announcements' FOR UPDATE;
 IF current=p_status THEN RETURN current; END IF;
 INSERT INTO runtime.runs(workspace_id,actor_ref,workflow_ref,status,started_at,finished_at) VALUES(p_workspace,'service:crm','crm.announcement.consent','succeeded',p_at,p_at) RETURNING run_id INTO run;
 INSERT INTO runtime.receipts(run_id,operation,result,evidence) VALUES(run,'crm.announcement.consent.observed','succeeded',
  jsonb_build_object('contractVersion','flapbase.crm.announcement-consent/v1','contactRef',p_contact,'channel',p_channel,'status',p_status,'sourceRef',p_source,'at',p_at)) RETURNING receipt_id INTO evidence;
 INSERT INTO platform.contact_consents(contact_id,workspace_id,channel,purpose,status,evidence_receipt_id,updated_at) VALUES(p_contact,p_workspace,p_channel,'announcements',p_status,evidence,p_at)
  ON CONFLICT(contact_id,channel,purpose) DO UPDATE SET status=EXCLUDED.status,evidence_receipt_id=EXCLUDED.evidence_receipt_id,updated_at=EXCLUDED.updated_at;
 RETURN p_status;
END $$;

-- The one writer. Input (jsonb): workspaceId, kind, sourceRef, idempotencyKey, entrance?, stage?, projectId?, occurredAt?, entryRef?,
-- decidedBy?, reasons?, ruleVersion?, definitionDecisionId?, confidence?, actorPrincipalId?, valueBand?, retentionDays?,
-- contact?: {name?, email, source?, organization?}, consent?: {channel: 'email'}.
-- 077: exact normalized email from the entrance's own field, within the Workspace; never linked to identity.principals;
-- a match to an existing person leaves a touch (reasons email_match) so a person can split it later.
CREATE OR REPLACE FUNCTION platform.record_outcome_event(p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
 ws uuid:=(p->>'workspaceId')::uuid; kind text:=p->>'kind'; src text:=p->>'sourceRef'; key text:=p->>'idempotencyKey';
 stage text:=p->>'stage'; by_ text:=p->>'decidedBy'; at_ timestamptz:=coalesce((p->>'occurredAt')::timestamptz,clock_timestamp());
 c jsonb:=p->'contact'; email text; org text; contact uuid; organization uuid; merged boolean:=false; prior text; event uuid; existing record;
 keep timestamptz; entrance_ text; bare_uuid boolean:=src ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
BEGIN
 IF ws IS NULL OR kind IS NULL OR src IS NULL OR key IS NULL THEN RAISE EXCEPTION 'OUTCOME_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF bare_uuid AND (coalesce(p->>'entrance','')<>'listing-order' OR kind<>'stage' OR stage IS DISTINCT FROM 'won') THEN RAISE EXCEPTION 'OUTCOME_PURCHASE_ENTRANCE_INVALID' USING ERRCODE='22023'; END IF;
 entrance_:=CASE WHEN bare_uuid THEN p->>'entrance' ELSE split_part(src,':',1) END;
 IF NOT EXISTS(SELECT 1 FROM platform.workspaces w WHERE w.workspace_id=ws) THEN RAISE EXCEPTION 'OUTCOME_WORKSPACE_INVALID' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('outcome:'||ws::text||':'||src,0));
 SELECT e.event_id,e.contact_ref INTO existing FROM platform.outcome_events e WHERE e.workspace_id=ws AND e.idempotency_key=key;
 IF FOUND THEN RETURN jsonb_build_object('eventId',existing.event_id,'contactId',existing.contact_ref,'created',false); END IF;
 SELECT i.contact_id INTO contact FROM platform.inquiries i WHERE i.workspace_id=ws AND i.source_ref=src;
 email:=nullif(lower(btrim(c->>'email')),'');
 keep:=at_+make_interval(days=>platform.contact_retention_days(ws));
 IF contact IS NULL AND email IS NOT NULL THEN
  IF email !~ '^[^@\s]+@[^@\s]+$' OR length(email)>320 THEN RAISE EXCEPTION 'OUTCOME_EMAIL_INVALID' USING ERRCODE='22023'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('contact:'||ws::text||':'||email,0));
  org:=nullif(btrim(c->>'organization'),'');
  IF org IS NOT NULL THEN
   INSERT INTO platform.organizations(workspace_id,name,name_normalized) VALUES(ws,left(org,200),left(lower(normalize(org,NFKC)),200))
    ON CONFLICT(workspace_id,name_normalized) DO UPDATE SET name=platform.organizations.name RETURNING organization_id INTO organization;
  END IF;
  SELECT x.contact_id INTO contact FROM platform.contacts x WHERE x.workspace_id=ws AND x.email_normalized=email FOR UPDATE;
  IF FOUND THEN
   merged:=true;
   UPDATE platform.contacts SET last_contacted_at=greatest(last_contacted_at,at_),retention_until=greatest(retention_until,keep),
     display_name=coalesce(display_name,nullif(left(btrim(c->>'name'),200),'')),organization_id=coalesce(organization_id,organization),updated_at=clock_timestamp()
    WHERE contact_id=contact;
  ELSE
   INSERT INTO platform.contacts(workspace_id,display_name,email_normalized,organization_id,source,last_contacted_at,retention_until)
    VALUES(ws,coalesce(nullif(left(btrim(c->>'name'),200),''),email),email,organization,nullif(btrim(c->>'source'),''),at_,keep) RETURNING contact_id INTO contact;
  END IF;
 ELSIF contact IS NOT NULL THEN
  UPDATE platform.contacts SET last_contacted_at=greatest(last_contacted_at,at_),retention_until=greatest(retention_until,keep),updated_at=clock_timestamp() WHERE contact_id=contact AND erased_at IS NULL;
 END IF;
 IF kind='stage' THEN
  SELECT e.stage INTO prior FROM platform.outcome_events e WHERE e.workspace_id=ws AND e.source_ref=src AND e.kind='stage' ORDER BY e.occurred_at DESC,e.created_at DESC LIMIT 1;
  -- Stages only move forward. A person may move one back; that adds a row and keeps the earlier one.
  IF prior IS NOT NULL AND by_<>'human' AND platform.outcome_stage_step(stage)<=platform.outcome_stage_step(prior) THEN
   RETURN jsonb_build_object('eventId',NULL,'contactId',contact,'created',false,'stage',prior);
  END IF;
  INSERT INTO platform.inquiries(workspace_id,source_ref,entrance,contact_id,project_id,stage,entry_ref,received_at)
   VALUES(ws,src,entrance_,contact,(p->>'projectId')::uuid,stage,p->>'entryRef',at_)
   ON CONFLICT(workspace_id,source_ref) DO UPDATE SET contact_id=coalesce(platform.inquiries.contact_id,EXCLUDED.contact_id),project_id=coalesce(EXCLUDED.project_id,platform.inquiries.project_id);
 END IF;
 INSERT INTO platform.outcome_events(workspace_id,project_id,kind,source_ref,contact_ref,stage,occurred_at,entry_ref,rule_version,definition_decision_id,
  reasons,confidence,decided_by,actor_principal_id,value_band,retention_days,idempotency_key)
 VALUES(ws,(p->>'projectId')::uuid,kind,src,contact,stage,at_,p->>'entryRef',p->>'ruleVersion',(p->>'definitionDecisionId')::uuid,
  coalesce(ARRAY(SELECT jsonb_array_elements_text(p->'reasons')),'{}'),(p->>'confidence')::numeric,by_,(p->>'actorPrincipalId')::uuid,p->>'valueBand',(p->>'retentionDays')::integer,key)
 RETURNING event_id INTO event;
 IF merged AND NOT EXISTS(SELECT 1 FROM platform.outcome_events e WHERE e.workspace_id=ws AND e.source_ref=src AND e.event_id<>event) THEN
  INSERT INTO platform.outcome_events(workspace_id,kind,source_ref,contact_ref,occurred_at,reasons,idempotency_key)
  VALUES(ws,'touch',src,contact,at_,ARRAY['email_match'],'merge:'||src) ON CONFLICT(workspace_id,idempotency_key) DO NOTHING;
 END IF;
 IF kind='stage' THEN PERFORM platform.refresh_outcome_stage(ws,src); END IF;
 IF contact IS NOT NULL AND p->'consent'->>'channel'='email' THEN
  PERFORM platform.record_contact_consent(ws,contact,'email','granted',src,at_);
 END IF;
 RETURN jsonb_build_object('eventId',event,'contactId',contact,'created',true,'merged',merged);
END $$;

-- Erasure: personal columns and identifiers go; events and inquiries keep stage, date and reason codes only.
CREATE OR REPLACE FUNCTION platform.erase_contact(p_workspace uuid, p_contact uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 UPDATE platform.contacts SET display_name=NULL,email_normalized=NULL,phone=NULL,organization_id=NULL,extras='{}',erased_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE contact_id=p_contact AND workspace_id=p_workspace AND erased_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE platform.contact_points SET value='erased:'||gen_random_uuid()::text WHERE contact_id=p_contact;
 UPDATE platform.outcome_events SET contact_ref=NULL WHERE contact_ref=p_contact;
 UPDATE platform.inquiries SET contact_id=NULL WHERE contact_id=p_contact;
 RETURN true;
END $$;

-- Daily: people with neither a won inquiry nor a granted consent, past their retention, are erased.
CREATE OR REPLACE FUNCTION platform.purge_expired_contacts() RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r record; n integer:=0;
BEGIN
 FOR r IN SELECT c.workspace_id,c.contact_id FROM platform.contacts c
  WHERE c.erased_at IS NULL AND c.retention_until<clock_timestamp() AND c.stage IS DISTINCT FROM 'won'
   AND NOT EXISTS(SELECT 1 FROM platform.contact_consents k WHERE k.contact_id=c.contact_id AND k.status='granted')
  ORDER BY c.retention_until LIMIT 1000 FOR UPDATE SKIP LOCKED LOOP
  IF platform.erase_contact(r.workspace_id,r.contact_id) THEN n:=n+1; END IF;
 END LOOP;
 RETURN n;
END $$;

REVOKE ALL ON FUNCTION platform.record_outcome_event(jsonb),platform.refresh_outcome_stage(uuid,text),platform.record_contact_consent(uuid,uuid,text,text,text,timestamptz),
 platform.erase_contact(uuid,uuid),platform.purge_expired_contacts() FROM PUBLIC;

-- Reads go through the Human API, which checks the Workspace member first. contact_points is never granted.

CREATE OR REPLACE FUNCTION platform.crm_member(p_actor uuid, p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM platform.workspace_members m JOIN platform.workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
  JOIN identity.principals p ON p.principal_id=m.principal_id AND p.status='active'
  WHERE m.workspace_id=p_workspace AND m.principal_id=p_actor AND m.status='active')
$$;

CREATE OR REPLACE FUNCTION platform.crm_manager(p_actor uuid, p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM platform.workspace_members m JOIN platform.workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
  JOIN identity.principals p ON p.principal_id=m.principal_id AND p.status='active' AND p.principal_kind='human'
  WHERE m.workspace_id=p_workspace AND m.principal_id=p_actor AND m.status='active' AND m.member_role IN ('owner','admin'))
$$;

REVOKE ALL ON FUNCTION platform.crm_member(uuid,uuid),platform.crm_manager(uuid,uuid) FROM PUBLIC;

-- 案件（2026-11-02 Owner §6a）: 案件 Flapp が受け持つ DB。対応（inquiries）とは統合せず、問い合わせから「案件にする」と
-- その人と対応が結ばれた案件ができる。案件は 受付→見積もり→受注→進行中→納品→請求→完了（途中で失注）と進み、複数の対応がぶら下がる。
-- 所有と参照を分ける: 案件の関数は cases・case_inquiries・case_status_changes だけを書く。名簿（contacts・organizations）と
-- 対応（inquiries）は読むだけで、書き換えは各 DB の関数に頼む。Flapp を外しても表は消さない（外部キーは CASCADE にしない）。
-- 利用者が足せる項目は各表の attributes（jsonb）に入り、ワークスペースごとの定義（attribute_definitions）に照らして書く。

-- 名簿・対応の表に、利用者が足せる項目の置き場所を足す（追加だけ。extras は取り込んだ表の残りで別物）。
ALTER TABLE platform.contacts ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'
 CHECK(jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=16384);
ALTER TABLE platform.organizations ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'
 CHECK(jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=16384);
ALTER TABLE platform.inquiries ADD COLUMN IF NOT EXISTS attributes jsonb NOT NULL DEFAULT '{}'
 CHECK(jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=16384);

-- 名簿の消去（079 と同じ）に、足した項目も消すことを加える。人の項目と、その人の問い合わせの項目は個人の情報を含みうる。
CREATE OR REPLACE FUNCTION platform.erase_contact(p_workspace uuid, p_contact uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 UPDATE platform.contacts SET display_name=NULL,email_normalized=NULL,phone=NULL,organization_id=NULL,extras='{}',attributes='{}',erased_at=clock_timestamp(),updated_at=clock_timestamp()
  WHERE contact_id=p_contact AND workspace_id=p_workspace AND erased_at IS NULL;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE platform.contact_points SET value='erased:'||gen_random_uuid()::text WHERE contact_id=p_contact;
 UPDATE platform.outcome_events SET contact_ref=NULL WHERE contact_ref=p_contact;
 UPDATE platform.inquiries SET contact_id=NULL,attributes='{}' WHERE contact_id=p_contact;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION platform.erase_contact(uuid,uuid) FROM PUBLIC;

-- ワークスペースごとの項目の定義。entity は Blueprint の名前（_fb_contacts など）で、どの表の attributes かを決める。
-- 消さずに archived_at で外す（書かれた値は残り、新しく書けなくなる）。
CREATE TABLE IF NOT EXISTS platform.attribute_definitions (
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 entity text NOT NULL CHECK(entity IN ('_fb_contacts','_fb_organizations','_fb_inquiries','_fb_cases')),
 key text NOT NULL CHECK(key ~ '^[a-z][a-z0-9_]{0,39}$'),
 label text NOT NULL CHECK(length(btrim(label)) BETWEEN 1 AND 80),
 value_type text NOT NULL CHECK(value_type IN ('text','long_text','number','date','boolean','choice','choices','url','email')),
 required boolean NOT NULL DEFAULT false,
 choices text[] NOT NULL DEFAULT '{}' CHECK(cardinality(choices)<=100),
 visibility text NOT NULL DEFAULT 'members' CHECK(visibility IN ('members','managers')),
 position integer NOT NULL DEFAULT 0 CHECK(position BETWEEN 0 AND 10000),
 archived_at timestamptz,
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(workspace_id,entity,key),
 CHECK((value_type IN ('choice','choices'))=(cardinality(choices)>0))
);

CREATE TABLE IF NOT EXISTS platform.cases (
 case_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 project_id uuid,
 contact_id uuid REFERENCES platform.contacts(contact_id),
 organization_id uuid REFERENCES platform.organizations(organization_id),
 source_inquiry_id uuid REFERENCES platform.inquiries(inquiry_id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 status text NOT NULL DEFAULT 'received' CHECK(status IN ('received','estimating','ordered','in_progress','delivered','invoiced','completed','lost')),
 assignee_principal_id uuid REFERENCES identity.principals(principal_id),
 due_on date,
 amount numeric(14,0) CHECK(amount IS NULL OR amount>=0),
 currency text NOT NULL DEFAULT 'JPY' CHECK(currency ~ '^[A-Z]{3}$'),
 attributes jsonb NOT NULL DEFAULT '{}' CHECK(jsonb_typeof(attributes)='object' AND octet_length(attributes::text)<=16384),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 closed_at timestamptz,
 archived_at timestamptz,
 FOREIGN KEY(workspace_id,project_id) REFERENCES platform.projects(workspace_id,project_id),
 UNIQUE(workspace_id,idempotency_key),
 CHECK((status IN ('completed','lost'))=(closed_at IS NOT NULL))
);
-- One case per inquiry made by 案件にする; more inquiries join through case_inquiries.
CREATE UNIQUE INDEX IF NOT EXISTS cases_source_inquiry ON platform.cases(source_inquiry_id) WHERE source_inquiry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS cases_open ON platform.cases(workspace_id,status,updated_at DESC) WHERE archived_at IS NULL;
CREATE INDEX IF NOT EXISTS cases_contact ON platform.cases(contact_id) WHERE contact_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.case_inquiries (
 case_id uuid NOT NULL REFERENCES platform.cases(case_id),
 inquiry_id uuid NOT NULL REFERENCES platform.inquiries(inquiry_id),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 linked_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 linked_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(case_id,inquiry_id)
);
CREATE INDEX IF NOT EXISTS case_inquiries_inquiry ON platform.case_inquiries(inquiry_id);

CREATE TABLE IF NOT EXISTS platform.case_status_changes (
 change_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 case_id uuid NOT NULL REFERENCES platform.cases(case_id),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 from_status text CHECK(from_status IS NULL OR from_status IN ('received','estimating','ordered','in_progress','delivered','invoiced','completed','lost')),
 to_status text NOT NULL CHECK(to_status IN ('received','estimating','ordered','in_progress','delivered','invoiced','completed','lost')),
 actor_principal_id uuid NOT NULL REFERENCES identity.principals(principal_id),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS case_status_changes_case ON platform.case_status_changes(case_id,occurred_at);

-- 案件を書けるのはワークスペースの owner・admin・member（CRM の Action と同じ）。
CREATE OR REPLACE FUNCTION platform.case_writer(p_actor uuid, p_workspace uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS (SELECT 1 FROM platform.workspace_members m JOIN platform.workspaces w ON w.workspace_id=m.workspace_id AND w.status='active'
  JOIN identity.principals p ON p.principal_id=m.principal_id AND p.status='active' AND p.principal_kind='human'
  WHERE m.workspace_id=p_workspace AND m.principal_id=p_actor AND m.status='active' AND m.member_role IN ('owner','admin','member'))
$$;

-- 状態の移り方: 前へは飛ばしてよい・完了の後は動かない・失注はどこからでも・失注から受付へ戻せる。
CREATE OR REPLACE FUNCTION platform.case_status_step(p text) RETURNS integer LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE p WHEN 'received' THEN 1 WHEN 'estimating' THEN 2 WHEN 'ordered' THEN 3 WHEN 'in_progress' THEN 4
  WHEN 'delivered' THEN 5 WHEN 'invoiced' THEN 6 WHEN 'completed' THEN 7 END
$$;
-- Same current Project predicates as the shared host: visibility first, then owner/editor for writes.
CREATE OR REPLACE FUNCTION platform.case_project_access(p_actor uuid,p_workspace uuid,p_project uuid,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.workspace_members wm JOIN platform.workspaces w USING(workspace_id)
 JOIN identity.principals h ON h.principal_id=wm.principal_id
 WHERE wm.workspace_id=p_workspace AND wm.principal_id=p_actor AND wm.status='active' AND w.status='active' AND h.status='active' AND h.principal_kind='human'
 AND wm.member_role IN('owner','admin','member','viewer') AND (p_project IS NULL OR EXISTS(
 SELECT 1 FROM platform.projects p WHERE p.project_id=p_project AND p.workspace_id=p_workspace AND p.status='active' AND p.visibility IN('private','workspace')
 AND (p.visibility='workspace' OR EXISTS(SELECT 1 FROM platform.project_memberships m WHERE m.project_id=p.project_id AND m.principal_id=p_actor AND m.status='active' AND m.member_role IN('owner','editor','member','viewer')))
 AND (NOT p_write OR wm.member_role='owner' OR EXISTS(SELECT 1 FROM platform.project_memberships m WHERE m.project_id=p.project_id AND m.principal_id=p_actor AND m.status='active' AND m.member_role IN('owner','editor'))))))
$$;

CREATE OR REPLACE FUNCTION platform.case_record_access(p_actor uuid,p_workspace uuid,p_case uuid,p_write boolean,p_project uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.cases c WHERE c.case_id=p_case AND c.workspace_id=p_workspace AND c.archived_at IS NULL
  AND (p_project IS NULL OR c.project_id=p_project) AND platform.case_project_access(p_actor,p_workspace,c.project_id,p_write))
$$;

CREATE OR REPLACE FUNCTION platform.case_record_access(p_actor uuid,p_workspace uuid,p_case uuid,p_write boolean DEFAULT false) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT platform.case_record_access(p_actor,p_workspace,p_case,p_write,NULL::uuid)
$$;

CREATE OR REPLACE FUNCTION platform.case_inquiry_access(p_actor uuid,p_workspace uuid,p_inquiry uuid,p_project uuid DEFAULT NULL,p_assignee uuid DEFAULT NULL) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT EXISTS(SELECT 1 FROM platform.inquiries i WHERE i.inquiry_id=p_inquiry AND i.workspace_id=p_workspace
 AND (to_jsonb(i)->>'inbox_owner_principal_id' IS NULL OR to_jsonb(i)->>'inbox_owner_principal_id'=p_actor::text)
 AND platform.case_project_access(p_actor,p_workspace,i.project_id,false)
 AND (p_project IS NULL OR i.project_id IS NULL OR i.project_id=p_project)
 AND platform.case_project_access(p_actor,p_workspace,coalesce(p_project,i.project_id),true)
 AND (i.contact_id IS NULL OR EXISTS(SELECT 1 FROM platform.contacts c WHERE c.contact_id=i.contact_id AND c.workspace_id=p_workspace AND c.erased_at IS NULL))
 AND (p_assignee IS NULL OR (platform.case_writer(p_assignee,p_workspace) AND platform.case_project_access(p_assignee,p_workspace,coalesce(p_project,i.project_id),true)))
 AND NOT EXISTS(SELECT 1 FROM platform.cases c WHERE c.source_inquiry_id=i.inquiry_id AND c.workspace_id=p_workspace AND ((p_project IS NOT NULL AND c.project_id IS DISTINCT FROM p_project) OR NOT platform.case_project_access(p_actor,p_workspace,c.project_id,true))))
$$;

CREATE OR REPLACE FUNCTION platform.case_status_allowed(p_from text, p_to text) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_from='completed' THEN false
  WHEN p_to='lost' THEN p_from<>'lost'
  WHEN p_from='lost' THEN p_to='received'
  ELSE coalesce(platform.case_status_step(p_to)>platform.case_status_step(p_from),false) END
$$;

-- 項目の値を定義に照らして確かめ、まとめた値を返す。p_patch の null は消す。定義のない鍵・外した項目への新しい値・型違い・
-- 必須の欠け・managers の項目を member が変えるのは ATTRIBUTES_INVALID / ATTRIBUTES_FORBIDDEN。外した項目の既存の値はそのまま残す。
CREATE OR REPLACE FUNCTION platform.check_attributes(p_workspace uuid, p_entity text, p_current jsonb, p_patch jsonb, p_manager boolean) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE merged jsonb:=coalesce(p_current,'{}'); k text; v jsonb; d record; ok boolean;
BEGIN
 IF p_patch IS NULL OR jsonb_typeof(p_patch)<>'object' THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID' USING ERRCODE='22023'; END IF;
 FOR k,v IN SELECT * FROM jsonb_each(p_patch) LOOP
  SELECT * INTO d FROM platform.attribute_definitions a WHERE a.workspace_id=p_workspace AND a.entity=p_entity AND a.key=k;
  IF NOT FOUND OR (d.archived_at IS NOT NULL AND jsonb_typeof(v)<>'null') THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID' USING ERRCODE='22023'; END IF;
  IF d.visibility='managers' AND NOT p_manager THEN RAISE EXCEPTION 'ATTRIBUTES_FORBIDDEN' USING ERRCODE='42501'; END IF;
  IF jsonb_typeof(v)='null' THEN merged:=merged-k; CONTINUE; END IF;
  ok:=CASE d.value_type
   WHEN 'text' THEN jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN 1 AND 500
   WHEN 'long_text' THEN jsonb_typeof(v)='string' AND length(v#>>'{}') BETWEEN 1 AND 5000
   WHEN 'url' THEN jsonb_typeof(v)='string' AND (v#>>'{}') ~ '^https?://[^\s]{1,2000}$'
   WHEN 'email' THEN jsonb_typeof(v)='string' AND (v#>>'{}') ~ '^[^@\s]+@[^@\s]+$' AND length(v#>>'{}')<=320
   WHEN 'number' THEN jsonb_typeof(v)='number'
   WHEN 'boolean' THEN jsonb_typeof(v)='boolean'
   WHEN 'date' THEN jsonb_typeof(v)='string' AND (v#>>'{}') ~ '^\d{4}-\d{2}-\d{2}$' AND (v#>>'{}')::date IS NOT NULL
   WHEN 'choice' THEN jsonb_typeof(v)='string' AND (v#>>'{}')=ANY(d.choices)
   WHEN 'choices' THEN jsonb_typeof(v)='array' AND jsonb_array_length(v) BETWEEN 1 AND 100
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v) x WHERE jsonb_typeof(x)<>'string' OR NOT (x#>>'{}')=ANY(d.choices))
   ELSE false END;
  IF NOT coalesce(ok,false) THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID' USING ERRCODE='22023'; END IF;
  merged:=merged||jsonb_build_object(k,v);
 END LOOP;
 IF EXISTS(SELECT 1 FROM platform.attribute_definitions a WHERE a.workspace_id=p_workspace AND a.entity=p_entity AND a.required AND a.archived_at IS NULL AND NOT merged ? a.key)
  THEN RAISE EXCEPTION 'ATTRIBUTES_REQUIRED' USING ERRCODE='22023'; END IF;
 RETURN merged;
END $$;

-- 項目の定義を足す・直す・外す（owner・admin）。型は一度決めたら変えない（値の読み違いを防ぐ）。
-- Input: entity, key, label, valueType, required?, choices?, visibility?, position?, archived?
CREATE OR REPLACE FUNCTION platform.save_attribute_definition(p_actor uuid, p_workspace uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE prior text; ch text[]:=coalesce(ARRAY(SELECT jsonb_array_elements_text(coalesce(p->'choices','[]'))),'{}');
BEGIN
 IF NOT platform.crm_manager(p_actor,p_workspace) THEN RAISE EXCEPTION 'ATTRIBUTES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT value_type INTO prior FROM platform.attribute_definitions WHERE workspace_id=p_workspace AND entity=p->>'entity' AND key=p->>'key' FOR UPDATE;
 IF prior IS NOT NULL AND prior<>p->>'valueType' THEN RAISE EXCEPTION 'ATTRIBUTES_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO platform.attribute_definitions(workspace_id,entity,key,label,value_type,required,choices,visibility,position,archived_at,created_by)
 VALUES(p_workspace,p->>'entity',p->>'key',p->>'label',p->>'valueType',coalesce((p->>'required')::boolean,false),ch,coalesce(p->>'visibility','members'),
  coalesce((p->>'position')::integer,0),CASE WHEN (p->>'archived')::boolean THEN clock_timestamp() END,p_actor)
 ON CONFLICT(workspace_id,entity,key) DO UPDATE SET label=EXCLUDED.label,required=EXCLUDED.required,choices=EXCLUDED.choices,visibility=EXCLUDED.visibility,
  position=EXCLUDED.position,archived_at=CASE WHEN EXCLUDED.archived_at IS NULL THEN NULL ELSE coalesce(platform.attribute_definitions.archived_at,EXCLUDED.archived_at) END,updated_at=clock_timestamp();
 RETURN jsonb_build_object('entity',p->>'entity','key',p->>'key','created',prior IS NULL);
END $$;

-- 見える項目の定義（managers の項目は owner・admin だけに）。
CREATE OR REPLACE FUNCTION platform.attribute_definitions_of(p_actor uuid, p_workspace uuid, p_entity text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE manager boolean:=platform.crm_manager(p_actor,p_workspace);
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CRM_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object('key',a.key,'label',a.label,'valueType',a.value_type,'required',a.required,
   'choices',CASE WHEN cardinality(a.choices)>0 THEN to_jsonb(a.choices) END,'visibility',a.visibility,'position',a.position,'archived',a.archived_at IS NOT NULL)) ORDER BY a.position,a.key)
  FROM platform.attribute_definitions a WHERE a.workspace_id=p_workspace AND a.entity=p_entity AND (manager OR a.visibility='members')),'[]');
END $$;

-- 値を見せるときに managers の項目を外す。
CREATE OR REPLACE FUNCTION platform.visible_attributes(p_workspace uuid, p_entity text, p_value jsonb, p_manager boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT CASE WHEN p_manager THEN p_value ELSE p_value-coalesce(ARRAY(SELECT a.key FROM platform.attribute_definitions a
  WHERE a.workspace_id=p_workspace AND a.entity=p_entity AND a.visibility='managers'),'{}') END
$$;

-- 名簿・対応の項目の書き手（名簿・対応の DB の関数。案件の関数からは呼ばない）。
CREATE OR REPLACE FUNCTION platform.set_record_attributes(p_actor uuid, p_workspace uuid, p_entity text, p_id uuid, p_patch jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE cur jsonb; merged jsonb; manager boolean:=platform.crm_manager(p_actor,p_workspace);
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'ATTRIBUTES_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_entity='_fb_contacts' THEN SELECT attributes INTO cur FROM platform.contacts WHERE contact_id=p_id AND workspace_id=p_workspace AND erased_at IS NULL FOR UPDATE;
 ELSIF p_entity='_fb_organizations' THEN SELECT attributes INTO cur FROM platform.organizations WHERE organization_id=p_id AND workspace_id=p_workspace FOR UPDATE;
 ELSIF p_entity='_fb_inquiries' THEN SELECT attributes INTO cur FROM platform.inquiries WHERE inquiry_id=p_id AND workspace_id=p_workspace FOR UPDATE;
 ELSE RAISE EXCEPTION 'ATTRIBUTES_INVALID' USING ERRCODE='22023'; END IF;
 IF cur IS NULL THEN RAISE EXCEPTION 'ATTRIBUTES_NOT_FOUND' USING ERRCODE='42501'; END IF;
 merged:=platform.check_attributes(p_workspace,p_entity,cur,p_patch,manager);
 IF p_entity='_fb_contacts' THEN UPDATE platform.contacts SET attributes=merged,updated_at=clock_timestamp() WHERE contact_id=p_id;
 ELSIF p_entity='_fb_organizations' THEN UPDATE platform.organizations SET attributes=merged WHERE organization_id=p_id;
 ELSE UPDATE platform.inquiries SET attributes=merged WHERE inquiry_id=p_id; END IF;
 RETURN platform.visible_attributes(p_workspace,p_entity,merged,manager);
END $$;

-- 案件にする: 問い合わせ1件から、その人（と組織）と対応が結ばれた案件を作る。同じ問い合わせ・同じ鍵なら前の案件を返す。
-- 問い合わせと名簿は読むだけ。Input: idempotencyKey, title?, projectId?, assigneeId?, dueOn?, amount?, attributes?
CREATE OR REPLACE FUNCTION platform.case_from_inquiry(p_actor uuid, p_workspace uuid, p_inquiry uuid, p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE key text:=p->>'idempotencyKey'; inq record; who record; existing uuid; id uuid; attrs jsonb;
 assignee uuid:=(p->>'assigneeId')::uuid; project uuid:=(p->>'projectId')::uuid;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF key IS NULL OR length(key) NOT BETWEEN 1 AND 200 THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-from-inquiry:'||p_inquiry::text,0));
 SELECT i.inquiry_id,i.contact_id,i.project_id INTO inq FROM platform.inquiries i WHERE i.inquiry_id=p_inquiry AND i.workspace_id=p_workspace AND platform.case_project_access(p_actor,p_workspace,i.project_id,false) AND (to_jsonb(i)->>'inbox_owner_principal_id' IS NULL OR to_jsonb(i)->>'inbox_owner_principal_id'=p_actor::text);
 IF NOT FOUND OR (project IS NOT NULL AND inq.project_id IS NOT NULL AND project<>inq.project_id) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT c.case_id INTO existing FROM platform.cases c WHERE c.workspace_id=p_workspace AND (c.idempotency_key=key OR c.source_inquiry_id=p_inquiry);
 IF FOUND THEN IF NOT EXISTS(SELECT 1 FROM platform.cases c WHERE c.case_id=existing AND (project IS NULL OR c.project_id=project) AND platform.case_project_access(p_actor,p_workspace,c.project_id,true)) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF; RETURN jsonb_build_object('caseId',existing,'created',false); END IF;
 IF NOT platform.case_project_access(p_actor,p_workspace,inq.project_id,false) OR NOT platform.case_project_access(p_actor,p_workspace,coalesce(project,inq.project_id),true) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT c.display_name,c.organization_id INTO who FROM platform.contacts c WHERE c.contact_id=inq.contact_id AND c.workspace_id=p_workspace AND c.erased_at IS NULL;
 IF inq.contact_id IS NOT NULL AND NOT FOUND THEN RAISE EXCEPTION 'CASE_REFERENCE_INVALID' USING ERRCODE='42501'; END IF;
 IF project IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.projects x WHERE x.workspace_id=p_workspace AND x.project_id=project) THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF assignee IS NOT NULL AND NOT platform.crm_member(assignee,p_workspace) THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 attrs:=platform.check_attributes(p_workspace,'_fb_cases','{}',coalesce(p->'attributes','{}'),platform.crm_manager(p_actor,p_workspace));
 INSERT INTO platform.cases(workspace_id,project_id,contact_id,organization_id,source_inquiry_id,title,assignee_principal_id,due_on,amount,attributes,idempotency_key,created_by)
 VALUES(p_workspace,coalesce(project,inq.project_id),inq.contact_id,who.organization_id,p_inquiry,
  left(coalesce(nullif(btrim(p->>'title'),''),'案件'),200),
  coalesce(assignee,p_actor),(p->>'dueOn')::date,(p->>'amount')::numeric,attrs,key,p_actor)
 RETURNING case_id INTO id;
 INSERT INTO platform.case_inquiries(case_id,inquiry_id,workspace_id,linked_by) VALUES(id,p_inquiry,p_workspace,p_actor);
 INSERT INTO platform.case_status_changes(case_id,workspace_id,from_status,to_status,actor_principal_id) VALUES(id,p_workspace,NULL,'received',p_actor);
 RETURN jsonb_build_object('caseId',id,'created',true);
END $$;

-- 案件にほかの対応をぶら下げる。同じProjectの対応と、Projectの付いていない既存の対応を扱う。
CREATE OR REPLACE FUNCTION platform.link_case_inquiry(p_actor uuid, p_workspace uuid, p_case uuid, p_inquiry uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.cases c JOIN platform.inquiries i ON i.workspace_id=c.workspace_id
  WHERE c.case_id=p_case AND c.workspace_id=p_workspace AND c.archived_at IS NULL AND i.inquiry_id=p_inquiry
  AND (i.project_id IS NULL OR i.project_id=c.project_id)
  AND platform.case_project_access(p_actor,p_workspace,c.project_id,true)
  AND (to_jsonb(i)->>'inbox_owner_principal_id' IS NULL OR to_jsonb(i)->>'inbox_owner_principal_id'=p_actor::text))
 THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 INSERT INTO platform.case_inquiries(case_id,inquiry_id,workspace_id,linked_by) VALUES(p_case,p_inquiry,p_workspace,p_actor) ON CONFLICT DO NOTHING;
 RETURN FOUND;
END $$;

-- 状態を進める。p_from を渡すと、その間に別の人が動かしていたら CASE_STATUS_CONFLICT（同じ移り先なら何もしない）。
CREATE OR REPLACE FUNCTION platform.move_case_status(p_actor uuid, p_workspace uuid, p_case uuid, p_to text, p_from text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE cur text;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT status INTO cur FROM platform.cases WHERE case_id=p_case AND workspace_id=p_workspace AND archived_at IS NULL AND platform.case_project_access(p_actor,p_workspace,project_id,true) FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF cur=p_to THEN RETURN jsonb_build_object('caseId',p_case,'status',cur,'moved',false); END IF;
 IF p_from IS NOT NULL AND p_from<>cur THEN RAISE EXCEPTION 'CASE_STATUS_CONFLICT' USING ERRCODE='40001'; END IF;
 IF NOT platform.case_status_allowed(cur,p_to) THEN RAISE EXCEPTION 'CASE_STATUS_INVALID' USING ERRCODE='22023'; END IF;
 UPDATE platform.cases SET status=p_to,updated_at=clock_timestamp(),closed_at=CASE WHEN p_to IN ('completed','lost') THEN clock_timestamp() END WHERE case_id=p_case;
 INSERT INTO platform.case_status_changes(case_id,workspace_id,from_status,to_status,actor_principal_id) VALUES(p_case,p_workspace,cur,p_to,p_actor);
 RETURN jsonb_build_object('caseId',p_case,'status',p_to,'from',cur,'moved',true);
END $$;

-- 案件の Query（読むだけ・メンバーだけ・Event を出さない）。
-- 案件の一覧の「相手」：名簿の表示名を添える（消された人は出さない）。定義はここの1つだけ（2026-11-10：088 で上書きしていたため、
-- 087 を流し直すと名前が消えていた）。
CREATE OR REPLACE FUNCTION platform.case_json(p_workspace uuid, c platform.cases, p_manager boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',c.case_id,'title',c.title,'version',coalesce((to_jsonb(c)->>'version')::bigint,1),'nextAction',to_jsonb(c)->>'next_action','status',c.status,'projectId',c.project_id,'contactId',c.contact_id,
  'contactName',(SELECT k.display_name FROM platform.contacts k WHERE k.contact_id=c.contact_id AND k.workspace_id=p_workspace AND k.erased_at IS NULL),
  'organizationId',c.organization_id,'sourceInquiryId',(SELECT i.inquiry_id FROM platform.inquiries i
    WHERE i.inquiry_id=c.source_inquiry_id AND i.workspace_id=p_workspace AND (i.project_id IS NULL OR i.project_id=c.project_id)),'assigneeId',c.assignee_principal_id,'dueOn',c.due_on,'amount',c.amount,
  'currency',c.currency,'attributes',platform.visible_attributes(p_workspace,'_fb_cases',c.attributes,p_manager),'createdAt',c.created_at,'updatedAt',c.updated_at,'closedAt',c.closed_at))
$$;

CREATE OR REPLACE FUNCTION platform.list_cases(p_actor uuid, p_workspace uuid, p_status text, p_open_only boolean, p_project uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE manager boolean:=platform.crm_manager(p_actor,p_workspace);
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(x.j ORDER BY x.u DESC) FROM (SELECT platform.case_json(p_workspace,c,manager) j,c.updated_at u FROM platform.cases c
  WHERE c.workspace_id=p_workspace AND c.archived_at IS NULL AND (p_project IS NULL OR c.project_id=p_project) AND platform.case_project_access(p_actor,p_workspace,c.project_id,false) AND (p_status IS NULL OR c.status=p_status) AND (NOT p_open_only OR c.closed_at IS NULL)
  ORDER BY c.updated_at DESC LIMIT 500) x),'[]');
END $$;

CREATE OR REPLACE FUNCTION platform.list_cases(p_actor uuid, p_workspace uuid, p_status text DEFAULT NULL, p_open_only boolean DEFAULT false) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT platform.list_cases(p_actor,p_workspace,p_status,p_open_only,NULL::uuid)
$$;

CREATE OR REPLACE FUNCTION platform.read_case(p_actor uuid, p_workspace uuid, p_case uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE manager boolean:=platform.crm_manager(p_actor,p_workspace); c platform.cases;
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT * INTO c FROM platform.cases x WHERE x.case_id=p_case AND x.workspace_id=p_workspace AND x.archived_at IS NULL AND platform.case_project_access(p_actor,p_workspace,x.project_id,false);
 IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 RETURN platform.case_json(p_workspace,c,manager)||jsonb_build_object(
  'inquiries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.inquiry_id,'sourceRef',i.source_ref,'entrance',i.entrance,'stage',i.stage,'receivedAt',i.received_at) ORDER BY i.received_at DESC)
   FROM platform.case_inquiries l JOIN platform.inquiries i ON i.inquiry_id=l.inquiry_id
   WHERE l.case_id=p_case AND i.workspace_id=p_workspace AND (i.project_id IS NULL OR i.project_id=c.project_id)
   AND (to_jsonb(i)->>'inbox_owner_principal_id' IS NULL OR to_jsonb(i)->>'inbox_owner_principal_id'=p_actor::text)),'[]'),
  'history',coalesce((SELECT jsonb_agg(jsonb_build_object('from',h.from_status,'to',h.to_status,'actorId',h.actor_principal_id,'at',h.occurred_at) ORDER BY h.occurred_at)
   FROM platform.case_status_changes h WHERE h.case_id=p_case),'[]'));
END $$;

-- 人を開いたときの対応と案件（名簿の人から両方が見える）。
CREATE OR REPLACE FUNCTION platform.contact_work(p_actor uuid, p_workspace uuid, p_contact uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE manager boolean:=platform.crm_manager(p_actor,p_workspace);
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.contacts c WHERE c.contact_id=p_contact AND c.workspace_id=p_workspace AND c.erased_at IS NULL) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object(
  'inquiries',coalesce((SELECT jsonb_agg(jsonb_build_object('id',i.inquiry_id,'sourceRef',i.source_ref,'entrance',i.entrance,'stage',i.stage,'receivedAt',i.received_at,
    'attributes',platform.visible_attributes(p_workspace,'_fb_inquiries',i.attributes,manager),
    'caseIds',coalesce((SELECT jsonb_agg(l.case_id) FROM platform.case_inquiries l WHERE l.inquiry_id=i.inquiry_id AND EXISTS(SELECT 1 FROM platform.cases linked WHERE linked.case_id=l.case_id AND platform.case_project_access(p_actor,p_workspace,linked.project_id,false))),'[]')) ORDER BY i.received_at DESC)
   FROM platform.inquiries i WHERE i.workspace_id=p_workspace AND i.contact_id=p_contact
   AND platform.case_project_access(p_actor,p_workspace,i.project_id,false)
   AND (to_jsonb(i)->>'inbox_owner_principal_id' IS NULL OR to_jsonb(i)->>'inbox_owner_principal_id'=p_actor::text)),'[]'),
  'cases',coalesce((SELECT jsonb_agg(platform.case_json(p_workspace,c,manager) ORDER BY c.updated_at DESC) FROM platform.cases c
   WHERE c.workspace_id=p_workspace AND c.archived_at IS NULL AND platform.case_project_access(p_actor,p_workspace,c.project_id,false) AND (c.contact_id=p_contact
    OR c.case_id IN (SELECT l.case_id FROM platform.case_inquiries l JOIN platform.inquiries i ON i.inquiry_id=l.inquiry_id WHERE i.contact_id=p_contact))),'[]'));
END $$;

-- Blueprint のエイリアス（postgres.platform-alias.v1）: 読みの射影。書きは上の関数だけ。
CREATE OR REPLACE FUNCTION platform.cases_alias(p_actor uuid, p_workspace uuid)
RETURNS TABLE(record_id uuid, data jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE manager boolean:=platform.crm_manager(p_actor,p_workspace);
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CRM_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.case_id, jsonb_strip_nulls(jsonb_build_object('title',c.title,'version',coalesce((to_jsonb(c)->>'version')::bigint,1),'nextAction',to_jsonb(c)->>'next_action','status',c.status,'due_on',c.due_on,'amount',c.amount,'currency',c.currency,
   'attributes',platform.visible_attributes(p_workspace,'_fb_cases',c.attributes,manager),
   'platform_relations',(SELECT jsonb_agg(r) FROM (SELECT jsonb_build_object('type','context.ext.flapbase.contact','target',jsonb_build_object('kind','platform','id',c.contact_id)) r WHERE c.contact_id IS NOT NULL
    UNION ALL SELECT jsonb_build_object('type','context.ext.flapbase.organization','target',jsonb_build_object('kind','platform','id',c.organization_id)) WHERE c.organization_id IS NOT NULL
    UNION ALL SELECT jsonb_build_object('type','context.ext.flapbase.project','target',jsonb_build_object('kind','platform','id',c.project_id)) WHERE c.project_id IS NOT NULL) x))),
  c.updated_at
 FROM platform.cases c WHERE c.workspace_id=p_workspace AND c.archived_at IS NULL AND platform.case_project_access(p_actor,p_workspace,c.project_id,false) ORDER BY c.updated_at DESC LIMIT 1000;
END $$;

CREATE OR REPLACE FUNCTION platform.case_inquiries_alias(p_actor uuid, p_workspace uuid)
RETURNS TABLE(record_id uuid, data jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CRM_FORBIDDEN' USING ERRCODE='42501'; END IF;
 -- The link has no id of its own; the record id is derived from the pair.
 RETURN QUERY SELECT pair.id, jsonb_build_object('case',l.case_id,'inquiry',l.inquiry_id), l.linked_at
 FROM platform.case_inquiries l CROSS JOIN LATERAL (SELECT md5(l.case_id::text||':'||l.inquiry_id::text)::uuid AS id) pair
 WHERE l.workspace_id=p_workspace ORDER BY l.linked_at DESC LIMIT 1000;
END $$;

CREATE OR REPLACE FUNCTION platform.inquiries_alias(p_actor uuid, p_workspace uuid)
RETURNS TABLE(record_id uuid, data jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE manager boolean:=platform.crm_manager(p_actor,p_workspace);
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CRM_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT i.inquiry_id, jsonb_strip_nulls(jsonb_build_object('source_ref',i.source_ref,'entrance',i.entrance,'stage',i.stage,
   'received_at',i.received_at,'reply_status',to_jsonb(i)->'reply_status','next_action',to_jsonb(i)->'next_action','next_action_at',to_jsonb(i)->'next_action_at','replied_at',to_jsonb(i)->'replied_at','inbox_item_id',to_jsonb(i)->'inbox_item_id','attributes',platform.visible_attributes(p_workspace,'_fb_inquiries',i.attributes,manager),
   'platform_relations',CASE WHEN i.contact_id IS NULL THEN NULL ELSE jsonb_build_array(jsonb_build_object('type','context.ext.flapbase.contact','target',jsonb_build_object('kind','platform','id',i.contact_id))) END)),
  i.received_at
 FROM platform.inquiries i WHERE i.workspace_id=p_workspace AND platform.case_project_access(p_actor,p_workspace,i.project_id,false) AND (to_jsonb(i)->>'inbox_owner_principal_id' IS NULL OR to_jsonb(i)->>'inbox_owner_principal_id'=p_actor::text) ORDER BY i.received_at DESC LIMIT 1000;
END $$;

-- 対応の記録: 問い合わせごとの段の動き・接点（outcome_events の stage と touch）。
CREATE OR REPLACE FUNCTION platform.inquiry_activities_alias(p_actor uuid, p_workspace uuid)
RETURNS TABLE(record_id uuid, data jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CRM_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT e.event_id, jsonb_strip_nulls(jsonb_build_object('kind',e.kind,'stage',e.stage,'source_ref',e.source_ref,'occurred_at',e.occurred_at,
   'decided_by',e.decided_by,'reasons',to_jsonb(e.reasons),
   'platform_relations',CASE WHEN e.contact_ref IS NULL THEN NULL ELSE jsonb_build_array(jsonb_build_object('type','context.ext.flapbase.contact','target',jsonb_build_object('kind','platform','id',e.contact_ref))) END)),
  e.created_at
 FROM platform.outcome_events e WHERE e.workspace_id=p_workspace AND e.kind IN ('stage','touch') ORDER BY e.occurred_at DESC LIMIT 1000;
END $$;

-- 所属: 人と組織の関係（今は contacts.organization_id の1つ）。
CREATE OR REPLACE FUNCTION platform.contact_affiliations_alias(p_actor uuid, p_workspace uuid)
RETURNS TABLE(record_id uuid, data jsonb, updated_at timestamptz)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CRM_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN QUERY SELECT c.contact_id, jsonb_build_object('contact',c.contact_id,'organization',c.organization_id), c.updated_at
 FROM platform.contacts c WHERE c.workspace_id=p_workspace AND c.erased_at IS NULL AND c.organization_id IS NOT NULL ORDER BY c.updated_at DESC LIMIT 1000;
END $$;

REVOKE ALL ON FUNCTION platform.case_inquiry_access(uuid,uuid,uuid,uuid,uuid),platform.case_record_access(uuid,uuid,uuid,boolean),platform.case_record_access(uuid,uuid,uuid,boolean,uuid),platform.case_project_access(uuid,uuid,uuid,boolean),platform.case_writer(uuid,uuid),platform.check_attributes(uuid,text,jsonb,jsonb,boolean),platform.save_attribute_definition(uuid,uuid,jsonb),
 platform.attribute_definitions_of(uuid,uuid,text),platform.visible_attributes(uuid,text,jsonb,boolean),platform.set_record_attributes(uuid,uuid,text,uuid,jsonb),
 platform.case_from_inquiry(uuid,uuid,uuid,jsonb),platform.link_case_inquiry(uuid,uuid,uuid,uuid),platform.move_case_status(uuid,uuid,uuid,text,text),
 platform.case_json(uuid,platform.cases,boolean),platform.list_cases(uuid,uuid,text,boolean),platform.list_cases(uuid,uuid,text,boolean,uuid),platform.read_case(uuid,uuid,uuid),platform.contact_work(uuid,uuid,uuid),
 platform.cases_alias(uuid,uuid),platform.case_inquiries_alias(uuid,uuid),platform.inquiries_alias(uuid,uuid),platform.inquiry_activities_alias(uuid,uuid),
 platform.contact_affiliations_alias(uuid,uuid) FROM PUBLIC;
-- flap-api calls only the functions; the case tables are never granted to it directly.

-- Narrow registry writes over the existing case SSOT. Status history and inquiry links remain owned by 087.
ALTER TABLE platform.cases ADD COLUMN IF NOT EXISTS version bigint NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE platform.cases ADD COLUMN IF NOT EXISTS next_action text CHECK(next_action IS NULL OR length(btrim(next_action)) BETWEEN 1 AND 200);
CREATE OR REPLACE FUNCTION platform.case_registry_version() RETURNS trigger
LANGUAGE plpgsql SET search_path TO '' AS $$ BEGIN
 IF NEW.version IS DISTINCT FROM OLD.version THEN RAISE EXCEPTION 'CASE_VERSION_MANAGED' USING ERRCODE='22023'; END IF;
 NEW.version:=OLD.version+1;NEW.updated_at:=clock_timestamp();RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER case_registry_version BEFORE UPDATE ON platform.cases FOR EACH ROW EXECUTE FUNCTION platform.case_registry_version();
CREATE OR REPLACE FUNCTION platform.save_case_record(p_actor uuid,p_workspace uuid,p_case uuid,p_expected bigint,p jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_variable
DECLARE c platform.cases; existed boolean; project uuid; contact uuid; assignee uuid; title text; due date; next_action text; status text; organization uuid;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_case IS NULL OR p_expected IS NULL OR p_expected<0 OR jsonb_typeof(p)<>'object' OR EXISTS(SELECT 1 FROM jsonb_object_keys(p) k WHERE k NOT IN('title','projectId','contactId','assigneeId','dueOn','nextAction','status')) THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-record:'||p_case::text,0));
 SELECT * INTO c FROM platform.cases WHERE case_id=p_case AND workspace_id=p_workspace AND archived_at IS NULL FOR UPDATE;existed:=FOUND;
 IF existed THEN
  IF NOT platform.case_project_access(p_actor,p_workspace,c.project_id,true) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF c.version<>p_expected THEN RAISE EXCEPTION 'CASE_VERSION_CONFLICT' USING ERRCODE='40001'; END IF;
 ELSIF p_expected<>0 THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 project:=CASE WHEN p?'projectId' THEN (p->>'projectId')::uuid ELSE c.project_id END;
 contact:=CASE WHEN p?'contactId' THEN (p->>'contactId')::uuid ELSE c.contact_id END;
 assignee:=CASE WHEN p?'assigneeId' THEN (p->>'assigneeId')::uuid ELSE c.assignee_principal_id END;
 title:=CASE WHEN p?'title' THEN btrim(p->>'title') ELSE c.title END;
 due:=CASE WHEN p?'dueOn' THEN (p->>'dueOn')::date ELSE c.due_on END;
 next_action:=CASE WHEN p?'nextAction' THEN nullif(btrim(p->>'nextAction'),'') ELSE c.next_action END;
 status:=CASE WHEN p?'status' THEN p->>'status' ELSE coalesce(c.status,'received') END;
 IF title IS NULL OR length(title) NOT BETWEEN 1 AND 200 OR length(next_action)>200 OR status IS NULL OR status NOT IN('received','estimating','ordered','in_progress','delivered','invoiced','completed','lost') OR (p?'dueOn' AND p->>'dueOn' IS NOT NULL AND to_char(due,'YYYY-MM-DD')<>p->>'dueOn') THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF NOT platform.case_project_access(p_actor,p_workspace,project,true) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF (NOT existed OR p?'contactId') AND contact IS NOT NULL THEN
  SELECT organization_id INTO organization FROM platform.contacts WHERE contact_id=contact AND workspace_id=p_workspace AND erased_at IS NULL;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_REFERENCE_INVALID' USING ERRCODE='42501'; END IF;
 ELSE organization:=c.organization_id; END IF;
 IF (NOT existed OR p?'assigneeId' OR project IS DISTINCT FROM c.project_id) AND assignee IS NOT NULL AND (NOT platform.case_writer(assignee,p_workspace) OR NOT platform.case_project_access(assignee,p_workspace,project,true)) THEN RAISE EXCEPTION 'CASE_REFERENCE_INVALID' USING ERRCODE='42501'; END IF;
 IF existed THEN
  IF c.status<>status AND NOT platform.case_status_allowed(c.status,status) THEN RAISE EXCEPTION 'CASE_STATUS_INVALID' USING ERRCODE='22023'; END IF;
  UPDATE platform.cases SET title=title,project_id=project,contact_id=contact,organization_id=organization,assignee_principal_id=assignee,due_on=due,next_action=next_action,status=status,closed_at=CASE WHEN status IN('completed','lost') THEN coalesce(c.closed_at,clock_timestamp()) END WHERE case_id=p_case;
 ELSE
  IF status<>'received' THEN RAISE EXCEPTION 'CASE_STATUS_INVALID' USING ERRCODE='22023'; END IF;
  INSERT INTO platform.cases(case_id,workspace_id,project_id,contact_id,organization_id,title,assignee_principal_id,due_on,next_action,idempotency_key,created_by) VALUES(p_case,p_workspace,project,contact,organization,title,assignee,due,next_action,'case-record:'||p_case::text,p_actor);
 END IF;
 IF NOT existed OR c.status<>status THEN INSERT INTO platform.case_status_changes(case_id,workspace_id,from_status,to_status,actor_principal_id) VALUES(p_case,p_workspace,c.status,status,p_actor); END IF;
 RETURN platform.read_case(p_actor,p_workspace,p_case);
EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow OR unique_violation THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023';
END $$;
REVOKE ALL ON FUNCTION platform.case_registry_version(),platform.save_case_record(uuid,uuid,uuid,bigint,jsonb) FROM PUBLIC;

CREATE OR REPLACE FUNCTION platform.case_registry_options(p_actor uuid,p_workspace uuid,p_case uuid,p_project uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c platform.cases; result jsonb;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF p_case IS NOT NULL THEN
  SELECT * INTO c FROM platform.cases WHERE case_id=p_case AND workspace_id=p_workspace AND archived_at IS NULL AND platform.case_project_access(p_actor,p_workspace,project_id,false);
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 END IF;
 IF NOT platform.case_project_access(p_actor,p_workspace,p_project,true) THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object(
 'statuses',(SELECT jsonb_agg(s) FROM unnest(ARRAY['received','estimating','ordered','in_progress','delivered','invoiced','completed','lost']) s WHERE (p_case IS NULL AND s='received') OR (p_case IS NOT NULL AND (s=c.status OR platform.case_status_allowed(c.status,s)))),
 'projects',coalesce((SELECT jsonb_agg(j) FROM(SELECT jsonb_build_object('id',p.project_id,'label',p.name) j FROM platform.projects p WHERE p.workspace_id=p_workspace AND platform.case_project_access(p_actor,p_workspace,p.project_id,true) ORDER BY (p.project_id=coalesce(p_project,c.project_id)) DESC NULLS LAST,p.name,p.project_id LIMIT 100) x),'[]'),
 'contacts',coalesce((SELECT jsonb_agg(j) FROM(SELECT jsonb_build_object('id',k.contact_id,'label',coalesce(k.display_name,'氏名未設定')) j FROM platform.contacts k WHERE k.workspace_id=p_workspace AND k.erased_at IS NULL ORDER BY (k.contact_id=c.contact_id) DESC NULLS LAST,k.last_contacted_at DESC,k.contact_id LIMIT 100) x),'[]'),
 'members',coalesce((SELECT jsonb_agg(j) FROM(SELECT jsonb_build_object('id',h.principal_id,'label',coalesce(h.display_name,'氏名未設定')) j FROM identity.principals h JOIN platform.workspace_members m USING(principal_id) WHERE m.workspace_id=p_workspace AND h.status='active' AND h.principal_kind='human' AND platform.case_writer(h.principal_id,p_workspace) AND platform.case_project_access(h.principal_id,p_workspace,p_project,true) ORDER BY (h.principal_id=c.assignee_principal_id) DESC NULLS LAST,h.display_name,h.principal_id LIMIT 100) x),'[]')) INTO result;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION platform.case_registry_options(uuid,uuid,uuid,uuid) FROM PUBLIC;

-- Current targets and edited references are revalidated before durable replay, as well as by the writer.
CREATE OR REPLACE FUNCTION platform.case_registry_authorized(p_actor uuid,p_workspace uuid,p_case uuid,p jsonb) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c record; project uuid; assignee uuid;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RETURN false; END IF;
 SELECT project_id,assignee_principal_id INTO c FROM platform.cases WHERE case_id=p_case AND workspace_id=p_workspace AND archived_at IS NULL;
 IF FOUND AND NOT platform.case_project_access(p_actor,p_workspace,c.project_id,true) THEN RETURN false; END IF;
 project:=CASE WHEN p?'projectId' THEN (p->>'projectId')::uuid ELSE c.project_id END;
 IF NOT platform.case_project_access(p_actor,p_workspace,project,true) THEN RETURN false; END IF;
 IF p?'contactId' AND p->>'contactId' IS NOT NULL AND NOT EXISTS(SELECT 1 FROM platform.contacts k WHERE k.contact_id=(p->>'contactId')::uuid AND k.workspace_id=p_workspace AND k.erased_at IS NULL) THEN RETURN false; END IF;
 assignee:=CASE WHEN p?'assigneeId' THEN (p->>'assigneeId')::uuid ELSE c.assignee_principal_id END;
 IF p?'assigneeId' AND assignee IS NOT NULL AND (NOT platform.case_writer(assignee,p_workspace) OR NOT platform.case_project_access(assignee,p_workspace,project,true)) THEN RETURN false; END IF;
 RETURN true;
END $$;
REVOKE ALL ON FUNCTION platform.case_registry_authorized(uuid,uuid,uuid,jsonb) FROM PUBLIC;

-- リードの1周 段2（2026-11-10）：案件の状態を、結び付いた問い合わせと顧客の段へ返す。
-- 受注（ordered）から先は won、失注は lost。失注から受付へ戻したときだけ opportunity に戻す（人の判断として足す。消さない）。
-- 書くのは record_outcome_event（ただ1つの書き手）。段が won に変わると、既存の「購入」のステップ配信（086）が動く。
-- 案件の関数（087）は名簿を書かない、という分け方を保つため、案件の状態の記録（case_status_changes）への追加で動かす。
CREATE OR REPLACE FUNCTION platform.case_outcome_stage(p_status text) RETURNS text LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT CASE WHEN p_status IN ('ordered','in_progress','delivered','invoiced','completed') THEN 'won'
  WHEN p_status='lost' THEN 'lost' ELSE 'opportunity' END
$$;

CREATE OR REPLACE FUNCTION platform.case_status_outcome_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE target text:=platform.case_outcome_stage(NEW.to_status); r record;
BEGIN
 FOR r IN SELECT i.inquiry_id,i.source_ref,i.stage,i.project_id FROM platform.inquiries i
  WHERE i.workspace_id=NEW.workspace_id AND (i.inquiry_id IN (SELECT l.inquiry_id FROM platform.case_inquiries l WHERE l.case_id=NEW.case_id)
   OR i.inquiry_id=(SELECT c.source_inquiry_id FROM platform.cases c WHERE c.case_id=NEW.case_id))
 LOOP
  -- 同じ段なら記録しない。受付・見積へ進めただけでは段を動かさない（失注・受注から戻したときだけ opportunity）。
  CONTINUE WHEN r.stage=target OR (target='opportunity' AND r.stage NOT IN ('won','lost'));
  PERFORM platform.record_outcome_event(jsonb_build_object('workspaceId',NEW.workspace_id,'kind','stage','stage',target,'decidedBy','human',
   'actorPrincipalId',NEW.actor_principal_id,'sourceRef',r.source_ref,'idempotencyKey','case-status:'||NEW.change_id::text||':'||r.inquiry_id::text,
   'occurredAt',NEW.occurred_at,'projectId',r.project_id,'reasons',jsonb_build_array('case_status:'||NEW.to_status)));
 END LOOP;
 RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION platform.case_status_outcome_event() FROM PUBLIC;
CREATE OR REPLACE TRIGGER case_status_outcome AFTER INSERT ON platform.case_status_changes
 FOR EACH ROW EXECUTE FUNCTION platform.case_status_outcome_event();

-- 顧客の窓口と顧客への依頼（2026-11-03 Owner §9-5・§9-6 の2・§11-1）。案件 Flapp の上に足す（案件の表と状態の遷移は変えない）。
-- 窓口: ワークスペースごとに推測できない鍵を1つ持つ。顧客は Flap ID（メールの確認コードで確かめた本人）で入り、
--   そのワークスペースの名簿で同じ確かめたメールの人として、自分の案件と自分への依頼だけを見る。鍵や Flap ID を知っていることは証拠にしない。
-- 依頼: 事業者が案件から作る（項目は 文字・長い文字・ファイル、期限は任意）。答えは依頼ごとに1件（主キー）で、二重送信は起きない。
-- 案内メール: 依頼を作った・期限の前・答えが届いた の3つ。Outbox（dedupe_key が一意）に入れ、送る側は取り出して送るか、差出人の設定が
--   なければ送らずに held で残す。宛先は送るときに名簿から引き、Outbox には持たない。
-- 実行の記録: 本人（誰のための操作か）・実行の主体・委任元・ワークスペース・Action・結果を customer_action_log に残す。

CREATE TABLE IF NOT EXISTS platform.customer_portals (
 workspace_id uuid PRIMARY KEY REFERENCES platform.workspaces(workspace_id),
 portal_key text NOT NULL UNIQUE CHECK(portal_key ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS platform.case_requests (
 request_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 case_id uuid NOT NULL REFERENCES platform.cases(case_id),
 -- 依頼を作ったときの案件の相手（スナップショット）。窓口ではこの人だけが見る。
 contact_id uuid NOT NULL REFERENCES platform.contacts(contact_id),
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 fields jsonb NOT NULL CHECK(jsonb_typeof(fields)='array' AND jsonb_array_length(fields) BETWEEN 1 AND 20 AND octet_length(fields::text)<=16384),
 due_on date,
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','answered')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 answered_at timestamptz,
 UNIQUE(workspace_id,idempotency_key),
 CHECK((status='answered')=(answered_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS case_requests_case ON platform.case_requests(case_id,created_at DESC);
CREATE INDEX IF NOT EXISTS case_requests_contact ON platform.case_requests(workspace_id,contact_id,created_at DESC);
CREATE INDEX IF NOT EXISTS case_requests_due ON platform.case_requests(due_on) WHERE status='open' AND due_on IS NOT NULL;

CREATE TABLE IF NOT EXISTS platform.case_request_answers (
 request_id uuid PRIMARY KEY REFERENCES platform.case_requests(request_id),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 answer_values jsonb NOT NULL CHECK(jsonb_typeof(answer_values)='object' AND octet_length(answer_values::text)<=65536),
 files jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(files)='array' AND jsonb_array_length(files)<=20),
 answered_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 answered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS platform.case_mail_outbox (
 mail_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 request_id uuid NOT NULL REFERENCES platform.case_requests(request_id),
 kind text NOT NULL CHECK(kind IN ('request.created','request.due_soon','request.answered')),
 dedupe_key text NOT NULL UNIQUE CHECK(length(dedupe_key) BETWEEN 1 AND 200),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','held','failed')),
 held_reason text CHECK(held_reason IS NULL OR held_reason IN ('sender_unconfigured','recipient_missing')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 claimed_at timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='held')=(held_reason IS NOT NULL)),
 CHECK((state='sent')=(sent_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS case_mail_outbox_due ON platform.case_mail_outbox(created_at) WHERE state IN ('pending','sending');

CREATE TABLE IF NOT EXISTS platform.customer_action_log (
 log_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 subject_contact_id uuid REFERENCES platform.contacts(contact_id),
 actor_kind text NOT NULL CHECK(actor_kind IN ('human','workflow','agent')),
 actor_ref text NOT NULL CHECK(length(actor_ref) BETWEEN 1 AND 100),
 delegated_by text NOT NULL CHECK(delegated_by IN ('customer','owner')),
 action text NOT NULL CHECK(action ~ '^[a-z][a-z.-]{1,60}$'),
 target_id uuid,
 result text NOT NULL CHECK(result IN ('ok','duplicate','sent','held','failed','retry')),
 occurred_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS customer_action_log_workspace ON platform.customer_action_log(workspace_id,occurred_at DESC);

-- 依頼の項目の宣言を確かめる: [{key,label,type,required}]。type は text・long_text・file。鍵は重ならない。
CREATE OR REPLACE FUNCTION platform.case_request_fields_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT jsonb_typeof(p)='array' AND jsonb_array_length(p) BETWEEN 1 AND 20
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p) f WHERE jsonb_typeof(f)<>'object'
   OR NOT (f ?& ARRAY['key','label','type']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('key','label','type','required'))
   OR jsonb_typeof(f->'key')<>'string' OR NOT (f->>'key') ~ '^[a-z][a-z0-9_]{0,39}$'
   OR jsonb_typeof(f->'label')<>'string' OR length(btrim(f->>'label')) NOT BETWEEN 1 AND 80
   OR coalesce(f->>'type','') NOT IN ('text','long_text','file')
   OR (f ? 'required' AND jsonb_typeof(f->'required')<>'boolean'))
  AND (SELECT count(DISTINCT f->>'key') FROM jsonb_array_elements(p) f)=jsonb_array_length(p)
$$;

-- 窓口の鍵（ワークスペースに1つ、なければ作る）。依頼を作る Action の中で呼ぶ。
CREATE OR REPLACE FUNCTION platform.ensure_customer_portal(p_actor uuid, p_workspace uuid) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE k text;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 INSERT INTO platform.customer_portals(workspace_id,portal_key,created_by)
  VALUES(p_workspace,replace(gen_random_uuid()::text||gen_random_uuid()::text,'-',''),p_actor) ON CONFLICT (workspace_id) DO NOTHING;
 SELECT portal_key INTO k FROM platform.customer_portals WHERE workspace_id=p_workspace;
 RETURN k;
END $$;

-- 依頼を作る（Action の中で呼ぶ）。同じキーは同じ依頼を返す。案件に相手がいないときは作れない。
CREATE OR REPLACE FUNCTION platform.case_request_create(p_actor uuid, p_workspace uuid, p_case uuid, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c record; r platform.case_requests; k text:=p_input->>'idempotencyKey'; portal text; due date; mail uuid;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF k IS NULL OR length(k) NOT BETWEEN 1 AND 200 OR jsonb_typeof(p_input->'title')<>'string' OR length(btrim(p_input->>'title')) NOT BETWEEN 1 AND 200
  OR NOT platform.case_request_fields_valid(p_input->'fields')
  OR (p_input ? 'dueOn' AND (jsonb_typeof(p_input->'dueOn')<>'string' OR NOT (p_input->>'dueOn') ~ '^\d{4}-\d{2}-\d{2}$'))
  THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 due:=(p_input->>'dueOn')::date;
 SELECT * INTO r FROM platform.case_requests x WHERE x.workspace_id=p_workspace AND x.idempotency_key=k;
 IF FOUND THEN
  IF r.case_id<>p_case THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('requestId',r.request_id,'created',false,'portalKey',platform.ensure_customer_portal(p_actor,p_workspace));
 END IF;
 SELECT x.case_id,x.contact_id INTO c FROM platform.cases x JOIN platform.contacts k2 ON k2.contact_id=x.contact_id AND k2.workspace_id=p_workspace AND k2.erased_at IS NULL
  WHERE x.case_id=p_case AND x.workspace_id=p_workspace AND x.archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 portal:=platform.ensure_customer_portal(p_actor,p_workspace);
 INSERT INTO platform.case_requests(workspace_id,case_id,contact_id,title,fields,due_on,idempotency_key,created_by)
  VALUES(p_workspace,p_case,c.contact_id,btrim(p_input->>'title'),p_input->'fields',due,k,p_actor) RETURNING * INTO r;
 INSERT INTO platform.case_mail_outbox(workspace_id,request_id,kind,dedupe_key) VALUES(p_workspace,r.request_id,'request.created','request-created:'||r.request_id::text)
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING mail_id INTO mail;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
  VALUES(p_workspace,c.contact_id,'human',p_actor::text,'owner','case-request.create',r.request_id,'ok');
 RETURN jsonb_strip_nulls(jsonb_build_object('requestId',r.request_id,'created',true,'portalKey',portal,'mailId',mail));
END $$;

CREATE OR REPLACE FUNCTION platform.case_request_json(r platform.case_requests, p_with_answer boolean) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',r.request_id,'caseId',r.case_id,'title',r.title,'fields',r.fields,'dueOn',r.due_on,'status',r.status,
  'createdAt',r.created_at,'answeredAt',r.answered_at,
  'answer',CASE WHEN p_with_answer THEN (SELECT jsonb_build_object('values',a.answer_values,'files',a.files) FROM platform.case_request_answers a WHERE a.request_id=r.request_id) END))
$$;

-- 事業者の Query: 案件の依頼と答え（メンバーだけ・Event を出さない）。
CREATE OR REPLACE FUNCTION platform.case_requests_of(p_actor uuid, p_workspace uuid, p_case uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('portalKey',(SELECT p.portal_key FROM platform.customer_portals p WHERE p.workspace_id=p_workspace),
  'requests',coalesce((SELECT jsonb_agg(platform.case_request_json(r,true) ORDER BY r.created_at DESC) FROM platform.case_requests r
   WHERE r.workspace_id=p_workspace AND r.case_id=p_case),'[]'));
END $$;

-- 答えのファイルを1つ引く（メンバーだけ）。返すのは保存先の鍵と種類だけ。
CREATE OR REPLACE FUNCTION platform.case_request_file(p_actor uuid, p_workspace uuid, p_request uuid, p_file text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN (SELECT f FROM platform.case_request_answers a CROSS JOIN LATERAL jsonb_array_elements(a.files) f
  WHERE a.request_id=p_request AND a.workspace_id=p_workspace AND f->>'id'=p_file LIMIT 1);
END $$;

-- 窓口の本人: 確かめたメール（identity.principals.email）と同じ名簿の人。ワークスペースの外は見ない。鍵が違えば NULL。
CREATE OR REPLACE FUNCTION platform.customer_portal_contacts(p_principal uuid, p_portal_key text) RETURNS TABLE(workspace_id uuid, contact_id uuid)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT p.workspace_id, k.contact_id FROM platform.customer_portals p
 JOIN identity.principals h ON h.principal_id=p_principal AND h.principal_kind='human' AND h.status='active' AND h.email IS NOT NULL
 JOIN platform.workspaces w ON w.workspace_id=p.workspace_id AND w.status='active'
 JOIN platform.contacts k ON k.workspace_id=p.workspace_id AND k.erased_at IS NULL AND k.email_normalized=lower(btrim(h.email))
 WHERE p.portal_key=p_portal_key
$$;

-- 顧客の Query: 窓口の1画面（事業者の名前・自分の案件・自分への依頼）。見えないときは NULL（鍵が違うのと同じ答え）。
CREATE OR REPLACE FUNCTION platform.customer_portal_view(p_principal uuid, p_portal_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE ws uuid; people uuid[];
BEGIN
 SELECT min(x.workspace_id::text)::uuid, array_agg(x.contact_id) INTO ws, people FROM platform.customer_portal_contacts(p_principal,p_portal_key) x;
 IF ws IS NULL THEN RETURN NULL; END IF;
 RETURN jsonb_build_object('business',jsonb_build_object('name',(SELECT w.name FROM platform.workspaces w WHERE w.workspace_id=ws)),
  'cases',coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.case_id,'title',c.title,'status',c.status) ORDER BY c.updated_at DESC) FROM platform.cases c
   WHERE c.workspace_id=ws AND c.archived_at IS NULL AND c.contact_id=ANY(people)),'[]'),
  'requests',coalesce((SELECT jsonb_agg(platform.case_request_json(r,false) ORDER BY r.created_at DESC) FROM platform.case_requests r
   WHERE r.workspace_id=ws AND r.contact_id=ANY(people)),'[]'));
END $$;

-- 顧客が答える前の確かめ（ファイルを保存する前に呼ぶ）。本人の依頼でなければ NULL。
CREATE OR REPLACE FUNCTION platform.customer_portal_request(p_principal uuid, p_portal_key text, p_request uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('workspaceId',r.workspace_id,'status',r.status,'fields',r.fields) FROM platform.case_requests r
 JOIN platform.customer_portal_contacts(p_principal,p_portal_key) x ON x.workspace_id=r.workspace_id AND x.contact_id=r.contact_id
 WHERE r.request_id=p_request
$$;

-- 顧客が答える（Action の中で呼ぶ）。答えは依頼ごとに1件。2回目は duplicate で何も変えない。
CREATE OR REPLACE FUNCTION platform.customer_request_answer(p_principal uuid, p_portal_key text, p_request uuid, p_values jsonb, p_files jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE r platform.case_requests; f jsonb; v jsonb; c record; project uuid; kept jsonb:='{}'; mail uuid;
BEGIN
 SELECT q.* INTO r FROM platform.case_requests q JOIN platform.customer_portal_contacts(p_principal,p_portal_key) x ON x.workspace_id=q.workspace_id AND x.contact_id=q.contact_id
  WHERE q.request_id=p_request FOR UPDATE OF q;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF r.status<>'open' THEN
  INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
   VALUES(r.workspace_id,r.contact_id,'human',p_principal::text,'customer','case-request.answer',r.request_id,'duplicate');
  RETURN jsonb_build_object('requestId',r.request_id,'answered',false,'duplicate',true);
 END IF;
 IF jsonb_typeof(p_values)<>'object' OR jsonb_typeof(p_files)<>'array' THEN RAISE EXCEPTION 'PORTAL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 FOR f IN SELECT * FROM jsonb_array_elements(r.fields) LOOP
  IF f->>'type'='file' THEN
   IF coalesce((f->>'required')::boolean,false) AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_files) x WHERE x->>'field'=f->>'key')
    THEN RAISE EXCEPTION 'PORTAL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
   CONTINUE;
  END IF;
  v:=p_values->(f->>'key');
  IF v IS NULL OR jsonb_typeof(v)='null' OR (jsonb_typeof(v)='string' AND btrim(v#>>'{}')='') THEN
   IF coalesce((f->>'required')::boolean,false) THEN RAISE EXCEPTION 'PORTAL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
   CONTINUE;
  END IF;
  IF jsonb_typeof(v)<>'string' OR length(v#>>'{}')>(ARRAY[2000,10000])[(f->>'type'='long_text')::integer+1] THEN RAISE EXCEPTION 'PORTAL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
  kept:=kept||jsonb_build_object(f->>'key',v);
 END LOOP;
 -- 宣言にない値・ファイルは受け取らない。
 IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_values) k WHERE NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.fields) d WHERE d->>'key'=k AND d->>'type'<>'file'))
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_files) x WHERE jsonb_typeof(x)<>'object' OR NOT (x ?& ARRAY['id','field','name','type','size','storageKey'])
   OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(r.fields) d WHERE d->>'key'=x->>'field' AND d->>'type'='file'))
  THEN RAISE EXCEPTION 'PORTAL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 INSERT INTO platform.case_request_answers(request_id,workspace_id,answer_values,files,answered_by) VALUES(r.request_id,r.workspace_id,kept,p_files,p_principal);
 UPDATE platform.case_requests SET status='answered',answered_at=clock_timestamp() WHERE request_id=r.request_id;
 -- 事業者へベルで知らせる（案件の担当、いなければ owner・admin）。依頼ごとに1回。
 SELECT x.title,x.project_id,x.assignee_principal_id INTO c FROM platform.cases x WHERE x.case_id=r.case_id;
 project:=coalesce(c.project_id,(SELECT p.project_id FROM platform.projects p WHERE p.workspace_id=r.workspace_id AND p.status='active' ORDER BY p.created_at,p.project_id LIMIT 1));
 IF project IS NOT NULL THEN
  INSERT INTO platform.notifications(project_id,recipient_principal_id,kind,title,body,action_label,href,dedupe_key)
  SELECT project,m.principal_id,'case.request.answered','依頼の答えが届きました',left(r.title,200),'開く','/?mode=operations','case-request-answered:'||r.request_id::text
  FROM platform.workspace_members m JOIN identity.principals pr ON pr.principal_id=m.principal_id AND pr.status='active' AND pr.principal_kind='human'
  WHERE m.workspace_id=r.workspace_id AND m.status='active'
   AND ((c.assignee_principal_id IS NOT NULL AND m.principal_id=c.assignee_principal_id) OR (c.assignee_principal_id IS NULL AND m.member_role IN ('owner','admin')))
  ON CONFLICT (recipient_principal_id,project_id,dedupe_key) DO NOTHING;
 END IF;
 INSERT INTO platform.case_mail_outbox(workspace_id,request_id,kind,dedupe_key) VALUES(r.workspace_id,r.request_id,'request.answered','request-answered:'||r.request_id::text)
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING mail_id INTO mail;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
  VALUES(r.workspace_id,r.contact_id,'human',p_principal::text,'customer','case-request.answer',r.request_id,'ok');
 RETURN jsonb_strip_nulls(jsonb_build_object('requestId',r.request_id,'answered',true,'mailId',mail));
END $$;

-- 期限の前の案内を Outbox に入れる（その日と翌日が期限の、答えていない依頼）。期限ごとに1回。
CREATE OR REPLACE FUNCTION platform.case_mail_enqueue_due(p_today date) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE added integer;
BEGIN
 INSERT INTO platform.case_mail_outbox(workspace_id,request_id,kind,dedupe_key)
 SELECT r.workspace_id,r.request_id,'request.due_soon','request-due:'||r.request_id::text||':'||r.due_on::text FROM platform.case_requests r
 WHERE r.status='open' AND r.due_on BETWEEN p_today AND p_today+1
 ON CONFLICT (dedupe_key) DO NOTHING;
 GET DIAGNOSTICS added=ROW_COUNT;
 RETURN added;
END $$;

-- 送る分を取り出す（pending と、10分より前に取り出したまま終わっていないもの）。p_ids を渡したときはその行だけ。
-- 宛先は名簿の今のメール（消された人・メールのない人は NULL）。
CREATE OR REPLACE FUNCTION platform.case_mail_claim(p_ids uuid[], p_limit integer)
RETURNS TABLE(mail_id uuid, kind text, business_name text, portal_key text, request_title text, recipient text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
BEGIN
 RETURN QUERY WITH picked AS (
  SELECT o.mail_id FROM platform.case_mail_outbox o
  WHERE (o.state='pending' OR (o.state='sending' AND o.claimed_at<clock_timestamp()-interval '10 minutes'))
   AND (p_ids IS NULL OR o.mail_id=ANY(p_ids))
  ORDER BY o.created_at LIMIT least(greatest(coalesce(p_limit,20),1),100) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE platform.case_mail_outbox o SET state='sending',claimed_at=clock_timestamp(),attempts=o.attempts+1 FROM picked WHERE o.mail_id=picked.mail_id
  RETURNING o.mail_id,o.kind,o.workspace_id,o.request_id
 )
 SELECT c.mail_id,c.kind,w.name,p.portal_key,r.title,k.email_normalized
 FROM claimed c JOIN platform.workspaces w ON w.workspace_id=c.workspace_id
 JOIN platform.case_requests r ON r.request_id=c.request_id
 LEFT JOIN platform.customer_portals p ON p.workspace_id=c.workspace_id
 LEFT JOIN platform.contacts k ON k.contact_id=r.contact_id AND k.workspace_id=c.workspace_id AND k.erased_at IS NULL;
END $$;

-- 送った結果を残す。retry は pending に戻す（5回で failed）。sent・held・failed は記録に残す。
CREATE OR REPLACE FUNCTION platform.case_mail_finish(p_mail uuid, p_result text, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE o platform.case_mail_outbox; next_state text; who uuid;
BEGIN
 IF p_result NOT IN ('sent','held','retry') THEN RAISE EXCEPTION 'CASE_MAIL_RESULT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO o FROM platform.case_mail_outbox x WHERE x.mail_id=p_mail AND x.state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 next_state:=CASE WHEN p_result='retry' AND o.attempts>=5 THEN 'failed' WHEN p_result='retry' THEN 'pending' ELSE p_result END;
 UPDATE platform.case_mail_outbox SET state=next_state,held_reason=CASE WHEN next_state='held' THEN coalesce(p_reason,'sender_unconfigured') END,
  sent_at=CASE WHEN next_state='sent' THEN clock_timestamp() END WHERE mail_id=p_mail;
 SELECT r.contact_id INTO who FROM platform.case_requests r WHERE r.request_id=o.request_id;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
  VALUES(o.workspace_id,who,'workflow','case-mail','owner','case-mail.'||translate(replace(o.kind,'request.',''),'_','-'),o.mail_id,
   CASE next_state WHEN 'pending' THEN 'retry' ELSE next_state END);
 RETURN next_state;
END $$;

REVOKE ALL ON FUNCTION platform.ensure_customer_portal(uuid,uuid),platform.case_request_create(uuid,uuid,uuid,jsonb),platform.case_request_json(platform.case_requests,boolean),
 platform.case_requests_of(uuid,uuid,uuid),platform.case_request_file(uuid,uuid,uuid,text),platform.customer_portal_contacts(uuid,text),platform.customer_portal_view(uuid,text),
 platform.customer_portal_request(uuid,text,uuid),platform.customer_request_answer(uuid,text,uuid,jsonb,jsonb),platform.case_mail_enqueue_due(date),
 platform.case_mail_claim(uuid[],integer),platform.case_mail_finish(uuid,text,text) FROM PUBLIC;
-- flap-api は関数だけを呼ぶ。表は直接渡さない。

-- 案件の見積と顧客の承認（2026-11-03 Owner 承認）。案件 Flapp の上に足す（案件の表・依頼の表・既存の関数は変えない）。
-- 見積: 案件の中で作る。明細（品名・数量・単価・税率 10/8/0）・有効期限・備考。金額は円の整数で DB が計算する（税率ごとに合計して税は切り捨て）。
--   下書きのあいだだけ直せる。送ると内容が固定され、同じ案件の前に送った見積は「差し替え済み」になる。直すときは新しい版を作る。
--   顧客は窓口の本人（確かめたメールの名簿の人）だけが、承認か辞退を1回選ぶ。答えたあとは変えられない。
-- 追加だけ: DELETE は書かない。消す代わりに状態の列を使う。表の行は DELETE できない（下の trigger）。
-- 案内メールは見積専用の Outbox（case_quote_mail_outbox）。依頼の Outbox（case_mail_outbox）は変えない。宛先は送るときに名簿から引く。
-- 前提: oss/platform の 087_cases・088_case_notifications・089_customer_portal（platform.cases・contacts・notifications・customer_portals・customer_action_log）。

-- 明細の宣言を確かめる: [{name,quantity,unitPrice,taxRate}]。数量は小数2桁まで、単価は円の整数、税率は 10・8・0。
CREATE OR REPLACE FUNCTION platform.case_quote_lines_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT jsonb_typeof(p)='array' AND jsonb_array_length(p) BETWEEN 1 AND 50
  AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p) f WHERE jsonb_typeof(f)<>'object'
   OR NOT (f ?& ARRAY['name','quantity','unitPrice','taxRate']) OR EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('name','quantity','unitPrice','taxRate'))
   OR jsonb_typeof(f->'name')<>'string' OR length(btrim(f->>'name')) NOT BETWEEN 1 AND 200
   OR NOT CASE WHEN jsonb_typeof(f->'quantity')='number' THEN (f->>'quantity')::numeric BETWEEN 0.01 AND 99999 AND (f->>'quantity')::numeric=round((f->>'quantity')::numeric,2) ELSE false END
   OR NOT CASE WHEN jsonb_typeof(f->'unitPrice')='number' THEN (f->>'unitPrice')::numeric BETWEEN 0 AND 999999999 AND (f->>'unitPrice')::numeric=trunc((f->>'unitPrice')::numeric) ELSE false END
   OR NOT CASE WHEN jsonb_typeof(f->'taxRate')='number' THEN (f->>'taxRate')::numeric IN (10,8,0) ELSE false END)
$$;

-- 検証済みの明細を同じ形に整える（品名の前後の空白を落とし、余分な鍵を持たない）。
CREATE OR REPLACE FUNCTION platform.case_quote_lines_normalize(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT jsonb_agg(jsonb_build_object('name',btrim(f->>'name'),'quantity',(f->>'quantity')::numeric,'unitPrice',(f->>'unitPrice')::bigint,'taxRate',(f->>'taxRate')::integer) ORDER BY o)
 FROM jsonb_array_elements(p) WITH ORDINALITY a(f,o)
$$;

-- 小計・税・合計（円の整数）。行は四捨五入、税は税率ごとの小計に掛けて切り捨てる。
CREATE OR REPLACE FUNCTION platform.case_quote_totals(p jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 WITH l AS (SELECT (f->>'taxRate')::integer AS rate, round((f->>'quantity')::numeric*(f->>'unitPrice')::numeric) AS amount FROM jsonb_array_elements(p) f),
 g AS (SELECT rate, sum(amount) AS s, floor(sum(amount)*rate/100) AS t FROM l GROUP BY rate)
 SELECT jsonb_build_object('subtotal',coalesce(sum(s),0)::bigint,'tax',coalesce(sum(t),0)::bigint,'total',coalesce(sum(s+t),0)::bigint) FROM g
$$;

CREATE TABLE IF NOT EXISTS platform.case_quotes (
 quote_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 case_id uuid NOT NULL REFERENCES platform.cases(case_id),
 -- 作ったときの案件の相手（スナップショット）。窓口ではこの人だけが見る。
 contact_id uuid NOT NULL REFERENCES platform.contacts(contact_id),
 version integer NOT NULL CHECK(version>=1),
 lines jsonb NOT NULL CHECK(platform.case_quote_lines_valid(lines)),
 valid_until date,
 note text CHECK(note IS NULL OR length(note) BETWEEN 1 AND 2000),
 subtotal bigint NOT NULL CHECK(subtotal>=0),
 tax_amount bigint NOT NULL CHECK(tax_amount>=0),
 total bigint NOT NULL CHECK(total=subtotal+tax_amount),
 status text NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','sent','accepted','declined','superseded')),
 idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200),
 created_by uuid NOT NULL REFERENCES identity.principals(principal_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 sent_at timestamptz,
 answered_at timestamptz,
 answered_by uuid REFERENCES identity.principals(principal_id),
 answer_comment text CHECK(answer_comment IS NULL OR length(answer_comment) BETWEEN 1 AND 1000),
 UNIQUE(workspace_id,idempotency_key),
 UNIQUE(case_id,version),
 CHECK((status='draft')=(sent_at IS NULL)),
 CHECK((status IN ('accepted','declined'))=(answered_at IS NOT NULL AND answered_by IS NOT NULL)),
 CHECK(answer_comment IS NULL OR status IN ('accepted','declined'))
);
CREATE INDEX IF NOT EXISTS case_quotes_case ON platform.case_quotes(case_id,version DESC);
CREATE INDEX IF NOT EXISTS case_quotes_contact ON platform.case_quotes(workspace_id,contact_id,created_at DESC) WHERE status<>'draft';

-- 固定したあとは内容を変えない・答えたあとは何も変えない・行は消せない。
CREATE OR REPLACE FUNCTION platform.case_quotes_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CASE_QUOTE_LOCKED' USING ERRCODE='55000'; END IF;
 IF OLD.status='draft' THEN
  IF NEW.status NOT IN ('draft','sent') THEN RAISE EXCEPTION 'CASE_QUOTE_LOCKED' USING ERRCODE='55000'; END IF;
 ELSIF OLD.status<>'sent' THEN
  IF NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'CASE_QUOTE_LOCKED' USING ERRCODE='55000'; END IF;
 ELSIF (NEW.workspace_id,NEW.case_id,NEW.contact_id,NEW.version,NEW.lines,NEW.valid_until,NEW.note,NEW.subtotal,NEW.tax_amount,NEW.total,NEW.sent_at,NEW.idempotency_key,NEW.created_by)
  IS DISTINCT FROM (OLD.workspace_id,OLD.case_id,OLD.contact_id,OLD.version,OLD.lines,OLD.valid_until,OLD.note,OLD.subtotal,OLD.tax_amount,OLD.total,OLD.sent_at,OLD.idempotency_key,OLD.created_by)
  OR NEW.status='draft' THEN RAISE EXCEPTION 'CASE_QUOTE_LOCKED' USING ERRCODE='55000';
 END IF;
 RETURN NEW;
END $$;
CREATE OR REPLACE TRIGGER case_quotes_guard BEFORE UPDATE OR DELETE ON platform.case_quotes FOR EACH ROW EXECUTE FUNCTION platform.case_quotes_guard();

CREATE TABLE IF NOT EXISTS platform.case_quote_mail_outbox (
 mail_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id),
 quote_id uuid NOT NULL REFERENCES platform.case_quotes(quote_id),
 kind text NOT NULL CHECK(kind IN ('quote.sent')),
 dedupe_key text NOT NULL UNIQUE CHECK(length(dedupe_key) BETWEEN 1 AND 200),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','held','failed')),
 held_reason text CHECK(held_reason IS NULL OR held_reason IN ('sender_unconfigured','recipient_missing')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 100),
 claimed_at timestamptz,
 sent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((state='held')=(held_reason IS NOT NULL)),
 CHECK((state='sent')=(sent_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS case_quote_mail_outbox_due ON platform.case_quote_mail_outbox(created_at) WHERE state IN ('pending','sending');

REVOKE ALL ON TABLE platform.case_quotes, platform.case_quote_mail_outbox FROM PUBLIC;


CREATE OR REPLACE FUNCTION platform.case_quote_json(q platform.case_quotes) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_strip_nulls(jsonb_build_object('id',q.quote_id,'caseId',q.case_id,'version',q.version,'status',q.status,'lines',q.lines,'validUntil',q.valid_until,'note',q.note,
  'subtotal',q.subtotal,'tax',q.tax_amount,'total',q.total,'createdAt',q.created_at,'sentAt',q.sent_at,'answeredAt',q.answered_at,'answerComment',q.answer_comment))
$$;

-- 下書きを作る・直す（Action の中で呼ぶ）。quoteId がなければ新しい版を作る（同じキーは同じ見積を返す）、あれば下書きのあいだだけ直す。
CREATE OR REPLACE FUNCTION platform.case_quote_save(p_actor uuid, p_workspace uuid, p_case uuid, p_input jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE k text:=p_input->>'idempotencyKey'; q platform.case_quotes; c record; norm jsonb; tot jsonb; vu date; v_note text; ver integer;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF k IS NULL OR length(k) NOT BETWEEN 1 AND 200 OR NOT platform.case_quote_lines_valid(p_input->'lines')
  OR (p_input ? 'validUntil' AND jsonb_typeof(p_input->'validUntil')<>'null' AND (jsonb_typeof(p_input->'validUntil')<>'string' OR NOT (p_input->>'validUntil') ~ '^\d{4}-\d{2}-\d{2}$'))
  OR (p_input ? 'note' AND jsonb_typeof(p_input->'note')<>'null' AND (jsonb_typeof(p_input->'note')<>'string' OR length(p_input->>'note')>2000))
  OR (p_input ? 'quoteId' AND jsonb_typeof(p_input->'quoteId')<>'null' AND (jsonb_typeof(p_input->'quoteId')<>'string' OR NOT (p_input->>'quoteId') ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'))
  THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 BEGIN
  vu:=nullif(p_input->>'validUntil','')::date;
 EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END;
 v_note:=nullif(btrim(coalesce(p_input->>'note','')),'');
 norm:=platform.case_quote_lines_normalize(p_input->'lines');
 tot:=platform.case_quote_totals(norm);
 IF p_input->>'quoteId' IS NOT NULL THEN
  SELECT * INTO q FROM platform.case_quotes x WHERE x.quote_id=(p_input->>'quoteId')::uuid AND x.workspace_id=p_workspace AND x.case_id=p_case FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
  IF q.status<>'draft' THEN RAISE EXCEPTION 'CASE_QUOTE_LOCKED' USING ERRCODE='55000'; END IF;
  UPDATE platform.case_quotes SET lines=norm,valid_until=vu,note=v_note,subtotal=(tot->>'subtotal')::bigint,tax_amount=(tot->>'tax')::bigint,total=(tot->>'total')::bigint,
   updated_at=clock_timestamp() WHERE quote_id=q.quote_id;
  RETURN jsonb_build_object('quoteId',q.quote_id,'created',false);
 END IF;
 SELECT * INTO q FROM platform.case_quotes x WHERE x.workspace_id=p_workspace AND x.idempotency_key=k;
 IF FOUND THEN
  IF q.case_id<>p_case THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF;
  RETURN jsonb_build_object('quoteId',q.quote_id,'created',false);
 END IF;
 SELECT x.case_id,x.contact_id INTO c FROM platform.cases x JOIN platform.contacts k2 ON k2.contact_id=x.contact_id AND k2.workspace_id=p_workspace AND k2.erased_at IS NULL
  WHERE x.case_id=p_case AND x.workspace_id=p_workspace AND x.archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-quote:'||p_case::text,0));
 SELECT coalesce(max(x.version),0)+1 INTO ver FROM platform.case_quotes x WHERE x.case_id=p_case;
 INSERT INTO platform.case_quotes(workspace_id,case_id,contact_id,version,lines,valid_until,note,subtotal,tax_amount,total,idempotency_key,created_by)
  VALUES(p_workspace,p_case,c.contact_id,ver,norm,vu,v_note,(tot->>'subtotal')::bigint,(tot->>'tax')::bigint,(tot->>'total')::bigint,k,p_actor) RETURNING * INTO q;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
  VALUES(p_workspace,c.contact_id,'human',p_actor::text,'owner','case-quote.create',q.quote_id,'ok');
 RETURN jsonb_build_object('quoteId',q.quote_id,'created',true);
END $$;

-- 内容を固定して顧客へ送る（Action の中で呼ぶ）。前に送った見積は差し替え済みにする。送り済みの見積をもう一度送っても何も変えない。
CREATE OR REPLACE FUNCTION platform.case_quote_send(p_actor uuid, p_workspace uuid, p_quote uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE q platform.case_quotes; case_ref uuid; portal text; mail uuid; tot jsonb;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 SELECT x.case_id INTO case_ref FROM platform.case_quotes x WHERE x.quote_id=p_quote AND x.workspace_id=p_workspace;
 IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('case-quote:'||case_ref::text,0));
 SELECT * INTO q FROM platform.case_quotes x WHERE x.quote_id=p_quote FOR UPDATE;
 IF q.status='sent' THEN RETURN jsonb_build_object('quoteId',q.quote_id,'sent',false,'duplicate',true); END IF;
 IF q.status<>'draft' THEN RAISE EXCEPTION 'CASE_QUOTE_LOCKED' USING ERRCODE='55000'; END IF;
 IF NOT EXISTS(SELECT 1 FROM platform.contacts k WHERE k.contact_id=q.contact_id AND k.workspace_id=p_workspace AND k.erased_at IS NULL)
  THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 tot:=platform.case_quote_totals(q.lines);
 portal:=platform.ensure_customer_portal(p_actor,p_workspace);
 UPDATE platform.case_quotes SET status='superseded' WHERE case_id=q.case_id AND status='sent' AND quote_id<>q.quote_id;
 UPDATE platform.case_quotes SET status='sent',sent_at=clock_timestamp(),updated_at=clock_timestamp(),
  subtotal=(tot->>'subtotal')::bigint,tax_amount=(tot->>'tax')::bigint,total=(tot->>'total')::bigint WHERE quote_id=q.quote_id;
 INSERT INTO platform.case_quote_mail_outbox(workspace_id,quote_id,kind,dedupe_key) VALUES(p_workspace,q.quote_id,'quote.sent','quote-sent:'||q.quote_id::text)
  ON CONFLICT (dedupe_key) DO NOTHING RETURNING mail_id INTO mail;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
  VALUES(p_workspace,q.contact_id,'human',p_actor::text,'owner','case-quote.send',q.quote_id,'ok');
 RETURN jsonb_strip_nulls(jsonb_build_object('quoteId',q.quote_id,'sent',true,'portalKey',portal,'mailId',mail));
END $$;

-- 事業者の Query: 案件の見積の一覧（メンバーだけ・Event を出さない）。新しい版が先。
CREATE OR REPLACE FUNCTION platform.case_quotes_of(p_actor uuid, p_workspace uuid, p_case uuid) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN jsonb_build_object('quotes',coalesce((SELECT jsonb_agg(platform.case_quote_json(q) ORDER BY q.version DESC) FROM platform.case_quotes q
  WHERE q.workspace_id=p_workspace AND q.case_id=p_case),'[]'));
END $$;

-- 顧客の Query: 窓口の本人に送られた見積（下書きと差し替え済みは見せない）。鍵が違う・本人でないときは NULL。
CREATE OR REPLACE FUNCTION platform.customer_portal_quotes(p_principal uuid, p_portal_key text) RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
DECLARE ws uuid; people uuid[];
BEGIN
 SELECT min(x.workspace_id::text)::uuid, array_agg(x.contact_id) INTO ws, people FROM platform.customer_portal_contacts(p_principal,p_portal_key) x;
 IF ws IS NULL THEN RETURN NULL; END IF;
 RETURN coalesce((SELECT jsonb_agg(platform.case_quote_json(q) ORDER BY q.sent_at DESC,q.quote_id) FROM platform.case_quotes q
  WHERE q.workspace_id=ws AND q.contact_id=ANY(people) AND q.status IN ('sent','accepted','declined')),'[]');
END $$;

-- 顧客が答える前の確かめ。本人に送られた見積でなければ NULL（下書きも NULL）。
CREATE OR REPLACE FUNCTION platform.customer_portal_quote(p_principal uuid, p_portal_key text, p_quote uuid) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('workspaceId',q.workspace_id,'status',q.status) FROM platform.case_quotes q
 JOIN platform.customer_portal_contacts(p_principal,p_portal_key) x ON x.workspace_id=q.workspace_id AND x.contact_id=q.contact_id
 WHERE q.quote_id=p_quote AND q.status<>'draft'
$$;

-- 顧客が承認か辞退を選ぶ（Action の中で呼ぶ）。答えは見積ごとに1回。2回目は duplicate で何も変えない。事業者のメンバーへベルで知らせる。
CREATE OR REPLACE FUNCTION platform.customer_quote_answer(p_principal uuid, p_portal_key text, p_quote uuid, p_decision text, p_comment text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE q platform.case_quotes; c record; project uuid; v_note text:=nullif(btrim(coalesce(p_comment,'')),''); next_status text;
BEGIN
 IF p_decision NOT IN ('accept','decline') OR (v_note IS NOT NULL AND length(v_note)>1000) THEN RAISE EXCEPTION 'PORTAL_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT x.* INTO q FROM platform.case_quotes x JOIN platform.customer_portal_contacts(p_principal,p_portal_key) k ON k.workspace_id=x.workspace_id AND k.contact_id=x.contact_id
  WHERE x.quote_id=p_quote AND x.status<>'draft' FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF q.status IN ('accepted','declined') THEN
  INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
   VALUES(q.workspace_id,q.contact_id,'human',p_principal::text,'customer','case-quote.answer',q.quote_id,'duplicate');
  RETURN jsonb_build_object('quoteId',q.quote_id,'answered',false,'duplicate',true,'status',q.status);
 END IF;
 IF q.status<>'sent' THEN RAISE EXCEPTION 'PORTAL_QUOTE_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 IF q.valid_until IS NOT NULL AND q.valid_until<(clock_timestamp() AT TIME ZONE 'Asia/Tokyo')::date THEN RAISE EXCEPTION 'PORTAL_QUOTE_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 next_status:=CASE p_decision WHEN 'accept' THEN 'accepted' ELSE 'declined' END;
 UPDATE platform.case_quotes SET status=next_status,answered_at=clock_timestamp(),answered_by=p_principal,answer_comment=v_note WHERE quote_id=q.quote_id;
 SELECT x.title,x.project_id,x.assignee_principal_id INTO c FROM platform.cases x WHERE x.case_id=q.case_id;
 project:=coalesce(c.project_id,(SELECT p.project_id FROM platform.projects p WHERE p.workspace_id=q.workspace_id AND p.status='active' ORDER BY p.created_at,p.project_id LIMIT 1));
 IF project IS NOT NULL THEN
  INSERT INTO platform.notifications(project_id,recipient_principal_id,kind,title,body,action_label,href,dedupe_key)
  SELECT project,m.principal_id,'case.quote.answered',CASE next_status WHEN 'accepted' THEN '見積が承認されました' ELSE '見積が辞退されました' END,left(c.title,200),'開く','/?mode=operations','case-quote-answered:'||q.quote_id::text
  FROM platform.workspace_members m JOIN identity.principals pr ON pr.principal_id=m.principal_id AND pr.status='active' AND pr.principal_kind='human'
  WHERE m.workspace_id=q.workspace_id AND m.status='active'
   AND ((c.assignee_principal_id IS NOT NULL AND m.principal_id=c.assignee_principal_id) OR (c.assignee_principal_id IS NULL AND m.member_role IN ('owner','admin')))
  ON CONFLICT (recipient_principal_id,project_id,dedupe_key) DO NOTHING;
 END IF;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
  VALUES(q.workspace_id,q.contact_id,'human',p_principal::text,'customer','case-quote.answer',q.quote_id,'ok');
 RETURN jsonb_build_object('quoteId',q.quote_id,'answered',true,'status',next_status);
END $$;

-- 送る分を取り出す（pending と、10分より前に取り出したまま終わっていないもの）。宛先は名簿の今のメール。
CREATE OR REPLACE FUNCTION platform.case_quote_mail_claim(p_ids uuid[], p_limit integer)
RETURNS TABLE(mail_id uuid, kind text, business_name text, portal_key text, recipient text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
#variable_conflict use_column
BEGIN
 RETURN QUERY WITH picked AS (
  SELECT o.mail_id FROM platform.case_quote_mail_outbox o
  WHERE (o.state='pending' OR (o.state='sending' AND o.claimed_at<clock_timestamp()-interval '10 minutes'))
   AND (p_ids IS NULL OR o.mail_id=ANY(p_ids))
  ORDER BY o.created_at LIMIT least(greatest(coalesce(p_limit,20),1),100) FOR UPDATE SKIP LOCKED
 ), claimed AS (
  UPDATE platform.case_quote_mail_outbox o SET state='sending',claimed_at=clock_timestamp(),attempts=o.attempts+1 FROM picked WHERE o.mail_id=picked.mail_id
  RETURNING o.mail_id,o.kind,o.workspace_id,o.quote_id
 )
 SELECT c.mail_id,c.kind,w.name,p.portal_key,k.email_normalized
 FROM claimed c JOIN platform.workspaces w ON w.workspace_id=c.workspace_id
 JOIN platform.case_quotes q ON q.quote_id=c.quote_id
 LEFT JOIN platform.customer_portals p ON p.workspace_id=c.workspace_id
 LEFT JOIN platform.contacts k ON k.contact_id=q.contact_id AND k.workspace_id=c.workspace_id AND k.erased_at IS NULL;
END $$;

-- 送った結果を残す。retry は pending に戻す（5回で failed）。
CREATE OR REPLACE FUNCTION platform.case_quote_mail_finish(p_mail uuid, p_result text, p_reason text DEFAULT NULL) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE o platform.case_quote_mail_outbox; next_state text; who uuid;
BEGIN
 IF p_result NOT IN ('sent','held','retry') THEN RAISE EXCEPTION 'CASE_MAIL_RESULT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT * INTO o FROM platform.case_quote_mail_outbox x WHERE x.mail_id=p_mail AND x.state='sending' FOR UPDATE;
 IF NOT FOUND THEN RETURN NULL; END IF;
 next_state:=CASE WHEN p_result='retry' AND o.attempts>=5 THEN 'failed' WHEN p_result='retry' THEN 'pending' ELSE p_result END;
 UPDATE platform.case_quote_mail_outbox SET state=next_state,held_reason=CASE WHEN next_state='held' THEN coalesce(p_reason,'sender_unconfigured') END,
  sent_at=CASE WHEN next_state='sent' THEN clock_timestamp() END WHERE mail_id=p_mail;
 SELECT q.contact_id INTO who FROM platform.case_quotes q WHERE q.quote_id=o.quote_id;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result)
  VALUES(o.workspace_id,who,'workflow','case-mail','owner','case-mail.quote-sent',o.mail_id,CASE next_state WHEN 'pending' THEN 'retry' ELSE next_state END);
 RETURN next_state;
END $$;

REVOKE ALL ON FUNCTION platform.case_quote_lines_valid(jsonb),platform.case_quote_lines_normalize(jsonb),platform.case_quote_totals(jsonb),platform.case_quotes_guard(),
 platform.case_quote_json(platform.case_quotes),platform.case_quote_save(uuid,uuid,uuid,jsonb),platform.case_quote_send(uuid,uuid,uuid),platform.case_quotes_of(uuid,uuid,uuid),
 platform.customer_portal_quotes(uuid,text),platform.customer_portal_quote(uuid,text,uuid),platform.customer_quote_answer(uuid,text,uuid,text,text),
 platform.case_quote_mail_claim(uuid[],integer),platform.case_quote_mail_finish(uuid,text,text) FROM PUBLIC;
-- flap-api は関数だけを呼ぶ。表は直接渡さない。

-- 案件の依頼・次の行動・確認／承認・成果物・例外を Action として固定する。チャットの状態は持たない。
CREATE TABLE IF NOT EXISTS platform.case_actions (
 action_id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id uuid NOT NULL REFERENCES platform.workspaces(workspace_id), case_id uuid NOT NULL REFERENCES platform.cases(case_id), contact_id uuid NOT NULL REFERENCES platform.contacts(contact_id),
 origin text NOT NULL DEFAULT 'expert' CHECK(origin IN ('expert','customer')),
 kind text NOT NULL CHECK(kind IN ('request','next_step','decision','deliverable','exception')), title text NOT NULL CHECK(length(title) BETWEEN 1 AND 200), body jsonb NOT NULL DEFAULT '{}'::jsonb CHECK(jsonb_typeof(body)='object'),
 status text NOT NULL DEFAULT 'open' CHECK(status IN ('open','sent','approved','declined','delivered','received','closed')), idempotency_key text NOT NULL CHECK(length(idempotency_key) BETWEEN 1 AND 200), created_by uuid NOT NULL REFERENCES identity.principals(principal_id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(), sent_at timestamptz, answered_at timestamptz, answered_by uuid REFERENCES identity.principals(principal_id), answer text CHECK(answer IS NULL OR length(answer)<=1000),
 UNIQUE(workspace_id,idempotency_key), CHECK((status IN ('approved','declined','received'))=(answered_at IS NOT NULL AND answered_by IS NOT NULL)), CHECK(kind<>'decision' OR status IN ('open','sent','approved','declined'))
);
CREATE INDEX IF NOT EXISTS case_actions_case ON platform.case_actions(case_id,created_at DESC);
CREATE OR REPLACE FUNCTION platform.case_actions_guard() RETURNS trigger LANGUAGE plpgsql SET search_path TO '' AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CASE_ACTION_LOCKED' USING ERRCODE='55000'; END IF;
 IF OLD.status IN ('approved','declined','received','closed') AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'CASE_ACTION_LOCKED' USING ERRCODE='55000'; END IF;
 IF OLD.status='sent' AND (NEW.origin,NEW.workspace_id,NEW.case_id,NEW.contact_id,NEW.kind,NEW.title,NEW.body,NEW.idempotency_key,NEW.created_by,NEW.created_at,NEW.sent_at) IS DISTINCT FROM (OLD.origin,OLD.workspace_id,OLD.case_id,OLD.contact_id,OLD.kind,OLD.title,OLD.body,OLD.idempotency_key,OLD.created_by,OLD.created_at,OLD.sent_at) THEN RAISE EXCEPTION 'CASE_ACTION_LOCKED' USING ERRCODE='55000'; END IF;
 RETURN NEW; END $$;
CREATE OR REPLACE TRIGGER case_actions_guard BEFORE UPDATE OR DELETE ON platform.case_actions FOR EACH ROW EXECUTE FUNCTION platform.case_actions_guard();
CREATE OR REPLACE FUNCTION platform.case_action_body_valid(p jsonb) RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path TO '' AS $$
 SELECT coalesce(jsonb_typeof(p)='object' AND octet_length(p::text)<=16384 AND NOT EXISTS(SELECT 1 FROM jsonb_each(p) e WHERE
 e.key NOT IN ('note','url','detail','dueOn','owner') OR jsonb_typeof(e.value)<>'string' OR length(e.value #>> '{}')>4000
 OR (e.key='url' AND (e.value #>> '{}') !~ '^https?://[^[:space:]]+$')
 OR (e.key='dueOn' AND (e.value #>> '{}') !~ '^\d{4}-\d{2}-\d{2}$')
 OR (e.key='owner' AND (e.value #>> '{}') NOT IN ('expert','customer'))),false)
$$;
CREATE OR REPLACE FUNCTION platform.case_action_create(p_actor uuid,p_workspace uuid,p_case uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a platform.case_actions; contact uuid; kind text:=p_input->>'kind'; key text:=p_input->>'idempotencyKey'; target text;
BEGIN
 IF NOT platform.case_writer(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 IF NOT platform.case_action_body_valid(p_input->'body') THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 IF kind NOT IN ('request','next_step','decision','deliverable','exception') OR key IS NULL OR length(key) NOT BETWEEN 1 AND 200 OR nullif(btrim(p_input->>'title'),'') IS NULL OR length(p_input->>'title')>200 OR jsonb_typeof(coalesce(p_input->'body','{}'::jsonb))<>'object' THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT contact_id INTO contact FROM platform.cases WHERE case_id=p_case AND workspace_id=p_workspace AND archived_at IS NULL; IF NOT FOUND THEN RAISE EXCEPTION 'CASE_NOT_FOUND' USING ERRCODE='42501'; END IF;
 SELECT * INTO a FROM platform.case_actions WHERE workspace_id=p_workspace AND idempotency_key=key; IF FOUND THEN IF a.case_id<>p_case THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT' USING ERRCODE='23505'; END IF; RETURN jsonb_build_object('actionId',a.action_id,'created',false); END IF;
 INSERT INTO platform.case_actions(workspace_id,case_id,contact_id,kind,title,body,status,idempotency_key,created_by,sent_at) VALUES(p_workspace,p_case,contact,kind,btrim(p_input->>'title'),coalesce(p_input->'body','{}'::jsonb),CASE WHEN kind IN ('decision','request','deliverable') THEN 'sent' ELSE 'open' END,key,p_actor,CASE WHEN kind IN ('decision','request','deliverable') THEN clock_timestamp() END) RETURNING * INTO a;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result) VALUES(p_workspace,contact,'human',p_actor::text,'owner','case-action.create',a.action_id,'ok');
 RETURN jsonb_build_object('actionId',a.action_id,'created',true,'status',a.status); END $$;
CREATE OR REPLACE FUNCTION platform.customer_case_action_answer(p_principal uuid,p_portal_key text,p_action uuid,p_answer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a platform.case_actions; state text; note text:=nullif(btrim(coalesce(p_answer,'')),''); BEGIN
 SELECT x.* INTO a FROM platform.case_actions x JOIN platform.customer_portal_contacts(p_principal,p_portal_key) c ON c.workspace_id=x.workspace_id AND c.contact_id=x.contact_id WHERE x.action_id=p_action FOR UPDATE OF x; IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF a.status IN ('approved','declined','received') THEN RETURN jsonb_build_object('actionId',a.action_id,'answered',false,'duplicate',true,'status',a.status); END IF;
 IF a.kind NOT IN ('decision','deliverable') OR a.status<>'sent' THEN RAISE EXCEPTION 'PORTAL_ACTION_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 state:=CASE WHEN a.kind='decision' AND note='decline' THEN 'declined' WHEN a.kind='decision' THEN 'approved' ELSE 'received' END;
 UPDATE platform.case_actions SET status=state,answered_at=clock_timestamp(),answered_by=p_principal,answer=note WHERE action_id=a.action_id;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result) VALUES(a.workspace_id,a.contact_id,'human',p_principal::text,'customer','case-action.answer',a.action_id,'ok');
 RETURN jsonb_build_object('actionId',a.action_id,'answered',true,'status',state); END $$;
REVOKE ALL ON TABLE platform.case_actions FROM PUBLIC;
REVOKE ALL ON FUNCTION platform.case_action_create(uuid,uuid,uuid,jsonb),platform.customer_case_action_answer(uuid,text,uuid,text),platform.case_actions_guard() FROM PUBLIC;

-- customer-portal は送付済みの decision / deliverable だけを同じ contact の本人へ投影する。本文の変更や owner Action は許さない。
CREATE OR REPLACE FUNCTION platform.customer_portal_case_actions(p_principal uuid,p_portal_key text) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.action_id,'caseId',a.case_id,'kind',a.kind,'title',a.title,'body',a.body,'status',a.status,'sentAt',a.sent_at,'createdAt',a.created_at,'answeredAt',a.answered_at,'answer',a.answer,'from',a.origin) ORDER BY a.created_at DESC),'[]'::jsonb)
 FROM platform.case_actions a JOIN platform.customer_portal_contacts(p_principal,p_portal_key) x ON x.workspace_id=a.workspace_id AND x.contact_id=a.contact_id
 WHERE a.status IN ('open','sent','approved','declined','delivered','received','closed')
$$;
CREATE OR REPLACE FUNCTION platform.customer_portal_case_action(p_principal uuid,p_portal_key text,p_action uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO '' AS $$
 SELECT jsonb_build_object('workspaceId',a.workspace_id,'status',a.status,'kind',a.kind) FROM platform.case_actions a
 JOIN platform.customer_portal_contacts(p_principal,p_portal_key) x ON x.workspace_id=a.workspace_id AND x.contact_id=a.contact_id
 WHERE a.action_id=p_action AND a.kind IN ('decision','deliverable')
$$;
REVOKE ALL ON FUNCTION platform.customer_portal_case_actions(uuid,text),platform.customer_portal_case_action(uuid,text,uuid) FROM PUBLIC;

-- 参加者は契約の contact の案件だけを見る。本人確認済みの Flap ID と招待のメールを結ぶ。

CREATE OR REPLACE FUNCTION platform.case_actions_of(p_actor uuid,p_workspace uuid,p_case uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
 IF NOT platform.crm_member(p_actor,p_workspace) THEN RAISE EXCEPTION 'CASE_FORBIDDEN' USING ERRCODE='42501'; END IF;
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.action_id,'caseId',a.case_id,'kind',a.kind,'title',a.title,'body',a.body,'status',a.status,
 'createdAt',a.created_at,'sentAt',a.sent_at,'answeredAt',a.answered_at,'answer',a.answer,'from',a.origin) ORDER BY a.created_at DESC) FROM platform.case_actions a WHERE a.workspace_id=p_workspace AND a.case_id=p_case),'[]');
END $$;
CREATE OR REPLACE FUNCTION platform.customer_case_action_request(p_actor uuid,p_portal text,p_case uuid,p_input jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE c platform.cases; a platform.case_actions; key text:=p_input->>'idempotencyKey';
BEGIN
 SELECT x.* INTO c FROM platform.cases x JOIN platform.customer_portal_contacts(p_actor,p_portal) pc ON pc.workspace_id=x.workspace_id AND pc.contact_id=x.contact_id WHERE x.case_id=p_case AND x.archived_at IS NULL;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF p_input->>'kind' IS DISTINCT FROM 'request' OR key IS NULL OR length(key) NOT BETWEEN 1 AND 200 OR nullif(btrim(p_input->>'title'),'') IS NULL OR length(p_input->>'title')>200 OR NOT platform.case_action_body_valid(p_input->'body') THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(c.workspace_id::text||':'||key,0));
 SELECT * INTO a FROM platform.case_actions WHERE workspace_id=c.workspace_id AND idempotency_key=key;
 IF FOUND THEN IF a.created_by<>p_actor OR a.case_id<>c.case_id THEN RAISE EXCEPTION 'CASE_IDEMPOTENCY_CONFLICT'; END IF; RETURN jsonb_build_object('actionId',a.action_id,'created',false); END IF;
 INSERT INTO platform.case_actions(workspace_id,case_id,contact_id,kind,title,body,status,idempotency_key,created_by,sent_at,origin) VALUES(c.workspace_id,c.case_id,c.contact_id,'request',btrim(p_input->>'title'),p_input->'body','sent',key,p_actor,clock_timestamp(),'customer') RETURNING * INTO a;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result) VALUES(c.workspace_id,c.contact_id,'human',p_actor::text,'customer','case-action.request',a.action_id,'ok');
 RETURN jsonb_build_object('actionId',a.action_id,'created',true,'status',a.status);
END $$;
CREATE OR REPLACE FUNCTION platform.customer_case_action_decide(p_actor uuid,p_portal text,p_action uuid,p_decision text,p_comment text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE a platform.case_actions; state text;
BEGIN
 SELECT x.* INTO a FROM platform.case_actions x JOIN platform.customer_portal_contacts(p_actor,p_portal) pc ON pc.workspace_id=x.workspace_id AND pc.contact_id=x.contact_id WHERE x.action_id=p_action FOR UPDATE OF x;
 IF NOT FOUND THEN RAISE EXCEPTION 'PORTAL_NOT_FOUND' USING ERRCODE='42501'; END IF;
 IF a.kind NOT IN ('decision','deliverable') THEN RAISE EXCEPTION 'PORTAL_ACTION_UNAVAILABLE' USING ERRCODE='55000'; END IF;
 IF a.status IN ('approved','declined','received') THEN RETURN jsonb_build_object('actionId',a.action_id,'answered',false,'duplicate',true,'status',a.status); END IF;
 IF a.status<>'sent' OR p_decision IS NULL OR (a.kind='decision' AND p_decision NOT IN ('approve','decline')) OR (a.kind='deliverable' AND p_decision<>'receive') OR length(coalesce(p_comment,''))>1000 THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 state:=CASE WHEN a.kind='deliverable' THEN 'received' WHEN p_decision='approve' THEN 'approved' ELSE 'declined' END;
 UPDATE platform.case_actions SET status=state,answered_at=clock_timestamp(),answered_by=p_actor,answer=nullif(btrim(p_comment),'') WHERE action_id=a.action_id;
 INSERT INTO platform.customer_action_log(workspace_id,subject_contact_id,actor_kind,actor_ref,delegated_by,action,target_id,result) VALUES(a.workspace_id,a.contact_id,'human',p_actor::text,'customer','case-action.answer',a.action_id,'ok');
 RETURN jsonb_build_object('actionId',a.action_id,'answered',true,'status',state);
END $$;
-- 前の呼出しの空文字／decline は互換として受ける。コメントを承認の意味へ読み替えない。
CREATE OR REPLACE FUNCTION platform.customer_case_action_answer(p_principal uuid,p_portal_key text,p_action uuid,p_answer text) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE kind text; BEGIN
 IF coalesce(p_answer,'') NOT IN ('','approve','decline') THEN RAISE EXCEPTION 'CASE_INPUT_INVALID' USING ERRCODE='22023'; END IF;
 SELECT a.kind INTO kind FROM platform.case_actions a JOIN platform.customer_portal_contacts(p_principal,p_portal_key) pc ON pc.workspace_id=a.workspace_id AND pc.contact_id=a.contact_id WHERE a.action_id=p_action;
 RETURN platform.customer_case_action_decide(p_principal,p_portal_key,p_action,CASE WHEN kind='deliverable' THEN 'receive' WHEN p_answer='decline' THEN 'decline' ELSE 'approve' END,'');
END $$;
REVOKE ALL ON FUNCTION platform.case_action_body_valid(jsonb),platform.case_actions_of(uuid,uuid,uuid),platform.customer_case_action_request(uuid,text,uuid,jsonb),platform.customer_case_action_decide(uuid,text,uuid,text,text) FROM PUBLIC;
