package io.github.bryancruzcb.chamberwatch.sim;

import java.util.SplittableRandom;

/**
 * Seeded draws that give the same bits on every platform. The generator is integer arithmetic, and the
 * normal draws use {@link StrictMath}, whose results the Java specification fixes.
 */
final class Randoms {

	private final SplittableRandom random;

	private double spare;

	private boolean hasSpare;

	private Randoms(long seed) {
		this.random = new SplittableRandom(seed);
	}

	/** A generator for one purpose, seeded from every part, so no run depends on the order runs are made in. */
	static Randoms of(long... parts) {
		long hash = 0x9E3779B97F4A7C15L;
		for (long part : parts) {
			hash = finish(hash ^ finish(part + 0x632BE59BD9B4E019L));
		}
		return new Randoms(hash);
	}

	double uniform(double low, double high) {
		return low + (high - low) * random.nextDouble();
	}

	boolean chance(double probability) {
		return random.nextDouble() < probability;
	}

	int integer(int bound) {
		return random.nextInt(bound);
	}

	/** A Poisson count by inversion, for the small means the simulator uses. */
	int poisson(double mean) {
		if (!(mean > 0)) {
			return 0;
		}
		double u = random.nextDouble();
		double probability = StrictMath.exp(-mean);
		double cumulative = probability;
		int count = 0;
		while (u > cumulative && count < 1000) {
			count++;
			probability *= mean / count;
			cumulative += probability;
		}
		return count;
	}

	/** Box-Muller, keeping the second value of each pair for the next call. */
	double gaussian() {
		if (hasSpare) {
			hasSpare = false;
			return spare;
		}
		double u;
		do {
			u = random.nextDouble();
		}
		while (u == 0);
		double radius = StrictMath.sqrt(-2 * StrictMath.log(u));
		double angle = 2 * StrictMath.PI * random.nextDouble();
		spare = radius * StrictMath.sin(angle);
		hasSpare = true;
		return radius * StrictMath.cos(angle);
	}

	/**
	 * A Student t draw scaled to unit variance, so a heavy tail changes how often large values come up but
	 * not the spread. 0 degrees of freedom draws from the normal distribution instead.
	 */
	double unitT(int degreesOfFreedom) {
		if (degreesOfFreedom == 0) {
			return gaussian();
		}
		double chiSquare = 0;
		for (int i = 0; i < degreesOfFreedom; i++) {
			double z = gaussian();
			chiSquare += z * z;
		}
		double t = gaussian() / StrictMath.sqrt(chiSquare / degreesOfFreedom);
		return t * StrictMath.sqrt((degreesOfFreedom - 2.0) / degreesOfFreedom);
	}

	/** The SplitMix64 finalizer. */
	private static long finish(long value) {
		long z = value;
		z = (z ^ (z >>> 30)) * 0xBF58476D1CE4E5B9L;
		z = (z ^ (z >>> 27)) * 0x94D049BB133111EBL;
		return z ^ (z >>> 31);
	}

}
