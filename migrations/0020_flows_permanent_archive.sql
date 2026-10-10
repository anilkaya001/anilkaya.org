CREATE TRIGGER IF NOT EXISTS flows_permanent_no_update
BEFORE UPDATE ON flows_payload
WHEN OLD.id GLOB 'ideas:[0-9]*'
  OR OLD.id GLOB 'ideas-out:[0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'flows permanent archive rows cannot be changed');
END;

CREATE TRIGGER IF NOT EXISTS flows_permanent_no_delete
BEFORE DELETE ON flows_payload
WHEN OLD.id GLOB 'ideas:[0-9]*'
  OR OLD.id GLOB 'ideas-out:[0-9]*'
BEGIN
  SELECT RAISE(ABORT, 'flows permanent archive rows cannot be removed');
END;
