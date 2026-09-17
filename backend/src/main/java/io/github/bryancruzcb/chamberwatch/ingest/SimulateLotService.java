package io.github.bryancruzcb.chamberwatch.ingest;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.SortedMap;
import java.util.stream.Collectors;

import io.github.bryancruzcb.chamberwatch.detect.DetectorConfig;
import io.github.bryancruzcb.chamberwatch.health.HealthService;
import io.github.bryancruzcb.chamberwatch.recipe.Aligner;
import io.github.bryancruzcb.chamberwatch.recipe.AlignmentResult;
import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import io.github.bryancruzcb.chamberwatch.recipe.Source;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlan;
import io.github.bryancruzcb.chamberwatch.sim.FaultPlans;
import io.github.bryancruzcb.chamberwatch.sim.RunSpec;
import io.github.bryancruzcb.chamberwatch.sim.SimulatedRun;
import io.github.bryancruzcb.chamberwatch.sim.SimulationTemplate;
import io.github.bryancruzcb.chamberwatch.sim.Simulator;
import io.github.bryancruzcb.chamberwatch.store.LotRecord;
import io.github.bryancruzcb.chamberwatch.store.LotRef;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;
import io.github.bryancruzcb.chamberwatch.store.RunId;
import io.github.bryancruzcb.chamberwatch.store.RunStore;

import org.springframework.stereotype.Service;

/**
 * Stores one seeded synthetic lot with known faults, so the app shows faults the detectors caught. The
 * synthetic baseline learns from clean training lots, the first wafers of lots 1 to {@code trainingLots},
 * exactly as the evaluation does, so this command stores those too when they are missing. Every run is
 * decided by the seed, its lot and its position, so a rerun simulates the same runs, finds them stored,
 * writes nothing and reuses the baseline.
 *
 * <p>The synthetic source holds one seed per lot: a run key carries its seed, and a lot whose runs came
 * from another seed is refused rather than mixed.
 */
@Service
public class SimulateLotService {

	private final RunStore runs;

	private final HealthService health;

	private final ReadQueries queries;

	private final DetectorConfig config;

	public SimulateLotService(RunStore runs, HealthService health, ReadQueries queries, DetectorConfig config) {
		this.runs = runs;
		this.health = health;
		this.queries = queries;
		this.config = config;
	}

	/**
	 * @param lotNo        the demo lot, above the training lots
	 * @param lotSize      wafers in the demo lot: the first {@code goodRunsPerLot} clean, then four faulted ones
	 * @param trainingLots lots 1 to this many hold the clean wafers the baseline learns from
	 * @throws IllegalArgumentException when the lot number or size cannot work
	 * @throws IllegalStateException    when a lot to write already holds runs from another seed
	 */
	public SimulateLotReport simulate(long seed, int lotNo, int lotSize, int trainingLots) {
		if (trainingLots < 1 || lotNo <= trainingLots) {
			throw new IllegalArgumentException("the demo lot must come after the " + trainingLots + " training lots, and "
					+ lotNo + " does not");
		}
		int cleanWafers = config.goodRunsPerLot();
		SortedMap<Integer, FaultPlan> plans = FaultPlans.forLot(seed, lotNo, lotSize, cleanWafers);
		Simulator simulator = Simulator.seeded(seed, SimulationTemplate.bundled());

		int trainingStored = 0;
		int trainingPresent = 0;
		for (int lot = 1; lot <= trainingLots; lot++) {
			LotRef ref = lot(lot, seed);
			for (int position = 1; position <= cleanWafers; position++) {
				if (store(simulator.run(RunSpec.clean(lot, position)), ref).stored()) {
					trainingStored++;
				}
				else {
					trainingPresent++;
				}
			}
		}
		SimulateLotReport.Load training = new SimulateLotReport.Load(trainingStored, trainingPresent);

		LotRef demo = lot(lotNo, seed);
		List<Stored> stored = new ArrayList<>();
		for (int position = 1; position <= lotSize; position++) {
			FaultPlan plan = plans.get(position);
			RunSpec spec = (plan == null) ? RunSpec.clean(lotNo, position) : RunSpec.faulted(lotNo, position, plan);
			stored.add(store(simulator.run(spec), demo));
		}
		SimulateLotReport.Load lot = new SimulateLotReport.Load((int) stored.stream().filter(Stored::stored).count(),
				(int) stored.stream().filter((s) -> !s.stored()).count());

		var refresh = health.refresh(Source.SYNTHETIC);
		Map<Integer, ReadQueries.RunRow> verdicts = queries.runs(Source.SYNTHETIC, (int) demo.id(), null)
			.runs()
			.stream()
			.collect(Collectors.toMap(ReadQueries.RunRow::id, (row) -> row));
		List<SimulateLotReport.Wafer> wafers = stored.stream()
			.map((s) -> new SimulateLotReport.Wafer(s.run().key(), s.alignment(), s.run().fault(), verdicts.get(s.id().value())))
			.toList();
		return new SimulateLotReport(seed, lotNo, trainingLots, cleanWafers, training, lot, wafers, refresh);
	}

	private record Stored(SimulatedRun run, String alignment, RunId id, boolean stored) {
	}

	/** Stores the run unless its key is stored, and writes its fault row either way, since that write is idempotent. */
	private Stored store(SimulatedRun simulated, LotRef lot) {
		AlignmentResult result = Aligner.STANDARD.align(simulated.raw());
		Optional<RunId> inserted = runs.insertIfAbsent(simulated.raw(), result, lot);
		RunId id = inserted.orElseGet(() -> runs.id(simulated.key())
			.orElseThrow(() -> new IllegalStateException(simulated.key().value() + " was neither stored nor found")));
		simulated.fault().ifPresent((fault) -> runs.insertInjectedFault(id, fault));
		String alignment = switch (result) {
			case AlignmentResult.Aligned aligned -> aligned.run().report().status().name();
			case AlignmentResult.Failed ignored -> "FAILED";
		};
		return new Stored(simulated, alignment, id, inserted.isPresent());
	}

	/** The synthetic lot, created when missing, refused when its stored runs came from another seed. */
	private LotRef lot(int lotNo, long seed) {
		LotRef ref = runs.upsertLot(new LotRecord(Source.SYNTHETIC, lotNo, Optional.empty(), Optional.empty()));
		for (RunKey key : runs.runKeys(ref)) {
			long stored = key.seed().orElseThrow();
			if (stored != seed) {
				throw new IllegalStateException("synthetic lot " + lotNo + " holds runs from seed " + stored + ", so seed "
						+ seed + " cannot write to it; use --seed=" + stored + " or an empty database");
			}
		}
		return ref;
	}

}
