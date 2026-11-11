-- S10 keeps the existing room cursor and adds data scoped by composite room keys.
ALTER TABLE public.classroom_groups ADD COLUMN removed_at timestamptz;

CREATE TABLE public.classroom_tasks (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  instructions text NOT NULL CHECK (char_length(instructions) <= 2000),
  focus_question text NOT NULL CHECK (char_length(focus_question) <= 300),
  common boolean NOT NULL,
  allowed_types text[] NOT NULL CHECK (
    cardinality(allowed_types) BETWEEN 1 AND 2 AND allowed_types <@ ARRAY['image','link']::text[]
  ),
  submission_open boolean NOT NULL,
  timer_state text NOT NULL DEFAULT 'idle' CHECK (timer_state IN ('idle','running','paused','ended')),
  duration_seconds integer NOT NULL CHECK (duration_seconds BETWEEN 0 AND 14400),
  remaining_ms integer NOT NULL CHECK (remaining_ms BETWEEN 0 AND 14400000),
  ends_at timestamptz,
  published_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id,id),
  CHECK ((timer_state = 'running') = (ends_at IS NOT NULL))
);

CREATE TABLE public.classroom_task_groups (
  room_id uuid NOT NULL,
  task_id uuid NOT NULL,
  group_id uuid NOT NULL,
  PRIMARY KEY (room_id,task_id,group_id),
  FOREIGN KEY (room_id,task_id) REFERENCES public.classroom_tasks(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,group_id) REFERENCES public.classroom_groups(room_id,id) ON DELETE CASCADE
);
CREATE INDEX classroom_task_groups_scope ON public.classroom_task_groups(room_id,group_id,task_id);

CREATE TABLE public.classroom_task_private (
  room_id uuid NOT NULL,
  task_id uuid NOT NULL,
  reference_answer text NOT NULL CHECK (char_length(reference_answer) <= 4000),
  private_notes text NOT NULL CHECK (char_length(private_notes) <= 2000),
  PRIMARY KEY (room_id,task_id),
  FOREIGN KEY (room_id,task_id) REFERENCES public.classroom_tasks(room_id,id) ON DELETE CASCADE
);

CREATE TABLE public.classroom_products (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  participant_id uuid NOT NULL,
  group_id uuid,
  group_name text,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  task_id uuid NOT NULL,
  task_revision integer NOT NULL CHECK (task_revision > 0),
  kind text NOT NULL CHECK (kind IN ('images','link')),
  caption text NOT NULL CHECK (char_length(caption) <= 400),
  link text CHECK (char_length(link) <= 2048),
  published boolean NOT NULL DEFAULT false,
  accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  removed_at timestamptz,
  audience uuid[] NOT NULL CHECK (cardinality(audience) BETWEEN 1 AND 100 AND participant_id = ANY(audience)),
  PRIMARY KEY (room_id,id),
  FOREIGN KEY (room_id,participant_id) REFERENCES public.classroom_participants(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,group_id) REFERENCES public.classroom_groups(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,task_id) REFERENCES public.classroom_tasks(room_id,id) ON DELETE CASCADE,
  CHECK ((kind = 'link') = (link IS NOT NULL))
);
CREATE INDEX classroom_products_author ON public.classroom_products(room_id,participant_id,accepted_at DESC);
CREATE INDEX classroom_products_group ON public.classroom_products(room_id,group_id);
CREATE INDEX classroom_products_task ON public.classroom_products(room_id,task_id);
CREATE INDEX classroom_products_gallery ON public.classroom_products(room_id,accepted_at DESC) WHERE published AND removed_at IS NULL;

CREATE TABLE public.classroom_product_feedback (
  room_id uuid NOT NULL,
  id uuid NOT NULL,
  product_id uuid NOT NULL,
  text text NOT NULL CHECK (char_length(text) BETWEEN 1 AND 1500),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id,id),
  FOREIGN KEY (room_id,product_id) REFERENCES public.classroom_products(room_id,id) ON DELETE CASCADE
);
CREATE INDEX classroom_feedback_product ON public.classroom_product_feedback(room_id,product_id,created_at);

