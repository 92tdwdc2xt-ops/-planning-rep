/**
 * GRIST STORAGE ADAPTER — Phase 1 via Proxy Cloudflare
 * Utilise le Worker Cloudflare pour contourner le CORS
 * Compatible avec GitHub Pages (hors widget Grist)
 */

const PROXY_URL = "https://grist-proxy.sebastien-hirsch.workers.dev";
const GRIST_TABLE = "AppData";

const _gristCache  = {};
const _gristRowIds = {};
let   _gristReady  = false;

async function gristInitStorage() {
  try {
    const resp = await fetch(`${PROXY_URL}/${GRIST_TABLE}/records`, {
      method: "GET",
      headers: { "Content-Type": "application/json" }
    });

    if (!resp.ok) throw new Error("HTTP " + resp.status);

    const data = await resp.json();
    const records = data.records || [];

    records.forEach(rec => {
      const cle    = rec.fields.cle    || "";
      const valeur = rec.fields.valeur || "";
      if (cle) {
        _gristCache[cle]  = valeur;
        _gristRowIds[cle] = rec.id;
      }
    });

    _gristReady = true;
    console.log("[GristAdapter] Initialisé via proxy —", records.length, "clés chargées");

  } catch (err) {
    console.warn("[GristAdapter] Erreur init, fallback localStorage :", err.message);
    _gristReady = false;
  }
}

function gristGetItem(cle) {
  if (!_gristReady) return localStorage.getItem(cle);
  return Object.prototype.hasOwnProperty.call(_gristCache, cle)
    ? _gristCache[cle]
    : null;
}

async function gristSetItem(cle, valeur) {
  _gristCache[cle] = valeur;

  if (!_gristReady) {
    localStorage.setItem(cle, valeur);
    return;
  }

  try {
    if (_gristRowIds[cle]) {
      await fetch(`${PROXY_URL}/${GRIST_TABLE}/records`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: [{ id: _gristRowIds[cle], fields: { cle, valeur } }]
        })
      });
    } else {
      const resp = await fetch(`${PROXY_URL}/${GRIST_TABLE}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          records: [{ fields: { cle, valeur } }]
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data.records && data.records[0]) {
          _gristRowIds[cle] = data.records[0].id;
        }
      }
    }
  } catch (err) {
    console.error("[GristAdapter] Erreur setItem :", cle, err);
    localStorage.setItem(cle, valeur);
  }
}

async function gristRemoveItem(cle) {
  delete _gristCache[cle];

  if (!_gristReady || !_gristRowIds[cle]) {
    localStorage.removeItem(cle);
    return;
  }

  try {
    await fetch(`${PROXY_URL}/${GRIST_TABLE}/records`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ records: [{ id: _gristRowIds[cle] }] })
    });
    delete _gristRowIds[cle];
  } catch (err) {
    console.error("[GristAdapter] Erreur removeItem :", cle, err);
    localStorage.removeItem(cle);
  }
}

function gristInstallStorageOverride() {
  const _orig = {
    getItem:    localStorage.getItem.bind(localStorage),
    setItem:    localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage)
  };

  Storage.prototype.getItem = function(cle) {
    if (!_gristReady) return _orig.getItem(cle);
    return gristGetItem(cle);
  };

  Storage.prototype.setItem = function(cle, valeur) {
    gristSetItem(cle, String(valeur));
  };

  Storage.prototype.removeItem = function(cle) {
    gristRemoveItem(cle);
  };

  console.log("[GristAdapter] Override localStorage installé");
}

async function gristStorageInit() {
  gristInstallStorageOverride();
  await gristInitStorage();
  console.log("[GristAdapter] Prêt ✓");
}

async function gristMigrateFromLocalStorage() {
  const keys = [
    "brigade-rep-toulouse-brigadier-v66-corrige",
    "brigade-rep-toulouse-absences-v1",
    "brigade-rep-toulouse-punctual-missions-v1",
    "brigade-rep-toulouse-reference-assignments-v1",
    "brigade-rep-toulouse-reference-ponderations-v1",
    "brigade-rep-toulouse-school-year-configs-v1",
    "brigade-rep-toulouse-active-school-year-v1"
  ];
  let migrated = 0;
  for (const cle of keys) {
    const valeur = localStorage.getItem(cle);
    if (valeur !== null) {
      await gristSetItem(cle, valeur);
      migrated++;
      console.log("[GristAdapter] Migré :", cle);
    }
  }
  console.log("[GristAdapter] Migration terminée —", migrated, "clés migrées");
  return migrated;
}
