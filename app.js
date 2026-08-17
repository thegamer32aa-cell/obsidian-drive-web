"use strict";

// ---- Configuracion propia (no son secretos: Client ID publico + API key restringida por referrer) ----
const CLIENT_ID = "283181206190-vrs3hu3np6slfumuis78kp9akcle011v.apps.googleusercontent.com";
const PICKER_API_KEY = "AIzaSyCjDY_u3JAEbojhObWjpoTJUDkMF4B089M";
const ALLOWED_EMAIL = "aimar.aramburu12@gmail.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const DRIVE_API = "https://www.googleapis.com/drive/v3";
const FOLDER_MIME = "application/vnd.google-apps.folder";
const STORAGE_FOLDER_KEY = "ovd_folder";

let accessToken = null; // solo en memoria
let tokenClient = null;
let pickerLoaded = false;
let currentUserEmail = null;

let rootFolder = null;        // {id, name}
let filesByPath = new Map();  // path -> {id,name,mimeType,modifiedTime,path,parentPath}
let nameIndex = new Map();    // nombre en minusculas (sin extension) -> path
let treeChildren = new Map(); // parentPath ("" = raiz) -> [path,...] ordenado

let currentNote = null;       // {path,id,content,dirty}
let viewMode = "preview";     // "preview" | "edit"
let collapsedFolders = new Set();

const $ = (id) => document.getElementById(id);
const main = $("main");
const noteTitle = $("noteTitle");
const topbarActions = $("topbarActions");
const treeEl = $("tree");
const vaultNameEl = $("vaultName");
const sidebar = $("sidebar");
const scrim = $("scrim");
const toastHost = $("toastHost");

function toast(msg, isError) {
  const node = document.createElement("div");
  node.className = "toast" + (isError ? " error" : "");
  node.textContent = msg;
  toastHost.appendChild(node);
  setTimeout(() => node.remove(), 4000);
}

function el(tag, opts) {
  const node = document.createElement(tag);
  if (opts) {
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.class) node.className = opts.class;
    if (opts.title) node.title = opts.title;
    if (opts.onclick) node.addEventListener("click", opts.onclick);
  }
  return node;
}

function openSidebar() {
  sidebar.classList.add("open");
  scrim.classList.add("show");
}
function closeSidebar() {
  sidebar.classList.remove("open");
  scrim.classList.remove("show");
}
$("sidebarOpenBtn").addEventListener("click", openSidebar);
$("sidebarCloseBtn").addEventListener("click", closeSidebar);
scrim.addEventListener("click", closeSidebar);

// ---------------- Pantallas base ----------------

function showLoading(msg) {
  main.innerHTML = "";
  const wrap = el("div", { class: "center-screen" });
  wrap.appendChild(el("div", { class: "spinner" }));
  wrap.appendChild(el("p", { text: msg || "Cargando..." }));
  main.appendChild(wrap);
  topbarActions.innerHTML = "";
  noteTitle.textContent = "Obsidian Vault";
}

function showLogin(errorMsg) {
  accessToken = null;
  currentUserEmail = null;
  sidebar.classList.remove("open");
  scrim.classList.remove("show");
  treeEl.innerHTML = "";
  vaultNameEl.textContent = "Vault";
  main.innerHTML = "";
  topbarActions.innerHTML = "";
  noteTitle.textContent = "Obsidian Vault";
  const wrap = el("div", { class: "center-screen" });
  wrap.appendChild(el("h2", { text: "Acceso a tu vault" }));
  wrap.appendChild(el("p", { text: "Solo la cuenta autorizada de Google puede entrar. El inicio de sesion es gestionado por Google; esta pagina nunca ve tu contrasena." }));
  if (errorMsg) {
    const err = el("p", { text: errorMsg });
    err.style.color = "var(--danger)";
    wrap.appendChild(err);
  }
  wrap.appendChild(el("button", { class: "pill primary", text: "Iniciar sesion con Google", onclick: requestLogin }));
  main.appendChild(wrap);
}

function showFolderPicker() {
  main.innerHTML = "";
  topbarActions.innerHTML = "";
  noteTitle.textContent = "Obsidian Vault";
  vaultNameEl.textContent = currentUserEmail || "Vault";
  treeEl.innerHTML = "";
  const wrap = el("div", { class: "center-screen" });
  wrap.appendChild(el("h2", { text: "Elige la carpeta de tu vault" }));
  wrap.appendChild(el("p", { text: 'Selecciona en Google Drive la carpeta que usa Obsidian para sincronizar (ej. "Obsidian Vault - Trading").' }));
  wrap.appendChild(el("button", { class: "pill primary", text: "Elegir carpeta en Drive", onclick: openPicker }));
  main.appendChild(wrap);
}

