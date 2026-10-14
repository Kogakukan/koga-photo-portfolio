const state = { catalog: null, photos: [], filtered: [], activeFilter: { type: 'all', value: null }, query: '', currentIndex: 0, zoom: 1 };
const $ = (selector) => document.querySelector(selector);
const esc = (value) => String(value ?? '').replace(/[&<>'"]/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#039;', '"': '&quot;' }[char]));
const fallback = (value) => value || '—';

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' }).format(date);
}

function renderPhotoCard(photo, index) {
  const label = photo.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  return `<button class="photo-card" style="--i:${index}" data-id="${esc(photo.id)}" aria-label="Ouvrir ${esc(label)}">
    <figure><img loading="lazy" src="${esc(photo.thumb)}" alt="${esc(label)}" /><div class="card-overlay"><div><p class="card-title">${esc(label)}</p><p class="card-location">${esc(photo.location)}</p></div><span class="card-year">${esc(photo.year)}</span></div></figure>
  </button>`;
}

function matches(photo) {
  const haystack = [photo.filename, photo.year, photo.location, photo.session, photo.lens, photo.camera, photo.focalLength, photo.date].filter(Boolean).join(' ').toLowerCase();
  const searchMatch = !state.query || haystack.includes(state.query.toLowerCase());
  const filterMatch = state.activeFilter.type === 'all' || String(photo[state.activeFilter.type] || '') === String(state.activeFilter.value);
  return searchMatch && filterMatch;
}

function renderGallery() {
  state.filtered = state.photos.filter(matches);
  $('#photoGrid').innerHTML = state.filtered.map(renderPhotoCard).join('');
  $('#emptyState').hidden = state.filtered.length > 0;
  $('#photoCount').textContent = `${state.filtered.length} photo${state.filtered.length === 1 ? '' : 's'}`;
  $('#activeFilter').textContent = state.activeFilter.type === 'all' ? 'Toutes' : state.activeFilter.value;
  document.querySelectorAll('.photo-card').forEach((card) => card.addEventListener('click', () => openPhoto(card.dataset.id)));
}

function renderFilters() {
  const years = state.catalog.facets.years || [];
  const locations = state.catalog.facets.locations || [];
  const chips = [{ type: 'all', value: 'Toutes' }, ...years.slice(0, 8).map((value) => ({ type: 'year', value })), ...locations.slice(0, 8).map((value) => ({ type: 'location', value }))];
  $('#filterRow').innerHTML = chips.map((chip) => `<button class="filter-chip ${chip.type === 'all' ? 'active' : ''}" data-filter-type="${esc(chip.type)}" data-filter-value="${esc(chip.value)}">${esc(chip.value)}</button>`).join('');
  document.querySelectorAll('.filter-chip').forEach((button) => button.addEventListener('click', () => {
    state.activeFilter = { type: button.dataset.filterType, value: button.dataset.filterType === 'all' ? null : button.dataset.filterValue };
    document.querySelectorAll('.filter-chip').forEach((item) => item.classList.remove('active'));
    button.classList.add('active');
    renderGallery();
  }));
}

function groupBy(values, key) {
  const map = new Map();
  values.forEach((photo) => { const value = photo[key] || 'Autres'; if (!map.has(value)) map.set(value, []); map.get(value).push(photo); });
  return [...map.entries()];
}

function renderCollections() {
  const groups = [
    ['Années', 'year', groupBy(state.photos, 'year').sort((a,b) => String(b[0]).localeCompare(String(a[0])))],
    ['Lieux', 'location', groupBy(state.photos, 'location').sort((a,b) => a[0].localeCompare(b[0]))],
    ['Objectifs', 'lens', groupBy(state.photos, 'lens').filter(([key]) => key !== 'Autres').sort((a,b) => a[0].localeCompare(b[0]))],
  ];
  $('#collectionGroups').innerHTML = groups.map(([title, key, entries]) => `<section class="collection-section"><h3>${esc(title)}</h3><div class="collection-row">${entries.map(([label, photos]) => `<button class="collection-card" data-collection-type="${esc(key)}" data-collection-value="${esc(label)}"><div class="folder-preview">${photos.slice(0,3).map((p) => `<img src="${esc(p.thumb)}" alt="" loading="lazy" />`).join('')}</div><div class="collection-label"><span>${esc(label)}</span><span>${photos.length}</span></div></button>`).join('')}</div></section>`).join('');
  document.querySelectorAll('.collection-card').forEach((card) => card.addEventListener('click', () => { state.activeFilter = { type: card.dataset.collectionType, value: card.dataset.collectionValue }; state.query = ''; $('#searchInput').value = ''; document.querySelector('[data-view="gallery"]').click(); renderFilters(); renderGallery(); }));
}

