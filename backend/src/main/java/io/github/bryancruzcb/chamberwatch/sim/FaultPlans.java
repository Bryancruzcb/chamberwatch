package io.github.bryancruzcb.chamberwatch.sim;

import java.util.SortedMap;
import java.util.SplittableRandom;
import java.util.TreeMap;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * Draws faults of the sizes the evaluation and the demo lots use. Sizes span easy and hard cases, so recall
 * says something: a pressure jump of 1 to 10 %, a reflected power rise of 5 to 60 W, a gas stuck at 30 to
 * 95 % of its flow, a dropout of 1 to 20 s. The public data has no faults to measure these from, so the
 * ranges are chosen.
 */
public final class FaultPlans {

	/** A steady cycle is about 6 s, so cycle k starts about (k - 1) * 6 s into the etch. */
	public static final double CYCLE_SECONDS = 6.0;

	private FaultPlans() {
	}

	/** One fault of the kind, starting at a random moment of a cycle from {@code firstCycle} to {@code lastCycle}. */
	public static FaultPlan draw(FaultKind kind, SplittableRandom random, int firstCycle, int lastCycle) {
		int cycle = firstCycle + random.nextInt(lastCycle - firstCycle + 1);
		double startS = (cycle - 1 + random.nextDouble()) * CYCLE_SECONDS;
		ChannelName channel = kind.channels().get(random.nextInt(kind.channels().size()));
		return switch (kind) {
			case GAS_FLOW_STUCK_LOW -> FaultPlan.gasFlowStuckLow(channel, startS, between(random, 0.30, 0.95));
			case PRESSURE_SPIKE -> FaultPlan.pressureSpike(startS, between(random, 1.0, 6.0), between(random, 0.01, 0.10));
			case REFLECTED_POWER_RISE -> FaultPlan.reflectedPowerRise(startS, between(random, 10, 60), between(random, 5, 60));
			case SENSOR_DROPOUT -> FaultPlan.sensorDropout(channel, startS, between(random, 1.0, 20.0));
		};
	}

	/**
	 * The faults of one demo lot: one of each kind, on distinct wafers after the lot's first {@code cleanWafers},
	 * starting in cycles 5 to 90, all drawn from the seed and the lot number alone.
	 *
	 * @return the fault for each faulted wafer, by position in lot
	 * @throws IllegalArgumentException when the lot has fewer than four wafers after the clean ones
	 */
	public static SortedMap<Integer, FaultPlan> forLot(long seed, int lotNo, int lotSize, int cleanWafers) {
		FaultKind[] kinds = FaultKind.values();
		int candidates = lotSize - cleanWafers;
		if (cleanWafers < 0 || candidates < kinds.length) {
			throw new IllegalArgumentException("a demo lot needs " + kinds.length + " wafers after the first "
					+ cleanWafers + " clean ones, and " + lotSize + " wafers give " + candidates);
		}
		SplittableRandom random = new SplittableRandom(31 * seed + lotNo);
		int[] positions = new int[candidates];
		for (int i = 0; i < candidates; i++) {
			positions[i] = cleanWafers + 1 + i;
		}
		SortedMap<Integer, FaultPlan> plans = new TreeMap<>();
		for (int i = 0; i < kinds.length; i++) {
			int pick = i + random.nextInt(candidates - i);
			int position = positions[pick];
			positions[pick] = positions[i];
			positions[i] = position;
			plans.put(position, draw(kinds[i], random, 5, 90));
		}
		return plans;
	}

	private static double between(SplittableRandom random, double low, double high) {
		return low + (high - low) * random.nextDouble();
	}

}
