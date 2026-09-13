package io.github.bryancruzcb.chamberwatch.ingest;

import java.io.IOException;
import java.io.UncheckedIOException;
import java.util.ArrayList;
import java.util.List;
import java.util.NoSuchElementException;
import java.util.SortedMap;
import java.util.TreeMap;
import java.util.regex.Pattern;

import io.github.bryancruzcb.chamberwatch.recipe.ChannelName;
import io.github.bryancruzcb.chamberwatch.recipe.ChannelSet;
import io.github.bryancruzcb.chamberwatch.recipe.RawRun;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import ucar.ma2.Array;
import ucar.ma2.DataType;
import ucar.ma2.Index;
import ucar.nc2.Group;
import ucar.nc2.NetcdfFile;
import ucar.nc2.NetcdfFiles;
import ucar.nc2.Variable;

/**
 * Reads {@code Process_data.nc} with netCDF-Java. This is the only class that imports {@code ucar},
 * and no netCDF type leaves it. It holds the open file and the 49,290-value dictionary, and one
 * wafer's arrays at a time.
 */
public final class NetcdfTelemetrySource implements TelemetrySource {

	private static final Pattern WAFER_GROUP = Pattern.compile("Day_\\d{4}_\\d{2}_\\d{2}_Wafer_\\d{2}");

	private final NetcdfFile file;

	private final float[] dictionary;

	private final SortedMap<RunKey, Group> groups;

	private NetcdfTelemetrySource(NetcdfFile file, float[] dictionary, SortedMap<RunKey, Group> groups) {
		this.file = file;
		this.dictionary = dictionary;
		this.groups = groups;
	}

	public static NetcdfTelemetrySource open(DataFiles.VerifiedFile processData, DataFiles.VerifiedFile dictionary) {
		float[] decoder;
		try (NetcdfFile dictionaryFile = NetcdfFiles.open(dictionary.path().toString())) {
			decoder = (float[]) variable(dictionaryFile.getRootGroup(), "data").read().get1DJavaArray(DataType.FLOAT);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		NetcdfFile file;
		try {
			file = NetcdfFiles.open(processData.path().toString());
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
		}
		SortedMap<RunKey, Group> groups = new TreeMap<>();
		for (Group group : file.getRootGroup().getGroups()) {
			if (WAFER_GROUP.matcher(group.getShortName()).matches()) {
				groups.put(RunKey.ofPublicGroup(group.getShortName()), group);
			}
		}
		return new NetcdfTelemetrySource(file, decoder, groups);
	}

	@Override
	public List<RunKey> keys() {
		return List.copyOf(groups.keySet());
	}

	@Override
	public RawRun read(RunKey key) {
		Group group = groups.get(key);
		if (group == null) {
			throw new NoSuchElementException("no wafer group " + key.value());
		}
		try {
			double[] times = (double[]) variable(group, "times").read().get1DJavaArray(DataType.DOUBLE);
			Array featureNames = variable(group, "feature").read();
			int features = (int) featureNames.getSize();
			List<ChannelName> fileOrder = new ArrayList<>(features);
			for (int feature = 0; feature < features; feature++) {
				fileOrder.add(ChannelName.of((String) featureNames.getObject(feature)));
			}
			ChannelSet channels = ChannelSet.of(fileOrder);
			int[] column = new int[features];
			for (int feature = 0; feature < features; feature++) {
				column[feature] = channels.indexOf(fileOrder.get(feature));
			}
			Variable data = variable(group, "data");
			int[] shape = data.getShape();
			if (shape.length != 2 || shape[0] != times.length || shape[1] != features) {
				throw new IllegalStateException(key.value() + ": data shape does not match its times and features");
			}
			Array codes = data.read();
			Index index = codes.getIndex();
			float[] values = new float[times.length * features];
			for (int sample = 0; sample < times.length; sample++) {
				for (int feature = 0; feature < features; feature++) {
					// codes are unsigned 16-bit and reach 49,289, so they must never be read as signed
					int code = codes.getInt(index.set(sample, feature)) & 0xFFFF;
					if (code >= dictionary.length) {
						throw new IllegalStateException(
								key.value() + ": code " + code + " is outside the dictionary at sample " + sample);
					}
					values[sample * features + column[feature]] = dictionary[code];
				}
			}
			return RawRun.of(key, channels, times, values);
		}
		catch (IOException ex) {
			throw new UncheckedIOException(ex);
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

}
