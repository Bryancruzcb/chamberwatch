/* chamber-sim: a plasma etch chamber that streams what it is doing over TCP.
 *
 * One connection, one wafer. The program ticks the recipe every 0.2 s of model time, reads the chamber, and
 * writes one JSON line per tick; between ticks it reads any command lines that arrived and applies them at the
 * next tick, so commands never land inside a tick. With --rate=0 it runs as fast as it can, which is how a test
 * drives it.
 *
 * This file and the socket calls in it are the only part of the program that touches the world. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "frame.h"
#include "run.h"

#ifdef _WIN32
#include <winsock2.h>
#include <ws2tcpip.h>
typedef SOCKET socket_t;
#define BAD_SOCKET INVALID_SOCKET
#define close_socket closesocket
#else
#include <arpa/inet.h>
#include <netinet/in.h>
#include <sys/select.h>
#include <sys/socket.h>
#include <time.h>
#include <unistd.h>
typedef int socket_t;
#define BAD_SOCKET (-1)
#define close_socket close
#endif

typedef struct {
	unsigned long long seed;
	int lot;
	int wafer;
	int port;
	double rate;      /* times real time; 0 runs with no waiting at all */
	int random_fault;
	const char *host;
} options_t;

/* Seconds on a clock that only moves forward, for keeping the stream to its rate. */
static double now_seconds(void)
{
#ifdef _WIN32
	LARGE_INTEGER frequency;
	LARGE_INTEGER count;
	QueryPerformanceFrequency(&frequency);
	QueryPerformanceCounter(&count);
	return (double)count.QuadPart / (double)frequency.QuadPart;
#else
	struct timespec now;
	clock_gettime(CLOCK_MONOTONIC, &now);
	return (double)now.tv_sec + (double)now.tv_nsec / 1e9;
#endif
}

static void sleep_seconds(double seconds)
{
	if (seconds <= 0.0) {
		return;
	}
#ifdef _WIN32
	Sleep((DWORD)(seconds * 1000.0));
#else
	struct timespec request;
	request.tv_sec = (time_t)seconds;
	request.tv_nsec = (long)((seconds - (double)request.tv_sec) * 1e9);
	nanosleep(&request, NULL);
#endif
}

static int send_line(socket_t client, const char *line)
{
	int length = (int)strlen(line);
	int sent = 0;
	while (sent < length) {
		int wrote = (int)send(client, line + sent, (size_t)(length - sent), 0);
		if (wrote <= 0) {
			return -1;
		}
		sent += wrote;
	}
	return 0;
}

/* Reads whatever has arrived, calling back for each complete line. Returns -1 when the client went away. */
static int drain(socket_t client, char *buffer, int *used, session_t *session, int *ended)
{
	for (;;) {
		fd_set readable;
		FD_ZERO(&readable);
		FD_SET(client, &readable);
		struct timeval nothing = { 0, 0 };
		int ready = select((int)client + 1, &readable, NULL, NULL, &nothing);
		if (ready <= 0) {
			return 0;
		}
		char chunk[512];
		int got = (int)recv(client, chunk, sizeof chunk, 0);
		if (got <= 0) {
			return -1;
		}
		for (int at = 0; at < got; at++) {
			char c = chunk[at];
			if (c == '\n') {
				buffer[*used] = '\0';
				char out[FRAME_MAX];
				command_t command;
				command_status_t status = command_parse(buffer, &command);
				*used = 0;
				if (status != COMMAND_OK) {
					frame_ack(out, sizeof out, "?", session->recipe.tick, 0, "BAD_COMMAND",
							status == COMMAND_TOO_LONG ? "the line is too long" : "not a command object");
					if (send_line(client, out) < 0) {
						return -1;
					}
					continue;
				}
				if (strcmp(command.cmd, "inject") == 0) {
					char reason[160];
					int refused = session_inject(session, &command, reason, (int)sizeof reason);
					frame_ack(out, sizeof out, "inject", session->recipe.tick, refused == 0,
							refused == 0 ? NULL : "REFUSED", refused == 0 ? NULL : reason);
				}
				else if (strcmp(command.cmd, "abort") == 0) {
					session_abort(session);
					*ended = 1;
					frame_ack(out, sizeof out, "abort", session->recipe.tick, 1, NULL, NULL);
				}
				else if (strcmp(command.cmd, "status") == 0) {
					frame_ack(out, sizeof out, "status", session->recipe.tick, 1, NULL,
							recipe_state_name(session->recipe.state));
				}
				else {
					frame_ack(out, sizeof out, command.cmd, session->recipe.tick, 0, "BAD_COMMAND",
							"no such command");
				}
				if (send_line(client, out) < 0) {
					return -1;
				}
			}
			else if (*used + 1 < COMMAND_MAX) {
				buffer[(*used)++] = c;
			}
			else {
				*used = 0; /* an over-long line is dropped, and its ack says so on the next newline */
			}
		}
	}
}

