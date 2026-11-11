// Al Majlis live room on Firebase Realtime Database.
// Gives the game the same small API it used before (user, db, room), so the game code itself stays the same.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import { getDatabase, ref, set, get, push, remove, onValue, onChildAdded, onDisconnect, query, orderByChild, startAt }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-database.js";

const C = window.MAJLIS_CONFIG || {};
const done = v => window.__majlisResolve && window.__majlisResolve(v);
const ls = { get:k=>{ try{ return localStorage.getItem(k); }catch{ return null; } }, set:(k,v)=>{ try{ localStorage.setItem(k,v); }catch{} } };

const params = new URLSearchParams(location.search);
const ROOM = (params.get("room") || C.room || "main").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40) || "main";
const configured = C.firebase && C.firebase.databaseURL && !/PASTE/.test(C.firebase.databaseURL);

const COUNTRIES = { SA: "Saudi Arabia", PK: "Pakistan" };
const rid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);

/* ---------- who am I ---------- */
let uid = ls.get("majlis.uid"); if (!uid) { uid = "u" + rid(); ls.set("majlis.uid", uid); }
const myPeer = "p" + rid();

function askWho(takenBy) {
  return new Promise(resolve => {
    const saved = JSON.parse(ls.get("majlis.me") || "null") || {};
    const box = document.createElement("div");
    box.style.cssText = "position:fixed;inset:0;z-index:100;display:grid;place-items:center;background:rgba(23,19,15,.55);padding:16px";
    box.innerHTML = `
      <form style="width:min(420px,100%);background:var(--surface,#FBF8F3);color:var(--fg,#2B221B);border:1px solid var(--line,#DCD1C2);border-radius:18px;padding:22px;box-shadow:0 18px 50px rgba(0,0,0,.25);font-family:var(--body,sans-serif)">
        <div style="font-family:'Reem Kufi',serif;font-size:26px;font-weight:700">Al Majlis</div>
        <p style="margin:4px 0 16px;color:var(--muted,#6F6257)">Room: <b>${ROOM}</b></p>
        <label style="display:block;font-weight:700;margin-bottom:6px">Your name</label>
        <input name="n" required maxlength="16" autocomplete="given-name" value="${(saved.name || "").replace(/"/g, "")}" style="width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid var(--line,#DCD1C2);font-size:16px;background:#fff">
        <label style="display:block;font-weight:700;margin:14px 0 6px">Where are you from?</label>
        <select name="c" style="width:100%;padding:11px 12px;border-radius:10px;border:1px solid var(--line,#DCD1C2);font-size:16px;background:#fff">
          ${Object.entries(COUNTRIES).map(([k, v]) => `<option value="${k}" ${saved.country === k ? "selected" : ""}>${v}</option>`).join("")}
        </select>
        <details style="margin-top:14px"><summary style="cursor:pointer;color:var(--muted,#6F6257)">I'm the host</summary>
          <input name="pin" inputmode="numeric" maxlength="12" placeholder="Host PIN" style="margin-top:8px;width:100%;box-sizing:border-box;padding:11px 12px;border-radius:10px;border:1px solid var(--line,#DCD1C2);font-size:16px;background:#fff">
        </details>
        <p data-err style="color:#B33A2E;min-height:20px;margin:10px 0 0"></p>
        <button style="margin-top:6px;width:100%;padding:12px;border:0;border-radius:12px;background:var(--brass,#A8701A);color:#fff;font-size:16px;font-weight:800;cursor:pointer">Enter Al Majlis</button>
      </form>`;
    document.body.append(box);
    const f = box.querySelector("form"), err = box.querySelector("[data-err]");
    f.onsubmit = e => {
      e.preventDefault();
      const name = f.n.value.trim().replace(/\s+/g, " ").slice(0, 16);
      if (!name) return;
      const owner = takenBy(name);
      if (owner && owner !== uid) { err.textContent = "Someone already joined with this name. Add an initial, like " + name + " A."; return; }
      const pin = (f.pin.value || "").trim();
      const host = pin ? pin === String(C.hostPin || "") : (!!saved.host && saved.name === name);
      if (pin && !host) { err.textContent = "That host PIN is not right."; return; }
      const me = { name, country: f.c.value, host };
      ls.set("majlis.me", JSON.stringify(me));
      box.remove(); resolve(me);
    };
  });
}

