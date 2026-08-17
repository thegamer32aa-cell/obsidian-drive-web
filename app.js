"use strict";

// ---- Configuracion propia (no son secretos: Client ID publico + API key restringida por referrer) ----
const CLIENT_ID = "283181206190-vrs3hu3np6slfumuis78kp9akcle011v.apps.googleusercontent.com";
const PICKER_API_KEY = "AIzaSyCjDY_u3JAEbojhObWjpoTJUDkMF4B089M";
const ALLOWED_EMAIL = "aimar.aramburu12@gmail.com";
const SCOPES = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";
const DRIVE_API = "https://www.googleapis.com/drive/v3";

const FOLDER_MIME = "application/vnd.google-apps.folder";
const STORAGE_FOLDER_KEY = "ovd_folder"; // { id, name } - no es sensible

let accessToken = null;   // solo en memoria, nunca en localStorage
let tokenClient = null;
let pickerLoaded = false;
let currentUserEmail = null;
let folderStack = []; // [{id, name}]

const main = document.getElementById("main");
const titleText = document.getElementById("titleText");
const headerActions = document.getElementById("headerActions");
const toastHost = document.getElementById("toastHost");

function toast(msg, isError) {
  const el = document.createElement("div");
  el.className = "toast" + (isError ? " error" : "");
  el.textContent = msg;
  toastHost.appendChild(el);
  setTimeout(() => el.remove(), 4000);
}

function clearHeaderActions() {
  headerActions.textContent = "";
}

function setHeaderActions(buttons) {
  clearHeaderActions();
  for (const b of buttons) headerActions.appendChild(b);
}

function el(tag, opts) {
  const node = document.createElement(tag);
  if (opts) {
    if (opts.text !== undefined) node.textContent = opts.text;
    if (opts.class) node.className = opts.class;
    if (opts.onclick) node.addEventListener("click", opts.onclick);
    if (opts.attrs) for (const k in opts.attrs) node.setAttribute(k, opts.attrs[k]);
  }
  return node;
}

// ---------------- Pantallas ----------------

function showLoading(msg) {
  main.textContent = "";
  const wrap = el("div", { class: "center-screen" });
  wrap.appendChild(el("div", { class: "spinner" }));
  wrap.appendChild(el("p", { text: msg || "Cargando..." }));
  main.appendChild(wrap);
  clearHeaderActions();
  titleText.textContent = "Obsidian Vault";
}

function showLogin(errorMsg) {
  accessToken = null;
  currentUserEmail = null;
  main.textContent = "";
  clearHeaderActions();
  titleText.textContent = "Obsidian Vault";
  const wrap = el("div", { class: "center-screen" });
  wrap.appendChild(el("h2", { text: "Acceso a tu vault" }));
  wrap.appendChild(el("p", { text: "Solo la cuenta autorizada de Google puede entrar. El inicio de sesion es gestionado por Google; esta pagina nunca ve tu contrasena." }));
  if (errorMsg) {
    const err = el("p", { text: errorMsg });
    err.style.color = "var(--danger)";
    wrap.appendChild(err);
  }
  const btn = el("button", { class: "primary", text: "Iniciar sesion con Google", onclick: () => requestLogin() });
  wrap.appendChild(btn);
  main.appendChild(wrap);
}

function showFolderPicker() {
  main.textContent = "";
  clearHeaderActions();
  setHeaderActions([el("button", { text: "Cerrar sesion", onclick: logout })]);
  titleText.textContent = currentUserEmail || "Obsidian Vault";
  const wrap = el("div", { class: "center-screen" });
  wrap.appendChild(el("h2", { text: "Elige la carpeta de tu vault" }));
  wrap.appendChild(el("p", { text: "Selecciona en Google Drive la carpeta que usa Obsidian para sincronizar (por ejemplo \"Obsidian Vault - Trading\")." }));
  wrap.appendChild(el("button", { class: "primary", text: "Elegir carpeta en Drive", onclick: openPicker }));
  main.appendChild(wrap);
}

