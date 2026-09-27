-- Migration: create_event_sync_state
-- Issue: #1857 Optimize ledger event sync queries using chunked paging
-- Persists the Horizon paging cursor per event stream so chunked sync can
-- resume exactly where it left off across restarts (no SSE stream state).

CREATE TABLE IF NOT EXISTS event_sync_state (
  stream_key VARCHAR(255) PRIMARY KEY,
  cursor     VARCHAR(255) NOT NULL DEFAULT '',
  updated_at TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMENT ON TABLE event_sync_state IS
  'Checkpoint of the last processed Horizon paging_token per event sync stream (chunked paging, #1857).';
COMMENT ON COLUMN event_sync_state.stream_key IS
  'Stable identifier for the sync stream, e.g. "escrow:<contract_id>" or "archiver:<contract_id>".';
COMMENT ON COLUMN event_sync_state.cursor IS
  'Last processed Horizon paging_token, or "now" when the stream has only followed new events.';
