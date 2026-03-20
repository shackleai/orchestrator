export const name = '037_comment_parent_set_null'

export const sql = `
ALTER TABLE issue_comments
  DROP CONSTRAINT IF EXISTS issue_comments_parent_id_fkey;

ALTER TABLE issue_comments
  ADD CONSTRAINT issue_comments_parent_id_fkey
  FOREIGN KEY (parent_id) REFERENCES issue_comments(id) ON DELETE SET NULL;
`
