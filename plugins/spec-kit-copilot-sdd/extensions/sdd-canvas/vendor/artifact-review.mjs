import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
import { ArtifactReadError, inspectArtifact, readArtifact, validateArtifactPath } from "./artifact-read.mjs";
import { deriveWizardArtifacts, scanArtifactCandidates } from "./artifact-discovery.mjs";
import { parseClarificationSource } from "./artifact-clarifications.mjs";

export const ARTIFACT_PAGE_SIZE = 200;
export const ARTIFACT_INSPECTION_LIMIT = 10_000;

function boundedString(value, maximum = 256) {
    return typeof value === "string" && value.length > 0 && value.length <= maximum && !/[\x00-\x1f\x7f]/.test(value);
}

function requireId(value, maximum) {
    if (!boundedString(value, maximum)) throw new ArtifactReadError("invalid_request");
}

function normalizeDescriptor(value, id) {
    const validated = validateArtifactPath(value?.relativePath);
    if (!boundedString(value.label) || !["primary", "supporting", "command", "reference"].includes(value.role) ||
        !["available", "expected", "deleted", "unsupported"].includes(value.availability)) {
        throw new ArtifactReadError("unsupported_artifact");
    }
    const descriptor = {
        id, relativePath: validated.relativePath, label: value.label,
        role: value.role, availability: value.availability, suffix: validated.suffix,
        owningStage: boundedString(value.owningStage) ? value.owningStage : null,
        owningCommand: boundedString(value.owningCommand) ? value.owningCommand : null,
        originArtifactId: boundedString(value.originArtifactId) ? value.originArtifactId : null,
    };
    if (Number.isSafeInteger(value.byteSize) && value.byteSize >= 0) descriptor.byteSize = value.byteSize;
    if (typeof value.modifiedAt === "string" && Number.isFinite(Date.parse(value.modifiedAt))) {
        descriptor.modifiedAt = new Date(value.modifiedAt).toISOString();
    }
    return descriptor;
}

const ROLE_ORDER = { primary: 0, supporting: 1, command: 2, reference: 3 };
export function compareArtifacts(first, second) {
    const role = ROLE_ORDER[first.role] - ROLE_ORDER[second.role];
    if (role) return role;
    for (const key of ["owningStage", "owningCommand", "relativePath"]) {
        const left = String(first[key] ?? "");
        const right = String(second[key] ?? "");
        if (left !== right) return left < right ? -1 : 1;
    }
    return 0;
}

