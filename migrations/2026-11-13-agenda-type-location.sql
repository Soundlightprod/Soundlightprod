-- Ajoute le type « location » (location / prêt de matériel) à artist_agenda.
-- Déjà appliqué sur D1 le 13/11/2026 (reconstruction de la table, SQLite ne permet pas de modifier un CHECK).
PRAGMA defer_foreign_keys = on;
CREATE TABLE artist_agenda_new ( id INTEGER PRIMARY KEY AUTOINCREMENT, artist_slug TEXT NOT NULL, date TEXT NOT NULL, type TEXT NOT NULL CHECK(type IN ('concert','indisponible','cabaret','dj','animation','karaoke','location')), label TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), publish_at TEXT, expires_at TEXT, source_actu_id INTEGER, status TEXT NOT NULL DEFAULT 'validee', UNIQUE(artist_slug, date) );
INSERT INTO artist_agenda_new (id, artist_slug, date, type, label, created_at, publish_at, expires_at, source_actu_id, status) SELECT id, artist_slug, date, type, label, created_at, publish_at, expires_at, source_actu_id, status FROM artist_agenda;
DROP TABLE artist_agenda;
ALTER TABLE artist_agenda_new RENAME TO artist_agenda;
CREATE INDEX idx_artist_agenda_artist ON artist_agenda(artist_slug);