// ---------------- Auth ----------------

function initGoogle() {
  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: CLIENT_ID,
    scope: SCOPES,
    callback: onTokenResponse,
    error_callback: (err) => {
      console.error(err);
      showLogin("No se pudo iniciar sesion (" + (err && err.type ? err.type : "error") + ").");
    },
  });
  showLogin();
}

function requestLogin() {
  tokenClient.requestAccessToken({ prompt: "" });
  showLoading("Conectando con Google...");
}

async function onTokenResponse(resp) {
  if (!resp || resp.error) {
    showLogin("Inicio de sesion cancelado o denegado.");
    return;
  }
  accessToken = resp.access_token;
  showLoading("Verificando cuenta...");
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: "Bearer " + accessToken },
    });
    if (!res.ok) throw new Error("no se pudo verificar la cuenta");
    const info = await res.json();
    if (!info.email || info.email.toLowerCase() !== ALLOWED_EMAIL.toLowerCase()) {
      revokeToken();
      showLogin("Esta cuenta (" + (info.email || "desconocida") + ") no tiene acceso a este vault.");
      return;
    }
    currentUserEmail = info.email;
  } catch (e) {
    revokeToken();
    showLogin("No se pudo verificar tu cuenta de Google. Intentalo de nuevo.");
    return;
  }

  const saved = safeParse(localStorage.getItem(STORAGE_FOLDER_KEY));
  if (saved && saved.id && saved.name) {
    rootFolder = saved;
    loadVault();
  } else {
    showFolderPicker();
  }
}

function revokeToken() {
  if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {});
    } catch (e) {}
  }
  accessToken = null;
}

function logout() {
  revokeToken();
  currentUserEmail = null;
  currentNote = null;
  showLogin();
}

function safeParse(s) {
  try {
    return JSON.parse(s);
  } catch (e) {
    return null;
  }
}

// ---------------- Picker (elegir carpeta) ----------------

function ensurePickerLoaded() {
  return new Promise((resolve, reject) => {
    if (pickerLoaded) return resolve();
    if (!window.gapi) return reject(new Error("Google API no disponible todavia, intenta de nuevo en unos segundos."));
    gapi.load("picker", {
      callback: () => {
        pickerLoaded = true;
        resolve();
      },
      onerror: () => reject(new Error("no se pudo cargar el selector de Drive")),
    });
  });
}

async function openPicker() {
  try {
    await ensurePickerLoaded();
  } catch (e) {
    toast(e.message, true);
    return;
  }
  const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS)
    .setSelectFolderEnabled(true)
    .setIncludeFolders(true)
    .setMimeTypes(FOLDER_MIME);

  const picker = new google.picker.PickerBuilder()
    .setOAuthToken(accessToken)
    .setDeveloperKey(PICKER_API_KEY)
    .addView(view)
    .setTitle("Elige la carpeta de tu vault")
    .setCallback((data) => {
      if (data.action === google.picker.Action.PICKED) {
        const doc = data.docs[0];
        rootFolder = { id: doc.id, name: doc.name };
        localStorage.setItem(STORAGE_FOLDER_KEY, JSON.stringify(rootFolder));
        loadVault();
      }
    })
    .build();
  picker.setVisible(true);
}

function changeFolder() {
  localStorage.removeItem(STORAGE_FOLDER_KEY);
  rootFolder = null;
  currentNote = null;
  showFolderPicker();
}
$("changeFolderBtn").addEventListener("click", changeFolder);

// ---------------- Drive REST ----------------

async function driveFetch(url, opts) {
  opts = opts || {};
  const res = await fetch(url, { ...opts, headers: { Authorization: "Bearer " + accessToken, ...(opts.headers || {}) } });
  if (res.status === 401) {
    revokeToken();
    showLogin("Tu sesion caduco, inicia sesion de nuevo.");
    throw new Error("sesion caducada");
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error("Drive API " + res.status + (text ? ": " + text.slice(0, 200) : ""));
  }
  return res;
}

async function listChildrenOf(folderId) {
  const out = [];
  let pageToken;
  do {
    const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
    const params = `q=${q}&fields=nextPageToken,files(id,name,mimeType,modifiedTime)&pageSize=1000` + (pageToken ? `&pageToken=${pageToken}` : "");
    const res = await driveFetch(`${DRIVE_API}/files?${params}`);
    const data = await res.json();
    out.push(...(data.files || []));
    pageToken = data.nextPageToken;
  } while (pageToken);
  return out;
}

async function downloadText(fileId) {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.text();
}

