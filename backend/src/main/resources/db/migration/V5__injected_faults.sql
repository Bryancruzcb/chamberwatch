-- The truth behind a synthetic run: the fault the simulator injected, which the aligner and the
-- detectors never see. One row per faulted run, written by simulate-lot beside the run, so a run
-- page can put what was injected next to what was caught. Public runs have no row.
create table injected_fault (
    run_id     integer          primary key references run (id) on delete cascade,
    kind       text             not null check (kind in ('GAS_FLOW_STUCK_LOW', 'PRESSURE_SPIKE',
                                                         'REFLECTED_POWER_RISE', 'SENSOR_DROPOUT')),
    channel_id smallint         not null references channel (id),
    -- seconds after the run's first sample, like sample.t_s
    start_s    real             not null,
    end_s      real             not null check (end_s >= start_s),
    -- the plan's duration, which for a reflected power rise is the ramp; null for a fault that lasted to the end of the etch
    duration_s real             check (duration_s > 0),
    magnitude  double precision not null
);
