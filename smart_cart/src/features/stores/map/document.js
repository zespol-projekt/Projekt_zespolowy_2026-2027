// One browser runtime for Android/iOS WebView and the web map.
// A literal string also works in Hermes, which does not preserve function source.
const runtime = String.raw`function startMap(ML, channel) {
  const send = message => {
    const body = { ...message, channel };
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(JSON.stringify(body));
    else window.parent.postMessage(body, '*');
  };
  const empty = () => ({ type: 'FeatureCollection', features: [] });
  let map, loaded = false, state = null, updating = false;
  let lastStores = null, lastFocus = null, dataTimer;
  let attributionStarted = false, attributionTimer, attributionPanel, attributionButton;
  const colors = { lidl: '#0050AA', biedronka: '#D62828', auchan: '#AA1B51', dino: '#267B35' };
  const palette = { land: '#F7F7F2', water: '#C3DEE1', green: '#D8E7D0', residential: '#EDEEE5', building: '#D9DFD5',
    road: '#FFFFFF', casing: '#CDD6CD', text: '#304B43', halo: '#F7F7F2', cluster: '#152D43', border: '#FFFFFF' };
  const showAttribution = expanded => {
    attributionPanel.hidden = !expanded;
    attributionButton.setAttribute('aria-expanded', String(expanded));
  };
  const acknowledgeAttribution = () => {
    clearTimeout(attributionTimer);
    send({ type: 'attribution-seen' });
  };
  const startAttribution = seen => {
    if (attributionStarted) return;
    attributionStarted = true;
    if (seen) return;
    showAttribution(true);
    attributionTimer = setTimeout(() => {
      showAttribution(false);
      acknowledgeAttribution();
    }, 5000);
  };
  const fail = (message, fatal = false) => send({ type: 'error', message, fatal });
  const applyPalette = () => {
    const c = palette;
    for (const layer of map.getStyle().layers) {
      if (layer.id.startsWith('smartcart-')) continue;
      const id = layer.id.toLowerCase();
      if (layer.type === 'background') map.setPaintProperty(layer.id, 'background-color', c.land);
      if (layer.type === 'fill') {
        const color = id.includes('water') ? c.water : /park|wood|landcover/.test(id) ? c.green
          : id.includes('building') ? c.building : c.residential;
        map.setPaintProperty(layer.id, 'fill-color', color);
      }
      if (layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', id.includes('water') ? c.water : /casing|boundary/.test(id) ? c.casing : c.road);
      }
      if (layer.type === 'symbol' && layer.layout?.['text-field']) {
        map.setPaintProperty(layer.id, 'text-color', c.text);
        map.setPaintProperty(layer.id, 'text-halo-color', c.halo);
      }
    }
    map.setPaintProperty('smartcart-clusters', 'circle-color', c.cluster);
    map.setPaintProperty('smartcart-clusters', 'circle-stroke-color', c.border);
  };
  const setSelection = id => map.setFilter('smartcart-selected', ['==', ['get', 'storeId'], id ?? '']);
  const updateLocation = point => map.getSource('smartcart-location').setData(point ? {
    type: 'Feature', geometry: { type: 'Point', coordinates: [point.longitude, point.latitude] }, properties: {},
  } : empty());
  const finishData = () => {
    if (!loaded || !updating || !map.isSourceLoaded('smartcart-stores')) return;
    updating = false; clearTimeout(dataTimer);
    document.getElementById('map').dataset.storeCount = String(state.stores.length);
    send({ type: 'data-ready', count: state.stores.length });
  };
  const applyState = next => {
    const previous = state;
    state = next;
    if (!loaded) return;
    // React sends the catalog only when the filtered list changes, never on pan/zoom.
    if (lastStores !== next.stores) {
      lastStores = next.stores;
      updating = true;
      delete document.getElementById('map').dataset.storeCount;
      map.getSource('smartcart-stores').setData({ type: 'FeatureCollection', features: next.stores.map(s => ({
        type: 'Feature', geometry: { type: 'Point', coordinates: [s.longitude, s.latitude] },
        properties: { storeId: s.id, chain: s.chain },
      })) });
      clearTimeout(dataTimer);
      dataTimer = setTimeout(() => fail('Przeliczanie sklepów trwa dłużej niż zwykle. Spróbuj ponownie.'), 15000);
    }
    if (!previous || previous.selectedId !== next.selectedId) setSelection(next.selectedId);
    if (!previous || JSON.stringify(previous.userLocation) !== JSON.stringify(next.userLocation)) updateLocation(next.userLocation);
    startAttribution(next.attributionSeen);
    if (next.focus && lastFocus !== next.focus.request) {
      lastFocus = next.focus.request;
      const { point, bounds, zoom } = next.focus;
      map.stop();
      map.once('moveend', () => { document.getElementById('map').dataset.focusRequest = String(next.focus.request); });
      if (bounds) map.fitBounds([[bounds.west, bounds.south], [bounds.east, bounds.north]], { padding: 45, maxZoom: 15, duration: 450 });
      else map.easeTo({ center: [point.longitude, point.latitude], zoom: zoom ?? 14, duration: 450 });
    }
  };
  const receive = message => {
    if (message.channel !== channel) return;
    if (message.type === 'state') {
      const next = { ...message.state };
      if (!next.stores && state) next.stores = state.stores;
      if (!Array.isArray(next.stores)) return;
      applyState(next);
    }
  };
  window.SmartcartMap = { receive };
  window.addEventListener('message', event => { if (event.source === window.parent && event.data) receive(event.data); });
  window.addEventListener('pagehide', () => { clearTimeout(dataTimer); clearTimeout(attributionTimer); map?.remove(); });
  try {
    ML.setWorkerCount(2);
    map = new ML.Map({ container: 'map', style: 'https://tiles.openfreemap.org/styles/positron',
      bounds: [[14.1, 49], [24.2, 54.9]], fitBoundsOptions: { padding: 20 }, minZoom: 4, maxZoom: 19,
      attributionControl: false, dragRotate: false, pitchWithRotate: false, maxPitch: 0,
      canvasContextAttributes: { preserveDrawingBuffer: false },
    });
    map.addControl(new ML.NavigationControl({ showCompass: false }), 'top-left');
    // A single compact credit covers both the basemap and OSM-corrected stores.
    map.addControl({
      onAdd() {
        const control = document.createElement('div');
        control.className = 'maplibregl-ctrl smartcart-attribution';
        attributionPanel = document.createElement('div');
        attributionPanel.id = 'map-attribution';
        attributionPanel.hidden = true;
        attributionPanel.innerHTML = '<a href="https://openmaptiles.org/" target="_blank" rel="noopener noreferrer">© OpenMapTiles</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap</a>';
        attributionButton = document.createElement('button');
        attributionButton.type = 'button';
        attributionButton.textContent = 'i';
        attributionButton.setAttribute('aria-label', 'Źródła i licencje mapy');
        attributionButton.setAttribute('aria-controls', attributionPanel.id);
        attributionButton.setAttribute('aria-expanded', 'false');
        attributionButton.addEventListener('click', () => {
          showAttribution(attributionPanel.hidden);
          acknowledgeAttribution();
        });
        control.append(attributionPanel, attributionButton);
        this.container = control;
        return control;
      },
      onRemove() { clearTimeout(attributionTimer); this.container.remove(); },
    }, 'bottom-right');
    map.touchZoomRotate.disableRotation();
    map.on('movestart', () => document.getElementById('map').setAttribute('aria-busy', 'true'));
    map.on('moveend', () => document.getElementById('map').setAttribute('aria-busy', 'false'));
    map.on('error', event => {
      const detail = String(event.error?.message ?? '');
      if (/worker/i.test(detail)) {
        fail('Nie udało się uruchomić silnika mapy. Spróbuj ponownie.', true);
        return;
      }
      const fatal = !loaded && !event.sourceId;
      fail(fatal ? 'Nie udało się wczytać podkładu mapy. Sprawdź internet i spróbuj ponownie.'
        : 'Nie udało się pobrać części podkładu. Sprawdź połączenie z internetem.', fatal);
    });
    map.on('webglcontextlost', () => fail('Telefon wstrzymał wyświetlanie mapy. Uruchom ją ponownie.', true));
    map.on('load', () => {
      map.addSource('smartcart-stores', { type: 'geojson', data: empty(), cluster: true, clusterMaxZoom: 16, clusterRadius: 48 });
      map.addSource('smartcart-location', { type: 'geojson', data: empty() });
      map.addLayer({ id: 'smartcart-clusters', type: 'circle', source: 'smartcart-stores', filter: ['has', 'point_count'], paint: {
        'circle-color': '#152D43', 'circle-radius': ['step', ['get', 'point_count'], 20, 100, 24, 1000, 28],
        'circle-stroke-width': 3, 'circle-stroke-color': '#FFFFFF',
      } });
      map.addLayer({ id: 'smartcart-counts', type: 'symbol', source: 'smartcart-stores', filter: ['has', 'point_count'], layout: {
        'text-field': ['get', 'point_count_abbreviated'], 'text-font': ['Noto Sans Bold'], 'text-size': 13,
        'text-allow-overlap': true, 'text-ignore-placement': true,
      }, paint: { 'text-color': '#FFFFFF' } });
      map.addLayer({ id: 'smartcart-points', type: 'circle', source: 'smartcart-stores', filter: ['!', ['has', 'point_count']], paint: {
        'circle-color': ['match', ['get', 'chain'], ...Object.entries(colors).flat(), '#152D43'],
        'circle-radius': 13, 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3,
      } });
      map.addLayer({ id: 'smartcart-selected', type: 'circle', source: 'smartcart-stores', filter: ['==', ['get', 'storeId'], ''], paint: {
        'circle-color': 'transparent', 'circle-radius': 18, 'circle-stroke-color': '#07966D', 'circle-stroke-width': 3,
      } });
      map.addLayer({ id: 'smartcart-user', type: 'circle', source: 'smartcart-location', paint: {
        'circle-radius': 8, 'circle-color': '#1479F2', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 3,
      } });
      map.on('click', 'smartcart-clusters', async event => {
        const feature = event.features[0];
        try {
          const zoom = await map.getSource('smartcart-stores').getClusterExpansionZoom(feature.properties.cluster_id);
          map.easeTo({ center: feature.geometry.coordinates, zoom, duration: 400 });
        } catch { /* A filter can replace the cluster before expansion finishes. */ }
      });
      map.on('click', 'smartcart-points', event => send({ type: 'select', id: event.features[0].properties.storeId }));
      for (const layer of ['smartcart-points', 'smartcart-clusters']) {
        map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
        map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      }
      loaded = true; applyPalette();
      const waiting = state; state = null;
      if (waiting) applyState(waiting);
      send({ type: 'ready' });
    });
    map.on('sourcedata', event => { if (event.sourceId === 'smartcart-stores') finishData(); });
    map.on('idle', finishData);
    send({ type: 'bridge-ready' });
  } catch {
    fail('Nie udało się uruchomić mapy na tym urządzeniu. Spróbuj ponownie.', true);
  }
}`;

