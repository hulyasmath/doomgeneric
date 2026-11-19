/*
 * zeq: the SDK a game or simulation plugs in.
 *
 * Three things, each the machine's own, none re-implemented here:
 *
 *   math       functions the machine generated from the shelf; verified once, then
 *              called every frame with no machine and no network
 *   contracts  your rules as state contracts; the machine holds the definition,
 *              decides every transition and chains every fire on the Zeqond
 *   reactors   a digital twin stepped by the machine, each step sealed and linked
 *
 *   const zeq = await Zeq.local({ dir, keyFile });      // or Zeq.connect({ url, key })
 *   const math = Zeq.math("generated/my_game");         // offline
 *   const door = await zeq.contract(definition);
 *   await door.fire("open", { key: 1 });                 // { fired, state, proof, why }
 *   const twin = await zeq.reactor(definition);
 *   await twin.step({});                                 // { value, verified, zeqond, proof }
 *   await zeq.close();
 */
"use strict";

const link = require("./zeq-link.js");
const { ZeqRefusal } = link;
const refuse = (code, detail) => { throw new ZeqRefusal(code, detail); };

function wrap(l, stop, machine) {
  if (!l.contracts || !l.reactors) refuse("no-wire", "contracts and reactors need a machine on the wire: Zeq.local or Zeq.connect");
  /* Deploy a state contract. The handle fires transitions and reads the chain. */
  async function contract(definition) {
    const d = await l.contracts.deploy(definition);
    if (!d.id) refuse("machine-refused", JSON.stringify(d).slice(0, 300));
    let state = d.state;
    const result = (r) => { state = r.state; return { fired: r.verdict === "fired", wouldFire: r.verdict === "fires", verdict: r.verdict, state: r.state,
      proof: r.verdict === "fired" ? r.detail : null, why: r.verdict === "fired" ? null : r.detail }; };
    return Object.freeze({
      id: d.id, name: d.name, definitionSha256: d.definition_sha256,
      get state() { return state; },
      fire: async (to, input = {}) => result(await l.contracts.fire(d.id, to, input, false)),
      dryRun: async (to, input = {}) => result(await l.contracts.fire(d.id, to, input, true)),
      /* the machine's record: definition, state, and the chain of fires it has checked */
      read: async () => { const c = await l.contracts.get(d.id); state = c.state; return c; },
    });
  }
  /* Deploy a reactor: {question, initial, transition, guards}. Each step is the machine's sealed answer. */
  async function reactor(definition) {
    const d = await l.reactors.deploy(definition);
    if (!d.id) refuse("machine-refused", JSON.stringify(d).slice(0, 300));
    return Object.freeze({
      id: d.id,
      step: async (env = {}) => { const r = await l.reactors.step(d.id, env); const s = r.step || {};
        return { value: s.value, verified: s.verification === "verified", verification: s.verification, zeqond: s.zeqond, index: s.step_index, proof: s.proof, previous: s.prev_state_proof, status: r.status }; },
      read: () => l.reactors.get(d.id),
      close: () => l.reactors.close(d.id),
    });
  }
  return Object.freeze({ machine: machine || null, ask: (q) => l.ask(q), find: (t) => l.find(t), verify: (s) => l.verify(s), record: () => l.record(), contract, reactor,
    /* the machine's record of any contract it holds, by id: for an auditor who deployed nothing */
    readContract: (id) => l.contracts.get(id),
    build: (pack, outDir, opts) => link.build(l, pack, outDir, opts), close: async () => { if (stop) stop(); } });
}

/* the machine's own name, from its public record */
const zid = async (l) => { try { return (await l.record()).zid || null; } catch (_) { return null; } };

module.exports = Object.freeze({
  ZeqRefusal,
  /* A machine already on the wire. */
  connect: async ({ url, key }) => { const l = link.remote({ url, key }); return wrap(l, null, await zid(l)); },
  /* A machine born in `dir` on this device: served on loopback for as long as the handle is open. */
  local: async ({ dir, keyFile, port, pinFile, origins }) => { const m = await link.serve({ dir, keyFile, port, pinFile, origins }); return wrap(m.link, m.stop, await zid(m.link)); },
  /* The machine's generated mathematics, offline. */
  math: (dir, opts) => { const g = link.load(dir, opts); const out = {}; for (const [k, f] of Object.entries(g.functions)) out[k] = Object.assign((...a) => f.call(...a), f); return Object.freeze(out); },
});
