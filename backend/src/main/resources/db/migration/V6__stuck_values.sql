-- The stuck-value rule: a channel that reports one value for longer than any good run held one has
-- stopped updating. The longest good-run hold is learned per channel with the baseline, the rule's
-- settings are stored with it like the other thresholds, and each passed hold is stored like an
-- excursion. Baselines fitted before this version are refitted by the detector version bump.
-- The simulator gains the matching fault kind, a sensor that repeats its last reading.

alter table injected_fault
    drop constraint injected_fault_kind_check,
    add constraint injected_fault_kind_check check (kind in ('GAS_FLOW_STUCK_LOW', 'PRESSURE_SPIKE',
                                                             'REFLECTED_POWER_RISE', 'SENSOR_DROPOUT',
                                                             'SENSOR_STUCK'));

alter table baseline
    add column stuck_factor      double precision not null default 2.0,
    add column stuck_min_samples smallint         not null default 10;

-- the longest run of one value any good run showed on the channel, in samples
alter table baseline_channel
    add column max_hold smallint not null default 0;

alter table run_assessment
    add column stuck_flags smallint not null default 0;

alter table channel_verdict
    add column holds        smallint not null default 0,
    add column longest_hold smallint not null default 0;

create table hold (
    baseline_id  integer  not null,
    run_id       integer  not null,
    channel_id   smallint not null,
    start_slot   smallint not null,
    confirm_slot smallint not null,
    end_slot     smallint not null,
    samples      smallint not null,
    value        real     not null,
    primary key (baseline_id, run_id, channel_id, start_slot),
    foreign key (baseline_id, run_id, channel_id)
        references channel_verdict (baseline_id, run_id, channel_id) on delete cascade
);