static int serve(socket_t client, const options_t *options)
{
	session_t session;
	session_begin(&session, options->seed, options->lot, options->wafer);
	if (options->random_fault) {
		session_random_fault(&session);
	}
	char out[FRAME_MAX];
	frame_hello(out, sizeof out, options->seed, options->lot, options->wafer, session.run_key);
	if (send_line(client, out) < 0) {
		return -1;
	}
	interlock_t start = session_start(&session);
	if (start != IL_OK) {
		char detail[160];
		interlock_detail(start, &session.chamber, detail, (int)sizeof detail);
		frame_ack(out, sizeof out, "start", 0, 0, interlock_name(start), detail);
		send_line(client, out);
		frame_end(out, sizeof out, "REFUSED", 0, NULL);
		send_line(client, out);
		return 0;
	}
	char buffer[COMMAND_MAX];
	int used = 0;
	int ended = 0;
	/* Each tick has a moment it is due, counted from the start. The stream sleeps only when it is ahead of that
	 * schedule, and by however far ahead it is, so a sleep that the system rounds up (Windows rounds to about
	 * 15.6 ms) is paid back by the ticks after it instead of slowing every tick down: --rate=60 really is 60 */
	double started = now_seconds();
	long ticks = 0;
	while (session_running(&session) && !ended) {
		if (drain(client, buffer, &used, &session, &ended) < 0) {
			return -1;
		}
		if (ended) {
			break;
		}
		session_tick(&session);
		frame_sample(out, sizeof out, session.recipe.tick, session.chamber.time_s,
				recipe_state_name(session.recipe.state), session.recipe.cycle, session.values);
		if (send_line(client, out) < 0) {
			return -1;
		}
		ticks++;
		if (options->rate > 0.0) {
			double due = started + ticks * RECIPE_TICK_S / options->rate;
			double ahead = due - now_seconds();
			if (ahead > 0.0) {
				sleep_seconds(ahead);
			}
		}
	}
	const char *reason = (session.recipe.state == STATE_ABORTED) ? "ABORTED" : "COMPLETE";
	frame_end(out, sizeof out, reason, session.samples,
			session.fault.kind == FAULT_NONE ? NULL : &session.fault);
	send_line(client, out);
	return 0;
}

static void usage(void)
{
	fprintf(stderr,
			"chamber-sim: streams one wafer's etch over TCP as JSON lines\n"
			"  --seed=N        the run's seed, which decides it completely (default 7)\n"
			"  --lot=N         the lot number (default 1)\n"
			"  --wafer=N       the wafer's position in the lot (default 1)\n"
			"  --port=N        the port to listen on, 0 for any (default 5610)\n"
			"  --host=ADDR     the address to bind (default 127.0.0.1)\n"
			"  --rate=N        N times real time; 0 runs with no waiting (default 1)\n"
			"  --fault=random  put a seeded fault into the run\n");
}

static int parse_options(int argc, char **argv, options_t *options)
{
	options->seed = 7;
	options->lot = 1;
	options->wafer = 1;
	options->port = 5610;
	options->rate = 1.0;
	options->random_fault = 0;
	options->host = "127.0.0.1";
	for (int at = 1; at < argc; at++) {
		const char *argument = argv[at];
		if (strncmp(argument, "--seed=", 7) == 0) {
			options->seed = strtoull(argument + 7, NULL, 10);
		}
		else if (strncmp(argument, "--lot=", 6) == 0) {
			options->lot = atoi(argument + 6);
		}
		else if (strncmp(argument, "--wafer=", 8) == 0) {
			options->wafer = atoi(argument + 8);
		}
		else if (strncmp(argument, "--port=", 7) == 0) {
			options->port = atoi(argument + 7);
		}
		else if (strncmp(argument, "--host=", 7) == 0) {
			options->host = argument + 7;
		}
		else if (strncmp(argument, "--rate=", 7) == 0) {
			options->rate = atof(argument + 7);
		}
		else if (strcmp(argument, "--fault=random") == 0) {
			options->random_fault = 1;
		}
		else {
			usage();
			return -1;
		}
	}
	return 0;
}

int main(int argc, char **argv)
{
	options_t options;
	if (parse_options(argc, argv, &options) < 0) {
		return 2;
	}
#ifdef _WIN32
	WSADATA winsock;
	if (WSAStartup(MAKEWORD(2, 2), &winsock) != 0) {
		fprintf(stderr, "cannot start winsock\n");
		return 1;
	}
#endif
	socket_t listener = socket(AF_INET, SOCK_STREAM, 0);
	if (listener == BAD_SOCKET) {
		fprintf(stderr, "cannot open a socket\n");
		return 1;
	}
	int yes = 1;
	setsockopt(listener, SOL_SOCKET, SO_REUSEADDR, (const char *)&yes, sizeof yes);
	struct sockaddr_in address;
	memset(&address, 0, sizeof address);
	address.sin_family = AF_INET;
	address.sin_port = htons((unsigned short)options.port);
	address.sin_addr.s_addr = inet_addr(options.host);
	if (bind(listener, (struct sockaddr *)&address, sizeof address) != 0 || listen(listener, 1) != 0) {
		fprintf(stderr, "cannot listen on %s:%d\n", options.host, options.port);
		close_socket(listener);
		return 1;
	}
	struct sockaddr_in bound;
	socklen_t bound_size = sizeof bound;
	if (getsockname(listener, (struct sockaddr *)&bound, &bound_size) == 0) {
		printf("{\"type\":\"listening\",\"port\":%d}\n", (int)ntohs(bound.sin_port));
		fflush(stdout);
	}
	int status = 0;
	socket_t client = accept(listener, NULL, NULL);
	if (client == BAD_SOCKET) {
		fprintf(stderr, "no client\n");
		status = 1;
	}
	else {
		status = serve(client, &options) < 0 ? 1 : 0;
		close_socket(client);
	}
	close_socket(listener);
#ifdef _WIN32
	WSACleanup();
#endif
	return status;
}
