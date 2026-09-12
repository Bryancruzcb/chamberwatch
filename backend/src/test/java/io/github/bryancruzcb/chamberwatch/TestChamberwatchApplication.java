package io.github.bryancruzcb.chamberwatch;

import org.springframework.boot.SpringApplication;

public class TestChamberwatchApplication {

	public static void main(String[] args) {
		SpringApplication.from(ChamberwatchApplication::main).with(TestcontainersConfiguration.class).run(args);
	}

}
