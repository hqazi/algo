-- T42 (SPEC §15.1): "written by the tutor" is kept per article, not by
-- folder, so an article the tutor wrote stays labelled when it is moved into
-- a library folder, and (T43) the tutor can save into one. Set only by the
-- app (its own folder, or a file it wrote), never from a note's frontmatter.
ALTER TABLE articles ADD COLUMN generated INTEGER NOT NULL DEFAULT 0
  CHECK (generated IN (0, 1));

UPDATE articles SET generated = 1 WHERE folder_id = 'generated';
