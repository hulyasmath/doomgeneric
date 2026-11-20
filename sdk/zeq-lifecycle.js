"use strict";
// Signed local application/plugin lifecycle. No ambient capabilities or code execution.
(function (root, factory) {
  const security = typeof module === "object" && module.exports ? require("./zeq-security.js") : root.ZeqSecurity;
  const api = factory(security);
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.ZeqLifecycle = api;
})(typeof window !== "undefined" ? window : globalThis, function (Security) {
  const FORMAT = "zeq-application-lifecycle-v1", DESCRIPTOR = "zeq-application-v1", STATE = "zeq-application-state-v1";
  const ACTIONS = new Set(["install", "enable", "disable", "update", "transfer", "revoke", "attest"]);
  const EXECUTION = new Set(["data-only", "sandboxed-script", "external-process", "native-unsafe"]);
  const id = value => typeof value === "string" && /^[A-Za-z][A-Za-z0-9_.-]{0,127}$/.test(value);
  const digest = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
  const anchorValid = anchor => anchor && anchor.format === "zeq-trust-anchor-v1" && anchor.algorithm === "Ed25519" && digest(anchor.key_id) && typeof anchor.public_key === "string";
  function canonical(value, limit = 1048576) {
    const text = Security.canonical(value);
    if (new TextEncoder().encode(text).length > limit) throw new RangeError("lifecycle size limit");
    return text;
  }
  function capabilities(values) {
    if (!Array.isArray(values) || values.length > 64 || values.some(value => typeof value !== "string" || !/^[a-z][a-z0-9-]*:(?:read|write|execute|control)$/.test(value))) throw new TypeError("invalid capability list");
    if (new Set(values).size !== values.length) throw new TypeError("duplicate capabilities");
    return Object.freeze([...values].sort());
  }
  function descriptor(value, hostCompatibility) {
    if (!value || value.format !== DESCRIPTOR || !id(value.id) || !/^\d{1,10}$/.test(value.version || "") || !digest(value.content_sha256)) throw new TypeError("invalid application descriptor");
    if (value.compatibility !== hostCompatibility || !EXECUTION.has(value.execution)) throw new TypeError("incompatible application or execution profile");
    const result = { format: DESCRIPTOR, id: value.id, version: value.version, content_sha256: value.content_sha256, compatibility: value.compatibility, execution: value.execution, requested_capabilities: capabilities(value.requested_capabilities), sandbox: value.sandbox || null };
    if (["sandboxed-script", "external-process"].includes(result.execution) && (!id(result.sandbox))) throw new TypeError("named sandbox/process boundary required");
    canonical(result, 65536); return Object.freeze(result);
  }
  async function signedRecord(signer, fields) {
    if (!signer || typeof signer.sign !== "function" || !anchorValid(signer.anchor)) throw new TypeError("valid public signer required");
    const body = { format: FORMAT, ...fields };
    canonical(body);
    return { ...body, record_sha256: await Security.sha256(Security.canonical(body)), signature: await signer.sign(body), signer: signer.anchor };
  }
  async function verifyRecord(record) {
    if (!record || record.format !== FORMAT || !ACTIONS.has(record.action) || !digest(record.record_sha256) || !anchorValid(record.signer)) return false;
    const { record_sha256, signature, signer, ...body } = record;
    return await Security.sha256(Security.canonical(body)) === record_sha256 && await Security.verifySignature(signer, body, signature);
  }
  function publicState(app) {
    return { descriptor: app.descriptor, owner: app.owner, enabled: app.enabled, revoked: app.revoked, grants: [...app.grants], sequence: app.records.length };
  }

  function createLifecycle(options = {}) {
    if (!id(options.compatibility)) throw new TypeError("host compatibility profile required");
    const compatibility = options.compatibility, applications = new Map();
    async function install(value, signer, installOptions = {}) {
      const desc = descriptor(value, compatibility);
      if (applications.has(desc.id)) throw new Error("application already installed");
      if (typeof installOptions.verifyContent !== "function" || await installOptions.verifyContent(desc.content_sha256) !== true) throw new Error("content bytes must be verified independently before install");
      const requested = new Set(desc.requested_capabilities), granted = capabilities(installOptions.grant || []);
      if (granted.some(capability => !requested.has(capability))) throw new Error("grant exceeds requested capabilities");
      const app = { descriptor: desc, owner: signer.anchor, enabled: false, revoked: false, grants: granted, records: [] };
      const record = await signedRecord(signer, { application: desc.id, action: "install", sequence: 0, previous_sha256: null, descriptor: desc, grants: granted, actor_key_id: signer.anchor.key_id, new_owner: null, attestation: null });
      if (!await verifyRecord(record)) throw new Error("record self-verification failed");
      app.records.push(record); applications.set(desc.id, app); return publicState(app);
    }
    function current(application) {
      const app = applications.get(application);
      if (!app) throw new Error("unknown application");
      return app;
    }
    async function transition(application, action, signer, transitionOptions = {}) {
      const app = current(application);
      if (!["enable", "disable", "update", "transfer", "revoke"].includes(action)) throw new TypeError("invalid lifecycle transition");
      if (app.revoked) throw new Error("revoked application is terminal");
      if (signer?.anchor?.key_id !== app.owner.key_id) throw new Error("only the current owner may transition lifecycle state");
      let desc = app.descriptor, grants = app.grants, newOwner = null;
      if (action === "enable") {
        if (app.enabled) throw new Error("application already enabled");
        if (desc.execution === "native-unsafe" && transitionOptions.allowUnsafeNative !== true) throw new Error("unsafe native execution requires an explicit host decision and is not sandboxed");
      }
      if (action === "disable" && !app.enabled) throw new Error("application already disabled");
      if (action === "update") {
        desc = descriptor(transitionOptions.descriptor, compatibility);
        if (desc.id !== app.descriptor.id || !/^\d+$/.test(desc.version) || Number(desc.version) <= Number(app.descriptor.version)) throw new Error("update must increase application version");
        if (typeof transitionOptions.verifyContent !== "function" || await transitionOptions.verifyContent(desc.content_sha256) !== true) throw new Error("updated content verification failed");
        const requested = new Set(desc.requested_capabilities); grants = capabilities(transitionOptions.grant || []);
        if (granted.some(capability => !requested.has(capability))) throw new Error("update grant exceeds request");
        app.enabled = false;
      }
      if (action === "transfer") {
        if (!anchorValid(transitionOptions.newOwner) || transitionOptions.newOwner.key_id === app.owner.key_id) throw new TypeError("distinct valid new owner required");
        newOwner = transitionOptions.newOwner;
      }
      const record = await signedRecord(signer, { application: app.descriptor.id, action, sequence: app.records.length, previous_sha256: app.records.at(-1).record_sha256, descriptor: action === "install" || action === "update" ? desc : null, grants: action === "install" || action === "update" ? grants : null, actor_key_id: signer.anchor.key_id, new_owner: newOwner, attestation: null });
      app.records.push(record);
      if (action === "enable") app.enabled = true;
      if (action === "disable") app.enabled = false;
      if (action === "revoke") { app.revoked = true; app.enabled = false; app.grants = []; }
      if (action === "update") { app.descriptor = desc; app.grants = grants; }
      if (action === "transfer") app.owner = newOwner;
      return publicState(app);
    }
    async function attest(application, signer, attestation) {
      const app = current(application);
      if (!attestation || attestation.format !== "zeq-attestation-v1" || typeof attestation.claim !== "string" || !attestation.claim.length || attestation.claim.length > 512 || !digest(attestation.subject_sha256)) throw new TypeError("bounded attestation and subject digest required");
      const record = await signedRecord(signer, { application: app.descriptor.id, action: "attest", sequence: app.records.length, previous_sha256: app.records.at(-1).record_sha256, descriptor: null, grants: null, actor_key_id: signer.anchor.key_id, new_owner: null, attestation });
      app.records.push(record); return record;
    }
    function authorize(application, capability) {
      const app = current(application);
      return app.enabled && !app.revoked && app.grants.includes(capability);
    }
    function exportState(application) {
      const app = current(application);
      return { format: STATE, state: publicState(app), records: app.records, compatibility, scope: "signed local lifecycle evidence; signing does not make code safe or prove execution" };
    }
    return { install, transition, attest, authorize, exportState, get: application => publicState(current(application)), applications };
  }

  async function auditState(pkg) {
    try {
      if (!pkg || pkg.format !== STATE || !id(pkg.compatibility) || !Array.isArray(pkg.records) || !pkg.records.length) return { ok: false, why: "invalid lifecycle package" };
      let state = null;
      for (let index = 0; index < pkg.records.length; index++) {
        const record = pkg.records[index];
        if (!await verifyRecord(record)) return { ok: false, at: index, why: "record digest or signature mismatch" };
        if (record.sequence !== index || record.previous_sha256 !== (index ? pkg.records[index - 1].record_sha256 : null)) return { ok: false, at: index, why: "sequence or chain mismatch" };
        if (record.action === "install") {
          if (state || record.signer.key_id !== record.actor_key_id) return { ok: false, at: index, why: "invalid install" };
          state = { descriptor: descriptor(record.descriptor, pkg.compatibility), owner: record.signer, enabled: false, revoked: false, grants: capabilities(record.grants), sequence: 0 };
        } else {
          if (!state || record.application !== state.descriptor.id) return { ok: false, at: index, why: "unknown application" };
          if (record.action === "attest") {
            if (!record.attestation || record.attestation.format !== "zeq-attestation-v1") return { ok: false, at: index, why: "invalid attestation" };
            state.sequence = index + 1;
            continue;
          }
          if (state.revoked || record.actor_key_id !== state.owner.key_id || record.signer.key_id !== state.owner.key_id) return { ok: false, at: index, why: "owner or terminal-state violation" };
          if (record.action === "enable") {
            if (state.enabled) return { ok: false, at: index, why: "application already enabled" };
            state.enabled = true;
          }
          else if (record.action === "disable") {
            if (!state.enabled) return { ok: false, at: index, why: "application already disabled" };
            state.enabled = false;
          }
          else if (record.action === "revoke") { state.revoked = true; state.enabled = false; state.grants = []; }
          else if (record.action === "update") {
            const next = descriptor(record.descriptor, pkg.compatibility), grants = capabilities(record.grants);
            if (next.id !== state.descriptor.id || Number(next.version) <= Number(state.descriptor.version)
              || grants.some(capability => !next.requested_capabilities.includes(capability)))
              return { ok: false, at: index, why: "invalid update identity, version, or grants" };
            state.descriptor = next; state.grants = grants; state.enabled = false;
          }
          else if (record.action === "transfer") {
            if (!anchorValid(record.new_owner) || record.new_owner.key_id === state.owner.key_id)
              return { ok: false, at: index, why: "invalid or unchanged new owner" };
            state.owner = record.new_owner;
          }
          else return { ok: false, at: index, why: "unexpected action" };
        }
        state.sequence = index + 1;
      }
      if (Security.canonical(state) !== Security.canonical(pkg.state)) return { ok: false, why: "final state mismatch" };
      return { ok: true, records: pkg.records.length, application: state.descriptor.id, owner_key_id: state.owner.key_id, enabled: state.enabled, revoked: state.revoked, grants: state.grants };
    } catch (error) { return { ok: false, why: error.message }; }
  }

  function scopedHost(lifecycle, application, host, capabilityMethods) {
    if (!host || !capabilityMethods || typeof capabilityMethods !== "object") throw new TypeError("host capability mapping required");
    const wrapper = {};
    for (const [method, capability] of Object.entries(capabilityMethods)) {
      if (typeof host[method] !== "function" || typeof capability !== "string") throw new TypeError("invalid host capability mapping");
      wrapper[method] = (...args) => {
        if (!lifecycle.authorize(application, capability)) throw new Error("capability denied");
        return host[method](...args);
      };
    }
    return Object.freeze(wrapper);
  }

  return Object.freeze({ FORMAT, DESCRIPTOR, STATE, createLifecycle, auditState, scopedHost, verifyRecord });
});
