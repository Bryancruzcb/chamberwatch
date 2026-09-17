package io.github.bryancruzcb.chamberwatch.ingest;

import java.util.List;
import java.util.Optional;

import io.github.bryancruzcb.chamberwatch.TestcontainersConfiguration;
import io.github.bryancruzcb.chamberwatch.sim.FaultKind;
import io.github.bryancruzcb.chamberwatch.sim.InjectedFault;
import io.github.bryancruzcb.chamberwatch.store.ReadQueries;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestInstance;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.simple.JdbcClient;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatIllegalArgumentException;
import static org.assertj.core.api.Assertions.assertThatIllegalStateException;
import static org.assertj.core.api.Assertions.within;

/**
 * Two training lots and a seven-wafer demo lot, so the test stores 13 runs instead of the command's 40.
 * Other tests store synthetic runs in the same database under other lot numbers.
 */
@SpringBootTest
@Import(TestcontainersConfiguration.class)
@TestInstance(TestInstance.Lifecycle.PER_CLASS)
class SimulateLotTest {

	private static final long SEED = 11;

	private static final int LOT = 911;

	@Autowired
	private SimulateLotService service;

	@Autowired
	private ReadQueries queries;

	@Autowired
	private JdbcClient jdbc;

	private SimulateLotReport first;

	private long rowsAfterFirst;

	@BeforeAll
	void simulateTheLot() {
		first = service.simulate(SEED, LOT, 7, 2);
		rowsAfterFirst = derivedRows();
	}

	@Test
	void storesTheTrainingLotsAndTheFaultedLotAndScoresThemAll() {
		assertThat(first.training()).isEqualTo(new SimulateLotReport.Load(6, 0));
		assertThat(first.lot()).isEqualTo(new SimulateLotReport.Load(7, 0));
		assertThat(first.wafers()).hasSize(7).allMatch((wafer) -> !wafer.alignment().equals("FAILED"));
		assertThat(first.hasProblems()).isFalse();
		assertThat(first.wafers().subList(0, 3)).allMatch((wafer) -> wafer.fault().isEmpty());
		assertThat(first.wafers().stream().flatMap((wafer) -> wafer.fault().stream()).map(InjectedFault::kind))
			.containsExactlyInAnyOrder(FaultKind.values());
		assertThat(first.refresh().fitted()).isTrue();
		// the demo lot's first wafers join the good runs, as every lot's do
		assertThat(goodRunsOfTheseLots(first.refresh().baseline().orElseThrow().id())).isEqualTo(9);
		assertThat(first.wafers()).allMatch((wafer) -> wafer.verdict() != null && wafer.verdict().scored());
		assertThat(faultRows()).isEqualTo(4);
		assertThat(first.describe()).contains("training: 6 runs stored, 0 already present (lots 1 to 2, wafers 1 to 3)")
			.contains("lot 911: 7 wafers stored, 0 already present")
			.contains("of 4 injected faults ranked first on their channel");
	}

	@Test
	void aRerunFindsEverythingAndWritesNothing() {
		SimulateLotReport second = service.simulate(SEED, LOT, 7, 2);

		assertThat(second.training()).isEqualTo(new SimulateLotReport.Load(0, 6));
		assertThat(second.lot()).isEqualTo(new SimulateLotReport.Load(0, 7));
		assertThat(second.refresh().fitted()).isFalse();
		assertThat(second.refresh().scored()).isZero();
		assertThat(second.wafers()).usingRecursiveComparison().isEqualTo(first.wafers());
		assertThat(derivedRows()).isEqualTo(rowsAfterFirst);
	}

