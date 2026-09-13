package io.github.bryancruzcb.chamberwatch.detect;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.recipe.RunKey;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class GoodRunsTest {

	@Test
	void theFirstCleanWafersOfALotAreGoodUnlessALabelSaysOtherwise() {
		RunKey first = RunKey.ofPublicGroup("Day_2024_07_02_Wafer_01");
		RunKey third = RunKey.ofPublicGroup("Day_2024_07_02_Wafer_03");
		RunKey fourth = RunKey.ofPublicGroup("Day_2024_07_02_Wafer_04");
		RunKey second = RunKey.ofPublicGroup("Day_2024_07_02_Wafer_02");
		RunKey degraded = RunKey.ofPublicGroup("Day_2024_07_05_Wafer_01");
		RunKey labeledGood = RunKey.ofPublicGroup("Day_2024_07_05_Wafer_09");

		List<GoodRuns.Candidate> candidates = List.of(
				new GoodRuns.Candidate(first, Label.AUTO, true),
				new GoodRuns.Candidate(second, Label.BAD, true),
				new GoodRuns.Candidate(third, Label.AUTO, true),
				new GoodRuns.Candidate(fourth, Label.AUTO, true),
				new GoodRuns.Candidate(degraded, Label.AUTO, false),
				new GoodRuns.Candidate(labeledGood, Label.GOOD, false));

		assertThat(GoodRuns.select(candidates, 3)).containsExactly(first, third, labeledGood);
	}

}
