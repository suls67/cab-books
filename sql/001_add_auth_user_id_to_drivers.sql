alter table drivers
add column if not exists auth_user_id uuid;

alter table drivers
add constraint drivers_auth_user_id_unique unique (auth_user_id);

update drivers
set auth_user_id = auth_users.id
from auth.users as auth_users
where lower(auth_users.email) = lower(drivers.email)
  and drivers.auth_user_id is null;

create index if not exists drivers_auth_user_id_idx
on drivers (auth_user_id);
