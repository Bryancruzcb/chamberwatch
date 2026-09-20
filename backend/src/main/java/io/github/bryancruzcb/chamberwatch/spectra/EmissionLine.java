package io.github.bryancruzcb.chamberwatch.spectra;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;

/**
 * One emission line of the plasma: the channel it becomes and the pixels of the spectrometer summed into it.
 *
 * <p>The lines are about as wide as the pixels are apart, so one pixel does not measure a line, it samples
 * wherever the line happens to fall on the detector's grid. Three pixels hold the whole line however it lands,
 * which is what keeps a day's reading comparable with another day's.
 *
 * @param channel the channel the reduced line becomes, named for its wavelength in nanometres
 * @param nm      the line's wavelength in the literature
 * @param pixel   the middle pixel of the window, on the file's own wavelength axis
 * @param width   how many pixels are summed, centred on {@code pixel}
 */
public record EmissionLine(ChannelName channel, double nm, int pixel, int width) {

	public EmissionLine {
		if (width < 1 || width % 2 == 0) {
			throw new IllegalArgumentException("a window is an odd number of pixels, not " + width);
		}
		if (pixel - width / 2 < 0) {
			throw new IllegalArgumentException("the window of " + channel.value() + " starts before the first pixel");
		}
	}

	public int firstPixel() {
		return pixel - width / 2;
	}

	/** The window's sum over one spectrum, whose values start at {@code offset} in the array. */
	public float sum(float[] spectrum, int offset) {
		float sum = 0;
		for (int at = 0; at < width; at++) {
			sum += spectrum[offset + at];
		}
		return sum;
	}

}
