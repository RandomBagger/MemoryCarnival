import os
import sqlite3
from flask import Flask, g, jsonify, request, render_template, send_from_directory
from werkzeug.utils import secure_filename

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
DB_PATH = os.path.join(BASE_DIR, "game.db")

MEDIA_KINDS = {
    "images": {"exts": (".png", ".jpg", ".jpeg", ".webp", ".svg"), "type": "image"},
    "sprites": {"exts": (".png", ".jpg", ".jpeg", ".webp", ".svg"), "type": "image"},
    "gifs": {"exts": (".gif",), "type": "gif"},
    "videos": {"exts": (".mp4", ".webm", ".ogg"), "type": "video"},
}

# Music is served from assets/ too, but deliberately kept out of MEDIA_KINDS so
# tracks never end up in the game's media pool.
MUSIC_FOLDER = "music"
MUSIC_EXTS = (".mp3", ".ogg", ".wav", ".m4a", ".flac", ".opus")

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 256 * 1024 * 1024  # 256 MB per upload request


def kind_info(folder):
    """Extensions and logical type for an asset folder, or None if unknown."""
    if folder == MUSIC_FOLDER:
        return {"exts": MUSIC_EXTS, "type": "audio"}
    return MEDIA_KINDS.get(folder)


ASSET_FOLDERS = list(MEDIA_KINDS.keys()) + [MUSIC_FOLDER]


def safe_asset_path(folder, filename):
    """Resolve assets/<folder>/<filename>, or None if it escapes the folder."""
    info = kind_info(folder)
    if info is None:
        return None
    folder_path = os.path.realpath(os.path.join(ASSETS_DIR, folder))
    target = os.path.realpath(os.path.join(folder_path, filename))
    if target != folder_path and not target.startswith(folder_path + os.sep):
        return None
    return target


def get_db():
    if "db" not in g:
        g.db = sqlite3.connect(DB_PATH)
        g.db.row_factory = sqlite3.Row
    return g.db


@app.teardown_appcontext
def close_db(exception=None):
    db = g.pop("db", None)
    if db is not None:
        db.close()


DEFAULT_SETTINGS = {
    "about_title": "🎠 About",
    "about_text": (
        "A carnival memory test. Watch the reel, then click the acts back "
        "in the order the ringmaster showed them.\n\n"
        "Each round adds one more act to remember."
    ),
}

SETTINGS_SCHEMA = """
    CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
    )
"""