CREATE TABLE public.classroom_help_requests (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  participant_id uuid NOT NULL,
  group_id uuid,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  task_id uuid,
  product_id uuid,
  explanation text NOT NULL CHECK (char_length(explanation) <= 400),
  state text NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','acknowledged','resolved','cancelled')),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id,id),
  FOREIGN KEY (room_id,participant_id) REFERENCES public.classroom_participants(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,group_id) REFERENCES public.classroom_groups(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,task_id) REFERENCES public.classroom_tasks(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,product_id) REFERENCES public.classroom_products(room_id,id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX classroom_one_open_help ON public.classroom_help_requests(room_id,participant_id)
  WHERE state IN ('pending','acknowledged');
CREATE INDEX classroom_help_group ON public.classroom_help_requests(room_id,group_id);
CREATE INDEX classroom_help_task ON public.classroom_help_requests(room_id,task_id);
CREATE INDEX classroom_help_product ON public.classroom_help_requests(room_id,product_id);

CREATE TABLE public.classroom_capture_grants (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  lesson_id uuid NOT NULL,
  surface text NOT NULL CHECK (surface IN ('main','scratchpad')),
  page_id text NOT NULL CHECK (char_length(page_id) BETWEEN 6 AND 128),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id,id),
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX classroom_capture_current ON public.classroom_capture_grants(room_id) WHERE revoked_at IS NULL;

CREATE TABLE public.classroom_capture_sessions (
  room_id uuid NOT NULL,
  id uuid NOT NULL,
  grant_id uuid NOT NULL,
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  csrf_token text NOT NULL CHECK (csrf_token ~ '^[A-Za-z0-9_-]{43}$'),
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id,id),
  FOREIGN KEY (room_id,grant_id) REFERENCES public.classroom_capture_grants(room_id,id) ON DELETE CASCADE
);
CREATE INDEX classroom_capture_sessions_grant ON public.classroom_capture_sessions(room_id,grant_id);

CREATE TABLE public.classroom_media (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  owner_kind text NOT NULL CHECK (owner_kind IN ('teacher','participant','capture')),
  owner_id uuid NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('submission','capture')),
  request_id uuid NOT NULL,
  expected_bytes integer NOT NULL CHECK (expected_bytes BETWEEN 1 AND 10000000),
  expected_mime text NOT NULL CHECK (expected_mime IN ('image/png','image/jpeg','image/webp')),
  expected_sha256 text NOT NULL CHECK (expected_sha256 ~ '^[0-9a-f]{64}$'),
  state text NOT NULL CHECK (state IN ('pending','processing','uploaded','finalized','deleting','deleted','rejected')),
  object_key text,
  thumbnail_key text,
  image_bytes integer CHECK (image_bytes > 0),
  thumbnail_bytes integer CHECK (thumbnail_bytes > 0),
  width integer CHECK (width BETWEEN 1 AND 8192),
  height integer CHECK (height BETWEEN 1 AND 8192),
  sha256 text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  process_token uuid,
  attached_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (room_id,id),
  UNIQUE (room_id,owner_kind,owner_id,request_id),
  CHECK (attached_at IS NULL OR state = 'finalized'),
  CHECK (state NOT IN ('uploaded','finalized') OR
    (object_key IS NOT NULL AND thumbnail_key IS NOT NULL AND image_bytes IS NOT NULL
      AND thumbnail_bytes IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND sha256 IS NOT NULL))
);
CREATE INDEX classroom_media_owner ON public.classroom_media(room_id,owner_kind,owner_id,state);
CREATE INDEX classroom_media_expiry ON public.classroom_media(room_id,state,expires_at) WHERE attached_at IS NULL;

