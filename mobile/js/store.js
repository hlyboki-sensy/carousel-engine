// store.js — локальне сховище (IndexedDB) для мобільного клієнта.
//
// Навіщо IndexedDB, а не localStorage: фото у base64 миттєво переповнюють 5MB-квоту
// localStorage. IndexedDB тримає Blob нативно, дає сотні MB на iOS.
//
// Сховища бази `carousel` (v1):
//   assets — {id, kind:'photo'|'cutout'|'font', blob, mime, name, createdAt}
//            слайд посилається на фото як "asset:<id>", самі байти в assets.
//   drafts — {id, name, updatedAt, state}  (state = знімок редактора)
//   meta   — {key, value}                  (schemaVersion, lastDraftId тощо)
//
// localStorage лишаємо лише для дрібного (ключі API, останній формат) — це роблять інші модулі.

const DB_NAME = "carousel";
const DB_VERSION = 1;
const ASSET_PREFIX = "asset:";

let _dbPromise = null;

export function openDB() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = req.result;
      if (!db.objectStoreNames.contains("assets")) {
        const s = db.createObjectStore("assets", { keyPath: "id" });
        s.createIndex("kind", "kind", { unique: false });
      }
      if (!db.objectStoreNames.contains("drafts")) {
        db.createObjectStore("drafts", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("meta")) {
        db.createObjectStore("meta", { keyPath: "key" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return _dbPromise;
}

function tx(db, store, mode = "readonly") {
  return db.transaction(store, mode).objectStore(store);
}
function reqP(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

function uuid() {
  if (crypto && crypto.randomUUID) return crypto.randomUUID();
  return "id-" + Math.abs(Date.now() ^ (Math.random() * 1e9 | 0)).toString(36);
}

// ── ASSETS ─────────────────────────────────────────────────────────
// Зберегти Blob (фото/cutout/шрифт). Повертає посилання "asset:<id>" для поля слайда.
export async function putAsset(blob, kind = "photo", name = "") {
  const db = await openDB();
  const id = uuid();
  const rec = { id, kind, blob, mime: blob.type || "", name, createdAt: Date.now() };
  await reqP(tx(db, "assets", "readwrite").put(rec));
  return ASSET_PREFIX + id;
}

export function isAssetRef(ref) {
  return typeof ref === "string" && ref.startsWith(ASSET_PREFIX);
}
function assetId(ref) {
  return isAssetRef(ref) ? ref.slice(ASSET_PREFIX.length) : ref;
}

export async function getAsset(ref) {
  const db = await openDB();
  return await reqP(tx(db, "assets").get(assetId(ref)));
}

export async function deleteAsset(ref) {
  const db = await openDB();
  const id = assetId(ref);
  _revoke(id);
  await reqP(tx(db, "assets", "readwrite").delete(id));
}

export async function listAssets(kind) {
  const db = await openDB();
  const all = await reqP(tx(db, "assets").getAll());
  return kind ? all.filter((a) => a.kind === kind) : all;
}

// ── резолвінг посилань у URL ────────────────────────────────────────
// objectURL — легкий, для прев'ю/UI/drag. Кешуємо, щоб не плодити URL.
const _objURLs = new Map(); // id -> objectURL
function _revoke(id) {
  const u = _objURLs.get(id);
  if (u) { URL.revokeObjectURL(u); _objURLs.delete(id); }
}
export async function assetObjectURL(ref) {
  const id = assetId(ref);
  if (_objURLs.has(id)) return _objURLs.get(id);
  const rec = await getAsset(ref);
  if (!rec) return "";
  const u = URL.createObjectURL(rec.blob);
  _objURLs.set(id, u);
  return u;
}
// data-URL — важчий, для ЕКСПОРТУ (snapdom вбудовує; canvas гарантовано не-tainted).
export async function assetDataURL(ref) {
  const rec = await getAsset(ref);
  if (!rec) return "";
  return await new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(fr.result);
    fr.onerror = () => rej(fr.error);
    fr.readAsDataURL(rec.blob);
  });
}

// Побудувати мапу {ref → url} для всіх asset-посилань у наборі слайдів.
// mode: "preview" → objectURL (швидко) | "export" → data-URL (для snapdom).
export async function resolveSlideAssets(slides, mode = "preview") {
  const refs = new Set();
  for (const s of slides) {
    if (isAssetRef(s.photo)) refs.add(s.photo);
    if (isAssetRef(s.cutout)) refs.add(s.cutout);
  }
  const map = new Map();
  const fn = mode === "export" ? assetDataURL : assetObjectURL;
  await Promise.all([...refs].map(async (r) => { map.set(r, await fn(r)); }));
  // resolver для buildSlideHTML: asset-посилання → url; звичайні (data:/http) — як є
  return (ref) => (isAssetRef(ref) ? (map.get(ref) || "") : ref);
}

// ── DRAFTS (чернетки) ───────────────────────────────────────────────
export async function saveDraft(id, state, name = "") {
  const db = await openDB();
  const rec = { id, name, updatedAt: Date.now(), state };
  await reqP(tx(db, "drafts", "readwrite").put(rec));
  await setMeta("lastDraftId", id);
  return id;
}
export async function getDraft(id) {
  const db = await openDB();
  return await reqP(tx(db, "drafts").get(id));
}
export async function listDrafts() {
  const db = await openDB();
  const all = await reqP(tx(db, "drafts").getAll());
  return all.sort((a, b) => b.updatedAt - a.updatedAt);
}
export async function deleteDraft(id) {
  const db = await openDB();
  await reqP(tx(db, "drafts", "readwrite").delete(id));
}

// ── META ────────────────────────────────────────────────────────────
export async function setMeta(key, value) {
  const db = await openDB();
  await reqP(tx(db, "meta", "readwrite").put({ key, value }));
}
export async function getMeta(key) {
  const db = await openDB();
  const r = await reqP(tx(db, "meta").get(key));
  return r ? r.value : undefined;
}

// ── персистентність (щоб Safari не чистив сховище під тиском місця) ──
export async function requestPersist() {
  try {
    if (navigator.storage && navigator.storage.persist) return await navigator.storage.persist();
  } catch (e) {}
  return false;
}
export async function storageEstimate() {
  try {
    if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
  } catch (e) {}
  return null;
}
