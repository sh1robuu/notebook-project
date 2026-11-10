CREATE TABLE public.classroom_rooms (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES public.classroom_users(id),
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  mode text NOT NULL CHECK (mode IN ('individual', 'group')),
  state text NOT NULL DEFAULT 'draft' CHECK (state IN ('draft', 'open', 'locked', 'ended', 'archived')),
  revision integer NOT NULL DEFAULT 1 CHECK (revision > 0),
  active_participants integer NOT NULL DEFAULT 0 CHECK (active_participants BETWEEN 0 AND 100),
  next_position integer NOT NULL DEFAULT 1 CHECK (next_position > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  UNIQUE (id, owner_id)
);

CREATE INDEX classroom_rooms_owner_recent ON public.classroom_rooms (owner_id, updated_at DESC, id);

CREATE TABLE public.classroom_groups (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id),
  id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 64),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id, id)
);

CREATE TABLE public.classroom_room_invitations (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id),
  id uuid NOT NULL,
  code_hash text NOT NULL UNIQUE CHECK (code_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id, id),
  CHECK (expires_at > created_at)
);

CREATE UNIQUE INDEX classroom_one_unrevoked_invitation
  ON public.classroom_room_invitations (room_id) WHERE revoked_at IS NULL;

CREATE TABLE public.classroom_participants (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id),
  id uuid NOT NULL,
  display_name text NOT NULL CHECK (char_length(display_name) BETWEEN 1 AND 80),
  group_id uuid,
  position integer NOT NULL CHECK (position > 0),
  joined_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  removed_at timestamptz,
  join_key uuid NOT NULL,
  join_invitation_id uuid NOT NULL,
  join_request_hash text NOT NULL CHECK (join_request_hash ~ '^[0-9a-f]{64}$'),
  PRIMARY KEY (room_id, id),
  UNIQUE (room_id, join_key),
  FOREIGN KEY (room_id, group_id) REFERENCES public.classroom_groups(room_id, id),
  FOREIGN KEY (room_id, join_invitation_id) REFERENCES public.classroom_room_invitations(room_id, id)
);

CREATE INDEX classroom_active_roster ON public.classroom_participants (room_id, position, id) WHERE removed_at IS NULL;
CREATE INDEX classroom_participants_group ON public.classroom_participants (room_id, group_id);
CREATE INDEX classroom_participants_invitation ON public.classroom_participants (room_id, join_invitation_id);

ALTER TABLE public.classroom_participant_sessions
  ADD CONSTRAINT classroom_participant_scope_fk
  FOREIGN KEY (room_id, participant_id) REFERENCES public.classroom_participants(room_id, id);

CREATE TABLE public.classroom_room_events (
  room_id uuid NOT NULL REFERENCES public.classroom_rooms(id),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (room_id, revision)
);

CREATE TABLE public.classroom_room_command_receipts (
  owner_id uuid NOT NULL,
  key uuid NOT NULL,
  room_id uuid NOT NULL,
  request_hash text NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  revision integer NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT statement_timestamp(),
  PRIMARY KEY (owner_id, key),
  FOREIGN KEY (room_id, owner_id) REFERENCES public.classroom_rooms(id, owner_id)
);

CREATE INDEX classroom_room_receipts_scope ON public.classroom_room_command_receipts (room_id, owner_id);

-- These helpers read context set by authenticated server code inside the current
-- transaction. They use invoker permissions and never grant access to hidden rows.
CREATE FUNCTION public.classroom_scope(name text) RETURNS text
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$ SELECT nullif(current_setting('classroom.' || name, true), '') $$;

CREATE FUNCTION public.classroom_teacher_owns(target uuid) RETURNS boolean
  LANGUAGE sql STABLE SET search_path = pg_catalog
  AS $$
    SELECT public.classroom_scope('actor') = 'teacher' AND EXISTS (
      SELECT 1 FROM public.classroom_rooms WHERE id = target
        AND owner_id = public.classroom_scope('actor_id')::uuid
    )
  $$;

REVOKE ALL ON FUNCTION public.classroom_scope(text), public.classroom_teacher_owns(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.classroom_scope(text), public.classroom_teacher_owns(uuid) TO lessonboard_app;

ALTER TABLE public.classroom_rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_rooms FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_room_teacher ON public.classroom_rooms FOR ALL TO lessonboard_app
  USING (public.classroom_scope('actor') = 'teacher' AND owner_id = public.classroom_scope('actor_id')::uuid)
  WITH CHECK (public.classroom_scope('actor') = 'teacher' AND owner_id = public.classroom_scope('actor_id')::uuid);
CREATE POLICY classroom_room_scoped_read ON public.classroom_rooms FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor') IN ('participant', 'invite')
    AND id = public.classroom_scope('room_id')::uuid);
CREATE POLICY classroom_room_join_revision ON public.classroom_rooms FOR UPDATE TO lessonboard_app
  USING (public.classroom_scope('actor') = 'invite' AND id = public.classroom_scope('room_id')::uuid)
  WITH CHECK (public.classroom_scope('actor') = 'invite' AND id = public.classroom_scope('room_id')::uuid);

