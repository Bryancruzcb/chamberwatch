package io.github.bryancruzcb.chamberwatch;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.ingest.AlignCommand;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ChamberwatchApplication {

	public static void main(String[] args) {
		// align needs no database, so it runs before Spring starts one
		if (args.length > 0 && args[0].equals("align")) {
			System.exit(AlignCommand.run(List.of(args).subList(1, args.length), System.out));
		}
		SpringApplication.run(ChamberwatchApplication.class, args);
	}

}
