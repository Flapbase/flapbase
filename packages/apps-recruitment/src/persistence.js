import { recruitmentAppKey, recruitmentRevision } from './shared.js';
export function createRecruitmentPersistence({ sha256, presetDigest }) {
    const blueprint = {
        id: 'vdb.flap.recruitment.preview',
        revision: '1',
        access: 'private',
        records: {
            job: ['installId', 'title', 'description', 'publishedTitle', 'publishedDescription', 'publishedVersion'],
            application: ['installId', 'jobTitle', 'publishedVersion', 'note', 'status'],
        },
    };
    const blueprintDigest = sha256(blueprint).slice('sha256:'.length);
    function schemaMatch(tx, { workspaceId }) {
        return tx `s.workspace_id = ${workspaceId}::uuid
      AND s.blueprint_ref = ${blueprint.id}
      AND s.blueprint_revision = ${blueprint.revision}
      AND s.blueprint_digest = ${blueprintDigest}`;
    }
    function recordScope(tx, binding) {
        return tx `${schemaMatch(tx, binding)}
      AND r.schema_id = s.schema_id
      AND r.project_id = ${binding.projectId}::uuid
      AND r.access = 'private'
      AND r.data->>'installId' = ${binding.installId}::text`;
    }
    function draftScope(tx, binding) {
        return tx `${recordScope(tx, binding)} AND r.record_key = ${binding.installId}::text AND r.data->>'kind' = 'job'`;
    }
    function applicationScope(tx, binding) {
        return tx `${recordScope(tx, binding)} AND r.data->>'kind' = 'application'`;
    }
    function draftProjection(tx) {
        return tx `r.version::int AS version, r.data->>'title' AS title, r.data->>'description' AS description,
      (r.data->>'publishedVersion')::int AS "publishedVersion"`;
    }
    function applicationProjection(tx) {
        return tx `r.record_id::text AS id, r.data->>'jobTitle' AS "jobTitle",
      r.data->>'status' AS status, r.version::int AS version`;
    }
    /** Called after the server creates or resolves a pinned install, in the same transaction. */
    async function initializeRecruitment(tx, binding) {
        await tx `
      INSERT INTO vdb.schemas (workspace_id, blueprint_ref, blueprint_revision, blueprint_digest,
        allowed_access, default_access, projection_version)
      VALUES (${binding.workspaceId}::uuid, ${blueprint.id}, ${blueprint.revision},
        ${blueprintDigest}, ARRAY['private']::text[], 'private', '1')
      ON CONFLICT (workspace_id, blueprint_ref, blueprint_revision) DO NOTHING
    `;
        await tx `
      INSERT INTO vdb.records (schema_id, access, owner_principal_id, project_id, record_key, data)
      SELECT s.schema_id, 'private', i.installed_by_principal_id, i.project_id, i.app_install_id::text,
        ${tx.json({ kind: 'job', installId: binding.installId, title: '', description: '' })}::jsonb
      FROM vdb.schemas AS s
      JOIN platform.projects AS p ON p.workspace_id = s.workspace_id
      JOIN platform.app_installs AS i ON i.project_id = p.project_id
      WHERE ${schemaMatch(tx, binding)}
        AND p.project_id = ${binding.projectId}::uuid
        AND i.app_install_id = ${binding.installId}::uuid AND i.app_key = ${recruitmentAppKey}
        AND i.app_revision = ${recruitmentRevision} AND i.status = 'active'
      ON CONFLICT (schema_id, record_key) DO NOTHING
    `;
        await readRecruitmentDraft(tx, binding);
    }
    async function readRecruitmentDraft(tx, binding) {
        const [draft] = await tx `
      SELECT ${draftProjection(tx)}
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${draftScope(tx, binding)}
    `;
        if (!draft)
            throw new Error('RECRUITMENT_DRAFT_MISSING');
        return draft;
    }
    async function saveRecruitmentDraft(tx, binding, input) {
        const { version, title, description } = input;
        const patch = { title, description };
        const [draft] = await tx `
      UPDATE vdb.records AS r SET data = r.data || ${tx.json(patch)}::jsonb,
        version = r.version + 1, updated_at = clock_timestamp()
      FROM vdb.schemas AS s
      WHERE ${draftScope(tx, binding)} AND r.version = ${version}::bigint
      RETURNING ${draftProjection(tx)}
    `;
        return draft ?? null;
    }
    /** Serialize release preparation and application against edits to the same draft. */
    async function lockRecruitmentDraft(tx, binding) {
        const [draft] = await tx `
      SELECT ${draftProjection(tx)}
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${draftScope(tx, binding)} FOR UPDATE OF r
    `;
        if (!draft)
            throw new Error('RECRUITMENT_DRAFT_MISSING');
        return draft;
    }
    /** Only the release service supplies the approved, immutable candidate. */
    async function activateRecruitmentCandidate(tx, binding, candidate) {
        const patch = { publishedTitle: candidate.title, publishedDescription: candidate.description, publishedVersion: candidate.version + 1 };
        const [draft] = await tx `
      UPDATE vdb.records AS r SET data = r.data || ${tx.json(patch)}::jsonb,
        version = r.version + 1, updated_at = clock_timestamp()
      FROM vdb.schemas AS s
      WHERE ${draftScope(tx, binding)} AND r.version = ${candidate.version}::bigint
      RETURNING ${draftProjection(tx)}
    `;
        if (!draft)
            throw new Error('RECRUITMENT_RELEASE_STALE');
        return draft;
    }
    async function readApplicationSubmission(tx, binding, subjectId, requestKey, input) {
        const [row] = await tx `
      SELECT ${applicationProjection(tx)}, r.data->>'note' AS note,
        (r.data->>'publishedVersion')::int AS "publishedVersion"
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${applicationScope(tx, binding)}
        AND r.owner_principal_id = ${subjectId}::uuid AND r.record_key = ${requestKey}
    `;
        if (!row)
            return null;
        if (row.publishedVersion !== input.publishedVersion || row.note !== input.note) {
            throw new Error('RECRUITMENT_REQUEST_CONFLICT');
        }
        return { id: row.id, jobTitle: row.jobTitle, status: 'submitted', version: 1 };
    }
    async function submitRecruitmentApplication(tx, binding, subjectId, input, snapshot) {
        const requestKey = sha256([binding.installId, subjectId, input.requestId]);
        const existing = await readApplicationSubmission(tx, binding, subjectId, requestKey, input);
        if (existing)
            return existing;
        // Keep accepting the public snapshot while a newer approved version is awaiting delivery.
        const [job] = snapshot?.version === input.publishedVersion ? await tx `
      SELECT s.schema_id::text AS "schemaId"
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${draftScope(tx, binding)} AND (r.data->>'publishedVersion')::int >= ${snapshot.version}::int
      FOR SHARE OF r
    ` : [];
        if (job && snapshot) {
            await tx `
        INSERT INTO vdb.records (schema_id, access, owner_principal_id, project_id, record_key, data)
        VALUES (${job.schemaId}::uuid, 'private', ${subjectId}::uuid, ${binding.projectId}::uuid, ${requestKey},
          ${tx.json({
                kind: 'application', installId: binding.installId, jobTitle: snapshot.title,
                publishedVersion: input.publishedVersion, note: input.note, status: 'submitted',
            })}::jsonb)
        ON CONFLICT (schema_id, record_key) DO NOTHING
      `;
        }
        const receipt = await readApplicationSubmission(tx, binding, subjectId, requestKey, input);
        if (job && !receipt)
            throw new Error('RECRUITMENT_RECEIPT_MISSING');
        return receipt;
    }
    async function listOwnApplications(tx, binding, subjectId) {
        return tx `
      SELECT ${applicationProjection(tx)}
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${applicationScope(tx, binding)} AND r.owner_principal_id = ${subjectId}::uuid
      ORDER BY r.created_at DESC, r.record_id DESC LIMIT 50
    `;
    }
    async function hasOwnApplication(tx, binding, subjectId) {
        const [row] = await tx `
      SELECT EXISTS (
        SELECT 1 FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
        WHERE ${applicationScope(tx, binding)} AND r.owner_principal_id = ${subjectId}::uuid
      ) AS found
    `;
        return row?.found === true;
    }
    async function listRecruitmentApplications(tx, binding, includeNote = true) {
        return tx `
      SELECT ${applicationProjection(tx)} ${includeNote ? tx `, r.data->>'note' AS note` : tx ``}
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${applicationScope(tx, binding)}
        ${includeNote ? tx `` : tx `AND EXISTS (
          SELECT 1 FROM vdb.records AS r
          WHERE ${draftScope(tx, binding)} AND r.data->>'publishedVersion' IS NOT NULL
        )`}
      ORDER BY r.created_at DESC, r.record_id DESC LIMIT 50
    `;
    }
    async function advanceRecruitmentApplication(tx, binding, { id, version }) {
        const [application] = await tx `
      UPDATE vdb.records AS r SET data = r.data || ${tx.json({ status: 'screening' })}::jsonb,
        version = r.version + 1, updated_at = clock_timestamp()
      FROM vdb.schemas AS s
      WHERE ${applicationScope(tx, binding)} AND r.record_id = ${id}::uuid
        AND r.version = ${version}::bigint AND r.data->>'status' = 'submitted'
      RETURNING ${applicationProjection(tx)}
    `;
        return application ?? null;
    }
    async function finalizeRecruitmentApplication(tx, binding, { id, version, outcome }) {
        const [application] = await tx `
      UPDATE vdb.records AS r SET data = r.data || ${tx.json({ status: outcome })}::jsonb,
        version = r.version + 1, updated_at = clock_timestamp()
      FROM vdb.schemas AS s
      WHERE ${applicationScope(tx, binding)} AND r.record_id = ${id}::uuid
        AND r.version = ${version}::bigint AND r.data->>'status' = 'screening'
      RETURNING ${applicationProjection(tx)}
    `;
        return application ?? null;
    }
    const verification = Object.freeze({
        id: 'vdb.flap.recruitment.release',
        revision: '1',
        checks: ['fixed-preset', 'bounded-job-copy', 'unchanged-base-publication'],
        fields: ['candidate', 'basePublishedVersion', 'digest', 'verifiedBy', 'approvedBy', 'appliedBy'],
    });
    const releaseBlueprintDigest = sha256(verification).slice(7);
    function releaseSchemaMatch(tx, binding) {
        return tx `s.workspace_id = ${binding.workspaceId}::uuid
      AND s.blueprint_ref = ${verification.id}
      AND s.blueprint_revision = ${verification.revision}
      AND s.blueprint_digest = ${releaseBlueprintDigest}`;
    }
    function scope(tx, binding) {
        return tx `${releaseSchemaMatch(tx, binding)} AND r.schema_id = s.schema_id
      AND r.project_id = ${binding.projectId}::uuid AND r.access = 'private'
      AND r.data->>'installId' = ${binding.installId}::text`;
    }
    function projection({ candidateId, candidate }) {
        return {
            candidateId,
            draftVersion: candidate.draft.version,
            digest: candidate.digest,
            state: candidate.appliedAt ? 'applied' : candidate.approvedAt ? 'approved' : 'verified',
            verifiedAt: candidate.verifiedAt,
            approvedAt: candidate.approvedAt,
            appliedAt: candidate.appliedAt,
        };
    }
    async function readRecruitmentRelease(tx, binding) {
        const [candidate] = await tx `
      SELECT r.record_id::text AS "candidateId", r.data->'candidate' AS candidate
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${scope(tx, binding)}
      ORDER BY (r.data #>> '{candidate,draft,version}')::int DESC LIMIT 1
    `;
        return candidate ? projection(candidate) : null;
    }
    function candidateDigest(binding, draft, basePublishedVersion) {
        const { installId, projectId, workspaceId } = binding;
        return sha256({ installId, projectId, workspaceId, verification: releaseBlueprintDigest,
            preset: presetDigest, draft, basePublishedVersion });
    }
    function missing() {
        throw new Error('RECRUITMENT_RELEASE_STALE');
    }
    async function requireCandidate(tx, binding, { candidateId, digest }) {
        const [row] = await tx `
      SELECT r.record_id::text AS "candidateId", r.data->'candidate' AS candidate
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${scope(tx, binding)} AND r.record_id = ${candidateId}::uuid
        AND r.data #>> '{candidate,digest}' = ${digest}
      FOR UPDATE OF r
    `;
        if (!row)
            missing();
        return row;
    }
    function requireCurrent(candidate, draft) {
        if (candidate.draft.version !== draft.version || candidate.basePublishedVersion !== draft.publishedVersion)
            missing();
    }
    async function verifyRecruitmentRelease(tx, binding, actor, version) {
        const draft = await lockRecruitmentDraft(tx, binding);
        if (draft.version !== version)
            missing();
        // This preset only varies the two escaped public text fields. No schema, Workflow,
        // connector, credentials or application records enter the candidate.
        if (typeof draft.title !== 'string' || !draft.title.trim() || draft.title.length > 120 || draft.title.includes('\0')
            || typeof draft.description !== 'string' || !draft.description.trim()
            || draft.description.length > 3000 || draft.description.includes('\0')) {
            throw new Error('RECRUITMENT_RELEASE_VERIFICATION_FAILED');
        }
        const basePublishedVersion = draft.publishedVersion;
        const job = { title: draft.title, description: draft.description, version: draft.version };
        const digest = candidateDigest(binding, job, basePublishedVersion);
        const recordKey = sha256([binding.installId, draft.version]);
        const [prior] = await tx `
      SELECT r.record_id::text AS "candidateId", r.data->'candidate' AS candidate
      FROM vdb.records AS r JOIN vdb.schemas AS s ON r.schema_id = s.schema_id
      WHERE ${scope(tx, binding)} AND r.record_key = ${recordKey}
    `;
        if (prior)
            return projection(prior);
        await tx `
      INSERT INTO vdb.schemas (workspace_id, blueprint_ref, blueprint_revision, blueprint_digest,
        allowed_access, default_access, projection_version)
      VALUES (${binding.workspaceId}::uuid, ${verification.id}, ${verification.revision},
        ${releaseBlueprintDigest}, ARRAY['private']::text[], 'private', '1')
      ON CONFLICT (workspace_id, blueprint_ref, blueprint_revision) DO NOTHING
    `;
        const candidate = {
            draft: job, basePublishedVersion, digest, verifiedAt: new Date().toISOString(), verifiedBy: actor,
            approvedAt: null, approvedBy: null, appliedAt: null, appliedBy: null,
        };
        // The locked draft serializes attempts for this version, together with the unique key.
        const [saved] = await tx `
      INSERT INTO vdb.records (schema_id, access, owner_principal_id, project_id, record_key, data)
      SELECT s.schema_id, 'private', ${actor}::uuid, ${binding.projectId}::uuid, ${recordKey},
        ${tx.json({ installId: binding.installId, candidate })}::jsonb
      FROM vdb.schemas AS s WHERE ${releaseSchemaMatch(tx, binding)}
      RETURNING record_id::text AS "candidateId"
    `;
        if (!saved)
            throw new Error('RECRUITMENT_RELEASE_STORAGE_UNAVAILABLE');
        return projection({ ...saved, candidate });
    }
    async function saveState(tx, binding, row) {
        await tx `
      UPDATE vdb.records AS r SET data = r.data || ${tx.json({ candidate: row.candidate })}::jsonb,
        version = r.version + 1, updated_at = clock_timestamp()
      FROM vdb.schemas AS s
      WHERE ${scope(tx, binding)} AND r.record_id = ${row.candidateId}::uuid
    `;
    }
    async function approveRecruitmentRelease(tx, binding, approver, pin) {
        const draft = await lockRecruitmentDraft(tx, binding);
        const row = await requireCandidate(tx, binding, pin);
        requireCurrent(row.candidate, draft);
        if (!row.candidate.approvedAt) {
            row.candidate.approvedAt = new Date().toISOString();
            row.candidate.approvedBy = approver;
            await saveState(tx, binding, row);
        }
        return projection(row);
    }
    async function applyRecruitmentRelease(tx, binding, actor, pin) {
        const current = await lockRecruitmentDraft(tx, binding);
        const row = await requireCandidate(tx, binding, pin);
        const { candidate } = row;
        if (!candidate.approvedAt || !candidate.approvedBy)
            throw new Error('RECRUITMENT_RELEASE_APPROVAL_REQUIRED');
        const job = { ...candidate.draft, version: candidate.draft.version + 1 };
        if (candidate.appliedAt) {
            // A failed R2 sync can retry an already committed version only while it is the current published version.
            if (current.publishedVersion !== job.version)
                missing();
            return { draft: current, job };
        }
        requireCurrent(candidate, current);
        const draft = await activateRecruitmentCandidate(tx, binding, candidate.draft);
        candidate.appliedAt = new Date().toISOString();
        candidate.appliedBy = actor;
        await saveState(tx, binding, row);
        return { draft, job };
    }
    return {
        initializeRecruitment,
        readRecruitmentDraft,
        saveRecruitmentDraft,
        lockRecruitmentDraft,
        activateRecruitmentCandidate,
        submitRecruitmentApplication,
        listOwnApplications,
        hasOwnApplication,
        listRecruitmentApplications,
        listRecruitmentApplications,
        listRecruitmentApplications,
        advanceRecruitmentApplication,
        finalizeRecruitmentApplication,
        readRecruitmentRelease,
        verifyRecruitmentRelease,
        approveRecruitmentRelease,
        applyRecruitmentRelease,
    };
}
