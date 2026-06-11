-- Migration 024: Recording status back-channel + abort command
--
-- Two additions to the office recording flow (migration 023):
--
-- 1. recording_status — a single-row slot the office agent WRITES and the
--    app READS, the mirror image of recording_command (app writes, agent
--    reads). It lets the app find out whether capture actually started: the
--    agent reports 'recording' once ffmpeg is confirmed alive, 'failed' if it
--    died on launch, and 'stopped'/'aborted' when capture ends. The app polls
--    it during the live step and shows an error dialog on 'failed' (or on its
--    own timeout, when the agent is offline and never reports). Keyed by the
--    same provisional recording_id the app generates on kickoff.
--
-- 2. recording_command.action gains 'abort' — the app sends it when the user
--    backs out of the live step (or dismisses the recording-error dialog).
--    The agent stops ffmpeg and DELETES the file (vs. 'stop', which keeps it
--    for the highlight pipeline).

ALTER TABLE recording_command DROP CONSTRAINT IF EXISTS recording_command_action_check;
ALTER TABLE recording_command ADD CONSTRAINT recording_command_action_check
	CHECK (action IN ('start', 'stop', 'abort'));

CREATE TABLE IF NOT EXISTS recording_status (
	id SMALLINT PRIMARY KEY DEFAULT 1 CHECK (id = 1),
	recording_id TEXT NOT NULL,
	status TEXT NOT NULL CHECK (status IN ('recording', 'failed', 'stopped', 'aborted')),
	updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
