import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { mergeReviewDecisions } from './przeglad.mjs';
const root = path.dirname(fileURLToPath(import.meta.url));
const directory = 'weryfikacja-biedronki/przeglad-siedmiu/';
const reportFile = directory + 'raport.json';
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
const save = (file, value) => fs.writeFileSync(path.join(root, file), JSON.stringify(value, null, 2) + '\n');
const hash = raw => createHash('sha256').update(raw).digest('hex');
const manifest = read(directory + 'manifest.json');
const evidenceFiles = [];
for (const metadata of manifest.responses) {
  if (!metadata.file) continue;
  const raw = fs.readFileSync(path.join(root, metadata.file));
  assert.equal(hash(raw), metadata.sha256);
  if (metadata.status === 200) evidenceFiles.push({ file: metadata.file, sha256: metadata.sha256 });
}
const metadataByKey = new Map(manifest.responses.map(m => [m.key, m]));
const patches = read('poprawki/biedronka.json');
const selected = patches.corrections.filter(p => p.replacement.address || p.replacement.location && p.expected.location);
assert.equal(selected.length, 7);
const stores = [...read('gotowe/sklepy.json').stores, ...read('do-weryfikacji/sklepy.json').stores];
const cases = {
  '2698': { status: 'requires_review', title: 'Trzebinia — Młoszowska 47',
    reason: 'Numer 47 pochodzi z OSM; CityOn powtarza ten sam punkt OSM. UUG nie zwróciło dokładnego adresu Młoszowska 47, a najbliższy punkt rejestrowy to Młoszowska 46 (23 m). Oficjalna strona i starsza lista potwierdzają miejscowość i ulicę bez numeru. Nie zastępujemy 47 numerem 46: najbliższy adres może należeć do innego budynku.',
    references: ['trzebinia-cityon', 'starsza-lista-biedronka'], recommendation: 'Sprawdzić numer na budynku, zdjęciu albo w gminnej ewidencji; do tego czasu zachować poza zbiorem gotowym.' },
  '3397': { status: 'corroborated', title: 'Zaklików — Lubelska 39',
    reason: 'Zgodne ID strony sklepu w OSM, punkt pierwotny 2 m od środka budynku. UUG potwierdza dokładny adres i kod 37-470, a rejestrowy punkt tego adresu leży 16 m od środka budynku. Targeo potwierdza Biedronkę przy Lubelskiej 39. DW855 pozostaje wyłącznie historyczną błędną wartością pola numeru.',
    references: ['zaklikow-targeo', 'starsza-lista-biedronka'], recommendation: 'Zachować poprawkę adresu.' },
  '3607': { status: 'corroborated', title: 'Maciejowice — Lubelska 73A, 08-480',
    reason: 'Zgodne ID strony sklepu, pierwotny punkt 7 m od budynku. UUG potwierdza Lubelską 73A oraz kod 08-480 (gmina Maciejowice, powiat garwoliński), punkt rejestrowy 24 m od środka budynku. Targeo potwierdza sklep pod tym adresem. Kod 05-090 w oficjalnej stronie sklepu jest sprzeczny z tymi danymi.',
    references: ['maciejowice-targeo', 'starsza-lista-biedronka'], recommendation: 'Zachować adres i kod 08-480; nie przywracać 05-090 z API.' },
  '3608': { status: 'corroborated', title: 'Drawno — Kolejowa 2A',
    reason: 'Zgodne ID strony sklepu, pierwotny punkt 17 m od środka budynku. UUG potwierdza Kolejową 2A i kod 73-220 (punkt rejestrowy 9 m od środka budynku), Targeo potwierdza sklep. Starsza lista Biedronki opisuje ten sam numer sklepu 6756 jako ulicę Kaliską bez numeru. Dokument gminy widoczny w wyszukiwarce zwrócił teraz 404 i nie służy jako rozstrzygający dowód.',
    references: ['drawno-targeo', 'starsza-lista-biedronka'], recommendation: 'Zachować Kolejową 2A; odnotować dawny wariant ulicy.' },
  '3711': { status: 'corroborated', title: 'Królewiec — 100B',
    reason: 'Zgodne ID strony sklepu w OSM, pierwotny punkt 57 m od środka budynku. UUG potwierdza numer 100B w gminie Smyków i kod 26-212; punkt rejestrowy tego adresu leży 13 m od środka budynku. Starsze dokumenty Biedronki mają numer 100, który istnieje w rejestrze jako osobny adres. CityOn powtarza dane OSM i nie jest niezależnym potwierdzeniem.',
    references: ['starsza-lista-biedronka', 'starsza-lista-krolewiec', 'krolewiec-mojagazetka', 'krolewiec-100-gugik'], recommendation: 'Zachować 100B jako adres wsparty aktualnym rejestrem i dopasowaniem ID; odnotować starszy zapis 100.' },
  '7078': { status: 'requires_review', title: 'Grąbków — poprawiony punkt, numer 57/57A',
    reason: 'Nowy punkt OSM jest około 49,1 km od błędnego punktu ogólnopolskiego i tylko około 6 m od punktu sklepu w Targeo. Lokalizacja sklepu jest potwierdzona. Numer adresowy pozostaje sprzeczny: aktualna strona Biedronki i Targeo podają 57, starszy dokument dla numeru sklepu 7027 podaje 57A, a najbliższy punkt rejestru to 57A (37 m). Oba numery istnieją jako osobne punkty adresowe. Nie zmieniamy numeru na podstawie samej bliskości.',
    references: ['grabkow-targeo', 'starsza-lista-biedronka', 'grabkow-57a-gugik'], recommendation: 'Zachować poprawione współrzędne jako kandydaturę; rekord odłożyć do wyjaśnienia numeru 57/57A.' },
  '7092': { status: 'corroborated', title: 'Gdynia — Rdestowa 160',
    reason: 'Oficjalna strona potwierdza sklep i adres Rdestowa 160, 81-577 Gdynia. UUG potwierdza adres (punkt rejestrowy 9 m od nowego punktu), Targeo wskazuje sklep około 6 m od nowego punktu. Stary punkt leżał około 286 km dalej, w środkowej Polsce.',
    references: ['gdynia-targeo'], recommendation: 'Zachować poprawiony punkt. Nie traktować go jako sprawdzonego wejścia do sklepu.' },
};
const rad = Math.PI / 180;
const distance = (a, b) => {
  const h = Math.sin((b.latitude-a.latitude)*rad/2)**2 + Math.cos(a.latitude*rad)*Math.cos(b.latitude*rad)*Math.sin((b.longitude-a.longitude)*rad/2)**2;
  return Math.round(12742000*Math.asin(Math.min(1,Math.sqrt(h))));
};
const records = [];
for (const patch of selected) {
  const id = patch.id.split(':')[1], review = cases[id];
  const osmData = read(directory + `${id}-osm.json`);
  const element = osmData.elements.find(e => e.type === patch.evidence.element_type && e.id === patch.evidence.element_id);
  assert.deepEqual(element.tags, patch.evidence.matched_tags, 'Zmieniły się tagi OSM — powtórz ocenę.');
  const nodes = osmData.elements.filter(e => e.type === 'node');
  const osmPoint = element.type === 'node' ? {latitude: element.lat, longitude: element.lon} : {
    latitude: (Math.max(...nodes.map(n => n.lat))+Math.min(...nodes.map(n => n.lat)))/2,
    longitude: (Math.max(...nodes.map(n => n.lon))+Math.min(...nodes.map(n => n.lon)))/2,
  };
  const originalSnapshot = read(patch.evidence.dataset_file).elements.find(e => e.type === element.type && e.id === element.id);
  assert.ok(distance(osmPoint, {latitude: originalSnapshot.lat ?? originalSnapshot.center.lat,
    longitude: originalSnapshot.lon ?? originalSnapshot.center.lon}) <= 1, 'Zmieniła się geometria OSM.');
  const forward = read(directory + `${id}-gugik.json`), reverse = read(directory + `${id}-gugik-reverse.json`);
  const store = stores.find(s => s.id === patch.id);
  assert.deepEqual(store.address, patch.replacement.address ?? patch.expected.address);
  assert.deepEqual(store.location, patch.replacement.location ?? patch.expected.location);
  const references = [`${id}-oficjalna`, `${id}-osm`, `${id}-gugik`, `${id}-gugik-reverse`, ...review.references]
    .map(key => { const m = metadataByKey.get(key); assert.equal(m.status, 200); return m; });
  records.push({ id: patch.id, ...review, original: patch.expected, candidate: {address: store.address, location: store.location},
    osm_point: osmPoint, original_point_to_osm_m: distance(patch.expected.location, osmPoint),
    current_osm: {url: patch.evidence.url, version: element.version, timestamp: element.timestamp, tags: element.tags},
    gugik_exact_address_results: forward.results, gugik_nearest_address: reverse.results,
    references });
}
const now = new Date().toISOString();
const report = { schema_version: 1, reviewed_at: now, baseline_input_fingerprint: patches.baseline_input_fingerprint,
  scoped_records: records.length, corroborated: records.filter(r => r.status === 'corroborated').length,
  requires_review: records.filter(r => r.status === 'requires_review').length,
  method: 'Przegląd źródeł online: świeże strony konkretnych sklepów, wersje i geometrie OSM, dokładne adresy oraz najbliższe adresy UUG, pomocnicze katalogi i starsze dokumenty Biedronki. To nie jest kontrola terenowa.',
  limitations: ['GUGiK potwierdza adres i jego położenie, nie markę najemcy budynku.', 'Najbliższy punkt adresowy nie przesądza o adresie sklepu.',
    'CityOn może powielać OSM; zgodność tych dwóch serwisów nie jest niezależnym dowodem.',
    'Targeo zawiera również błędy adresów, np. karta Królewca ma niespójne miejscowości i kody. Nie wykorzystano jej jako potwierdzenia numeru 100B.',
    'Zapisane odczyty dotyczą chwili pobrania; nie potwierdzają godzin pracy ani wejścia do sklepu.'],
  unavailable_sources: manifest.responses.filter(m => m.status !== 200), records };