CREATE TABLE public.classroom_product_media (
  room_id uuid NOT NULL,
  product_id uuid NOT NULL,
  media_id uuid NOT NULL,
  position integer NOT NULL CHECK (position BETWEEN 1 AND 4),
  PRIMARY KEY (room_id,product_id,position),
  UNIQUE (room_id,media_id),
  FOREIGN KEY (room_id,product_id) REFERENCES public.classroom_products(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,media_id) REFERENCES public.classroom_media(room_id,id)
);

CREATE TABLE public.classroom_captures (
  room_id uuid NOT NULL,
  id uuid NOT NULL,
  grant_id uuid NOT NULL,
  session_id uuid NOT NULL,
  media_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id,id),
  UNIQUE (room_id,media_id),
  FOREIGN KEY (room_id,grant_id) REFERENCES public.classroom_capture_grants(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,session_id) REFERENCES public.classroom_capture_sessions(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,media_id) REFERENCES public.classroom_media(room_id,id)
);
CREATE INDEX classroom_captures_grant ON public.classroom_captures(room_id,grant_id);
CREATE INDEX classroom_captures_session ON public.classroom_captures(room_id,session_id);

CREATE TABLE public.classroom_board_insertions (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id) ON DELETE CASCADE,
  id uuid NOT NULL,
  product_id uuid,
  capture_id uuid,
  media_id uuid NOT NULL,
  lesson_id uuid NOT NULL,
  surface text NOT NULL CHECK (surface IN ('main','scratchpad')),
  page_id text NOT NULL CHECK (char_length(page_id) BETWEEN 6 AND 128),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  saved_at timestamptz,
  local_revision integer CHECK (local_revision >= 0),
  PRIMARY KEY (room_id,id),
  FOREIGN KEY (room_id,product_id) REFERENCES public.classroom_products(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,capture_id) REFERENCES public.classroom_captures(room_id,id) ON DELETE CASCADE,
  FOREIGN KEY (room_id,media_id) REFERENCES public.classroom_media(room_id,id),
  CHECK (num_nonnulls(product_id,capture_id) = 1),
  CHECK ((saved_at IS NULL) = (local_revision IS NULL))
);
CREATE INDEX classroom_insertion_product ON public.classroom_board_insertions(room_id,product_id);
CREATE INDEX classroom_insertion_capture ON public.classroom_board_insertions(room_id,capture_id);
CREATE INDEX classroom_insertion_media ON public.classroom_board_insertions(room_id,media_id);
CREATE UNIQUE INDEX classroom_capture_insert_once
  ON public.classroom_board_insertions(room_id,capture_id) WHERE capture_id IS NOT NULL;

CREATE TABLE public.classroom_participation_receipts (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id) ON DELETE CASCADE,
  actor_kind text NOT NULL CHECK (actor_kind IN ('teacher','participant','capture')),
  actor_id uuid NOT NULL,
  key uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL CHECK (revision > 0),
  resource_id uuid NOT NULL,
  accepted_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id,actor_kind,actor_id,key)
);

