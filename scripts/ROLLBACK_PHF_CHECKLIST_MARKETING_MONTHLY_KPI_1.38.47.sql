begin;
drop function if exists public.phf_save_marketing_monthly_kpi(text,text,text,text,jsonb,integer,boolean,text,text,text,text);
drop table if exists public.checklist_monthly_kpi_config_history;
drop table if exists public.checklist_monthly_kpi_configs;
commit;