save(reportFile, report);
const decisionsFile = 'weryfikacja-biedronki/decyzje-przegladu.json';
const previousDecisions = fs.existsSync(path.join(root,decisionsFile)) ? read(decisionsFile) : null;
save(decisionsFile, mergeReviewDecisions(previousDecisions, { schema_version: 1, reviewed_at: now,
  baseline_input_fingerprint: patches.baseline_input_fingerprint, evidence_files: [...evidenceFiles,
    {file: reportFile, sha256: hash(fs.readFileSync(path.join(root, reportFile)))}],
  decisions: records.map(r => ({id: r.id, status: r.status, reason: r.reason, report_file: reportFile,
    expected: r.candidate})) }));
const csv = value => '"' + String(value ?? '').replaceAll('"', '""') + '"';
const rows = [['id','sklep','wynik','uzasadnienie','zalecenie'], ...records.map(r => [r.id,r.title,r.status,r.reason,r.recommendation])];
fs.writeFileSync(path.join(root, directory + 'wynik.csv'), '\uFEFF' + rows.map(row => row.map(csv).join(';')).join('\r\n') + '\r\n');
const lines = ['# Przegląd siedmiu poprawek', '', `Data UTC: ${now}`, '',
  '**Wynik: 5 przypadków potwierdzonych w porównanych źródłach, 2 do dalszej kontroli.**', '',
  'Dwa niejednoznaczne rekordy otrzymują status wymagający kontroli i pozostają poza zbiorem gotowym. Dane i automatyczne poprawki są zachowane wraz z historią.', '',
  '| Sklep | Wynik |', '| --- | --- |', ...records.map(r => `| ${r.title} | ${r.status === 'corroborated' ? 'Potwierdzony w porównanych źródłach' : 'Do dalszej kontroli'} |`), '',
  ...records.flatMap(r => [`## ${r.title}`, '', r.reason, '', `Zalecenie: ${r.recommendation}`, '',
    ...r.references.map(m => `- [${m.key}](${m.url}) — lokalny dowód: \`${path.basename(m.file)}\`; SHA-256: \`${m.sha256}\`.`), '']),
  '## Ograniczenia', '', ...report.limitations.map(item => '- ' + item), '',
  'Dokument gminy Drawno wskazany przez wyszukiwarkę zwrócił HTTP 404; odpowiedź zachowano i nie potraktowano jako potwierdzenia.', '',
  'Szczegóły: `raport.json`; zestawienie do Excela: `wynik.csv`.', '',
  'Ponowne przygotowanie danych nakłada decyzje z `../decyzje-przegladu.json` po poprawkach automatycznych. `--check` sprawdza także sumy dowodów przeglądu.', '',
  'Dane OSM: © OpenStreetMap contributors, ODbL-1.0.'];
fs.writeFileSync(path.join(root, directory + 'README.md'), lines.join('\n') + '\n');
console.log(JSON.stringify({ reviewed: records.length, corroborated: report.corroborated, held: report.requires_review }));