-- The application role has explicit per-row policies. The migration role owns
-- narrow definer functions that lock a room or append a revision after auth.
DO $$
DECLARE relation text;
BEGIN
  FOREACH relation IN ARRAY ARRAY[
    'tasks','task_groups','task_private','products','product_feedback','help_requests',
    'capture_grants','capture_sessions','media','product_media','captures','board_insertions','participation_receipts'
  ] LOOP
    EXECUTE format('ALTER TABLE public.classroom_%I ENABLE ROW LEVEL SECURITY', relation);
    EXECUTE format('ALTER TABLE public.classroom_%I FORCE ROW LEVEL SECURITY', relation);
    EXECUTE format('CREATE POLICY classroom_s10_teacher ON public.classroom_%I FOR ALL TO lessonboard_app
      USING (public.classroom_teacher_owns(room_id)) WITH CHECK (public.classroom_teacher_owns(room_id))', relation);
    EXECUTE format('CREATE POLICY classroom_s10_owner ON public.classroom_%I FOR ALL TO %I USING (true) WITH CHECK (true)',
      relation,current_user);
  END LOOP;
END
$$;
CREATE POLICY classroom_s10_owner_rooms ON public.classroom_rooms FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY classroom_s10_owner_events ON public.classroom_room_events FOR ALL TO CURRENT_USER USING (true) WITH CHECK (true);
CREATE POLICY classroom_s10_owner_members ON public.classroom_participants FOR SELECT TO CURRENT_USER USING (true);

CREATE FUNCTION public.classroom_s10_participant(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$
    SELECT public.classroom_scope('actor') = 'participant'
       AND target = public.classroom_scope('room_id')::uuid
       AND EXISTS (SELECT 1 FROM public.classroom_participants p
         WHERE p.room_id = target AND p.id = public.classroom_scope('actor_id')::uuid AND p.removed_at IS NULL)
  $$;

CREATE FUNCTION public.classroom_s10_capture(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$
    SELECT public.classroom_scope('actor') = 'capture'
       AND target = public.classroom_scope('room_id')::uuid
       AND EXISTS (
         SELECT 1 FROM public.classroom_capture_sessions s
         JOIN public.classroom_capture_grants g ON g.room_id=s.room_id AND g.id=s.grant_id
         WHERE s.room_id=target AND s.id=public.classroom_scope('actor_id')::uuid
           AND g.id=public.classroom_scope('capture_grant_id')::uuid
           AND s.expires_at > statement_timestamp()
           AND g.expires_at > statement_timestamp() AND g.revoked_at IS NULL
       )
  $$;

CREATE FUNCTION public.classroom_s10_lock_room(target uuid)
  RETURNS TABLE(state text,revision integer)
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
  AS $$
  BEGIN
    IF NOT coalesce(
      (public.classroom_scope('actor') = 'teacher' AND EXISTS (
         SELECT 1 FROM public.classroom_rooms WHERE id=target AND owner_id=public.classroom_scope('actor_id')::uuid
       ))
      OR public.classroom_s10_participant(target)
      OR public.classroom_s10_capture(target), false)
    THEN RAISE EXCEPTION 'Room unavailable' USING ERRCODE='42501'; END IF;
    RETURN QUERY SELECT r.state,r.revision FROM public.classroom_rooms r WHERE r.id=target FOR UPDATE;
  END
  $$;

CREATE FUNCTION public.classroom_s10_append_change(target uuid, receipt_key uuid) RETURNS integer
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
  AS $$
  DECLARE next_revision integer;
  BEGIN
    SELECT lock.revision+1 INTO next_revision FROM public.classroom_s10_lock_room(target) lock;
    IF NOT EXISTS (
      SELECT 1 FROM public.classroom_participation_receipts r
      WHERE r.room_id=target AND r.actor_kind=public.classroom_scope('actor')
        AND r.actor_id=public.classroom_scope('actor_id')::uuid AND r.key=receipt_key
        AND r.revision=next_revision
    ) THEN RAISE EXCEPTION 'Missing matching participation receipt' USING ERRCODE='42501'; END IF;
    UPDATE public.classroom_rooms SET revision=next_revision,updated_at=statement_timestamp() WHERE id=target;
    INSERT INTO public.classroom_room_events(room_id,revision) VALUES(target,next_revision);
    RETURN next_revision;
  END
  $$;

CREATE FUNCTION public.classroom_s10_audience(target uuid, group_key uuid) RETURNS uuid[]
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$
    SELECT coalesce(array_agg(p.id ORDER BY p.id),ARRAY[]::uuid[])
    FROM public.classroom_participants p
    WHERE public.classroom_s10_participant(target)
      AND p.room_id=target AND p.removed_at IS NULL
      AND (p.id=public.classroom_scope('actor_id')::uuid OR (group_key IS NOT NULL AND p.group_id=group_key))
      AND (group_key IS NULL OR EXISTS (
        SELECT 1 FROM public.classroom_participants self WHERE self.room_id=target
          AND self.id=public.classroom_scope('actor_id')::uuid AND self.group_id=group_key
      ))
  $$;

CREATE FUNCTION public.classroom_s10_media_usage(target uuid)
  RETURNS TABLE(objects integer, reserved_bytes bigint)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$
    SELECT count(*)::integer, coalesce(sum(greatest(expected_bytes,coalesce(image_bytes,0)+coalesce(thumbnail_bytes,0))),0)
    FROM public.classroom_media
    WHERE room_id=target AND state NOT IN ('deleted','rejected')
      AND target=public.classroom_scope('room_id')::uuid
      AND (
        (public.classroom_scope('actor')='teacher' AND EXISTS (
          SELECT 1 FROM public.classroom_rooms WHERE id=target AND owner_id=public.classroom_scope('actor_id')::uuid
        )) OR public.classroom_s10_participant(target) OR public.classroom_s10_capture(target)
      )
  $$;

REVOKE ALL ON FUNCTION public.classroom_s10_participant(uuid), public.classroom_s10_capture(uuid),
  public.classroom_s10_lock_room(uuid), public.classroom_s10_append_change(uuid,uuid),
  public.classroom_s10_audience(uuid,uuid), public.classroom_s10_media_usage(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_s10_participant(uuid), public.classroom_s10_capture(uuid),
  public.classroom_s10_lock_room(uuid), public.classroom_s10_append_change(uuid,uuid),
  public.classroom_s10_audience(uuid,uuid), public.classroom_s10_media_usage(uuid) TO lessonboard_app;

CREATE POLICY classroom_s10_tasks_participant ON public.classroom_tasks FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_participant(room_id) AND (common OR EXISTS (
    SELECT 1 FROM public.classroom_task_groups g WHERE g.room_id=classroom_tasks.room_id AND g.task_id=classroom_tasks.id
  )));
CREATE POLICY classroom_s10_task_groups_participant ON public.classroom_task_groups FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_participant(room_id) AND EXISTS (
    SELECT 1 FROM public.classroom_participants p WHERE p.room_id=classroom_task_groups.room_id
      AND p.id=public.classroom_scope('actor_id')::uuid AND p.group_id=classroom_task_groups.group_id
      AND p.removed_at IS NULL
  ));
CREATE POLICY classroom_s10_products_participant ON public.classroom_products FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_participant(room_id) AND (
    public.classroom_scope('actor_id')::uuid = ANY(audience) OR (published AND removed_at IS NULL)
  ));
CREATE POLICY classroom_s10_products_submit ON public.classroom_products FOR INSERT TO lessonboard_app
  WITH CHECK (public.classroom_s10_participant(room_id)
    AND participant_id=public.classroom_scope('actor_id')::uuid AND NOT published AND removed_at IS NULL
    AND audience=public.classroom_s10_audience(room_id,group_id)
    AND EXISTS (SELECT 1 FROM public.classroom_tasks t WHERE t.room_id=classroom_products.room_id
      AND t.id=classroom_products.task_id AND t.revision=classroom_products.task_revision AND t.submission_open));
CREATE POLICY classroom_s10_feedback_participant ON public.classroom_product_feedback FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_participant(room_id) AND EXISTS (
    SELECT 1 FROM public.classroom_products p WHERE p.room_id=classroom_product_feedback.room_id
      AND p.id=classroom_product_feedback.product_id AND p.removed_at IS NULL
      AND public.classroom_scope('actor_id')::uuid=ANY(p.audience)
  ));
