// Asset admin panel. Wrapped in an IIFE so its top-level names never collide
// with game.ts — both compile as classic scripts sharing one global scope.
(() => {
  interface AssetItem {
    name: string;
    url: string;
    type: "image" | "gif" | "video" | "audio";
    size: number;
  }

  interface FolderData {
    type: string;
    accept: string[];
    items: AssetItem[];
  }

  type AssetMap = Record<string, FolderData>;

  const FOLDER_LABELS: Record<string, string> = {
    images: "🖼️ Images",
    sprites: "🧚 Sprites",
    gifs: "🎞️ GIFs",
    videos: "📹 Videos",
    music: "🎵 Music",
  };

  const main = document.getElementById("admin-main") as HTMLElement;
  const statusBar = document.getElementById("admin-status") as HTMLDivElement;
  const modal = document.getElementById("preview-modal") as HTMLDivElement;
  const modalTitle = document.getElementById("preview-title") as HTMLHeadingElement;
  const modalBody = document.getElementById("preview-body") as HTMLDivElement;
  const modalClose = document.getElementById("preview-close") as HTMLButtonElement;

  // Folder cards re-render after every upload/delete; the About editor must not,
  // or in-progress edits would be wiped. Keep them in separate hosts.
  const foldersHost = document.createElement("div");
  foldersHost.className = "folders-host";

  let statusTimer = 0;

  function setStatus(text: string): void {
    statusBar.textContent = text;
    window.clearTimeout(statusTimer);
    if (text) statusTimer = window.setTimeout(() => (statusBar.textContent = ""), 4000);
  }

  function formatSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  /** Builds the element that actually shows the asset. Audio gets a glyph in grids. */
  function mediaEl(item: AssetItem, forModal: boolean): HTMLElement {
    if (item.type === "audio") {
      if (!forModal) {
        const glyph = document.createElement("span");
        glyph.className = "audio-glyph";
        glyph.textContent = "🎵";
        return glyph;
      }
      const audio = document.createElement("audio");
      audio.src = item.url;
      audio.controls = true;
      return audio;
    }

    if (item.type === "video") {
      const video = document.createElement("video");
      video.src = item.url;
      video.muted = true;
      video.loop = true;
      video.playsInline = true;
      if (forModal) {
        video.controls = true;
      } else {
        video.autoplay = true;
      }
      return video;
    }

    const img = document.createElement("img");
    img.src = item.url;
    img.alt = item.name;
    return img;
  }

  function openPreview(item: AssetItem): void {
    modalTitle.textContent = item.name;
    modalBody.innerHTML = "";
    modalBody.appendChild(mediaEl(item, true));
    modal.classList.remove("hidden");
  }

  function closePreview(): void {
    modal.classList.add("hidden");
    modalBody.innerHTML = ""; // stops any playing audio/video
  }

  modalClose.addEventListener("click", closePreview);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closePreview();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closePreview();
  });

  async function upload(folder: string, files: FileList | File[]): Promise<void> {
    const list = Array.from(files);
    if (list.length === 0) return;

    const form = new FormData();
    list.forEach((f) => form.append("files", f));

    setStatus(`Uploading ${list.length} file(s) to ${folder}…`);
    const res = await fetch(`/api/assets/${folder}`, { method: "POST", body: form });
    if (!res.ok) {
      setStatus(`Upload failed (${res.status}).`);
      return;
    }
    const result: { saved: string[]; rejected: { name: string; reason: string }[] } =
      await res.json();

    const parts: string[] = [];
    if (result.saved.length) parts.push(`Saved ${result.saved.length} to ${folder}.`);
    result.rejected.forEach((r) => parts.push(`Rejected ${r.name} — ${r.reason}.`));
    setStatus(parts.join(" ") || "Nothing uploaded.");
    await render();
  }

  async function remove(folder: string, name: string): Promise<void> {
    const res = await fetch(`/api/assets/${folder}/${encodeURIComponent(name)}`, {
      method: "DELETE",
    });
    setStatus(res.ok ? `Deleted ${name}.` : `Could not delete ${name}.`);
    await render();
  }

  function buildTile(folder: string, item: AssetItem): HTMLDivElement {
    const tile = document.createElement("div");
    tile.className = "asset-tile";

    const thumb = document.createElement("div");
    thumb.className = "asset-thumb";
    thumb.title = "Click to preview";
    thumb.appendChild(mediaEl(item, false));
    thumb.addEventListener("click", () => openPreview(item));
    tile.appendChild(thumb);

    const name = document.createElement("div");
    name.className = "asset-name";
    name.textContent = item.name;
    tile.appendChild(name);

    const size = document.createElement("div");
    size.className = "asset-size";
    size.textContent = formatSize(item.size);
    tile.appendChild(size);

    // Audio gets inline controls too — a glyph alone tells you nothing.
    if (item.type === "audio") {
      const audio = document.createElement("audio");
      audio.src = item.url;
      audio.controls = true;
      audio.preload = "none";
      tile.appendChild(audio);
    }

    const actions = document.createElement("div");
    actions.className = "asset-actions";

    const previewBtn = document.createElement("button");
    previewBtn.className = "mini-btn";
    previewBtn.type = "button";
    previewBtn.textContent = "Preview";
    previewBtn.addEventListener("click", () => openPreview(item));
    actions.appendChild(previewBtn);

    // Two-step delete: first click arms it, second confirms. Resets after 3s.
    const delBtn = document.createElement("button");
    delBtn.className = "mini-btn danger";
    delBtn.type = "button";
    delBtn.textContent = "Delete";
    let armed = false;
    let armTimer = 0;
    delBtn.addEventListener("click", () => {
      if (!armed) {
        armed = true;
        delBtn.textContent = "Sure?";
        delBtn.classList.add("confirming");
        armTimer = window.setTimeout(() => {
          armed = false;
          delBtn.textContent = "Delete";
          delBtn.classList.remove("confirming");
        }, 3000);
        return;
      }
      window.clearTimeout(armTimer);
      void remove(folder, item.name);
    });
    actions.appendChild(delBtn);

    tile.appendChild(actions);
    return tile;
  }

  function buildFolder(folder: string, data: FolderData): HTMLElement {
    const card = document.createElement("section");
    card.className = "folder-card";

    const head = document.createElement("div");
    head.className = "folder-head";

    const title = document.createElement("h2");
    title.textContent = FOLDER_LABELS[folder] ?? folder;
    head.appendChild(title);

    const meta = document.createElement("div");
    meta.className = "folder-meta";
    meta.textContent = `${data.items.length} file(s) · accepts ${data.accept.join(" ")}`;
    head.appendChild(meta);
    card.appendChild(head);

    // Dropzone doubles as a file picker.
    const zone = document.createElement("label");
    zone.className = "dropzone";
    zone.textContent = `Drop files here, or click to browse — assets/${folder}/`;

    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = data.accept.join(",");
    input.addEventListener("change", () => {
      if (input.files) void upload(folder, input.files);
      input.value = "";
    });
    zone.appendChild(input);

    ["dragenter", "dragover"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.add("dragging");
      }),
    );
    ["dragleave", "drop"].forEach((ev) =>
      zone.addEventListener(ev, (e) => {
        e.preventDefault();
        zone.classList.remove("dragging");
      }),
    );
    zone.addEventListener("drop", (e) => {
      const dt = (e as DragEvent).dataTransfer;
      if (dt?.files) void upload(folder, dt.files);
    });
    card.appendChild(zone);

    if (data.items.length === 0) {
      const empty = document.createElement("p");
      empty.className = "asset-empty";
      empty.textContent = "Empty.";
      card.appendChild(empty);
      return card;
    }

    const grid = document.createElement("div");
    grid.className = "asset-grid";
    data.items.forEach((item) => grid.appendChild(buildTile(folder, item)));
    card.appendChild(grid);
    return card;
  }

  /* ---------------- About panel editor ---------------- */

  interface Settings {
    about_title: string;
    about_text: string;
  }

  function paragraphs(text: string): string[] {
    return text
      .split(/\n\s*\n/)
      .map((chunk) => chunk.trim())
      .filter(Boolean);
  }

  async function buildAboutEditor(): Promise<HTMLElement> {
    const res = await fetch("/api/settings");
    const settings: Settings = await res.json();

    const card = document.createElement("section");
    card.className = "folder-card";

    const head = document.createElement("div");
    head.className = "folder-head";
    const h2 = document.createElement("h2");
    h2.textContent = "📝 About panel";
    head.appendChild(h2);
    const meta = document.createElement("div");
    meta.className = "folder-meta";
    meta.textContent = "left column on the start and game-over screens";
    head.appendChild(meta);
    card.appendChild(head);

    const editor = document.createElement("div");
    editor.className = "about-editor";

    const fields = document.createElement("div");

    const titleLabel = document.createElement("label");
    titleLabel.className = "setting-label";
    titleLabel.textContent = "Heading";
    titleLabel.htmlFor = "about-title-input";
    fields.appendChild(titleLabel);

    const titleInput = document.createElement("input");
    titleInput.id = "about-title-input";
    titleInput.className = "setting-select";
    titleInput.type = "text";
    titleInput.maxLength = 80;
    titleInput.value = settings.about_title;
    fields.appendChild(titleInput);

    const textLabel = document.createElement("label");
    textLabel.className = "setting-label";
    textLabel.textContent = "Body — leave a blank line between paragraphs";
    textLabel.htmlFor = "about-text-input";
    fields.appendChild(textLabel);

    const textInput = document.createElement("textarea");
    textInput.id = "about-text-input";
    textInput.className = "setting-textarea";
    textInput.rows = 8;
    textInput.maxLength = 4000;
    textInput.value = settings.about_text;
    fields.appendChild(textInput);

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn btn-primary btn-sm";
    saveBtn.type = "button";
    saveBtn.textContent = "💾 Save about text";
    fields.appendChild(saveBtn);

    editor.appendChild(fields);

    // Live preview, using the game's own panel styles.
    const previewWrap = document.createElement("div");
    const previewLabel = document.createElement("div");
    previewLabel.className = "setting-label";
    previewLabel.textContent = "Preview";
    previewWrap.appendChild(previewLabel);

    const preview = document.createElement("div");
    preview.className = "panel side-panel about-preview";
    previewWrap.appendChild(preview);
    editor.appendChild(previewWrap);

    function paint(): void {
      preview.innerHTML = "";
      const h3 = document.createElement("h3");
      h3.textContent = titleInput.value || " ";
      preview.appendChild(h3);
      paragraphs(textInput.value).forEach((chunk) => {
        const p = document.createElement("p");
        p.className = "side-text";
        p.textContent = chunk;
        preview.appendChild(p);
      });
    }

    titleInput.addEventListener("input", paint);
    textInput.addEventListener("input", paint);
    paint();

    saveBtn.addEventListener("click", async () => {
      saveBtn.disabled = true;
      const save = await fetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          about_title: titleInput.value,
          about_text: textInput.value,
        }),
      });
      saveBtn.disabled = false;
      setStatus(save.ok ? "About text saved." : `Save failed (${save.status}).`);
    });

    card.appendChild(editor);
    return card;
  }

  async function render(): Promise<void> {
    const res = await fetch("/api/assets");
    const data: AssetMap = await res.json();
    foldersHost.innerHTML = "";

    let total = 0;
    Object.keys(data).forEach((folder) => {
      total += data[folder].items.length;
      foldersHost.appendChild(buildFolder(folder, data[folder]));
    });

    const playable = ["images", "sprites", "gifs", "videos"].reduce(
      (n, f) => n + (data[f]?.items.length ?? 0),
      0,
    );
    if (playable < 8) {
      const warn = document.createElement("p");
      warn.className = "admin-loading";
      warn.textContent = `⚠️ ${playable}/8 playable media files — the game needs at least 8 (music does not count).`;
      foldersHost.prepend(warn);
    }
    if (total === 0) setStatus("No assets yet. Drop some files in.");
  }

  void (async () => {
    main.innerHTML = "";
    main.appendChild(await buildAboutEditor());
    main.appendChild(foldersHost);
    await render();
  })();
})();
