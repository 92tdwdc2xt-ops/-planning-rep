/**
 * GRIST STORAGE ADAPTER — Phase 1 (v3)
 * Compatible grist.numerique.gouv.fr
 */

const GRIST_TABLE = "AppData";
const _gristCache   = {};
const _gristRowIds  = {};
let   _gristReady   = false;

async function gristInitStorage() {
  try {
    // grist.numerique.gouv.fr expose l'API via window.grist
    // On attend jusqu'à 10 secondes
    let attempts = 0;
    while (typeof window.grist === "undefined" && attempts < 100) {
      await new Promise(r => setTimeout(r, 100));
      attempts++;
    }

    console.log("[GristAdapter] window.grist =", typeof window.grist);
    console.log("[GristAdapter] keys =", typeof window.grist !== "undefined" ? Object.keys(window.grist) : "N/A");

    if (typeof window.grist === "undefined") {
      throw new Error("window.grist introuvable après 10s");
    }

    // Signaler que le widget est prêt
    if (typeof window.grist.ready === "function") {
      window.grist.ready({ requiredAccess: "full" });
    }

    // Attendre encore un peu après ready()
    await new Promise(r => setTimeout(r, 500));

    // Lire la table AppData
    let records;
    if (window.grist.docApi && typeof window.grist.docApi.fetchTable === "function") {
      records = await window.grist.docApi.fetchTable(GRIST_TABLE);
    } else if (typeof window.grist.fetchTable === "function") {
      records = await window.grist.fetchTable(GRIST_TABLE);
    } else {
      throw new Error("Aucune méthode fetchTable disponible. Méthodes disponibles : " + Object.keys(window.grist).join(", "));
    }

    const ids     = records.id     || [];
    const cles    = records.cle    || records.Cle    || [];
    const valeurs = records.valeur || records.Valeur || [];

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
}

function gristGetItem(cle) {
  if (!_gristReady) return localStorage.getItem(cle);
  return Object.prototype.hasOwnProperty.call(_gristCache, cle) ? _gristCache[cle] : null;
}

async function gristSetItem(cle, valeur) {
  _gristCache[cle] = valeur;
  if (!_gristReady) { localStorage.setItem(cle, valeur); return; }
  try {
    const api = window.grist.docApi || window.grist;
    if (_gristRowIds[cle]) {
      await api.applyUserActions([["UpdateRecord", GRIST_TABLE, _gristRowIds[cle], { cle, valeur }]]);
    } else {
      const result = await api.applyUserActions([["AddRecord", GRIST_TABLE, null, { cle, valeur }]]);
      if (result && result.retValues && result.retValues[0]) {
        _gristRowIds[cle] = result.retValues[0];
      }
    }
  } catch (err) {
    console.error("[GristAdapter] Erreur setItem :", cle, err);
    localStorage.setItem(cle, valeur);
  }
}

async function gristRemoveItem(cle) {
  delete _gristCache[cle];
  if (!_gristReady || !_gristRowIds[cle]) { localStorage.removeItem(cle); return; }
  try {
    const api = window.grist.docApi || window.grist;
    await api.applyUserActions([["RemoveRecord", GRIST_TABLE, _gristRowIds[cle]]]);
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
  Storage.prototype.getItem    = function(cle)         { if (!_gristReady) return _orig.getItem(cle); return gristGetItem(cle); };
  Storage.prototype.setItem    = function(cle, valeur) { gristSetItem(cle, String(valeur)); };
  Storage.prototype.removeItem = function(cle)         { gristRemoveItem(cle); };
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
