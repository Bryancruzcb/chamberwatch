package io.github.bryancruzcb.chamberwatch.detect;

/** Whether the detectors score a channel. Decided when a baseline is fitted. */
public enum ChannelRole {

	/** Good runs vary, so every detector scores the channel. */
	INFORMATIVE,

	/**
	 * Every good-run sample holds one value, like lot 1's 13 extra channels or Heater1Temp. A band of
	 * zero width would flag every quantization step, so nothing scores it.
	 */
	CONSTANT

}
