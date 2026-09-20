# chamber-sim: C11, no dependencies.
#
#   make            build build/chamber-sim
#   make test       build and run the tests
#   make SAN=1 test run the tests under the address and undefined-behaviour sanitizers
#   make smoke      run one wafer at full speed and check the frames it produced
#   make clean

CC ?= cc
CFLAGS ?= -std=c11 -Wall -Wextra -Werror -O2
LDLIBS ?=

ifeq ($(OS),Windows_NT)
	EXE := .exe
	LDLIBS += -lws2_32
else
	EXE :=
	CFLAGS += -D_POSIX_C_SOURCE=200809L
endif

ifdef SAN
	CFLAGS += -fsanitize=address,undefined -fno-omit-frame-pointer -g -O1
	LDFLAGS += -fsanitize=address,undefined
endif

BUILD := build
SOURCES := src/rng.c src/channels.c src/recipe.c src/fault.c src/chamber.c src/interlock.c src/frame.c src/run.c
OBJECTS := $(SOURCES:src/%.c=$(BUILD)/%.o)
TEST_SOURCES := test/test_main.c test/test_rng.c test/test_recipe.c test/test_interlock.c test/test_chamber.c \
	test/test_frame.c
TEST_OBJECTS := $(TEST_SOURCES:test/%.c=$(BUILD)/%.o)

all: $(BUILD)/chamber-sim$(EXE)

$(BUILD)/chamber-sim$(EXE): $(OBJECTS) $(BUILD)/main.o
	$(CC) $(LDFLAGS) -o $@ $^ $(LDLIBS)

$(BUILD)/%.o: src/%.c | $(BUILD)
	$(CC) $(CFLAGS) -Isrc -c -o $@ $<

$(BUILD)/%.o: test/%.c | $(BUILD)
	$(CC) $(CFLAGS) -Isrc -c -o $@ $<

$(BUILD):
	@mkdir -p $(BUILD)

$(BUILD)/tests$(EXE): $(OBJECTS) $(TEST_OBJECTS)
	$(CC) $(LDFLAGS) -o $@ $^ $(LDLIBS)

test: $(BUILD)/tests$(EXE)
	$(BUILD)/tests$(EXE)

# One wafer at full speed, checked for the structure the aligner needs: a hello, the etch's phases, an end.
smoke: all
	@sh scripts/smoke.sh

clean:
	rm -rf $(BUILD)

.PHONY: all test smoke clean
