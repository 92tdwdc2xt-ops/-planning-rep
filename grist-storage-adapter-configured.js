/**
 * ============================================================
 *  GRIST STORAGE ADAPTER — Phase 1
 *  Remplace localStorage par des appels à l'API Grist
 *  Table Grist requise : AppData (colonnes: cle, valeur)
 * ============================================================
 *
 *  INSTALLATION :
 *  1. Dans Grist, créer une table "AppData" avec deux colonnes :
 *       - cle    (type Texte)
 *       - valeur (type Texte)
 *  2. Générer une clé API dans Grist :
 *       Profil → Clé API → Copier
 *  3. Trouver l'ID du document Grist (dans l'URL)
 *  4. Renseigner GRIST_CONFIG ci-dessous
 *  5. Inclure ce fichier AVANT le script principal de l'app :
 *       <script src="grist-storage-adapter.js"></script>
 *
 * ============================================================
 */

const GRIST_CONFIG = {
  baseUrl:   "https://grist.numerique.gouv.fr",
  docId:     "xiZBNHXKX3fK",  // ex: "3NsoHE2AF5vQ..."
  apiKey:    "a82f84e2ead33cc2650123aad87f0ea41c01bc9b",       // ex: "8c8c9e1f2a3b..."
  tableName: "AppData"
};

// ============================================================
//  COUCHE CACHE LOCAL
//  Pour éviter trop d'appels API et garder la réactivité
// ============================================================
const _gristCache = {};      // cache en mémoire : clé → valeur JSON
const _gristRowIds = {};     // cache des IDs de lignes Grist : clé → rowId
let   _gristReady = false;   // true quand les données initiales sont chargées
let   _gristInitPromise = null;

// ============================================================
//  FONCTIONS UTILITAIRES
// ============================================================

function _gristHeaders() {
  return {
    "Content-Type":  "application/json",
    "Authorization": "Bearer " + GRIST_CONFIG.apiKey
  };
}

function _gristTableUrl() {
  return GRIST_CONFIG.baseUrl
    + "/api/docs/" + GRIST_CONFIG.docId
    + "/tables/" + GRIST_CONFIG.tableName
    + "/records";
}

// ============================================================
//  INITIALISATION : charge toutes les clés depuis Grist
//  À appeler au démarrage de l'app (une seule fois)
// ============================================================

async function gristInitStorage() {
  if (_gristInitPromise) return _gristInitPromise;

  _gristInitPromise = (async () => {
    try {
      const resp = await fetch(_gristTableUrl(), {
        headers: _gristHeaders()
      });
      if (!resp.ok) throw new Error("Grist init HTTP " + resp.status);

      const data = await resp.json();
      const records = data.records || [];

      records.forEach(rec => {
        const cle    = rec.fields.cle    || rec.fields.Cle    || "";
        const valeur = rec.fields.valeur || rec.fields.Valeur || "";
        if (cle) {
          _gristCache[cle]   = valeur;
          _gristRowIds[cle]  = rec.id;
        }
      });

      _gristReady = true;
      console.log("[GristAdapter] Initialisé —", records.length, "clés chargées");
    } catch (err) {
      console.error("[GristAdapter] Erreur init :", err);
      // Fallback : continuer avec localStorage si Grist inaccessible
      _gristReady = false;
    }
  })();

  return _gristInitPromise;
}

// ============================================================
//  GET : lecture (synchrone depuis le cache)
// ============================================================

function gristGetItem(cle) {
  if (!_gristReady) {
    // Fallback localStorage pendant l'initialisation
    return localStorage.getItem(cle);
  }
  return Object.prototype.hasOwnProperty.call(_gristCache, cle)
    ? _gristCache[cle]
    : null;
}

// ============================================================
//  SET : écriture (async, avec mise à jour du cache immédiate)
// ============================================================