async function downloadBlob(fileId) {
  const res = await driveFetch(`${DRIVE_API}/files/${encodeURIComponent(fileId)}?alt=media`);
  return res.blob();
}

async function uploadText(fileId, text) {
  await driveFetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media`, {
    method: "PATCH",
    headers: { "Content-Type": "text/plain; charset=utf-8" },
    body: text,
  });
}

// ---------------- Construir arbol completo del vault ----------------

async function loadVault() {
  showLoading("Leyendo tu vault...");
  filesByPath = new Map();
  nameIndex = new Map();
  treeChildren = new Map();
  treeChildren.set("", []);

  try {
    const queue = [{ id: rootFolder.id, path: "" }];
    while (queue.length) {
      const { id, path } = queue.shift();
      const children = await listChildrenOf(id);
      children.sort((a, b) => {
        const af = a.mimeType === FOLDER_MIME ? 0 : 1;
        const bf = b.mimeType === FOLDER_MIME ? 0 : 1;
        if (af !== bf) return af - bf;
        return a.name.localeCompare(b.name, "es");
      });
      for (const child of children) {
        const childPath = path ? path + "/" + child.name : child.name;
        const isFolder = child.mimeType === FOLDER_MIME;
        filesByPath.set(childPath, {
          id: child.id,
          name: child.name,
          mimeType: child.mimeType,
          modifiedTime: child.modifiedTime,
          path: childPath,
          parentPath: path,
          isFolder,
        });
        treeChildren.get(path).push(childPath);
        if (isFolder) {
          treeChildren.set(childPath, []);
          queue.push({ id: child.id, path: childPath });
        } else {
          const base = child.name.replace(/\.[^.]+$/, "").toLowerCase();
          if (!nameIndex.has(base)) nameIndex.set(base, childPath);
        }
      }
    }
  } catch (e) {
    main.innerHTML = "";
    main.appendChild(el("div", { class: "empty", text: "Error leyendo el vault: " + e.message }));
    return;
  }

  vaultNameEl.textContent = rootFolder.name;
  $("sidebarEmail").textContent = currentUserEmail || "";
  renderTree();
  main.innerHTML = "";
  topbarActions.innerHTML = "";
  const wrap = el("div", { class: "center-screen" });
  wrap.appendChild(el("p", { text: "Selecciona una nota del menu para empezar." }));
  main.appendChild(wrap);
  noteTitle.textContent = rootFolder.name;
}

// ---------------- Sidebar / arbol ----------------

function renderTree() {
  treeEl.innerHTML = "";
  const rootChildren = treeChildren.get("") || [];
  for (const path of rootChildren) {
    treeEl.appendChild(buildTreeNode(path));
  }
}

function buildTreeNode(path) {
  const file = filesByPath.get(path);
  const item = el("div", { class: "tree-item" });
  const row = el("div", { class: "tree-row" });

  if (file.isFolder) {
    const collapsed = collapsedFolders.has(path);
    row.classList.toggle("collapsed", collapsed);
    row.appendChild(el("span", { class: "chev", text: "▾" }));
    row.appendChild(el("span", { class: "name", text: "📁 " + file.name }));
    const childrenWrap = el("div", { class: "tree-children" + (collapsed ? " hidden" : "") });
    for (const childPath of treeChildren.get(path) || []) {
      childrenWrap.appendChild(buildTreeNode(childPath));
    }
    row.addEventListener("click", () => {
      const nowCollapsed = childrenWrap.classList.toggle("hidden");
      row.classList.toggle("collapsed", nowCollapsed);
      if (nowCollapsed) collapsedFolders.add(path);
      else collapsedFolders.delete(path);
    });
    item.appendChild(row);
    item.appendChild(childrenWrap);
  } else {
    const isMd = file.name.toLowerCase().endsWith(".md");
    const icon = isMd ? "📄" : /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name) ? "🖼️" : "📎";
    row.appendChild(el("span", { class: "chev", text: "" }));
    row.appendChild(el("span", { class: "name", text: icon + " " + file.name.replace(/\.md$/i, "") }));
    row.addEventListener("click", () => {
      closeSidebar();
      if (isMd) openNote(path);
      else openOther(path);
    });
    item.appendChild(row);
  }
  return item;
}

// ---------------- Ver / editar nota ----------------

async function openNote(path) {
  const file = filesByPath.get(path);
  if (!file) {
    toast("Nota no encontrada: " + path, true);
    return;
  }
  showLoading("Abriendo " + file.name + "...");
  try {
    const content = await downloadText(file.id);
    currentNote = { path, id: file.id, content, dirty: false };
    viewMode = "preview";
    renderNote();
  } catch (e) {
    main.innerHTML = "";
    main.appendChild(el("div", { class: "empty", text: "Error abriendo la nota: " + e.message }));
  }
}

async function openOther(path) {
  const file = filesByPath.get(path);
  const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(file.name);
  noteTitle.textContent = file.name;
  topbarActions.innerHTML = "";
  if (isImg) {
    showLoading("Cargando imagen...");
    try {
      const blob = await downloadBlob(file.id);
      const url = URL.createObjectURL(blob);
      main.innerHTML = "";
      const wrap = el("div", { class: "center-screen" });
      const img = document.createElement("img");
      img.src = url;
      img.style.maxWidth = "100%";
      img.style.borderRadius = "8px";
      wrap.appendChild(img);
      main.appendChild(wrap);
    } catch (e) {
      main.innerHTML = "";
      main.appendChild(el("div", { class: "empty", text: "Error cargando la imagen: " + e.message }));
    }
  } else {
    main.innerHTML = "";
    const wrap = el("div", { class: "center-screen" });
    wrap.appendChild(el("p", { text: "Este tipo de archivo no se puede previsualizar aqui." }));
    wrap.appendChild(el("a", { text: "Abrir en Google Drive" }));
    wrap.querySelector("a").href = `https://drive.google.com/file/d/${encodeURIComponent(file.id)}/view`;
    wrap.querySelector("a").target = "_blank";
    wrap.querySelector("a").rel = "noopener noreferrer";
    main.appendChild(wrap);
  }
}