export function createReviewStore({
    canvasId, instanceId, workspacePath, validateScope, discover, resolveMember,
    now = Date.now, ttlMs = 15 * 60_000, maxContexts = 20,
}) {
    if (!["speckit-wizard", "sdd-canvas"].includes(canvasId) || !boundedString(instanceId) ||
        typeof workspacePath !== "string" || !path.isAbsolute(workspacePath) ||
        ![validateScope, discover, resolveMember].every((callback) => typeof callback === "function") ||
        !Number.isSafeInteger(maxContexts) || maxContexts < 1 || maxContexts > 100 ||
        !Number.isSafeInteger(ttlMs) || ttlMs < 1 || ttlMs > 24 * 60 * 60_000) {
        throw new ArtifactReadError("invalid_request");
    }
    const contexts = new Map();
    const workspaceFingerprint = createHash("sha256").update(path.resolve(workspacePath)).digest("hex");

    const publicContext = (context) => ({
        id: context.id, canvasId, generation: context.generation,
        scopeType: context.scopeType, scopeKey: context.scopeKey,
        originStage: context.originStage, originCommand: context.originCommand,
    });

    async function checked(contextId) {
        requireId(contextId, 256);
        const context = contexts.get(contextId);
        if (!context || now() - context.createdAt >= ttlMs) {
            contexts.delete(contextId);
            throw new ArtifactReadError("invalid_context");
        }
        let valid;
        try {
            valid = await validateScope(publicContext(context));
        } catch {
            throw new ArtifactReadError("workspace_unavailable");
        }
        if (valid !== true || contexts.get(contextId) !== context) {
            contexts.delete(contextId);
            throw new ArtifactReadError("invalid_context");
        }
        return context;
    }

    function remember(context, candidate) {
        const existing = context.paths.get(candidate.relativePath);
        const id = existing ?? `artifact_${randomUUID()}`;
        const descriptor = normalizeDescriptor(candidate, id);
        if (!existing && context.artifacts.size >= ARTIFACT_INSPECTION_LIMIT) throw new ArtifactReadError("invalid_request");
        context.paths.set(descriptor.relativePath, id);
        context.artifacts.set(id, descriptor);
        return { ...descriptor };
    }

    return {
        createContext({ scopeType, scopeKey, generation = 1, originStage = null, originCommand = null }) {
            if (!["project", "feature", "composition"].includes(scopeType) || !boundedString(scopeKey) ||
                !Number.isSafeInteger(generation) || generation < 1) throw new ArtifactReadError("invalid_request");
            for (const [id, context] of contexts) {
                if (now() - context.createdAt >= ttlMs) contexts.delete(id);
            }
            while (contexts.size >= maxContexts) contexts.delete(contexts.keys().next().value);
            const context = {
                id: `ctx_${randomUUID()}`, instanceId, workspaceFingerprint,
                scopeType, scopeKey, generation, originStage, originCommand,
                createdAt: now(), artifacts: new Map(), paths: new Map(), cursors: new Map(),
            };
            contexts.set(context.id, context);
            return publicContext(context);
        },

        async getContext(contextId) {
            return publicContext(await checked(contextId));
        },

        async list(contextId, { cursor = null } = {}) {
            const context = await checked(contextId);
            let position = { resumeKey: null, inspectedCount: 0 };
            if (cursor !== null && cursor !== undefined) {
                requireId(cursor, 1024);
                position = context.cursors.get(cursor);
                if (!position || position.generation !== context.generation || now() - position.createdAt >= ttlMs) {
                    throw new ArtifactReadError("invalid_context");
                }
            }
            const limit = Math.min(ARTIFACT_PAGE_SIZE, ARTIFACT_INSPECTION_LIMIT - position.inspectedCount);
            if (limit <= 0) throw new ArtifactReadError("invalid_context");
            let discovered;
            try {
                discovered = await discover(publicContext(context), { ...position, limit });
            } catch (error) {
                if (error instanceof ArtifactReadError) throw error;
                throw new ArtifactReadError("read_failed");
            }
            await checked(contextId);
            if (!Array.isArray(discovered?.entries) || !Number.isSafeInteger(discovered.inspectedCount) ||
                discovered.inspectedCount < discovered.entries.length || discovered.inspectedCount > limit ||
                discovered.inspectedCount < 0 || (discovered.inspectedCount === 0 && !discovered.complete) ||
                discovered.entries.length > ARTIFACT_PAGE_SIZE || typeof discovered.complete !== "boolean") {
                throw new ArtifactReadError("read_failed");
            }
            const items = discovered.entries.map((entry) => remember(context, entry)).sort(compareArtifacts);
            const inspectedCount = position.inspectedCount + discovered.inspectedCount;
            const limitReached = inspectedCount >= ARTIFACT_INSPECTION_LIMIT && !discovered.complete;
            let nextCursor = null;
            if (!discovered.complete && !limitReached) {
                nextCursor = `cursor_${randomUUID()}`;
                while (context.cursors.size >= 128) context.cursors.delete(context.cursors.keys().next().value);
                context.cursors.set(nextCursor, {
                    generation: context.generation, resumeKey: discovered.resumeKey,
                    inspectedCount, createdAt: now(),
                });
            }
            return { contextId, generation: context.generation, items, nextCursor, limitReached };
        },

        async resolve(contextId, artifactId) {
            const context = await checked(contextId);
            requireId(artifactId, 256);
            const descriptor = context.artifacts.get(artifactId);
            if (!descriptor) throw new ArtifactReadError("artifact_unavailable");
            let current;
            try {
                current = await resolveMember(publicContext(context), descriptor.relativePath);
            } catch (error) {
                if (error instanceof ArtifactReadError) throw error;
                throw new ArtifactReadError("read_failed");
            }
            await checked(contextId);
            if (!current || current.relativePath !== descriptor.relativePath || current.availability !== "available") {
                throw new ArtifactReadError("artifact_unavailable");
            }
            return remember(context, current);
        },

        async register(contextId, candidate) {
            return remember(await checked(contextId), candidate);
        },

        invalidate(contextId) { contexts.delete(contextId); },
        clear() { contexts.clear(); },
    };
}

