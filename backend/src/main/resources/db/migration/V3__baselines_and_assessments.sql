-- Baselines and the assessments scored against them. Every row below a baseline carries its id, so
-- a refit writes new rows beside the old ones, and current_baseline decides which rows readers see.

create table baseline (
    id                   integer          generated always as identity primary key,
    source               text             not null check (source in ('PUBLIC', 'SYNTHETIC')),
    -- sha-256 of the source, the good run keys, the settings below, and the aligner and detector versions
    fingerprint          char(64)         not null unique,
    aligner_version      smallint         not null,
    detector_version     smallint         not null,
    -- the highest run.label_seq of the source when the good runs were chosen
    labels_seq           bigint           not null,
    pool_half_width      smallint         not null,
    relative_sd_floor    double precision not null,
    min_observations     smallint         not null,
    max_distinct_tracked integer          not null,
    limit_k              double precision not null,
    limit_n              smallint         not null,
    run_z                double precision not null,
    fitted_at            timestamptz      not null default now()
);

-- The baseline readers use, one per source. Moving it is a compare-and-set on labels_seq in a single
-- upsert, so a refresh that read older labels never replaces one that read newer labels.
create table current_baseline (
    source      text    primary key check (source in ('PUBLIC', 'SYNTHETIC')),
    baseline_id integer not null references baseline (id),
    labels_seq  bigint  not null
);

create table baseline_good_run (
    baseline_id integer not null references baseline (id) on delete cascade,
    run_id      integer not null references run (id) on delete cascade,
    primary key (baseline_id, run_id)
);

-- Every channel the good runs carried. CONSTANT channels are kept so a run page can say why a channel
-- was not scored.
create table baseline_channel (
    baseline_id integer  not null references baseline (id) on delete cascade,
    channel_id  smallint not null references channel (id),
    role        text     not null check (role in ('INFORMATIVE', 'CONSTANT')),
    good_runs   smallint not null,
    primary key (baseline_id, channel_id)
);

-- The band at each slot that a good run filled. sd is null where the pooled observations fell short,
-- and for CONSTANT channels, so the chart still has a mean there but nothing is scored.
create table band (
    baseline_id integer  not null,
    channel_id  smallint not null,
    slot        smallint not null check (slot between 0 and 3999),
    mean        real     not null,
    sd          real     check (sd > 0),
    primary key (baseline_id, channel_id, slot),
    foreign key (baseline_id, channel_id) references baseline_channel (baseline_id, channel_id) on delete cascade
);

-- How each phase statistic spreads across good runs, for the run-level detector and the lot page.
create table summary_band (
    baseline_id integer          not null,
    channel_id  smallint         not null,
    phase       text             not null check (phase in ('SF6', 'C4F8')),
    stat        text             not null check (stat in ('MEAN', 'SD')),
    mean        double precision not null,
    sd          double precision not null check (sd > 0),
    primary key (baseline_id, channel_id, phase, stat),
    foreign key (baseline_id, channel_id) references baseline_channel (baseline_id, channel_id) on delete cascade
);

-- One row per run scored against a baseline. The first_* columns describe the rank 1 channel when the
-- run is flagged, and its first excursion when it has one.
create table run_assessment (
    baseline_id        integer          not null references baseline (id) on delete cascade,
    run_id             integer          not null references run (id) on delete cascade,
    limit_flags        smallint         not null,
    deviation_flags    smallint         not null,
    -- the largest |z| any channel held for limit_n samples in a row, the run's severity
    max_persistent_z   double precision not null,
    first_channel_id   smallint         references channel (id),
    first_start_slot   smallint,
    first_confirm_slot smallint,
    first_time_s       real,
    primary key (baseline_id, run_id)
);

-- One row per informative channel the run carries, in rank order. A z column is null when the baseline
-- has no band for that statistic.
create table channel_verdict (
    baseline_id       integer          not null,
    run_id            integer          not null,
    channel_id        smallint         not null references channel (id),
    rank              smallint         not null check (rank > 0),
    excursions        smallint         not null,
    persistent_z      double precision not null,
    deviation         boolean          not null,
    max_abs_summary_z double precision not null,
    sf6_mean_z        double precision,
    sf6_sd_z          double precision,
    c4f8_mean_z       double precision,
    c4f8_sd_z         double precision,
    primary key (baseline_id, run_id, channel_id),
    unique (baseline_id, run_id, rank),
    foreign key (baseline_id, run_id) references run_assessment (baseline_id, run_id) on delete cascade
);

create table excursion (
    baseline_id  integer          not null,
    run_id       integer          not null,
    channel_id   smallint         not null,
    start_slot   smallint         not null,
    confirm_slot smallint         not null,
    end_slot     smallint         not null,
    out_samples  smallint         not null,
    peak_z       double precision not null,
    primary key (baseline_id, run_id, channel_id, start_slot),
    foreign key (baseline_id, run_id, channel_id)
        references channel_verdict (baseline_id, run_id, channel_id) on delete cascade
);