	@Test
	void theStuckFlowAndTheDropoutAreCaughtFirstAndTheRunPageCarriesTheTruth() {
		for (FaultKind kind : List.of(FaultKind.GAS_FLOW_STUCK_LOW, FaultKind.SENSOR_DROPOUT)) {
			SimulateLotReport.Wafer wafer = wafer(kind);
			InjectedFault fault = wafer.fault().orElseThrow();
			assertThat(wafer.verdict().limitFlags()).as(kind.name()).isPositive();
			assertThat(wafer.caughtFirst()).as(kind + " ranked first").isTrue();
			ReadQueries.RunDetail detail = queries.run(wafer.verdict().id()).orElseThrow();
			ReadQueries.InjectedFault shown = detail.injectedFault();
			assertThat(shown.kind()).isEqualTo(kind.name());
			assertThat(shown.channel()).isEqualTo(fault.channel().value());
			assertThat(shown.startS()).isCloseTo(fault.startS(), within(1e-3));
			assertThat(shown.endS()).isCloseTo(fault.endS(), within(1e-3));
			assertThat(shown.magnitude()).isEqualTo(fault.plan().magnitude());
			assertThat(detail.channels().get(0).channel()).isEqualTo(fault.channel().value());
		}
		ReadQueries.InjectedFault stuck = queries.run(wafer(FaultKind.GAS_FLOW_STUCK_LOW).verdict().id())
			.orElseThrow()
			.injectedFault();
		assertThat(stuck.durationS()).as("a fault that lasts to the end of the etch has no duration").isNull();
		ReadQueries.InjectedFault dropout = queries.run(wafer(FaultKind.SENSOR_DROPOUT).verdict().id())
			.orElseThrow()
			.injectedFault();
		assertThat(dropout.durationS()).isCloseTo(wafer(FaultKind.SENSOR_DROPOUT).fault().orElseThrow().plan().durationS(),
				within(1e-3));
		assertThat(queries.run(first.wafers().get(0).verdict().id()).orElseThrow().injectedFault()).isNull();
	}

	@Test
	void aLotFromAnotherSeedIsRefusedAndABadLotIsRejected() {
		assertThatIllegalStateException().isThrownBy(() -> service.simulate(SEED + 1, LOT, 7, 2))
			.withMessageContaining("seed 11");
		assertThatIllegalArgumentException().isThrownBy(() -> service.simulate(SEED, 2, 7, 2));
		assertThatIllegalArgumentException().isThrownBy(() -> service.simulate(SEED, 912, 6, 2));
		assertThat(derivedRows()).isEqualTo(rowsAfterFirst);
	}

	private SimulateLotReport.Wafer wafer(FaultKind kind) {
		return first.wafers()
			.stream()
			.filter((wafer) -> wafer.fault().map(InjectedFault::kind).equals(Optional.of(kind)))
			.findFirst()
			.orElseThrow();
	}

	/** Other tests add synthetic lots of their own, so only this test's lots are counted. */
	private long goodRunsOfTheseLots(int baselineId) {
		return jdbc.sql("""
				select count(*)
				from baseline_good_run g
				join run r on r.id = g.run_id
				join lot l on l.id = r.lot_id
				where g.baseline_id = :baseline and l.source = 'SYNTHETIC' and l.lot_no in (1, 2, :lot)""")
			.param("baseline", baselineId)
			.param("lot", LOT)
			.query(Long.class)
			.single();
	}

	private long faultRows() {
		return jdbc.sql("""
				select count(*)
				from injected_fault f
				join run r on r.id = f.run_id
				join lot l on l.id = r.lot_id
				where l.source = 'SYNTHETIC' and l.lot_no = :lot""")
			.param("lot", LOT)
			.query(Long.class)
			.single();
	}

	private long derivedRows() {
		return jdbc.sql("""
				select (select count(*) from run) + (select count(*) from sample) + (select count(*) from baseline)
				     + (select count(*) from baseline_good_run) + (select count(*) from band)
				     + (select count(*) from run_assessment) + (select count(*) from channel_verdict)
				     + (select count(*) from excursion) + (select count(*) from injected_fault)""")
			.query(Long.class)
			.single();
	}

}
