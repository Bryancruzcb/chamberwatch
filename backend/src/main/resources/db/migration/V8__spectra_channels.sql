-- The optical emission lines reduced into the recipe's slots are stored as ordinary channels of the run, in the
-- same sample table, so the bands, the detectors, the trace chart and the drift page take them with no new code.
-- A run records which reduction wrote them: 0 for a run that has none, so a rerun of the same reduction reads
-- nothing, and a new reduction replaces the rows of the channels it writes.

alter table run
    add column spectra_version smallint not null default 0;

comment on column run.spectra_version is
    'the spectra reduction that wrote this run''s emission channels, 0 when it has none';