export const MAPLIBRE_VERSION = '6.16.0';
export const MAPLIBRE_ASSETS = `https://unpkg.com/maplibre-gl@${MAPLIBRE_VERSION}/dist/`;
// A virtual origin for inline HTML, not a server to fetch. Android WebView uses
// loadDataWithBaseURL; without HTTPS baseUrl its opaque origin blocks module workers.
export const MAP_DOCUMENT_BASE_URL = 'https://smartcart.invalid/map/';

export function createNativeMapSource(html) {
  return { html, baseUrl: MAP_DOCUMENT_BASE_URL };
}

export function createMapDocument(channel) {
  const encoded = JSON.stringify(channel).replace(/</g, '\\u003c');
  return `<!doctype html><html lang="pl"><head><meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
    <link rel="stylesheet" href="${MAPLIBRE_ASSETS}maplibre-gl.css">
    <style>html,body,#map{height:100%;width:100%;margin:0;background:#F7F7F2;overflow:hidden}
    .maplibregl-ctrl-group{border-radius:10px!important}
    .maplibregl-ctrl-group button{width:36px!important;height:36px!important}
    .smartcart-attribution{display:flex;align-items:center;max-width:calc(100vw - 20px);border-radius:12px;background:rgba(255,255,255,.95);color:#304B43;box-shadow:0 1px 5px #0002;font:10px system-ui,sans-serif}
    .smartcart-attribution div{padding-left:10px}.smartcart-attribution a{color:inherit}
    .smartcart-attribution button{width:24px;height:24px;flex-shrink:0;border:0;padding:0;border-radius:50%;background:transparent;color:inherit;cursor:pointer;font:bold 14px/24px Georgia,serif;text-align:center}
    .smartcart-attribution button:focus-visible{outline:2px solid #07966D;outline-offset:1px}</style></head>
    <body><div id="map" role="region" aria-label="Wektorowa mapa sklepów"></div>
    <script type="module">
    import('${MAPLIBRE_ASSETS}maplibre-gl.mjs').then(ML=>(${runtime})(ML,${encoded})).catch(()=>{
      const message={channel:${encoded},type:'error',fatal:true,message:'Nie udało się uruchomić mapy. Sprawdź połączenie i spróbuj ponownie.'};
      if(window.ReactNativeWebView)window.ReactNativeWebView.postMessage(JSON.stringify(message));else window.parent.postMessage(message,'*');
    });</script></body></html>`;
}