function setZoom(value) {
  state.zoom = Math.min(2, Math.max(1, value));
  $('#dialogImage').style.transform = `scale(${state.zoom})`;
  $('#zoomValue').textContent = `${Math.round(state.zoom * 100)}%`;
}

function openPhoto(id) {
  const index = state.filtered.findIndex((photo) => photo.id === id);
  state.currentIndex = Math.max(0, index);
  showCurrentPhoto();
  const dialog = $('#photoDialog');
  if (!dialog.open) dialog.showModal();
}

function showCurrentPhoto() {
  const photo = state.filtered[state.currentIndex];
  if (!photo) return;
  const label = photo.filename.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ');
  $('#dialogImage').src = photo.full;
  $('#dialogImage').alt = label;
  $('#dialogTitle').textContent = label;
  $('#dialogDate').textContent = formatDate(photo.date);
  $('#dialogLens').textContent = fallback(photo.lens);
  $('#dialogCamera').textContent = fallback(photo.camera);
  $('#dialogLocation').textContent = fallback(photo.location);
  $('#dialogFocal').textContent = fallback(photo.focalLength);
  setZoom(1);
}

function movePhoto(delta) { if (!state.filtered.length) return; state.currentIndex = (state.currentIndex + delta + state.filtered.length) % state.filtered.length; showCurrentPhoto(); }

function initialize(catalog) {
  state.catalog = catalog; state.photos = catalog.photos || [];
  $('#siteTitle').firstChild.textContent = catalog.config.title || 'Antoine';
  $('#siteTagline').textContent = catalog.config.tagline || 'Photography as a way of seeing.'; 
  $('#siteSubtitle').textContent = catalog.config.subtitle || '';
  $('#footerTitle').textContent = catalog.config.watermark || 'ANTOINE · PHOTOGRAPHY';
  $('#footerYear').textContent = new Date().getFullYear();
  renderFilters(); renderGallery(); renderCollections();
}

document.querySelectorAll('[data-view]').forEach((button) => button.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach((item) => item.classList.remove('active')); button.classList.add('active');
  const gallery = button.dataset.view === 'gallery'; $('#galleryView').hidden = !gallery; $('#collectionsView').hidden = gallery;
}));
$('#searchInput').addEventListener('input', (event) => { state.query = event.target.value.trim(); renderGallery(); });
$('#dialogClose').addEventListener('click', () => $('#photoDialog').close());
$('#prevPhoto').addEventListener('click', () => movePhoto(-1));
$('#nextPhoto').addEventListener('click', () => movePhoto(1));
$('#zoomIn').addEventListener('click', () => setZoom(state.zoom + .25));
$('#zoomOut').addEventListener('click', () => setZoom(state.zoom - .25));
$('#dialogImageWrap').addEventListener('wheel', (event) => { event.preventDefault(); setZoom(state.zoom + (event.deltaY < 0 ? .12 : -.12)); }, { passive: false });
document.addEventListener('keydown', (event) => { if (!$('#photoDialog').open) return; if (event.key === 'ArrowLeft') movePhoto(-1); if (event.key === 'ArrowRight') movePhoto(1); if (event.key === 'Escape') $('#photoDialog').close(); });
$('#themeToggle').addEventListener('click', () => document.body.classList.toggle('dark'));
fetch('catalog.json').then((response) => response.json()).then(initialize).catch(() => initialize({ config: { title: 'Antoine — Photography', subtitle: 'Ajoute des JPEG dans photos/', watermark: 'ANTOINE · PHOTOGRAPHY' }, photos: [], facets: { years: [], locations: [], lenses: [] } }));
