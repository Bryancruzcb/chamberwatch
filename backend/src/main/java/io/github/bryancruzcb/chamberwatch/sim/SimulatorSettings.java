package io.github.bryancruzcb.chamberwatch.sim;

/**
 * The simulator's modelling choices the public data cannot measure directly.
 *
 * @param lotDegreesOfFreedom lot levels come from a Student t with this many degrees of freedom, scaled to
 *                            the measured spread; 0 draws them from a normal distribution
 * @param swingRateScale      each channel swings at its measured rate times this
 */
public record SimulatorSettings(int lotDegreesOfFreedom, double swingRateScale) {

	/**
	 * Normal lot levels, and swings at a tenth of the rate the public good runs showed. A swing is measured as
	 * a shift of a cycle's median, which overstates how far single readings move when a match capacitor
	 * changes shape rather than level. Of the factors 0.10 to 0.30, 0.10 makes simulated good wafers from
	 * unseen lots alarm most like the public ones at the default thresholds; SimulatorCalibrationTest holds
	 * it there, and docs/DATA.md has the sweep.
	 */
	public static final SimulatorSettings DEFAULT = new SimulatorSettings(0, 0.10);

	public SimulatorSettings {
		if (lotDegreesOfFreedom != 0 && lotDegreesOfFreedom < 3) {
			throw new IllegalArgumentException("a unit-variance t needs at least 3 degrees of freedom");
		}
		if (!(swingRateScale >= 0) || !Double.isFinite(swingRateScale)) {
			throw new IllegalArgumentException("invalid swing rate scale " + swingRateScale);
		}
	}

}