async function gristSetItem(cle, valeur) {
  // Mise à jour du cache immédiatement pour que l'UI reste réactive
  _gristCache[cle] = valeur;

  if (!_gristReady) {
    // Fallback localStorage
    localStorage.setItem(cle, valeur);
    return;
  }

  try {
    if (_gristRowIds[cle]) {
      // La clé existe déjà → PATCH (mise à jour)
      const url = GRIST_CONFIG.baseUrl
        + "/api/docs/" + GRIST_CONFIG.docId
        + "/tables/" + GRIST_CONFIG.tableName
        + "/records";

      await fetch(url, {
        method:  "PATCH",
        headers: _gristHeaders(),
        body: JSON.stringify({
          records: [{
            id:     _gristRowIds[cle],
            fields: { cle: cle, valeur: valeur }
          }]
        })
      });
    } else {
      // Nouvelle clé → POST (création)
      const resp = await fetch(_gristTableUrl(), {
        method:  "POST",
        headers: _gristHeaders(),
        body: JSON.stringify({
          records: [{
            fields: { cle: cle, valeur: valeur }
          }]
        })
      });
      if (resp.ok) {
        const data = await resp.json();
        const newId = (data.records && data.records[0]) ? data.records[0].id : null;
        if (newId) _gristRowIds[cle] = newId;
      }
    }
  } catch (err) {
    console.error("[GristAdapter] Erreur setItem :", cle, err);
    // Fallback localStorage en cas d'erreur réseau
    localStorage.setItem(cle, valeur);
  }
}

// ============================================================
//  REMOVE : suppression d'une clé
// ============================================================

async function gristRemoveItem(cle) {
  delete _gristCache[cle];

  if (!_gristReady || !_gristRowIds[cle]) {
    localStorage.removeItem(cle);
    return;
  }

  try {
    await fetch(
      GRIST_CONFIG.baseUrl
        + "/api/docs/" + GRIST_CONFIG.docId
        + "/tables/" + GRIST_CONFIG.tableName
        + "/records",
      {
        method:  "DELETE",
        headers: _gristHeaders(),
        body: JSON.stringify({ records: [{ id: _gristRowIds[cle] }] })
      }
    );
    delete _gristRowIds[cle];
  } catch (err) {
    console.error("[GristAdapter] Erreur removeItem :", cle, err);
    localStorage.removeItem(cle);
  }
}

// ============================================================
//  REMPLACEMENT DE localStorage
//  Surcharge l'objet localStorage global avec les fonctions Grist
//  ATTENTION : getItem reste synchrone (lecture depuis le cache)
//              setItem/removeItem sont async en arrière-plan
// ============================================================

function gristInstallStorageOverride() {
  const _originalStorage = {
    getItem:    localStorage.getItem.bind(localStorage),
    setItem:    localStorage.setItem.bind(localStorage),
    removeItem: localStorage.removeItem.bind(localStorage)
  };

  // Surcharge getItem — synchrone (cache en mémoire)
  Storage.prototype.getItem = function(cle) {
    if (!_gristReady) return _originalStorage.getItem(cle);
    return gristGetItem(cle);
  };

  // Surcharge setItem — lance l'écriture async en arrière-plan
  Storage.prototype.setItem = function(cle, valeur) {
    gristSetItem(cle, String(valeur)); // non-bloquant
  };

  // Surcharge removeItem
  Storage.prototype.removeItem = function(cle) {
    gristRemoveItem(cle); // non-bloquant
  };

  console.log("[GristAdapter] Override localStorage installé");
}

// ============================================================
//  POINT D'ENTRÉE PRINCIPAL
//  À appeler au chargement de la page, avant renderAllPanels()
// ============================================================

async function gristStorageInit() {
  gristInstallStorageOverride();
  await gristInitStorage();
  console.log("[GristAdapter] Prêt ✓");
}

// ============================================================
//  UTILITAIRE : migration one-shot localStorage → Grist
//  À appeler UNE SEULE FOIS pour migrer les données existantes
// ============================================================

async function gristMigrateFromLocalStorage() {
  const keysToMigrate = [
    "brigade-rep-toulouse-brigadier-v66-corrige",
    "brigade-rep-toulouse-absences-v1",
    "brigade-rep-toulouse-punctual-missions-v1",
    "brigade-rep-toulouse-reference-assignments-v1",
    "brigade-rep-toulouse-reference-ponderations-v1",
    "brigade-rep-toulouse-school-year-configs-v1",
    "brigade-rep-toulouse-active-school-year-v1"
  ];

  let migrated = 0;
  for (const cle of keysToMigrate) {
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