function renderNote() {
  if (!currentNote) return;
  const file = filesByPath.get(currentNote.path);
  noteTitle.textContent = file.name.replace(/\.md$/i, "") + (currentNote.dirty ? " •" : "");

  topbarActions.innerHTML = "";
  if (viewMode === "preview") {
    topbarActions.appendChild(el("button", { class: "icon-btn", title: "Editar", text: "✏️", onclick: () => { viewMode = "edit"; renderNote(); } }));
  } else {
    topbarActions.appendChild(el("button", { class: "icon-btn", title: "Vista previa", text: "👁️", onclick: () => { viewMode = "preview"; renderNote(); } }));
    const saveBtn = el("button", { class: "pill primary", text: "Guardar", onclick: () => saveCurrentNote(saveBtn) });
    saveBtn.disabled = !currentNote.dirty;
    topbarActions.appendChild(saveBtn);
  }

  main.innerHTML = "";
  const wrap = el("div", { class: "note-wrap" });

  if (viewMode === "edit") {
    const textarea = document.createElement("textarea");
    textarea.value = currentNote.content;
    textarea.addEventListener("input", () => {
      currentNote.content = textarea.value;
      currentNote.dirty = true;
      noteTitle.textContent = file.name.replace(/\.md$/i, "") + " •";
      const saveBtn = topbarActions.querySelector("button.primary");
      if (saveBtn) saveBtn.disabled = false;
    });
    wrap.appendChild(textarea);
  } else {
    const div = el("div", { class: "md" });
    const pendingImages = [];
    let embedCounter = 0;
    const ctx = {
      onWikilink: (target, alias) => renderWikilink(target, alias),
      onEmbed: (target, alias) => renderEmbed(target, alias, pendingImages, () => embedCounter++),
      onImage: (url, alt) => renderInlineImage(url, alt, pendingImages, () => embedCounter++, currentNote.path),
    };
    div.innerHTML = renderMarkdown(currentNote.content, ctx);
    wrap.appendChild(div);

    div.addEventListener("click", (ev) => {
      const a = ev.target.closest("a[data-open]");
      if (a) {
        ev.preventDefault();
        openNote(a.getAttribute("data-open"));
      }
    });
    div.addEventListener("change", (ev) => {
      const cb = ev.target.closest('input[type="checkbox"][data-line]');
      if (cb) toggleCheckboxLine(Number(cb.getAttribute("data-line")), cb.checked);
    });

    resolvePendingImages(pendingImages);
  }

  main.appendChild(wrap);
}

function renderWikilink(target, alias) {
  const path = nameIndex.get(target.toLowerCase());
  const label = mdEscapeHtml(alias || target);
  if (!path) return `<a href="#" class="wikilink broken" title="Nota no encontrada">${label}</a>`;
  return `<a href="#" class="wikilink" data-open="${mdEscapeHtml(path)}">${label}</a>`;
}

