-- Wafer measurements from both CSV files, raw columns kept. Depth has one formula for both files:
-- a step height taken with the mask still in place spans the remaining oxide plus the etched silicon.

create table measurement (
    run_id          integer  not null references run (id) on delete cascade,
    measurement_set text     not null check (measurement_set in ('NINE_POINT', 'EIGHTY_NINE_POINT')),
    point_no        smallint not null check (point_no > 0),
    loc_id          text,
    x_um            real     not null,
    y_um            real     not null,
    preox_um        real     not null,
    postox_um       real     not null,
    postox_measured boolean  not null,
    stepheight_um   real     not null,
    oxide_etch_um   real     not null,
    si_etch_file_um real     not null,
    depth_um        real     generated always as (stepheight_um - postox_um) stored,
    primary key (run_id, measurement_set, point_no)
);
