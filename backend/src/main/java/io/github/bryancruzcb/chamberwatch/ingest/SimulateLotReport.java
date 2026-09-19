package io.github.bryancruzcb.chamberwatch.ingest;

import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.stream.Collectors;
import java.util.stream.Stream;

import io.github.bryancruzcb.chamberwatch.health.Refresh;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;
import io.github.bryancruzcb.chamberwatch.store.StoredFault;

/**
 * What one simulate-lot did, and what the detectors made of the lot afterwards: one line per wafer with
 * the fault that is stored beside it next to the channel the detectors named first.
 *
 * @param cleanWafers the first wafers of every lot, which carry no fault and are the good runs
 */
public record SimulateLotReport(long seed, int lotNo, int trainingLots, int cleanWafers, Load training, Load lot,
		List<Wafer> wafers, Refresh refresh) {

	public SimulateLotReport {
		wafers = List.copyOf(wafers);
	}

	/**
	 * @param fault   the fault stored beside the run, which is what its samples carry
	 * @param verdict the runs-table row after the refresh, null when the run could not be scored
	 */
	public record Wafer(RunKey key, String alignment, Optional<StoredFault> fault, ReadQueries.RunRow verdict) {

		/** True when the detectors flagged the run and ranked the injected fault's channel first. */
		public boolean caughtFirst() {
			return fault.isPresent() && verdict != null && verdict.firstChannel() != null
					&& verdict.firstChannel().equals(fault.get().channel().value());
		}

		String describe() {
			String went = fault.map(SimulateLotReport::describe).orElse("clean");
			String came;
			if (verdict == null || !verdict.scored()) {
				came = "not scored";
			}
			else if (verdict.firstChannel() == null) {
				came = "not flagged";
			}
			else {
				came = String.format(Locale.ROOT, "flagged, %s first%s, %d limit, %d deviation and %d stuck flags",
						verdict.firstChannel(),
						(verdict.firstTimeS() != null) ? String.format(Locale.ROOT, " at %.1f s", verdict.firstTimeS()) : "",
						verdict.limitFlags(), verdict.deviationFlags(), verdict.stuckFlags());
			}
			return String.format(Locale.ROOT, "  %s %s: %s -> %s", key.value(), alignment, went, came);
		}

	}

	public record Load(int stored, int alreadyPresent) {
	}

	/** True when a wafer could not be aligned. */
	public boolean hasProblems() {
		return wafers.stream().anyMatch((wafer) -> wafer.alignment().equals("FAILED"));
	}

	public long injected() {
		return wafers.stream().filter((wafer) -> wafer.fault().isPresent()).count();
	}

	public long caughtFirst() {
		return wafers.stream().filter(Wafer::caughtFirst).count();
	}

	public String describe() {
		String header = String.format(Locale.ROOT,
				"training: %d runs stored, %d already present (lots 1 to %d, wafers 1 to %d)%nlot %d: %d wafers stored, %d already present",
				training.stored(), training.alreadyPresent(), trainingLots, cleanWafers, lotNo, lot.stored(),
				lot.alreadyPresent());
		String summary = String.format(Locale.ROOT, "%d of %d injected faults ranked first on their channel", caughtFirst(),
				injected());
		return Stream
			.of(Stream.of(header), wafers.stream().map(Wafer::describe), Stream.of(summary, refresh.describe()))
			.flatMap((lines) -> lines)
			.collect(Collectors.joining(System.lineSeparator()));
	}

	static String describe(StoredFault fault) {
		double from = fault.startS();
		double duration = fault.durationS().orElse(fault.endS() - fault.startS());
		return switch (fault.kind()) {
			case GAS_FLOW_STUCK_LOW -> String.format(Locale.ROOT, "%s stuck at %.0f %% from %.1f s", fault.channel(),
					fault.magnitude() * 100, from);
			case PRESSURE_SPIKE -> String.format(Locale.ROOT, "%s up %.1f %% for %.1f s from %.1f s", fault.channel(),
					fault.magnitude() * 100, duration, from);
			case REFLECTED_POWER_RISE -> String.format(Locale.ROOT, "%s up %.0f W over %.0f s from %.1f s", fault.channel(),
					fault.magnitude(), duration, from);
			case SENSOR_DROPOUT -> String.format(Locale.ROOT, "%s reads 0 for %.1f s from %.1f s", fault.channel(), duration,
					from);
			case SENSOR_STUCK -> String.format(Locale.ROOT, "%s repeats its last reading for %.1f s from %.1f s",
					fault.channel(), duration, from);
		};
	}

}