CREATE POLICY classroom_s10_help_self ON public.classroom_help_requests FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_participant(room_id) AND participant_id=public.classroom_scope('actor_id')::uuid);
CREATE POLICY classroom_s10_help_create ON public.classroom_help_requests FOR INSERT TO lessonboard_app
  WITH CHECK (public.classroom_s10_participant(room_id)
    AND participant_id=public.classroom_scope('actor_id')::uuid AND state='pending');
CREATE POLICY classroom_s10_help_cancel ON public.classroom_help_requests FOR UPDATE TO lessonboard_app
  USING (public.classroom_s10_participant(room_id)
    AND participant_id=public.classroom_scope('actor_id')::uuid AND state='pending')
  WITH CHECK (public.classroom_s10_participant(room_id)
    AND participant_id=public.classroom_scope('actor_id')::uuid AND state='cancelled');

CREATE POLICY classroom_s10_grant_redeem ON public.classroom_capture_grants FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor')='capture-redeem' AND code_hash=public.classroom_scope('capture_hash'));
CREATE POLICY classroom_s10_grant_use ON public.classroom_capture_grants FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_capture(room_id) AND id=public.classroom_scope('capture_grant_id')::uuid);
CREATE POLICY classroom_s10_session_lookup ON public.classroom_capture_sessions FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor')='capture-session' AND token_hash=public.classroom_scope('capture_hash'));
CREATE POLICY classroom_s10_session_create ON public.classroom_capture_sessions FOR INSERT TO lessonboard_app
  WITH CHECK (public.classroom_scope('actor')='capture-redeem' AND EXISTS (
    SELECT 1 FROM public.classroom_capture_grants g
    WHERE g.room_id=classroom_capture_sessions.room_id AND g.id=classroom_capture_sessions.grant_id
      AND g.code_hash=public.classroom_scope('capture_hash') AND g.revoked_at IS NULL
      AND g.expires_at > statement_timestamp() AND classroom_capture_sessions.expires_at <= g.expires_at
  ));

