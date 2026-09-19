-- A phase whose readings never change has no spread. The summaries stored before this version were
-- summed in one pass about zero, so such a phase kept a spread of about 1e-8 from rounding, and its mean
-- could miss the reading in the last bits. The summaries are now summed about the phase's first
-- reading, which gives exactly 0; this corrects the rows already stored. Rows with any spread keep
-- their values, which moved by far less than a reading's resolution.

update run_phase_summary
set sd   = 0,
    mean = min
where min = max
  and (sd <> 0 or mean <> min);
