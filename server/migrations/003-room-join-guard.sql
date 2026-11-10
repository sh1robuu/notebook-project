-- Invitation scope can advance the admission counters. Configuration and
-- ownership remain teacher commands even when queries use the runtime role.
CREATE FUNCTION public.classroom_guard_join_revision() RETURNS trigger
  LANGUAGE plpgsql SET search_path = pg_catalog
  AS $$
  BEGIN
    IF public.classroom_scope('actor') = 'invite' THEN
      IF ROW(NEW.id, NEW.owner_id, NEW.title, NEW.mode, NEW.state, NEW.created_at)
           IS DISTINCT FROM
         ROW(OLD.id, OLD.owner_id, OLD.title, OLD.mode, OLD.state, OLD.created_at)
         OR OLD.state <> 'open'
         OR NEW.active_participants <> OLD.active_participants + 1
         OR NEW.next_position <> OLD.next_position + 1
         OR NEW.revision <> OLD.revision + 1
         OR NEW.updated_at <> statement_timestamp()
         OR NOT EXISTS (
           SELECT 1 FROM public.classroom_participants AS member
           JOIN public.classroom_room_invitations AS invitation
             ON invitation.room_id = member.room_id AND invitation.id = member.join_invitation_id
           WHERE member.room_id = OLD.id
             AND member.join_key = public.classroom_scope('join_key')::uuid
             AND member.removed_at IS NULL
             AND member.position = OLD.next_position
             AND invitation.code_hash = public.classroom_scope('invite_hash')
             AND invitation.revoked_at IS NULL
             AND invitation.expires_at > statement_timestamp()
         )
      THEN
        RAISE EXCEPTION 'Invitation scope cannot change room configuration'
          USING ERRCODE = '42501';
      END IF;
    END IF;
    RETURN NEW;
  END
  $$;

REVOKE ALL ON FUNCTION public.classroom_guard_join_revision() FROM PUBLIC;
CREATE TRIGGER classroom_join_revision_guard
  BEFORE UPDATE ON public.classroom_rooms FOR EACH ROW
  EXECUTE FUNCTION public.classroom_guard_join_revision();
