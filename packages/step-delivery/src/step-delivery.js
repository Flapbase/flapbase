export class StepDeliveryError extends Error {
    code;
    status;
    constructor(code, status = 400) {
        super(code);
        this.code = code;
        this.status = status;
    }
}
export function requireStep(value, code = 'invalid_request', status = 400) { if (!value)
    throw new StepDeliveryError(code, status); }
export const DELIVERY_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function requireDeliveryId(value) { requireStep(typeof value === 'string' && DELIVERY_UUID.test(value)); }
export function validateDeliveryCondition(input) {
    let nodes = 0;
    const visit = (value, depth) => {
        requireStep(++nodes <= 100 && depth <= 5 && !!value && typeof value === 'object' && !Array.isArray(value));
        const v = value;
        if ('type' in v) {
            requireStep((v.type === 'all' || v.type === 'any') && Array.isArray(v.conditions) && v.conditions.length <= 20);
            return { type: v.type, conditions: v.conditions.map(c => visit(c, depth + 1)) };
        }
        requireStep(typeof v.field === 'string' && (/^(stage|source|tag)$/.test(v.field) || /^attributes\.[a-zA-Z][\w-]{0,60}$/.test(v.field)));
        requireStep(['eq', 'neq', 'in', 'contains', 'gte', 'lte'].includes(String(v.op)));
        const scalar = (x) => typeof x === 'boolean' || typeof x === 'number' && Number.isFinite(x) || typeof x === 'string' && x.length <= 500;
        requireStep(v.op === 'in' ? Array.isArray(v.value) && v.value.length > 0 && v.value.length <= 50 && v.value.every(scalar) : scalar(v.value));
        if (v.op === 'gte' || v.op === 'lte')
            requireStep(v.field.startsWith('attributes.') && typeof v.value === 'number');
        return { field: v.field, op: v.op, value: v.value };
    };
    return visit(input, 0);
}
export function matchesDeliveryCondition(contact, condition) {
    if ('type' in condition)
        return condition.type === 'all' ? condition.conditions.every(c => matchesDeliveryCondition(contact, c)) : condition.conditions.some(c => matchesDeliveryCondition(contact, c));
    const actual = condition.field === 'tag' ? contact.tags : condition.field.startsWith('attributes.') ? Object.hasOwn(contact.attributes, condition.field.slice(11)) ? contact.attributes[condition.field.slice(11)] : undefined : contact[condition.field];
    if (actual == null)
        return false;
    const eq = (v) => Array.isArray(actual) ? actual.includes(v) : actual === v;
    switch (condition.op) {
        case 'eq': return eq(condition.value);
        case 'neq': return !eq(condition.value);
        case 'in': return condition.value.some(eq);
        case 'contains': return Array.isArray(actual) ? actual.includes(condition.value) : typeof actual === 'string' && typeof condition.value === 'string' && actual.includes(condition.value);
        case 'gte': return typeof actual === 'number' && typeof condition.value === 'number' && actual >= condition.value;
        case 'lte': return typeof actual === 'number' && typeof condition.value === 'number' && actual <= condition.value;
    }
}
/** Days are elapsed 24h; an optional clock time is the first JST occurrence at/after that offset. */
export function stepDueAt(previousAt, step) {
    requireStep(Number.isFinite(Date.parse(previousAt)) && Number.isSafeInteger(step.waitDays) && step.waitDays >= 0 && step.waitDays <= 365);
    const due = Date.parse(previousAt) + step.waitDays * 86400000;
    if (!step.at)
        return new Date(due).toISOString();
    requireStep(/^([01]\d|2[0-3]):[0-5]\d$/.test(step.at));
    const day = new Date(due + 9 * 3600000).toISOString().slice(0, 10);
    let clock = Date.parse(`${day}T${step.at}:00+09:00`);
    if (clock < due)
        clock += 86400000;
    return new Date(clock).toISOString();
}
export function validateScenario(input) {
    requireStep(!!input && typeof input === 'object' && !Array.isArray(input));
    const v = input;
    requireDeliveryId(v.id);
    requireDeliveryId(v.workspaceId);
    requireStep(typeof v.name === 'string' && !!v.name.trim() && v.name.length <= 200 && Number.isSafeInteger(v.version) && v.version > 0);
    requireStep(['draft', 'active', 'paused', 'canceled'].includes(v.state) && !!v.trigger && ['inquiry', 'purchase', 'tag', 'form', 'booking'].includes(v.trigger.kind));
    requireStep(v.trigger.value === undefined || typeof v.trigger.value === 'string' && v.trigger.value.length <= 100);
    requireStep(Array.isArray(v.steps) && v.steps.length > 0 && v.steps.length <= 20 && new Set(v.steps.map(s => s.id)).size === v.steps.length);
    const steps = v.steps.map(s => {
        requireDeliveryId(s.id);
        stepDueAt('2026-01-01T00:00:00Z', s);
        requireStep((s.channel === 'email' || s.channel === 'line') && typeof s.subject === 'string' && s.subject.length <= 200 && !/[\r\n]/.test(s.subject)
            && typeof s.text === 'string' && !!s.text.trim() && s.text.length <= (s.channel === 'line' ? 5000 : 20000) && (s.channel !== 'email' || !!s.subject.trim()));
        return { id: s.id, waitDays: s.waitDays, ...(s.at ? { at: s.at } : {}), channel: s.channel, subject: s.subject, text: s.text, ...(s.condition ? { condition: validateDeliveryCondition(s.condition) } : {}) };
    });
    requireStep(!!v.sender && ['name', 'address', 'contact'].every(k => typeof v.sender[k] === 'string' && v.sender[k].length <= 200));
    if (v.state !== 'draft' && steps.some(s => s.channel === 'email'))
        requireStep(Object.values(v.sender).every(x => x.trim()));
    return { id: v.id, workspaceId: v.workspaceId, name: v.name.trim(), version: v.version, state: v.state, trigger: { kind: v.trigger.kind, ...(v.trigger.value ? { value: v.trigger.value } : {}) }, steps, sender: { name: v.sender.name, address: v.sender.address, contact: v.sender.contact }, ...(v.segment ? { segment: validateDeliveryCondition(v.segment) } : {}) };
}
export async function scenarioDigest(scenario) {
    const data = validateScenario(scenario);
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify({ id: data.id, workspaceId: data.workspaceId, name: data.name, trigger: data.trigger, segment: data.segment, steps: data.steps, sender: data.sender })));
    return [...new Uint8Array(bytes)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export function eligibleForScenario(scenario, event, contact) {
    return scenario.state === 'active' && !!scenario.approvedBy && !!scenario.digest && scenario.workspaceId === event.workspaceId && contact.id === event.contactId && !contact.erased
        && scenario.trigger.kind === event.kind && (!scenario.trigger.value || scenario.trigger.value === event.value)
        && (!scenario.segment || matchesDeliveryCondition(contact, scenario.segment));
}
/** All state mutations are serialized by the host. Network work is outside transactions. */
export class StepDeliveryEngine {
    store;
    transport;
    now;
    constructor(store, transport, now = () => new Date().toISOString()) {
        this.store = store;
        this.transport = transport;
        this.now = now;
    }
    async saveDraft(scenario) {
        const clean = validateScenario(scenario);
        requireStep(clean.state === 'draft');
        await this.store.transaction(clean.workspaceId, async (tx) => {
            const old = await tx.scenario(clean.id);
            requireStep(!old?.digest, 'content_locked', 409);
            if (!old)
                requireStep((await tx.scenarios()).length < 100, 'scenario_limit', 409);
            requireStep(!old || old.version === clean.version, 'conflict', 409);
            await tx.saveScenario({ ...clean, version: old ? old.version + 1 : 1 }, old?.version ?? null);
        });
    }
    async activate(workspaceId, id, version, actorId) {
        requireDeliveryId(actorId);
        return this.store.transaction(workspaceId, async (tx) => {
            const s = await tx.scenario(id);
            requireStep(s, 'not_found', 404);
            requireStep(s.version === version, 'conflict', 409);
            requireStep(s.state === 'draft' || s.state === 'paused', 'invalid_state', 409);
            if (s.steps.some(step => step.channel === 'email'))
                requireStep(Object.values(s.sender).every(x => x.trim()), 'sender_required');
            const active = { ...s, state: 'active', version: s.version + 1, approvalId: s.approvalId ?? crypto.randomUUID(), approvalRunId: s.approvalRunId ?? crypto.randomUUID(), approvedBy: s.approvedBy ?? actorId, approvedAt: s.approvedAt ?? this.now(), digest: s.digest ?? await scenarioDigest(s) };
            await tx.saveScenario(active, s.version);
            return active;
        });
    }
    async pause(workspaceId, id, version) {
        return this.store.transaction(workspaceId, async (tx) => { const s = await tx.scenario(id); requireStep(s, 'not_found', 404); requireStep(s.version === version, 'conflict', 409); requireStep(s.state === 'active', 'invalid_state', 409); await tx.saveScenario({ ...s, state: 'paused', version: s.version + 1 }, s.version); });
    }
    async enroll(event) {
        requireDeliveryId(event.id);
        requireDeliveryId(event.workspaceId);
        requireDeliveryId(event.contactId);
        requireStep(Number.isFinite(Date.parse(event.occurredAt)));
        return this.store.transaction(event.workspaceId, async (tx) => {
            const c = await tx.contact(event.contactId);
            if (!c)
                return 0;
            let n = 0;
            for (const s of await tx.scenarios()) {
                if (!eligibleForScenario(s, event, c) || await tx.findEnrollment(s.id, c.id))
                    continue;
                // An old event delivered after activation does not enroll historic contacts.
                if (Date.parse(event.occurredAt) < Date.parse(s.approvedAt))
                    continue;
                if (!s.steps.some(step => c.channels[step.channel]?.consent === 'granted'))
                    continue;
                const e = { id: crypto.randomUUID(), scenarioId: s.id, contactId: c.id, eventId: event.id, enrolledAt: event.occurredAt, state: 'active', next: 0 };
                await tx.saveEnrollment(e);
                await tx.saveJob({ id: crypto.randomUUID(), workspaceId: s.workspaceId, scenarioId: s.id, enrollmentId: e.id, stepId: s.steps[0].id, scenarioDigest: s.digest, dueAt: stepDueAt(e.enrolledAt, s.steps[0]), state: 'pending' });
                n++;
            }
            return n;
        });
    }
    async tick(workspaceId, limit = 20) {
        requireStep(Number.isSafeInteger(limit) && limit > 0 && limit <= 100);
        const now = this.now();
        const jobs = await this.store.transaction(workspaceId, tx => tx.due(now, limit));
        let sent = 0, skipped = 0, uncertain = 0;
        for (const candidate of jobs) {
            const claim = await this.store.transaction(workspaceId, async (tx) => {
                const j = await tx.job(candidate.id);
                if (!j || j.state !== 'pending' || Date.parse(j.dueAt) > Date.parse(this.now()))
                    return null;
                const s = await tx.scenario(j.scenarioId), e = await tx.enrollment(j.enrollmentId);
                if (!s || !e || s.state !== 'active' || e.state !== 'active')
                    return null;
                const step = s.steps[e.next];
                requireStep(step?.id === j.stepId, 'step_mismatch', 409);
                const c = await tx.contact(e.contactId), point = c?.channels[step.channel];
                const stopped = !c || c.erased || !point?.to || point.consent !== 'granted' || !DELIVERY_UUID.test(point.evidenceId);
                if (stopped || (step.condition && !matchesDeliveryCondition(c, step.condition))) {
                    await tx.saveJob({ ...j, state: 'skipped', reason: stopped ? 'consent_required' : 'condition_mismatch' });
                    await this.advance(tx, s, e, stopped);
                    skipped++;
                    return null;
                }
                const claimed = { ...j, state: 'sending', token: crypto.randomUUID(), attemptedAt: this.now(), leaseUntil: new Date(Date.parse(this.now()) + 120000).toISOString() };
                await tx.saveJob(claimed);
                return { job: claimed, scenario: s, enrollment: e, step, contact: c };
            });
            if (!claim)
                continue;
            // The broker repeats the exact approval/consent check at the external write boundary.
            let outcome = 'uncertain';
            try {
                outcome = await this.transport.send(claim);
            }
            catch { /* ambiguous external result must never retry automatically */ }
            await this.store.transaction(workspaceId, async (tx) => {
                const j = await tx.job(claim.job.id);
                if (!j || j.state !== 'sending' || j.token !== claim.job.token)
                    return;
                if (outcome === 'rejected' && (await tx.scenario(j.scenarioId))?.state === 'paused') {
                    await tx.saveJob({ ...j, state: 'pending', token: undefined, leaseUntil: undefined, attemptedAt: undefined });
                    return;
                }
                await tx.saveJob({ ...j, state: outcome === 'accepted' ? 'sent' : outcome === 'rejected' ? 'canceled' : 'uncertain', reason: outcome });
                const e = await tx.enrollment(j.enrollmentId), s = await tx.scenario(j.scenarioId);
                if (e && s && outcome === 'accepted') {
                    sent++;
                    await this.advance(tx, s, e, false);
                }
                else if (e) {
                    await tx.saveEnrollment({ ...e, state: 'stopped' });
                    if (outcome === 'uncertain')
                        uncertain++;
                }
            });
        }
        return { sent, skipped, uncertain, processed: jobs.length };
    }
    async advance(tx, s, e, stop) {
        const next = e.next + 1, step = s.steps[next];
        await tx.saveEnrollment({ ...e, next, state: stop ? 'stopped' : step ? 'active' : 'completed' });
        if (!stop && step)
            await tx.saveJob({ id: crypto.randomUUID(), workspaceId: s.workspaceId, scenarioId: s.id, enrollmentId: e.id, stepId: step.id, scenarioDigest: s.digest, dueAt: stepDueAt(this.now(), step), state: 'pending' });
    }
}