/* ---------- start ---------- */
(async () => {
  if (!configured) { console.warn("Al Majlis: add your Firebase config in config.js"); done(null); return; }
  const app = initializeApp(C.firebase);
  const fdb = getDatabase(app);
  const base = `rooms/${ROOM}`;
  const R = p => ref(fdb, `${base}/${p}`);

  // everyone's name and country
  let profiles = {};
  let firstLoad; const loaded = new Promise(r => firstLoad = r);
  onValue(R("profiles"), s => {
    profiles = s.val() || {};
    firstLoad();
    window.__majlisRoster && window.__majlisRoster(Object.values(profiles));
  }, () => firstLoad());
  await loaded;

  const takenBy = name => { const k = Object.keys(profiles).find(id => (profiles[id].name || "").toLowerCase() === name.toLowerCase()); return k || null; };
  const me = await askWho(takenBy);
  await set(R(`profiles/${uid}`), { name: me.name, country: me.country, at: Date.now() });

  const parse = v => (v && typeof v.j === "string") ? JSON.parse(v.j) : v;

  const user = {
    me: async () => ({ id: uid, name: me.name, isOwner: !!me.host }),
    profiles: async ids => {
      if (ids.some(id => !profiles[id])) { try { profiles = (await get(R("profiles"))).val() || {}; } catch {} }
      const out = {}; for (const id of ids) out[id] = { name: profiles[id]?.name || "" }; return out;
    },
  };

  const db = {
    doc: path => ({
      set: data => set(R(`db/${path}`), { j: JSON.stringify(data) }),
      onSnapshot: (cb, onErr) => onValue(R(`db/${path}`), s => cb({ exists: s.exists(), data: () => parse(s.val()) }), onErr),
    }),
    collection: path => ({
      onSnapshot: (cb, onErr) => onValue(R(`db/${path}`), s => {
        const docs = []; s.forEach(c => { docs.push({ id: c.key, data: () => parse(c.val()) }); });
        cb({ docs });
      }, onErr),
    }),
  };

  const presRef = R(`presence/${myPeer}`);
  let lastPresence = null;
  const room = {
    presence: async p => { lastPresence = p; await set(presRef, { by: uid, presence: p, updatedAt: Date.now() }); },
    onPeers: (cb, onErr) => onValue(R("presence"), s => {
      const peers = []; s.forEach(c => { const v = c.val() || {}; peers.push({ peer: c.key, by: v.by, kind: "viewer", presence: v.presence || {}, updatedAt: v.updatedAt || 0, sameTab: c.key === myPeer }); });
      cb({ peers });
    }, onErr),
    onConnection: (cb, onErr) => onValue(ref(fdb, ".info/connected"), s => {
      const on = !!s.val();
      if (on) { onDisconnect(presRef).remove(); if (lastPresence) set(presRef, { by: uid, presence: lastPresence, updatedAt: Date.now() }); }
      cb(on);
    }, onErr),
    emit: async (type, data) => {
      const r = push(R(`events/${type}`));
      await set(r, { by: uid, peer: myPeer, at: Date.now(), d: JSON.stringify(data) });
      setTimeout(() => remove(r).catch(() => {}), 8000);
    },
    on: (type, cb, onErr) => onChildAdded(query(R(`events/${type}`), orderByChild("at"), startAt(Date.now() - 1000)), c => {
      const v = c.val() || {}; let d = null; try { d = JSON.parse(v.d); } catch {}
      cb({ by: v.by, data: d, sameTab: v.peer === myPeer });
    }, onErr),
  };

  done({ use: async what => ({ user, db, room })[what] || null });
})().catch(e => { console.error("Al Majlis live room:", e); done(null); });
