-- A run streamed in from the chamber simulator as it was etched. It gets a source of its own rather than joining
-- the synthetic runs: the synthetic bands were learned from the Java simulator, and a run from a different
-- generator judged against them would be flagged for being different, not for being faulty. With its own source
-- a live baseline learns from the first clean live wafers, exactly as the other two sources do.

alter table lot
    drop constraint lot_source_check,
    add constraint lot_source_check check (source in ('PUBLIC', 'SYNTHETIC', 'LIVE'));

alter table baseline
    drop constraint baseline_source_check,
    add constraint baseline_source_check check (source in ('PUBLIC', 'SYNTHETIC', 'LIVE'));

alter table current_baseline
    drop constraint current_baseline_source_check,
    add constraint current_baseline_source_check check (source in ('PUBLIC', 'SYNTHETIC', 'LIVE'));