def init_db():
    conn = sqlite3.connect(DB_PATH)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS scores (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            player_name TEXT NOT NULL,
            round_reached INTEGER NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        )
        """
    )
    conn.execute(SETTINGS_SCHEMA)
    conn.commit()
    conn.close()


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/assets/<folder>/<path:filename>")
def serve_asset(folder, filename):
    if folder not in MEDIA_KINDS and folder != MUSIC_FOLDER:
        return "not found", 404
    return send_from_directory(os.path.join(ASSETS_DIR, folder), filename)


@app.route("/api/media")
def api_media():
    items = []
    for folder, info in MEDIA_KINDS.items():
        folder_path = os.path.join(ASSETS_DIR, folder)
        if not os.path.isdir(folder_path):
            continue
        for fname in sorted(os.listdir(folder_path)):
            if fname.startswith("."):
                continue
            if fname.lower().endswith(info["exts"]):
                items.append(
                    {
                        "id": f"{folder}/{fname}",
                        "url": f"/assets/{folder}/{fname}",
                        "type": info["type"],
                    }
                )
    return jsonify(items)


@app.route("/api/music")
def api_music():
    folder_path = os.path.join(ASSETS_DIR, MUSIC_FOLDER)
    if not os.path.isdir(folder_path):
        return jsonify([])
    tracks = []
    for fname in sorted(os.listdir(folder_path)):
        if fname.startswith(".") or not fname.lower().endswith(MUSIC_EXTS):
            continue
        tracks.append(
            {
                "id": fname,
                "name": os.path.splitext(fname)[0].replace("_", " ").replace("-", " "),
                "url": f"/assets/{MUSIC_FOLDER}/{fname}",
            }
        )
    return jsonify(tracks)


@app.route("/admin")
def admin():
    return render_template("admin.html")


@app.route("/api/assets", methods=["GET"])
def api_assets():
    """Everything in assets/, grouped by folder, for the admin panel."""
    out = {}
    for folder in ASSET_FOLDERS:
        info = kind_info(folder)
        folder_path = os.path.join(ASSETS_DIR, folder)
        items = []
        if os.path.isdir(folder_path):
            for fname in sorted(os.listdir(folder_path)):
                if fname.startswith(".") or not fname.lower().endswith(info["exts"]):
                    continue
                full = os.path.join(folder_path, fname)
                items.append(
                    {
                        "name": fname,
                        "url": f"/assets/{folder}/{fname}",
                        "type": info["type"],
                        "size": os.path.getsize(full),
                    }
                )
        out[folder] = {
            "type": info["type"],
            "accept": list(info["exts"]),
            "items": items,
        }
    return jsonify(out)


@app.route("/api/assets/<folder>", methods=["POST"])
def upload_assets(folder):
    info = kind_info(folder)
    if info is None:
        return jsonify({"error": "unknown folder"}), 404

    folder_path = os.path.join(ASSETS_DIR, folder)
    os.makedirs(folder_path, exist_ok=True)

    saved, rejected = [], []
    for storage in request.files.getlist("files"):
        original = storage.filename or ""
        name = secure_filename(original)
        if not name:
            rejected.append({"name": original, "reason": "bad filename"})
            continue
        if not name.lower().endswith(info["exts"]):
            rejected.append({"name": original, "reason": f"needs {', '.join(info['exts'])}"})
            continue

        # Never silently overwrite — suffix instead.
        stem, ext = os.path.splitext(name)
        candidate, n = name, 1
        while os.path.exists(os.path.join(folder_path, candidate)):
            candidate = f"{stem}-{n}{ext}"
            n += 1

        dest = safe_asset_path(folder, candidate)
        if dest is None:
            rejected.append({"name": original, "reason": "invalid path"})
            continue
        storage.save(dest)
        saved.append(candidate)

    return jsonify({"saved": saved, "rejected": rejected})


@app.route("/api/assets/<folder>/<path:filename>", methods=["DELETE"])
def delete_asset(folder, filename):
    target = safe_asset_path(folder, filename)
    if target is None or not os.path.isfile(target):
        return jsonify({"error": "not found"}), 404
    os.remove(target)
    return jsonify({"ok": True, "deleted": filename})


@app.route("/api/settings", methods=["GET"])
def get_settings():
    db = get_db()
    db.execute(SETTINGS_SCHEMA)  # older DBs predate this table
    rows = db.execute("SELECT key, value FROM settings").fetchall()
    data = dict(DEFAULT_SETTINGS)
    data.update({r["key"]: r["value"] for r in rows if r["key"] in DEFAULT_SETTINGS})
    return jsonify(data)


@app.route("/api/settings", methods=["POST"])
def post_settings():
    payload = request.get_json(force=True) or {}
    db = get_db()
    db.execute(SETTINGS_SCHEMA)
    for key in DEFAULT_SETTINGS:
        if key not in payload:
            continue
        db.execute(
            "INSERT INTO settings (key, value) VALUES (?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, str(payload[key])[:4000]),
        )
    db.commit()
    return jsonify({"ok": True})


@app.route("/api/scores", methods=["GET"])
def get_scores():
    db = get_db()
    rows = db.execute(
        "SELECT player_name, round_reached, created_at FROM scores "
        "ORDER BY round_reached DESC, created_at ASC LIMIT 10"
    ).fetchall()
    return jsonify([dict(r) for r in rows])


@app.route("/api/scores", methods=["POST"])
def post_score():
    data = request.get_json(force=True) or {}
    name = str(data.get("player_name", "")).strip()[:30] or "Anonymous"
    round_reached = int(data.get("round_reached", 0))
    db = get_db()
    db.execute(
        "INSERT INTO scores (player_name, round_reached) VALUES (?, ?)",
        (name, round_reached),
    )
    db.commit()
    return jsonify({"ok": True})


if __name__ == "__main__":
    init_db()
    app.run(debug=True)
