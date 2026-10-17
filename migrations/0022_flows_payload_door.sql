ALTER TABLE flows_payload ADD COLUMN chash TEXT;
ALTER TABLE flows_payload ADD COLUMN session TEXT;
ALTER TABLE flows_payload ADD COLUMN quality INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flows_payload ADD COLUMN epoch INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flows_payload ADD COLUMN asof INTEGER NOT NULL DEFAULT 0;
ALTER TABLE flows_payload ADD COLUMN rev INTEGER NOT NULL DEFAULT 0;

CREATE TRIGGER IF NOT EXISTS flows_payload_manifest_i
AFTER INSERT ON flows_payload
WHEN NEW.chash IS NOT NULL
  AND NEW.id <> 'manifest'
  AND NEW.id NOT GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
BEGIN
  INSERT INTO flows_payload (id, payload, updated_at)
  VALUES ('manifest', json_object(NEW.id, json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch)), NEW.updated_at)
  ON CONFLICT(id) DO UPDATE SET
    payload = json_set(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$."' || NEW.id || '"',
      json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch)),
    updated_at = NEW.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS flows_payload_manifest_u
AFTER UPDATE ON flows_payload
WHEN (NEW.chash IS NOT NULL OR OLD.chash IS NOT NULL)
  AND NEW.id <> 'manifest'
  AND NEW.id NOT GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
BEGIN
  INSERT INTO flows_payload (id, payload, updated_at)
  VALUES ('manifest', json_object(NEW.id, CASE WHEN NEW.chash IS NULL THEN json('null') ELSE json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch) END), NEW.updated_at)
  ON CONFLICT(id) DO UPDATE SET
    payload = json_set(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$."' || NEW.id || '"',
      CASE WHEN NEW.chash IS NULL THEN json('null') ELSE json_array(substr(NEW.chash, 1, 8), NEW.session, NEW.quality, NEW.epoch) END),
    updated_at = NEW.updated_at;
END;

CREATE TRIGGER IF NOT EXISTS flows_payload_manifest_d
AFTER DELETE ON flows_payload
WHEN OLD.id <> 'manifest'
  AND OLD.id NOT GLOB '*[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]*'
BEGIN
  UPDATE flows_payload
  SET payload = json_remove(CASE WHEN json_valid(payload) THEN payload ELSE '{}' END, '$."' || OLD.id || '"')
  WHERE id = 'manifest';
END;