CREATE POLICY classroom_s10_media_own ON public.classroom_media FOR ALL TO lessonboard_app
  USING (owner_kind=public.classroom_scope('actor') AND owner_id=public.classroom_scope('actor_id')::uuid
    AND (public.classroom_s10_participant(room_id) OR public.classroom_s10_capture(room_id)))
  WITH CHECK (owner_kind=public.classroom_scope('actor') AND owner_id=public.classroom_scope('actor_id')::uuid
    AND ((purpose='submission' AND public.classroom_s10_participant(room_id))
      OR (purpose='capture' AND public.classroom_s10_capture(room_id))));
CREATE POLICY classroom_s10_media_products ON public.classroom_media FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_participant(room_id) AND attached_at IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.classroom_product_media m WHERE m.room_id=classroom_media.room_id AND m.media_id=classroom_media.id
  ));
CREATE POLICY classroom_s10_product_media_read ON public.classroom_product_media FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_participant(room_id) AND EXISTS (
    SELECT 1 FROM public.classroom_products p WHERE p.room_id=classroom_product_media.room_id
      AND p.id=classroom_product_media.product_id AND p.removed_at IS NULL
  ));
CREATE POLICY classroom_s10_product_media_attach ON public.classroom_product_media FOR INSERT TO lessonboard_app
  WITH CHECK (public.classroom_s10_participant(room_id) AND EXISTS (
    SELECT 1 FROM public.classroom_products p WHERE p.room_id=classroom_product_media.room_id
      AND p.id=classroom_product_media.product_id AND p.participant_id=public.classroom_scope('actor_id')::uuid
      AND p.removed_at IS NULL
  ) AND EXISTS (
    SELECT 1 FROM public.classroom_media m WHERE m.room_id=classroom_product_media.room_id
      AND m.id=classroom_product_media.media_id AND m.owner_id=public.classroom_scope('actor_id')::uuid
      AND m.owner_kind='participant' AND m.purpose='submission' AND m.state='finalized' AND m.attached_at IS NULL
  ));
CREATE POLICY classroom_s10_capture_own ON public.classroom_captures FOR SELECT TO lessonboard_app
  USING (public.classroom_s10_capture(room_id) AND session_id=public.classroom_scope('actor_id')::uuid);