async function showFolderListing(pushToStack) {
  const current = folderStack[folderStack.length - 1];
  titleText.textContent = current.name;
  setHeaderActions([
    el("button", { text: "Cambiar carpeta", onclick: () => { localStorage.removeItem(STORAGE_FOLDER_KEY); folderStack = []; showFolderPicker(); } }),
    el("button", { text: "Cerrar sesion", onclick: logout }),
  ]);

  main.textContent = "";

  if (folderStack.length > 1) {
    const crumbs = el("div", { class: "breadcrumbs" });
    folderStack.forEach((f, idx) => {
      if (idx > 0) crumbs.appendChild(document.createTextNode(" / "));
      crumbs.appendChild(el("button", {
        text: f.name,
        onclick: () => { folderStack = folderStack.slice(0, idx + 1); showFolderListing(); },
      }));
    });
    main.appendChild(crumbs);
  }

  const loading = el("div", { class: "center-screen" });
  loading.appendChild(el("div", { class: "spinner" }));
  main.appendChild(loading);

  try {
    const items = await listChildren(current.id);
    main.removeChild(loading);
    if (items.length === 0) {
      main.appendChild(el("div", { class: "empty", text: "Carpeta vacia." }));
      return;
    }
    const ul = el("ul", { class: "filelist" });
    items.sort((a, b) => {
      const af = a.mimeType === FOLDER_MIME ? 0 : 1;
      const bf = b.mimeType === FOLDER_MIME ? 0 : 1;
      if (af !== bf) return af - bf;
      return a.name.localeCompare(b.name, "es");
    });
    for (const item of items) {
      const li = document.createElement("li");
      const isFolder = item.mimeType === FOLDER_MIME;
      const isMd = item.name.toLowerCase().endsWith(".md");
      const isImg = /\.(png|jpe?g|gif|webp|svg)$/i.test(item.name);
      const icon = isFolder ? "📁" : isMd ? "📄" : isImg ? "🖼️" : "📎";
      const btn = el("button", {
        onclick: () => {
          if (isFolder) {
            folderStack.push({ id: item.id, name: item.name });
            showFolderListing();
          } else if (isMd) {
            openEditor(item);
          } else if (isImg) {
            openImage(item);
          } else {
            window.open(`https://drive.google.com/file/d/${encodeURIComponent(item.id)}/view`, "_blank", "noopener,noreferrer");
          }
        },
      });
      const iconSpan = el("span", { class: "icon", text: icon });
      const nameSpan = el("span", { text: item.name });
      btn.appendChild(iconSpan);
      btn.appendChild(nameSpan);
      li.appendChild(btn);
      ul.appendChild(li);
    }
    main.appendChild(ul);
  } catch (e) {
    main.removeChild(loading);
    main.appendChild(el("div", { class: "empty", text: "Error cargando la carpeta: " + e.message }));
  }
}

async function openEditor(file) {
  showLoading("Abriendo " + file.name + "...");
  titleText.textContent = file.name;
  try {
    const content = await downloadText(file.id);
    main.textContent = "";
    const wrap = el("div", { class: "editor" });
    const textarea = document.createElement("textarea");
    textarea.value = content;
    wrap.appendChild(textarea);
    const actions = el("div", { class: "editor-actions" });
    const backBtn = el("button", { text: "Volver", onclick: () => showFolderListing() });
    const saveBtn = el("button", {
      class: "primary",
      text: "Guardar",
      onclick: async () => {
        saveBtn.disabled = true;
        saveBtn.textContent = "Guardando...";
        try {
          await uploadText(file.id, textarea.value);
          toast("Guardado.");
        } catch (e) {
          toast("Error al guardar: " + e.message, true);
        } finally {
          saveBtn.disabled = false;
          saveBtn.textContent = "Guardar";
        }
      },
    });
    actions.appendChild(backBtn);
    actions.appendChild(saveBtn);
    wrap.appendChild(actions);
    main.appendChild(wrap);
    setHeaderActions([el("button", { text: "Cerrar sesion", onclick: logout })]);
  } catch (e) {
    main.textContent = "";
    main.appendChild(el("div", { class: "empty", text: "Error abriendo el archivo: " + e.message }));
  }
}

async function openImage(file) {
  showLoading("Cargando imagen...");
  titleText.textContent = file.name;
  try {
    const blob = await downloadBlob(file.id);
    const url = URL.createObjectURL(blob);
    main.textContent = "";
    const wrap = el("div", { class: "center-screen" });
    const img = document.createElement("img");
    img.src = url;
    img.style.maxWidth = "100%";
    img.style.borderRadius = "8px";
    wrap.appendChild(img);
    wrap.appendChild(el("button", { text: "Volver", onclick: () => { URL.revokeObjectURL(url); showFolderListing(); } }));
    main.appendChild(wrap);
    setHeaderActions([el("button", { text: "Cerrar sesion", onclick: logout })]);
  } catch (e) {
    main.textContent = "";
    main.appendChild(el("div", { class: "empty", text: "Error cargando la imagen: " + e.message }));
  }
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
  showLoading("Conectando con Google...");
  tokenClient.requestAccessToken({ prompt: "" });
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
    folderStack = [{ id: saved.id, name: saved.name }];
    showFolderListing();
  } else {
    showFolderPicker();
  }
}

function revokeToken() {
  if (accessToken && window.google && google.accounts && google.accounts.oauth2) {
    try {
      google.accounts.oauth2.revoke(accessToken, () => {});
    } catch (e) {
      /* ignore */
    }
  }
  accessToken = null;
}

function logout() {
  revokeToken();
  currentUserEmail = null;
  folderStack = [];
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
    if (!window.gapi) return reject(new Error("Google API no disponible todavia, espera unos segundos e intenta de nuevo."));
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
        const folder = { id: doc.id, name: doc.name };
        localStorage.setItem(STORAGE_FOLDER_KEY, JSON.stringify(folder));
        folderStack = [folder];
        showFolderListing();
      }
    })
    .build();
  picker.setVisible(true);
}

// ---------------- Drive REST ----------------

async function driveFetch(url, opts) {
  opts = opts || {};
  const res = await fetch(url, {
    ...opts,
    headers: { Authorization: "Bearer " + accessToken, ...(opts.headers || {}) },
  });
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

async function listChildren(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed=false`);
  const url = `${DRIVE_API}/files?q=${q}&fields=files(id,name,mimeType,modifiedTime)&pageSize=1000`;
  const res = await driveFetch(url);
  const data = await res.json();
  return data.files || [];
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
