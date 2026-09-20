package io.github.bryancruzcb.chamberwatch.spectra;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import io.github.bryancruzcb.chamberwatch.recipe.RunKey;

import ucar.ma2.Array;
import ucar.ma2.DataType;
import ucar.ma2.InvalidRangeException;
import ucar.nc2.Group;
import ucar.nc2.NetcdfFile;
import ucar.nc2.NetcdfFiles;
import ucar.nc2.Variable;

/**
 * Reads one day's optical emission file and gives back only the lines asked for. The whole file holds 3,648
 * wavelengths for every sample of every wafer, about 800 MB, so it is read in blocks of samples and nothing but
 * the lines' own pixels is ever kept.
 *
 * <p>The readings are dictionary codes, as the telemetry's are, and they reach past the top of a signed short, so
 * they are read unsigned. This is the interaction layer: it holds the open file and the decoder, and no netCDF
 * type leaves it.
 */
public final class NetcdfSpectraSource implements AutoCloseable {

	/** The wafer groups inside a daily file carry no day, which the file's own name gives. */
	private static final Pattern WAFER_GROUP = Pattern.compile("Wafer_\\d{2}");

	private static final Pattern DAILY_FILE = Pattern.compile("(Day_\\d{4}_\\d{2}_\\d{2})\\.nc");

	/** How many samples are read at once. A block of the two bands read is about 10 MB. */
	static final int BLOCK = 2000;

	/** The first pixel read: everything below 428 nm is noise, and the file's chunks start here. */
	static final int FIRST_PIXEL = 1216;

	private final NetcdfFile file;

	private final float[] dictionary;

	private final SortedMap<RunKey, Group> groups;

	private NetcdfSpectraSource(NetcdfFile file, float[] dictionary, SortedMap<RunKey, Group> groups) {
		this.file = file;
		this.dictionary = dictionary;
		this.groups = groups;
	}

	/**
	 * @param daily      one day's spectra, {@code Day_YYYY_MM_DD.nc}
	 * @param dictionary the codebook the day's codes index, {@code Dictionary_OES.nc}
	 * @throws IllegalArgumentException when the file is not named for a day
	 */
	public static NetcdfSpectraSource open(Path daily, Path dictionary) {
		Matcher name = DAILY_FILE.matcher(daily.getFileName().toString());
		if (!name.matches()) {
			throw new IllegalArgumentException("not a daily spectra file: " + daily.getFileName());
		}
		String day = name.group(1);
		float[] decoder;
		try (NetcdfFile dictionaryFile = NetcdfFiles.open(dictionary.toString())) {
			decoder = (float[]) variable(dictionaryFile.getRootGroup(), "data").read().get1DJavaArray(DataType.FLOAT);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		NetcdfFile file;
		try {
			file = NetcdfFiles.open(daily.toString());
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		SortedMap<RunKey, Group> groups = new TreeMap<>();
		for (Group group : file.getRootGroup().getGroups()) {
			if (WAFER_GROUP.matcher(group.getShortName()).matches()) {
				groups.put(RunKey.ofPublicGroup(day + "_" + group.getShortName()), group);
			}
		}
		return new NetcdfSpectraSource(file, decoder, groups);
	}

	/** The wafers the day holds, in order. */
	public List<RunKey> keys() {
		return List.copyOf(groups.keySet());
	}

	/**
	 * Reads one wafer, keeping only the lines' windows.
	 *
	 * @throws NoSuchElementException when the day holds no such wafer
	 * @throws IllegalStateException  when the file's wavelength axis is not the one the lines were measured on
	 */
	public WaferSpectra read(RunKey key, List<EmissionLine> lines) {
		Group group = groups.get(key);
		if (group == null) {
			throw new NoSuchElementException("no wafer group " + key.value());
		}
		try {
			double[] times = (double[]) variable(group, "times").read().get1DJavaArray(DataType.DOUBLE);
			double[] axis = (double[]) variable(group, "wavelengths").read().get1DJavaArray(DataType.DOUBLE);
			EmissionLines.resolve(axis);
			Variable data = variable(group, "data");
			int[] shape = data.getShape();
			if (shape.length != 2 || shape[0] != times.length || shape[1] != axis.length) {
				throw new IllegalStateException(key.value() + ": data does not match its times and wavelengths");
			}
			int pixels = shape[1] - FIRST_PIXEL;
			for (EmissionLine line : lines) {
				if (line.firstPixel() < FIRST_PIXEL || line.firstPixel() + line.width() > shape[1]) {
					throw new IllegalStateException(line.channel().value() + " is outside the pixels read");
				}
			}
			float[][] values = new float[lines.size()][times.length];
			for (int from = 0; from < times.length; from += BLOCK) {
				int rows = Math.min(BLOCK, times.length - from);
				Array block = data.read(new int[] { from, FIRST_PIXEL }, new int[] { rows, pixels });
				readBlock(key, block, lines, values, from, rows, pixels);
			}
			double[] sinceStart = new double[times.length];
			for (int sample = 0; sample < times.length; sample++) {
				sinceStart[sample] = times[sample] - times[0];
			}
			return new WaferSpectra(key, lines, sinceStart, values);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		catch (InvalidRangeException ex) {
			throw new IllegalStateException(key.value() + ": cannot read the pixels of the lines", ex);
		}
	}

	private void readBlock(RunKey key, Array block, List<EmissionLine> lines, float[][] values, int from, int rows,
			int pixels) {
		short[] codes = (short[]) block.get1DJavaArray(DataType.SHORT);
		float[] spectrum = new float[pixels];
		for (int row = 0; row < rows; row++) {
			int at = row * pixels;
			for (int pixel = 0; pixel < pixels; pixel++) {
				// the codes are unsigned 16-bit and reach 61,422, so they must never be read as signed
				int code = codes[at + pixel] & 0xFFFF;
				if (code >= dictionary.length) {
					throw new IllegalStateException(
							key.value() + ": code " + code + " is outside the dictionary at sample " + (from + row));
				}
				spectrum[pixel] = dictionary[code];
			}
			for (int line = 0; line < lines.size(); line++) {
				values[line][from + row] = lines.get(line).sum(spectrum, lines.get(line).firstPixel() - FIRST_PIXEL);
			}
		}
	}

	@Override
	public void close() {
		try {
			file.close();
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
	}

	private static Variable variable(Group group, String name) {
		Variable variable = group.findVariableLocal(name);
		if (variable == null) {
			throw new IllegalStateException("group '" + group.getShortName() + "' has no variable " + name);
		}
		return variable;
	}

	/** The lines this source keeps room for, so a caller need not name the list twice. */
	public static List<EmissionLine> standardLines() {
		return new ArrayList<>(EmissionLines.STANDARD);
	}

}