CREATE POLICY classroom_s10_capture_accept ON public.classroom_captures FOR INSERT TO lessonboard_app
  WITH CHECK (public.classroom_s10_capture(room_id)
    AND session_id=public.classroom_scope('actor_id')::uuid AND grant_id=public.classroom_scope('capture_grant_id')::uuid
    AND EXISTS (
      SELECT 1 FROM public.classroom_media m WHERE m.room_id=classroom_captures.room_id
        AND m.id=classroom_captures.media_id AND m.owner_id=public.classroom_scope('actor_id')::uuid
        AND m.owner_kind='capture' AND m.purpose='capture' AND m.state='finalized' AND m.attached_at IS NULL
    ));
CREATE POLICY classroom_s10_receipts_actor ON public.classroom_participation_receipts FOR ALL TO lessonboard_app
  USING (actor_kind=public.classroom_scope('actor') AND actor_id=public.classroom_scope('actor_id')::uuid
    AND (public.classroom_s10_participant(room_id) OR public.classroom_s10_capture(room_id)))
  WITH CHECK (actor_kind=public.classroom_scope('actor') AND actor_id=public.classroom_scope('actor_id')::uuid
    AND (public.classroom_s10_participant(room_id) OR public.classroom_s10_capture(room_id)));

-- A participant may cancel only their pending request. Shared runtime column
-- grants also serve the teacher, so guard any participant UPDATE at the row.
CREATE FUNCTION public.classroom_s10_guard_help() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
  AS $$
  BEGIN
    IF public.classroom_scope('actor')='participant' AND (
      ROW(NEW.room_id,NEW.id,NEW.participant_id,NEW.group_id,NEW.display_name,NEW.task_id,NEW.product_id,NEW.explanation,NEW.created_at)
       IS DISTINCT FROM
      ROW(OLD.room_id,OLD.id,OLD.participant_id,OLD.group_id,OLD.display_name,OLD.task_id,OLD.product_id,OLD.explanation,OLD.created_at)
      OR OLD.state <> 'pending' OR NEW.state <> 'cancelled'
    ) THEN RAISE EXCEPTION 'Participant may cancel only their pending help request' USING ERRCODE='42501'; END IF;
    RETURN NEW;
  END
  $$;
REVOKE ALL ON FUNCTION public.classroom_s10_guard_help() FROM PUBLIC;
CREATE TRIGGER classroom_s10_help_guard BEFORE UPDATE ON public.classroom_help_requests
  FOR EACH ROW EXECUTE FUNCTION public.classroom_s10_guard_help();

GRANT UPDATE (removed_at) ON public.classroom_groups TO lessonboard_app;
GRANT SELECT,INSERT ON public.classroom_tasks,public.classroom_task_private,public.classroom_products,
  public.classroom_product_feedback,public.classroom_help_requests,public.classroom_capture_grants,
  public.classroom_capture_sessions,public.classroom_media,public.classroom_product_media,
  public.classroom_captures,public.classroom_board_insertions,public.classroom_participation_receipts TO lessonboard_app;
GRANT SELECT,INSERT,DELETE ON public.classroom_task_groups TO lessonboard_app;
GRANT UPDATE (revision,title,instructions,focus_question,common,allowed_types,submission_open,timer_state,
  duration_seconds,remaining_ms,ends_at,updated_at) ON public.classroom_tasks TO lessonboard_app;
GRANT UPDATE (reference_answer,private_notes) ON public.classroom_task_private TO lessonboard_app;
GRANT UPDATE (published,removed_at) ON public.classroom_products TO lessonboard_app;
GRANT UPDATE (state,updated_at) ON public.classroom_help_requests TO lessonboard_app;
GRANT UPDATE (revoked_at) ON public.classroom_capture_grants TO lessonboard_app;
GRANT UPDATE (state,object_key,thumbnail_key,image_bytes,thumbnail_bytes,width,height,sha256,
  process_token,attached_at,updated_at,expires_at) ON public.classroom_media TO lessonboard_app;
GRANT UPDATE (saved_at,local_revision) ON public.classroom_board_insertions TO lessonboard_app;
