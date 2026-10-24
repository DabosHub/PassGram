-- A community stays unpublished until RegisterCommunity's owner signature is stored.
-- Existing rows were saved before that signature, so they leave the owner list.

alter table creator_communities
  add column if not exists registration_signature_hash text;

update creator_communities
set active = false
where registration_signature_hash is null;