export function createArtifactReviewService({ canvasId, instanceId, workspacePath, getScope, discoverCandidates }) {
    const selections = new Map();
    const discoveries = new Map();
    const references = new Map();
    function bindingsFor(contextId, artifact, document) {
        if (!artifact.owningCommand || !["primary", "supporting"].includes(artifact.role) ||
            (canvasId === "sdd-canvas" && (artifact.owningStage !== "specify" || artifact.role !== "primary"))) return [];
        return parseClarificationSource(document.content).map((question) => {
            const questionId = `question_${createHash("sha256").update(`${question.startIdx}:${question.question}`).digest("hex").slice(0, 24)}`;
            return {
                id: `binding_${createHash("sha256").update(`${contextId}:${artifact.id}:${document.revision}:${questionId}`).digest("hex").slice(0, 32)}`,
                contextId, artifactId: artifact.id, revision: document.revision, questionId,
                question: question.question, section: question.section, index: question.index,
                sourceStart: question.startIdx, sourceEnd: question.endIdx,
                commandName: canvasId === "sdd-canvas" ? "speckit-clarify" : artifact.owningCommand,
                mode: canvasId === "sdd-canvas" ? "sdd-immediate" : "wizard-batched",
            };
        });
    }
    async function currentScope(context) {
        const selection = selections.get(context.id);
        if (!selection) return null;
        const scope = await getScope(selection);
        return scope?.scopeKey === context.scopeKey ? scope : null;
    }
    async function hydrate(candidate) {
        validateArtifactPath(candidate.relativePath);
        try {
            return { ...candidate, ...await inspectArtifact(workspacePath, candidate.relativePath), availability: "available" };
        } catch (error) {
            if (error.code === "artifact_unavailable") return { ...candidate, availability: "expected" };
            throw error;
        }
    }
    const store = createReviewStore({
        canvasId, instanceId, workspacePath,
        validateScope: async (context) => Boolean(await currentScope(context)),
        resolveMember: async (context, relativePath) => {
            const scope = await currentScope(context);
            if (!scope) return null;
            const reference = references.get(context.id)?.get(relativePath);
            if (reference) {
                await readArtifact(workspacePath, reference.originPath, { expectedRevision: reference.originRevision });
                return hydrate(reference);
            }
            let candidate = scope.candidates.find((entry) => entry.relativePath === relativePath);
            if (!candidate && scope.roots?.some((root) => relativePath.startsWith(`${root}/`))) {
                candidate = discoveries.get(context.id)?.candidates.find((entry) => entry.relativePath === relativePath);
            }
            return candidate ? hydrate(candidate) : null;
        },
        discover: async (context, { resumeKey, limit }) => {
            const scope = await currentScope(context);
            if (!scope) throw new ArtifactReadError("invalid_context");
            if (!resumeKey) {
                const result = discoverCandidates
                    ? await discoverCandidates(scope)
                    : { candidates: scope.candidates, inspectedCount: scope.candidates.length, limitReached: false };
                discoveries.set(context.id, { ...result, candidates: result.candidates.slice().sort(compareArtifacts), scanId: randomUUID() });
            }
            const discovered = discoveries.get(context.id);
            if (!discovered || (resumeKey && resumeKey.scanId !== discovered.scanId)) throw new ArtifactReadError("invalid_context");
            const offset = resumeKey?.offset ?? 0;
            const total = Math.max(discovered.inspectedCount, discovered.candidates.length);
            const inspected = Math.min(limit, total - offset);
            const selected = discovered.candidates.slice(offset, offset + inspected);
            return {
                entries: await Promise.all(selected.map(hydrate)),
                inspectedCount: inspected, resumeKey: { offset: offset + inspected, scanId: discovered.scanId },
                complete: offset + inspected >= total && !discovered.limitReached,
            };
        },
    });
    return {
        async open(input = {}) {
            const selection = {};
            for (const key of ["stage", "source", "feature", "command"]) {
                if (input[key] === undefined || input[key] === null || input[key] === "") continue;
                if (!boundedString(input[key], key === "source" ? 2048 : 256)) throw new ArtifactReadError("invalid_request");
                selection[key] = input[key];
            }
            const scope = await getScope(selection);
            if (!scope?.primary || !scope.candidates?.length) throw new ArtifactReadError("artifact_unavailable");
            const context = store.createContext(scope);
            while (selections.size >= 20) {
                const oldest = selections.keys().next().value;
                selections.delete(oldest);
                discoveries.delete(oldest);
                references.delete(oldest);
                store.invalidate(oldest);
            }
            selections.set(context.id, selection);
            const page = await store.list(context.id);
            const primary = page.items.find((entry) => entry.relativePath === scope.primary.relativePath);
            if (!primary) throw new ArtifactReadError("artifact_unavailable");
            return { ...page, primaryArtifactId: primary.id };
        },
        list: (contextId, options) => store.list(contextId, options),
        async content(contextId, artifactId, options) {
            const artifact = await store.resolve(contextId, artifactId);
            const document = await readArtifact(workspacePath, artifact.relativePath, options);
            await store.resolve(contextId, artifactId);
            return { artifact, ...document, clarifications: bindingsFor(contextId, artifact, document) };
        },
        async clarifications(contextId, artifactId) {
            const artifact = await store.resolve(contextId, artifactId);
            const document = await readArtifact(workspacePath, artifact.relativePath);
            return bindingsFor(contextId, artifact, document);
        },
        async validateClarifications(contextId, artifactId, expectedRevision, answers, commandName) {
            if (!Array.isArray(answers) || !answers.length || answers.length > (canvasId === "sdd-canvas" ? 1 : 100) ||
                typeof expectedRevision !== "string" || !/^sha256:[a-f0-9]{64}$/.test(expectedRevision) ||
                new Set(answers.map((answer) => answer.questionId)).size !== answers.length) throw new ArtifactReadError("invalid_request");
            const artifact = await store.resolve(contextId, artifactId);
            const document = await readArtifact(workspacePath, artifact.relativePath, { expectedRevision });
            const current = bindingsFor(contextId, artifact, document);
            const accepted = answers.map((answer) => {
                if (!boundedString(answer?.answer, 4000) || !answer.answer.trim()) throw new ArtifactReadError("invalid_request");
                const binding = current.find((entry) => entry.questionId === answer.questionId && entry.question === answer.question &&
                    (answer.index === undefined || entry.index === answer.index) && (!commandName || entry.commandName === commandName));
                if (!binding) throw new ArtifactReadError("changed_source");
                return { ...binding, relativePath: artifact.relativePath, answer: answer.answer.trim() };
            });
            await store.resolve(contextId, artifactId);
            return accepted;
        },
        async resolveLink(contextId, sourceArtifactId, expectedRevision, target) {
            const source = await store.resolve(contextId, sourceArtifactId);
            await readArtifact(workspacePath, source.relativePath, { expectedRevision });
            if (!boundedString(target, 2048) || /^[\s\\]|^\/\//.test(target)) return { kind: "inert", reason: "unsupported_target" };
            if (/^[a-z][a-z0-9+.-]*:/i.test(target)) {
                try {
                    const external = new URL(target);
                    if (!["http:", "https:"].includes(external.protocol) || external.username || external.password) {
                        return { kind: "inert", reason: "unsupported_scheme" };
                    }
                    return { kind: "external", url: external.href, requiresUserAction: true };
                } catch { return { kind: "inert", reason: "unsupported_target" }; }
            }
            let relativeTarget;
            let fragment;
            try {
                const separator = target.indexOf("#");
                const file = separator < 0 ? target : target.slice(0, separator);
                fragment = separator < 0 ? "" : decodeURIComponent(target.slice(separator + 1));
                relativeTarget = decodeURIComponent(file);
                if (fragment.length > 1024 || /[\x00-\x1f\x7f]/.test(fragment) || /[\\:?]/.test(relativeTarget) || relativeTarget.startsWith("/")) {
                    return { kind: "inert", reason: "unsupported_target" };
                }
                if (!relativeTarget) return { kind: "fragment", artifactId: sourceArtifactId, fragment };
                relativeTarget = path.posix.normalize(path.posix.join(path.posix.dirname(source.relativePath), relativeTarget));
                validateArtifactPath(relativeTarget);
            } catch { return { kind: "inert", reason: "unsupported_target" }; }
            if (relativeTarget === source.relativePath) return { kind: "fragment", artifactId: sourceArtifactId, fragment };
            const document = await readArtifact(workspacePath, relativeTarget);
            const reference = {
                relativePath: relativeTarget, label: path.posix.basename(relativeTarget), role: "reference",
                availability: "available", originArtifactId: sourceArtifactId,
                originPath: source.relativePath, originRevision: expectedRevision,
                byteSize: document.byteSize, modifiedAt: document.modifiedAt,
            };
            await store.getContext(contextId);
            if (!references.has(contextId)) references.set(contextId, new Map());
            const scopedReferences = references.get(contextId);
            if (scopedReferences.size >= 1000 && !scopedReferences.has(relativeTarget)) throw new ArtifactReadError("invalid_request");
            scopedReferences.set(relativeTarget, reference);
            const artifact = await store.register(contextId, reference);
            return { kind: "artifact", artifact, fragment };
        },
        async signature() {
            const digest = createHash("sha256");
            let inspected = 0;
            for (const [contextId, selection] of selections) {
                if (inspected >= ARTIFACT_INSPECTION_LIMIT) break;
                try {
                    await store.getContext(contextId);
                    const scope = await getScope(selection);
                    const discovered = discoverCandidates ? await discoverCandidates(scope) : { candidates: scope.candidates };
                    for (const candidate of discovered.candidates) {
                        if (inspected++ >= ARTIFACT_INSPECTION_LIMIT) break;
                        digest.update(candidate.relativePath);
                        try {
                            const metadata = await inspectArtifact(workspacePath, candidate.relativePath);
                            digest.update(`${metadata.byteSize}:${metadata.modifiedAt}`);
                        } catch (error) { digest.update(error.code ?? "unavailable"); }
                    }
                } catch {
                    digest.update("invalid-context");
                }
            }
            return digest.digest("hex");
        },
        dispose() { selections.clear(); discoveries.clear(); references.clear(); store.clear(); },
    };
}

export function wizardPrimaryScope(snapshot, selection, workspacePath) {
    if (!snapshot?.workspacePath || path.resolve(snapshot.workspacePath) !== path.resolve(workspacePath)) {
        throw new ArtifactReadError("workspace_unavailable");
    }
    const candidates = [];
    for (const [stage, phase] of Object.entries(snapshot.phases ?? {})) {
        const expected = { specify: "spec.md", plan: "plan.md", tasks: "tasks.md" }[stage];
        const artifactPath = phase.artifactPath ?? (snapshot.slug && expected ? `specs/${snapshot.slug}/${expected}` : stage === "constitution" ? ".specify/memory/constitution.md" : null);
        if (!artifactPath) continue;
        candidates.push({
            relativePath: artifactPath.replaceAll("\\", "/"), label: phase.name || stage,
            role: "primary", owningStage: stage, owningCommand: `speckit.${stage}`,
        });
    }
    for (const command of snapshot.commands ?? []) {
        if (!command.artifactPath || candidates.some((entry) => entry.relativePath === command.artifactPath)) continue;
        candidates.push({ relativePath: command.artifactPath.replaceAll("\\", "/"), label: command.shortLabel || command.id,
            role: "primary", owningStage: command.id, owningCommand: command.commandName });
    }
    for (const artifact of snapshot.composition?.artifacts ?? []) {
        if (artifact.kind !== "command") continue;
        const name = String(artifact.id).replace(/^commands\//, "");
        if (!/^speckit\.[a-z0-9.-]+$/i.test(name)) continue;
        const relativePath = `.github/skills/${name.replace(/^speckit\./, "speckit-")}/SKILL.md`;
        candidates.push({ relativePath, label: name, role: "command", owningCommand: name });
    }
    let stage = selection.stage?.replace(/^commands\//, "").replace(/^speckit[.-]/, "");
    if (!stage && !selection.source) stage = snapshot.currentPhase;
    let primary = candidates.find((entry) =>
        (!stage || entry.owningStage === stage || entry.owningStage === selection.stage) &&
        (!selection.source || entry.relativePath === selection.source));
    if (!primary && selection.source) {
        const derived = deriveWizardArtifacts(snapshot);
        const known = derived.candidates.find((entry) => entry.relativePath === selection.source);
        if (known) primary = known;
        else if (derived.roots.some((root) => selection.source.startsWith(`${root}/`))) {
            validateArtifactPath(selection.source);
            primary = { relativePath: selection.source, label: path.posix.basename(selection.source), role: "primary" };
        }
    }
    if (!primary) return null;
    validateArtifactPath(primary.relativePath);
    const scopeKey = createHash("sha256").update(JSON.stringify([snapshot.slug, primary.relativePath, primary.owningStage])).digest("hex");
    return {
        scopeType: primary.role === "command" ? "composition" : snapshot.slug ? "feature" : "project",
        scopeKey, originStage: primary.owningStage ?? null, originCommand: primary.owningCommand ?? null,
        primary, ...deriveWizardArtifacts(snapshot, primary),
    };
}

export function createWizardReviewService({ workspacePath, instanceId, getState }) {
    return createArtifactReviewService({
        canvasId: "speckit-wizard", workspacePath, instanceId,
        getScope: async (selection) => wizardPrimaryScope(await getState(), selection, workspacePath),
        discoverCandidates: (scope) => scanArtifactCandidates({ workspacePath, roots: scope.roots, explicit: scope.candidates }),
    });
}

export async function handleArtifactReview(req, res, url, service) {
    let status = 200;
    let payload;
    try {
        const limits = { stage: 256, source: 2048, feature: 256, command: 256, context: 256, artifactId: 256,
            cursor: 1024, expectedRevision: 71, token: 256, cap: 256 };
        for (const [key, value] of url.searchParams) {
            if (!Object.hasOwn(limits, key) || value.length > limits[key] || /[\x00-\x1f\x7f]/.test(value) || url.searchParams.getAll(key).length > 1) {
                throw new ArtifactReadError("invalid_request");
            }
        }
        let data;
        if (["/api/review/resolve-link", "/api/review/validate-clarifications"].includes(url.pathname) && req.method === "POST") {
            if (!/^application\/json(?:;|$)/i.test(req.headers["content-type"] ?? "")) throw new ArtifactReadError("invalid_request");
            const chunks = [];
            let size = 0;
            for await (const chunk of req) {
                size += chunk.length;
                if (size > 16_384) throw new ArtifactReadError("invalid_request");
                chunks.push(chunk);
            }
            let body;
            try { body = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))); }
            catch { throw new ArtifactReadError("invalid_request"); }
            const validation = url.pathname === "/api/review/validate-clarifications";
            const fields = validation ? ["contextId", "artifactId", "expectedRevision", "answers", "commandName"] : ["contextId", "sourceArtifactId", "expectedRevision", "target"];
            if (!body || Array.isArray(body) || Object.keys(body).some((key) => !fields.includes(key))) {
                throw new ArtifactReadError("invalid_request");
            }
            if (typeof body.expectedRevision !== "string") throw new ArtifactReadError("invalid_request");
            data = validation
                ? { clarifications: await service.validateClarifications(body.contextId, body.artifactId, body.expectedRevision, body.answers, body.commandName) }
                : await service.resolveLink(body.contextId, body.sourceArtifactId, body.expectedRevision, body.target);
        } else if (req.method !== "GET") throw new ArtifactReadError("invalid_request");
        else if (url.pathname === "/api/review/context") {
            data = await service.open(Object.fromEntries(["stage", "source", "feature", "command"].map((key) => [key, url.searchParams.get(key)])));
        } else if (url.pathname === "/api/review/artifacts") {
            data = await service.list(url.searchParams.get("context"), { cursor: url.searchParams.get("cursor") });
        } else if (url.pathname === "/api/review/content") {
            data = await service.content(url.searchParams.get("context"), url.searchParams.get("artifactId"),
                { expectedRevision: url.searchParams.get("expectedRevision") ?? undefined });
        } else throw new ArtifactReadError("invalid_request");
        payload = { ok: true, data };
    } catch (error) {
        const failure = error instanceof ArtifactReadError ? error : new ArtifactReadError("read_failed");
        status = failure.status;
        payload = { ok: false, error: { code: failure.code, message: failure.message, retryable: failure.retryable } };
    }
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff",
    });
    res.end(JSON.stringify(payload));
}
