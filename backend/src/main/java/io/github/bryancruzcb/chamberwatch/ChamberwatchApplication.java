package io.github.bryancruzcb.chamberwatch;

import java.util.List;

import io.github.bryancruzcb.chamberwatch.ingest.AlignCommand;
import io.github.bryancruzcb.chamberwatch.ingest.SimTemplateCommand;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.WebApplicationType;
import org.springframework.boot.autoconfigure.SpringBootApplication;

@SpringBootApplication
public class ChamberwatchApplication {

	public static void main(String[] args) {
		String command = (args.length > 0) ? args[0] : "";
		// align and sim-template need no database, so they run before Spring starts one
		if (command.equals("align")) {
			System.exit(AlignCommand.run(List.of(args).subList(1, args.length), System.out));
		}
		if (command.equals("sim-template")) {
			System.exit(SimTemplateCommand.run(List.of(args).subList(1, args.length), System.out));
		}
		if (ChamberwatchCommands.NAMES.contains(command)) {
			SpringApplication application = new SpringApplication(ChamberwatchApplication.class);
			application.setWebApplicationType(WebApplicationType.NONE);
			System.exit(SpringApplication.exit(application.run(args)));
		}
		SpringApplication.run(ChamberwatchApplication.class, args);
	}

}