function renderEmbed(target, alias, pendingImages, nextId) {
  const path = nameIndex.get(target.toLowerCase()) || (filesByPath.has(target) ? target : null);
  if (!path) return `<span class="embed-missing">[[${mdEscapeHtml(target)}]] no encontrada</span>`;
  const file = filesByPath.get(path);
  if (/\.(png|jpe?g|gif|webp|svg)$/i.test(file.name)) {
    const holderId = "embed-img-" + nextId();
    pendingImages.push({ holderId, fileId: file.id });
    return `<span class="embed-missing" id="${holderId}">Cargando ${mdEscapeHtml(file.name)}...</span>`;
  }
  const label = mdEscapeHtml(alias || file.name.replace(/\.md$/i, ""));
  return `<a href="#" class="wikilink" data-open="${mdEscapeHtml(path)}">🔗 ${label}</a>`;
}

function renderInlineImage(url, alt, pendingImages, nextId, currentPath) {
  const decoded = decodeURIComponent(url);
  let file = filesByPath.get(decoded);
  if (!file) {
    const baseDir = currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "";
    const joined = baseDir ? baseDir + "/" + decoded : decoded;
    file = filesByPath.get(joined);
  }
  if (!file) {
    const base = decoded.split("/").pop().replace(/\.[^.]+$/, "").toLowerCase();
    const p = nameIndex.get(base);
    if (p) file = filesByPath.get(p);
  }
  if (!file) return `<span class="embed-missing">imagen no encontrada: ${mdEscapeHtml(decoded)}</span>`;
  const holderId = "embed-img-" + nextId();
  pendingImages.push({ holderId, fileId: file.id, alt });
  return `<span class="embed-missing" id="${holderId}">Cargando imagen...</span>`;
}

async function resolvePendingImages(pending) {
  for (const p of pending) {
    try {
      const blob = await downloadBlob(p.fileId);
      const url = URL.createObjectURL(blob);
      const holder = document.getElementById(p.holderId);
      if (!holder) continue;
      const img = document.createElement("img");
      img.src = url;
      img.alt = p.alt || "";
      holder.replaceWith(img);
    } catch (e) {
      const holder = document.getElementById(p.holderId);
      if (holder) holder.textContent = "No se pudo cargar la imagen.";
    }
  }
}

function toggleCheckboxLine(lineIndex, checked) {
  const lines = currentNote.content.split("\n");
  if (lineIndex < 0 || lineIndex >= lines.length) return;
  lines[lineIndex] = lines[lineIndex].replace(/\[( |x|X)\]/, checked ? "[x]" : "[ ]");
  currentNote.content = lines.join("\n");
  currentNote.dirty = true;
  saveCurrentNote(null);
}

async function saveCurrentNote(btn) {
  if (!currentNote) return;
  if (btn) {
    btn.disabled = true;
    btn.textContent = "Guardando...";
  }
  try {
    await uploadText(currentNote.id, currentNote.content);
    currentNote.dirty = false;
    const file = filesByPath.get(currentNote.path);
    if (file) file.modifiedTime = new Date().toISOString();
    toast("Guardado.");
    renderNote();
  } catch (e) {
    toast("Error al guardar: " + e.message, true);
    if (btn) {
      btn.disabled = false;
      btn.textContent = "Guardar";
    }
  }
}

// ---------------- Busqueda ----------------

$("searchInput").addEventListener("input", (ev) => {
  const q = ev.target.value.trim().toLowerCase();
  if (!q) {
    renderTree();
    return;
  }
  treeEl.innerHTML = "";
  const matches = [...filesByPath.values()]
    .filter((f) => !f.isFolder && f.name.toLowerCase().includes(q))
    .sort((a, b) => a.name.localeCompare(b.name, "es"));
  if (matches.length === 0) {
    treeEl.appendChild(el("div", { class: "empty", text: "Sin resultados." }));
    return;
  }
  for (const f of matches) {
    const row = el("div", { class: "tree-row" });
    const icon = f.name.toLowerCase().endsWith(".md") ? "📄" : "📎";
    row.appendChild(el("span", { class: "chev", text: "" }));
    row.appendChild(el("span", { class: "name", text: icon + " " + f.path }));
    row.addEventListener("click", () => {
      closeSidebar();
      ev.target.value = "";
      renderTree();
      if (f.name.toLowerCase().endsWith(".md")) openNote(f.path);
      else openOther(f.path);
    });
    treeEl.appendChild(row);
  }
});

// ---------------- Sesion ----------------

$("logoutBtn").addEventListener("click", logout);

// ---------------- Arranque ----------------

showLoading("Iniciando...");
function waitForGoogle() {
  if (window.google && google.accounts && google.accounts.oauth2) {
    initGoogle();
  } else {
    setTimeout(waitForGoogle, 100);
  }
}
waitForGoogle();
