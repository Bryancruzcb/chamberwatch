package io.github.bryancruzcb.chamberwatch.spectra;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * The emission lines the reduction stores, measured on the public spectra rather than taken from a table.
 *
 * <p>Three fluorine lines report the etchant and rise in the SF6 phase; two C2 Swan band heads report the carbon
 * the passivation lays down and rise in the C4F8 phase. Between them a reader sees the recipe's two halves in the
 * plasma's own light, beside the flows and powers that caused them.
 *
 * <p>The file's wavelength axis reads about 1.23 nm low against the lines' published wavelengths, measured on
 * sixteen fluorine lines from 624 to 780 nm, so a window placed by the published number alone lands beside the
 * line and reads noise. The pixels below are the measured positions; {@link #resolve} checks them against the
 * file's own axis and refuses a file whose axis has moved.
 *
 * <p>Nothing below 428 nm is stored: over the whole of the spectrometer's first chunk band the plasma raises the
 * reading by 1 to 2 counts against a noise floor of 49, so those pixels carry no signal to reduce.
 */
public final class EmissionLines {

	/**
	 * The reduction's version, stored with every run it writes. A change to the lines, the windows, the baseline or
	 * the slot rule bumps it, so a rerun replaces what an older reduction stored instead of trusting it.
	 */
	public static final int VERSION = 1;

	/** The line whose step at the plasma's onset places the record on the run's clock: 192 counts off, 3,324 on. */
	public static final ChannelName PLASMA = ChannelName.of("Emission685");

	/** The line that rises in the C4F8 phase, used to check an alignment: 45 times its SF6 level. */
	public static final ChannelName PASSIVATION = ChannelName.of("Emission516");

	private static final int WIDTH = 3;

	/** The offset of the file's axis against the published wavelengths, in nanometres. */
	static final double AXIS_OFFSET_NM = 1.228;

	/** How far a resolved pixel may sit from the measured one before the file is refused. */
	static final int PIXEL_TOLERANCE = 1;

	public static final List<EmissionLine> STANDARD = List.of(
			new EmissionLine(PLASMA, 685.603, 2557, WIDTH),
			new EmissionLine(ChannelName.of("Emission703"), 703.747, 2654, WIDTH),
			new EmissionLine(ChannelName.of("Emission623"), 623.965, 2229, WIDTH),
			new EmissionLine(PASSIVATION, 516.520, 1665, WIDTH),
			new EmissionLine(ChannelName.of("Emission563"), 563.550, 1910, WIDTH));

	private EmissionLines() {
	}

	/**
	 * Checks the lines against a file's own wavelength axis.
	 *
	 * @param axis the file's wavelengths in nanometres, ascending
	 * @throws IllegalStateException when a line's measured pixel is not where the axis puts it, which means the
	 *                               file's axis is not the one the lines were measured on
	 */
	public static void resolve(double[] axis) {
		for (EmissionLine line : STANDARD) {
			int nearest = nearest(axis, line.nm() - AXIS_OFFSET_NM);
			if (Math.abs(nearest - line.pixel()) > PIXEL_TOLERANCE) {
				throw new IllegalStateException(line.channel().value() + " is at pixel " + line.pixel()
						+ " in the public files, but this file puts " + line.nm() + " nm at pixel " + nearest);
			}
		}
	}

	private static int nearest(double[] axis, double nm) {
		int nearest = 0;
		double best = Double.POSITIVE_INFINITY;
		for (int at = 0; at < axis.length; at++) {
			double distance = Math.abs(axis[at] - nm);
			if (distance < best) {
				best = distance;
				nearest = at;
			}
		}
		return nearest;
	}

}
