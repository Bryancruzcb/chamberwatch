-- Every label change takes the next value into run.label_seq, so a refresh can tell a baseline chosen
-- from newer labels from one chosen from older labels.
create sequence label_seq;
