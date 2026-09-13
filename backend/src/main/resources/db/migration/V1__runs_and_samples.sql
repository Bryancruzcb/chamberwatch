-- Runs, their raw samples, and the reference data they hang off.

create table lot (
    id                   smallint generated always as identity primary key,
    source               text     not null check (source in ('PUBLIC', 'SYNTHETIC')),
    lot_no               smallint not null check (lot_no > 0),
    run_date             date,
    conditioning_count   smallint check (conditioning_count > 0),
    conditioning_surface text     check (conditioning_surface in ('CHUCK', 'SILICON', 'OXIDE')),
    unique (source, lot_no)
);

-- Channel names without the Stat3_Etch_MV_ prefix.
create table channel (
    id   smallint generated always as identity primary key,
    name text not null unique
);

-- One row per verified source file and aligner version. A file is COMPLETE only after every row
-- read from it has committed, so a COMPLETE file is skipped and a STARTED one is resumed.
create table ingest_file (
    md5             char(32)    not null,
    aligner_version smallint    not null,
    file_name       text        not null,
    bytes           bigint      not null,
    status          text        not null check (status in ('STARTED', 'COMPLETE')),
    started_at      timestamptz not null default now(),
    completed_at    timestamptz,
    primary key (md5, aligner_version)
);

-- The recipe grid: 100 cycles of 30 SF6 slots followed by 10 C4F8 slots. RecipeSlotTableTest
-- checks these rows against RecipeGrid.STANDARD, so the two cannot drift apart.
create table recipe_slot (
    slot         smallint primary key,
    cycle        smallint not null,
    phase        text     not null check (phase in ('SF6', 'C4F8')),
    phase_offset smallint not null,
    unique (cycle, phase, phase_offset)
);

insert into recipe_slot (slot, cycle, phase, phase_offset)
select s,
       s / 40 + 1,
       case when s % 40 < 30 then 'SF6' else 'C4F8' end,
       case when s % 40 < 30 then s % 40 else s % 40 - 30 end
from generate_series(0, 3999) as s;

-- One row per wafer run. A run row, its samples and its phase summaries commit in one transaction,
-- so a stored run key always means a whole run. Report columns are null for FAILED runs.
create table run (
    id                integer    generated always as identity primary key,
    run_key           text       not null unique,
    lot_id            smallint   not null references lot (id),
    position_in_lot   smallint   not null check (position_in_lot > 0),
    aligner_version   smallint   not null,
    sample_count      integer    not null,
    alignment_status  text       not null check (alignment_status in ('ALIGNED', 'DEGRADED', 'FAILED')),
    alignment_note    text,
    etch_start_s      real,
    etch_end_s        real,
    cycle1_sf6        boolean,
    c4f8_phases       smallint,
    last_cycle        smallint,
    onsets_detected   smallint,
    onsets_predicted  smallint,
    gap_start_s       real,
    gap_length_s      real,
    gap_inside_etch   boolean,
    pre_etch_samples  integer,
    post_etch_samples integer,
    steady_overflow   integer,
    edge_overflow     integer,
    slot_collisions   integer,
    irregular_cycles  smallint[] not null default '{}',
    label             text       not null default 'AUTO' check (label in ('AUTO', 'GOOD', 'BAD')),
    label_seq         bigint     not null default 0,
    unique (lot_id, position_in_lot)
);

-- Every decoded value: 10,132,286 rows for the public data. slot is null outside the grid: before
-- and after the etch, and for the rare sample that overflowed a phase or lost a slot collision.
-- There are no foreign keys here. RunStore writes a run and its samples in one transaction, and a
-- trigger per row would slow the COPY for no gain.
create table sample (
    run_id     integer  not null,
    channel_id smallint not null,
    sample_idx smallint not null,
    t_s        real     not null,
    value      real     not null,
    slot       smallint check (slot between 0 and 3999),
    primary key (run_id, channel_id, sample_idx)
);

-- A channel's statistics over one phase of a run's steady cycles, written with the run.
create table run_phase_summary (
    run_id     integer          not null references run (id) on delete cascade,
    channel_id smallint         not null references channel (id),
    phase      text             not null check (phase in ('SF6', 'C4F8')),
    n          integer          not null,
    mean       double precision not null,
    sd         double precision not null,
    min        real             not null,
    max        real             not null,
    primary key (run_id, channel_id, phase)
);
