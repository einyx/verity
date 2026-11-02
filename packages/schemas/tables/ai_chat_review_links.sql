/* init_order = 7 */

/** No copied bodies: action audit rows remain the source of validated review data. */
create table ai_chat_review_links (
  id varchar(21) not null primary key,
  tenant_id varchar(21) not null references tenants (id) on delete cascade,
  user_id varchar(21) not null,
  session_id varchar(21),
  message_id varchar(21),
  turn_id varchar(21),
  original_action_id varchar(21) not null,
  current_action_id varchar(21) not null,
  previous_action_ids text[] not null default '{}',
  deleted_session_at timestamptz,
  check ((session_id is not null and deleted_session_at is null) or
    (session_id is null and message_id is null and turn_id is null and deleted_session_at is not null)),
  unique (tenant_id, user_id, original_action_id),
  foreign key (tenant_id, user_id, session_id) references ai_chat_sessions (tenant_id, user_id, id) on delete no action,
  foreign key (tenant_id, user_id, session_id, message_id) references ai_chat_messages (tenant_id, user_id, session_id, id) on delete no action,
  foreign key (tenant_id, user_id, session_id, turn_id) references ai_chat_turns (tenant_id, user_id, session_id, id) on delete no action,
  foreign key (tenant_id, user_id, original_action_id) references ai_pending_actions (tenant_id, user_id, id),
  foreign key (tenant_id, user_id, current_action_id) references ai_pending_actions (tenant_id, user_id, id)
);

create index ai_chat_review_links__message on ai_chat_review_links (tenant_id, user_id, session_id, message_id);
create index ai_chat_review_links__current_action on ai_chat_review_links (tenant_id, user_id, current_action_id);

-- PostgreSQL 14 cannot SET NULL only selected composite-key columns. Clear references before
-- session cascades instead; direct deletion of a referenced message/turn remains prohibited.
create function tombstone_ai_chat_reviews() returns trigger as
$$ begin
  update ai_chat_review_links set session_id = null, message_id = null, turn_id = null,
    deleted_session_at = now()
    where tenant_id = old.tenant_id and user_id = old.user_id and session_id = old.id;
  return old;
end; $$ language plpgsql;

create trigger tombstone_ai_chat_reviews before delete on ai_chat_sessions
  for each row execute procedure tombstone_ai_chat_reviews();
