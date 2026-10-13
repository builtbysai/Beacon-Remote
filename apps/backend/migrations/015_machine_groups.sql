-- A computer can belong to one named group, so a person with many computers can find them (one level, set by the owner).
ALTER TABLE machines ADD COLUMN IF NOT EXISTS group_name text CHECK (group_name IS NULL OR length(group_name) BETWEEN 1 AND 40);