ALTER TABLE public.classroom_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_groups FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_groups_teacher ON public.classroom_groups FOR ALL TO lessonboard_app
  USING (public.classroom_teacher_owns(room_id)) WITH CHECK (public.classroom_teacher_owns(room_id));
CREATE POLICY classroom_groups_own_membership ON public.classroom_groups FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor') = 'participant' AND room_id = public.classroom_scope('room_id')::uuid
    AND EXISTS (SELECT 1 FROM public.classroom_participants AS member
      WHERE member.room_id = classroom_groups.room_id AND member.group_id = classroom_groups.id
        AND member.id = public.classroom_scope('actor_id')::uuid AND member.removed_at IS NULL));

ALTER TABLE public.classroom_room_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_room_invitations FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_invitations_teacher ON public.classroom_room_invitations FOR ALL TO lessonboard_app
  USING (public.classroom_teacher_owns(room_id)) WITH CHECK (public.classroom_teacher_owns(room_id));
CREATE POLICY classroom_invitation_redeem ON public.classroom_room_invitations FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor') = 'invite' AND code_hash = public.classroom_scope('invite_hash'));

ALTER TABLE public.classroom_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_participants FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_roster_teacher ON public.classroom_participants FOR ALL TO lessonboard_app
  USING (public.classroom_teacher_owns(room_id)) WITH CHECK (public.classroom_teacher_owns(room_id));
CREATE POLICY classroom_participant_read ON public.classroom_participants FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor') = 'participant' AND room_id = public.classroom_scope('room_id')::uuid
    AND id = public.classroom_scope('actor_id')::uuid AND removed_at IS NULL);
CREATE POLICY classroom_join_retry ON public.classroom_participants FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor') = 'invite' AND room_id = public.classroom_scope('room_id')::uuid
    AND join_key = public.classroom_scope('join_key')::uuid);
CREATE POLICY classroom_join_insert ON public.classroom_participants FOR INSERT TO lessonboard_app
  WITH CHECK (public.classroom_scope('actor') = 'invite' AND room_id = public.classroom_scope('room_id')::uuid
    AND join_key = public.classroom_scope('join_key')::uuid
    AND group_id IS NULL AND removed_at IS NULL
    AND EXISTS (SELECT 1 FROM public.classroom_room_invitations AS invite
      WHERE invite.room_id = classroom_participants.room_id AND invite.id = classroom_participants.join_invitation_id
        AND invite.revoked_at IS NULL AND invite.expires_at > statement_timestamp()));

ALTER TABLE public.classroom_room_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_room_events FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_events_teacher ON public.classroom_room_events FOR ALL TO lessonboard_app
  USING (public.classroom_teacher_owns(room_id)) WITH CHECK (public.classroom_teacher_owns(room_id));
CREATE POLICY classroom_events_participant ON public.classroom_room_events FOR SELECT TO lessonboard_app
  USING (public.classroom_scope('actor') = 'participant' AND room_id = public.classroom_scope('room_id')::uuid
    AND EXISTS (SELECT 1 FROM public.classroom_participants AS member
      WHERE member.room_id = classroom_room_events.room_id
        AND member.id = public.classroom_scope('actor_id')::uuid AND member.removed_at IS NULL));
CREATE POLICY classroom_events_join ON public.classroom_room_events FOR INSERT TO lessonboard_app
  WITH CHECK (public.classroom_scope('actor') = 'invite' AND room_id = public.classroom_scope('room_id')::uuid);

ALTER TABLE public.classroom_room_command_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classroom_room_command_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY classroom_receipts_teacher ON public.classroom_room_command_receipts FOR ALL TO lessonboard_app
  USING (public.classroom_scope('actor') = 'teacher' AND owner_id = public.classroom_scope('actor_id')::uuid)
  WITH CHECK (public.classroom_scope('actor') = 'teacher' AND owner_id = public.classroom_scope('actor_id')::uuid);

GRANT SELECT, INSERT ON public.classroom_rooms TO lessonboard_app;
GRANT UPDATE (title, mode, state, revision, active_participants, next_position, updated_at)
  ON public.classroom_rooms TO lessonboard_app;
GRANT SELECT, INSERT, DELETE ON public.classroom_groups TO lessonboard_app;
GRANT UPDATE (name) ON public.classroom_groups TO lessonboard_app;
GRANT SELECT, INSERT ON public.classroom_room_invitations TO lessonboard_app;
GRANT UPDATE (revoked_at) ON public.classroom_room_invitations TO lessonboard_app;
GRANT SELECT, INSERT ON public.classroom_participants TO lessonboard_app;
GRANT UPDATE (display_name, group_id, position, removed_at) ON public.classroom_participants TO lessonboard_app;
GRANT SELECT, INSERT ON public.classroom_room_events, public.classroom_room_command_receipts TO lessonboard_app;
