begin;

alter table public.checklist_permission_grants
  drop constraint if exists checklist_permission_preset_ck;

alter table public.checklist_permission_grants
  add constraint checklist_permission_preset_ck
  check (preset_code in (
    'TRO_LY_GD',
    'TRUONG_BO_PHAN',
    'TRUONG_CA_BH',
    'QUAN_LY_TRUC_TIEP',
    'CHI_XEM_BAO_CAO',
    'TUY_CHINH'
  ));

commit;
