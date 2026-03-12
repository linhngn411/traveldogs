// Import Turf.js into the worker
importScripts("https://unpkg.com/@turf/turf@6/turf.min.js");

// ─── MASSIVE DATA STORAGE (INDEXEDDB) ────────────────
const DB_NAME = "TravelDogsDB";
function getDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = (e) => e.target.result.createObjectStore("cache");
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
}
async function saveToDB(key, data) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cache", "readwrite");
    tx.objectStore("cache").put(data, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
async function loadFromDB(key) {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("cache", "readonly");
    const req = tx.objectStore("cache").get(key);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(tx.error);
  });
}

// ─── ENGINE STATE ────────────────────────────────────
let pathFinder = null;
let roadVertices = null;

// Listen for messages from app.js
self.onmessage = async function (e) {
  const { type, id, payload } = e.data;

  // 1. INITIALIZE ENGINE (Downloads data & builds graph)
  if (type === "INIT") {
    try {
      let roadData = await loadFromDB("dalatRoadsData");

      if (!roadData) {
        // Fetch from the URL provided by app.js
        const roadRes = await fetch(payload.url);
        if (!roadRes.ok) throw new Error("Failed to fetch roads.");
        roadData = await roadRes.json();
        await saveToDB("dalatRoadsData", roadData);
      }

      // Load PathFinder dynamically
      const PathFinderModule =
        await import("https://cdn.skypack.dev/geojson-path-finder");
      const PathFinder = PathFinderModule.default || PathFinderModule;

      // Heavy Math: Build routing graph
      pathFinder = new PathFinder(roadData, { precision: 1e-5 });

      // Heavy Math: Build vertices
      const vertices = [];
      turf.coordEach(roadData, (coord) => {
        vertices.push(turf.point(coord));
      });
      roadVertices = turf.featureCollection(vertices);

      // Tell app.js we are ready!
      postMessage({ type: "INIT_SUCCESS" });
    } catch (err) {
      console.error("Worker Init Error:", err);
      postMessage({ type: "INIT_ERROR", error: err.message });
    }
  }

  // 2. CALCULATE ROUTE (Finds path between A and B)
  if (type === "ROUTE") {
    if (!pathFinder || !roadVertices) {
      postMessage({ type: "ROUTE_RESULT", id, route: null });
      return;
    }

    try {
      const { startLat, startLng, endLat, endLng } = payload;

      const startNode = turf.nearestPoint(
        turf.point([startLng, startLat]),
        roadVertices,
      );
      const endNode = turf.nearestPoint(
        turf.point([endLng, endLat]),
        roadVertices,
      );

      const route = pathFinder.findPath(startNode, endNode);

      if (route && route.path) {
        // Convert to Leaflet format [lat, lng]
        const latLngs = route.path.map((coord) => [coord[1], coord[0]]);
        postMessage({ type: "ROUTE_RESULT", id, route: latLngs });
      } else {
        postMessage({ type: "ROUTE_RESULT", id, route: null }); // Fallback
      }
    } catch (err) {
      postMessage({ type: "ROUTE_RESULT", id, route: null }); // Fallback
    }
  }
};
