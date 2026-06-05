/**
 * ============================================================
 *  GRIST STORAGE ADAPTER — Phase 1 (API native Grist)
 *  Utilise grist.docApi au lieu de fetch + clé API
 *  Pas de problème CORS car API interne au widget
 * ============================================================
 */

const GRIST_TABLE = "AppData";

// Cache en mémoire
const _gristCache   = {};
const _gristRowIds  = {};
let   _gristReady   = false;
let   _gristInitPromise = null;

// ============================================================
//  INITIALISATION — charge toutes les clés depuis Grist
// ============================================================
async function gristInitStorage() {
  if (_gristInitPromise) return _gristInitPromise;

  _gristInitPromise = (async () => {
    try {
      // Attendre que l'API Grist soit disponible
      await new Promise((resolve) => {
        if (typeof grist !== "undefined") { resolve(); return; }
        const interval = setInterval(() => {
          if (typeof grist !== "undefined") {
            clearInterval(interval);
            resolve();
          }
        }, 100);
        // Timeout après 5 secondes
        setTimeout(() => { clearInterval(interval); resolve(); }, 5000);
      });

      if (typeof grist === "undefined") {
        throw new Error("API Grist non disponible");
      }

      // Initialiser le widget Grist
      grist.ready({ requiredAccess: "full" });

      // Lire toutes les lignes de la table AppData
      const records = await grist.docApi.fetchTable(GRIST_TABLE);

      // records est un objet { id: [...], cle: [...], valeur: [...] }
      const ids    = records.id    || [];
      const cles   = records.cle   || records.Cle   || [];
      const valeurs= records.valeur|| records.Valeur || [];

      ids.forEach((id, i) => {
        const cle    = String(cles[i]    || "");
        const valeur = String(valeurs[i] || "");
        if (cle) {
          _gristCache[cle]  = valeur;
          _gristRowIds[cle] = id;
        }
      });

      _gristReady = true;
      console.log("[GristAdapter] Initialisé —", ids.length, "clés chargées");

    } catch (err) {
      console.warn("[GristAdapter] Erreur init, fallback localStorage :", err.message);
      _gristReady = false;
    }
  })();

  return _gristInitPromise;
}

// ============================================================
//  GET — lecture depuis le cache
// ============================================================
function gristGetItem(cle) {
  if (!_gristReady) return localStorage.getItem(cle);
  return Object.prototype.hasOwnProperty.call(_gristCache, cle)
    ? _gristCache[cle]
    : null;
}

// ============================================================
//  SET — écriture dans Grist via docApi
// ============================================================
async function gristSetItem(cle, valeur) {
  _gristCache[cle] = valeur; // cache immédiat

  if (!_gristReady) {
    localStorage.setItem(cle, valeur);
    return;
  }

  try {
    if (_gristRowIds[cle]) {
      // Mise à jour ligne existante
      await grist.docApi.applyUserActions([
        ["UpdateRecord", GRIST_TABLE, _gristRowIds[cle], { cle, valeur }]
      ]);
    } else {
      // Nouvelle ligne
      const result = await grist.docApi.applyUserActions([
        ["AddRecord", GRIST_TABLE, null, { cle, valeur }]
      ]);
      // Récupérer le nouvel ID
      if (result && result.retValues && result.retValues[0]) {
        _gristRowIds[cle] = result.retValues[0];
      }
    }
  } catch (err) {
    console.error("[GristAdapter] Erreur setItem :", cle, err);
    localStorage.setItem(cle, valeur);
  }
}

// ============================================================
//  REMOVE — suppression dans Grist
// ============================================================
async function gristRemoveItem(cle) {
  delete _gristCache[cle];

  if (!_gristReady || !_gristRowIds[cle]) {
    localStorage.removeItem(cle);
    return;
  }

  try {
    await grist.docApi.applyUserActions([
      ["RemoveRecord", GRIST_TABLE, _gristRowIds[cle]]
    ]);
    delete _gristRowIds[cle];
  } catch (err) {
    console.error("[GristAdapter] Erreur removeItem :", cle, err);
    localStorage.removeItem(cle);
  }
}

// ============================================================
//  OVERRIDE localStorage
// ============================================================
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

// ============================================================
//  POINT D'ENTRÉE
// ============================================================
async function gristStorageInit() {
  gristInstallStorageOverride();
  await gristInitStorage();
  console.log("[GristAdapter] Prêt ✓");
}

// ============================================================
//  MIGRATION one-shot localStorage → Grist
// ============================================================
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
