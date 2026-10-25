-- Index D1 (26/10/2026) : le quota gratuit de 5 M de lignes lues par jour a été dépassé le 25/10/2026.
-- Les requêtes sur session_id / visitor_id faisaient un scan complet de page_visits.
CREATE INDEX IF NOT EXISTS idx_page_visits_session ON page_visits(session_id);
CREATE INDEX IF NOT EXISTS idx_page_visits_visitor ON page_visits(visitor_id);
CREATE INDEX IF NOT EXISTS idx_page_visits_site_bot_date ON page_visits(site, is_bot, visited_at);
CREATE INDEX IF NOT EXISTS idx_contact_events_session ON contact_events(session_id);
CREATE INDEX IF NOT EXISTS idx_video_events_session ON video_events(session_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_thread ON chat_messages(thread_id, id);
ANALYZE;
